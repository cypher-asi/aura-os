mod common;
#[path = "context_rollover/task_counts.rs"]
mod task_counts;

use std::sync::Arc;

use aura_os_core::*;
use aura_os_sessions::{
    CreateSessionParams, RolloverSessionParams, SessionService, UpdateContextUsageParams,
};

use common::*;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn should_rollover_respects_threshold() {
    let tmp = tempfile::TempDir::new().expect("temp dir should be created");
    let store = Arc::new(
        aura_os_store::SettingsStore::open(tmp.path()).expect("SettingsStore should open"),
    );
    let svc = SessionService::new(store, 0.5, 200_000);

    let base = Session::dummy(ProjectId::new());

    let below = Session {
        context_usage_estimate: 0.49,
        ..base.clone()
    };
    assert!(
        !svc.should_rollover(&below),
        "below threshold should not trigger"
    );

    let at = Session {
        context_usage_estimate: 0.5,
        ..base.clone()
    };
    assert!(svc.should_rollover(&at), "at threshold should trigger");

    let above = Session {
        context_usage_estimate: 0.9,
        ..base.clone()
    };
    assert!(
        svc.should_rollover(&above),
        "above threshold should trigger"
    );
}

#[tokio::test]
async fn should_rollover_triggers_on_max_tasks() {
    let tmp = tempfile::TempDir::new().expect("temp dir should be created");
    let store = Arc::new(
        aura_os_store::SettingsStore::open(tmp.path()).expect("SettingsStore should open"),
    );
    let svc = SessionService::new(store, 0.99, 200_000);

    let base = Session::dummy(ProjectId::new());

    let seven_tasks = Session {
        tasks_worked: (0..7).map(|_| TaskId::new()).collect(),
        context_usage_estimate: 0.1,
        ..base.clone()
    };
    assert!(
        !svc.should_rollover(&seven_tasks),
        "7 tasks should not trigger"
    );

    let eight_tasks = Session {
        tasks_worked: (0..8).map(|_| TaskId::new()).collect(),
        context_usage_estimate: 0.1,
        ..base
    };
    assert!(svc.should_rollover(&eight_tasks), "8 tasks should trigger");
}

#[tokio::test]
async fn rollover_session_marks_old_and_creates_new() {
    let (storage_url, db) = start_mock_storage().await;
    let tmp = tempfile::TempDir::new().expect("temp dir should be created");
    let store = Arc::new(
        aura_os_store::SettingsStore::open(tmp.path()).expect("SettingsStore should open"),
    );
    store_test_jwt(&store);

    let svc = make_session_service(&store, &storage_url, 0.5);

    let pid = ProjectId::new();
    let aid = AgentInstanceId::new();

    let original = svc
        .create_session(CreateSessionParams {
            agent_instance_id: aid,
            project_id: pid,
            active_task_id: None,
            summary: String::new(),
            user_id: None,
            model: None,
        })
        .await
        .expect("create_session should succeed");

    assert_eq!(original.status, SessionStatus::Active);
    assert_eq!(original.context_usage_estimate, 0.0);

    let new_session = svc
        .rollover_session(RolloverSessionParams {
            project_id: pid,
            agent_instance_id: aid,
            session_id: original.session_id,
            summary: "Summary of previous work".into(),
            next_task_id: None,
        })
        .await
        .expect("rollover_session should succeed");

    assert_ne!(new_session.session_id, original.session_id);
    assert_eq!(new_session.status, SessionStatus::Active);
    assert_eq!(
        new_session.summary_of_previous_context,
        "Summary of previous work"
    );
    assert_eq!(new_session.context_usage_estimate, 0.0);

    let sessions = db.lock().await;
    let old = sessions
        .iter()
        .find(|s| s.id == original.session_id.to_string())
        .expect("old session should exist in storage");
    assert_eq!(old.status.as_deref(), Some("rolled_over"));
    assert!(
        old.ended_at.is_some(),
        "old session should have ended_at set"
    );
}

#[tokio::test]
async fn rollover_chain_creates_linked_sessions() {
    let (storage_url, db) = start_mock_storage().await;
    let tmp = tempfile::TempDir::new().expect("temp dir should be created");
    let store = Arc::new(
        aura_os_store::SettingsStore::open(tmp.path()).expect("SettingsStore should open"),
    );
    store_test_jwt(&store);

    let svc = make_session_service(&store, &storage_url, 0.3);

    let pid = ProjectId::new();
    let aid = AgentInstanceId::new();

    let s1 = svc
        .create_session(CreateSessionParams {
            agent_instance_id: aid,
            project_id: pid,
            active_task_id: None,
            summary: String::new(),
            user_id: None,
            model: None,
        })
        .await
        .expect("session creation should succeed");

    let s2 = svc
        .rollover_session(RolloverSessionParams {
            project_id: pid,
            agent_instance_id: aid,
            session_id: s1.session_id,
            summary: "work from s1".into(),
            next_task_id: None,
        })
        .await
        .expect("rollover should succeed");

    let s3 = svc
        .rollover_session(RolloverSessionParams {
            project_id: pid,
            agent_instance_id: aid,
            session_id: s2.session_id,
            summary: "work from s1 + s2".into(),
            next_task_id: None,
        })
        .await
        .expect("rollover should succeed");

    assert_eq!(s3.summary_of_previous_context, "work from s1 + s2");

    let sessions = db.lock().await;
    assert_eq!(sessions.len(), 3, "should have 3 sessions total");

    let rolled = sessions
        .iter()
        .filter(|s| s.status.as_deref() == Some("rolled_over"))
        .count();
    assert_eq!(rolled, 2, "first two sessions should be rolled_over");

    let active = sessions
        .iter()
        .filter(|s| s.status.as_deref() == Some("active"))
        .count();
    assert_eq!(active, 1, "only the latest session should be active");
}

#[tokio::test]
async fn update_context_usage_accumulates() {
    let (storage_url, _db) = start_mock_storage().await;
    let tmp = tempfile::TempDir::new().expect("temp dir should be created");
    let store = Arc::new(
        aura_os_store::SettingsStore::open(tmp.path()).expect("SettingsStore should open"),
    );
    store_test_jwt(&store);

    let svc = make_session_service(&store, &storage_url, 0.8);

    let pid = ProjectId::new();
    let aid = AgentInstanceId::new();

    let session = svc
        .create_session(CreateSessionParams {
            agent_instance_id: aid,
            project_id: pid,
            active_task_id: None,
            summary: String::new(),
            user_id: None,
            model: None,
        })
        .await
        .expect("session creation should succeed");

    // 40k tokens out of 200k context window = 0.2 usage
    let updated = svc
        .update_context_usage(UpdateContextUsageParams {
            project_id: pid,
            agent_instance_id: aid,
            session_id: session.session_id,
            input_tokens: 20_000,
            output_tokens: 20_000,
            total_input_tokens: None,
            total_output_tokens: None,
            context_usage_estimate: None,
        })
        .await
        .expect("context usage update should succeed");

    let expected = 40_000.0 / 200_000.0; // 0.2
    assert!(
        (updated.context_usage_estimate - expected).abs() < 0.001,
        "usage should be ~0.2, got {}",
        updated.context_usage_estimate
    );

    // Another 80k tokens -> total 120k/200k = 0.6
    let updated2 = svc
        .update_context_usage(UpdateContextUsageParams {
            project_id: pid,
            agent_instance_id: aid,
            session_id: session.session_id,
            input_tokens: 40_000,
            output_tokens: 40_000,
            total_input_tokens: None,
            total_output_tokens: None,
            context_usage_estimate: None,
        })
        .await
        .expect("context usage update should succeed");

    let expected2 = expected + 80_000.0 / 200_000.0; // 0.6
    assert!(
        (updated2.context_usage_estimate - expected2).abs() < 0.001,
        "usage should be ~0.6, got {}",
        updated2.context_usage_estimate
    );
}

#[tokio::test]
async fn context_usage_caps_at_one() {
    let (storage_url, _db) = start_mock_storage().await;
    let tmp = tempfile::TempDir::new().expect("temp dir should be created");
    let store = Arc::new(
        aura_os_store::SettingsStore::open(tmp.path()).expect("SettingsStore should open"),
    );
    store_test_jwt(&store);

    let svc = make_session_service(&store, &storage_url, 0.8);

    let pid = ProjectId::new();
    let aid = AgentInstanceId::new();

    let session = svc
        .create_session(CreateSessionParams {
            agent_instance_id: aid,
            project_id: pid,
            active_task_id: None,
            summary: String::new(),
            user_id: None,
            model: None,
        })
        .await
        .expect("session creation should succeed");

    // 500k tokens on a 200k window -> usage would be 2.5, should cap at 1.0
    let updated = svc
        .update_context_usage(UpdateContextUsageParams {
            project_id: pid,
            agent_instance_id: aid,
            session_id: session.session_id,
            input_tokens: 250_000,
            output_tokens: 250_000,
            total_input_tokens: None,
            total_output_tokens: None,
            context_usage_estimate: None,
        })
        .await
        .expect("context usage update should succeed");

    assert_eq!(
        updated.context_usage_estimate, 1.0,
        "usage should cap at 1.0"
    );
}

#[tokio::test]
async fn exact_context_usage_overrides_additive_estimate() {
    let (storage_url, _db) = start_mock_storage().await;
    let tmp = tempfile::TempDir::new().expect("temp dir should be created");
    let store = Arc::new(
        aura_os_store::SettingsStore::open(tmp.path()).expect("SettingsStore should open"),
    );
    store_test_jwt(&store);

    let svc = make_session_service(&store, &storage_url, 0.8);

    let pid = ProjectId::new();
    let aid = AgentInstanceId::new();

    let session = svc
        .create_session(CreateSessionParams {
            agent_instance_id: aid,
            project_id: pid,
            active_task_id: None,
            summary: String::new(),
            user_id: None,
            model: None,
        })
        .await
        .expect("session creation should succeed");

    let updated = svc
        .update_context_usage(UpdateContextUsageParams {
            project_id: pid,
            agent_instance_id: aid,
            session_id: session.session_id,
            input_tokens: 12_000,
            output_tokens: 4_000,
            total_input_tokens: Some(120_000),
            total_output_tokens: Some(30_000),
            context_usage_estimate: Some(0.73),
        })
        .await
        .expect("context usage update should succeed");

    assert_eq!(updated.total_input_tokens, 120_000);
    assert_eq!(updated.total_output_tokens, 30_000);
    assert!((updated.context_usage_estimate - 0.73).abs() < 0.001);
}

#[tokio::test]
async fn end_to_end_usage_triggers_rollover() {
    let (storage_url, db) = start_mock_storage().await;
    let tmp = tempfile::TempDir::new().expect("temp dir should be created");
    let store = Arc::new(
        aura_os_store::SettingsStore::open(tmp.path()).expect("SettingsStore should open"),
    );
    store_test_jwt(&store);

    let threshold = 0.5;
    let svc = make_session_service(&store, &storage_url, threshold);

    let pid = ProjectId::new();
    let aid = AgentInstanceId::new();

    let session = svc
        .create_session(CreateSessionParams {
            agent_instance_id: aid,
            project_id: pid,
            active_task_id: None,
            summary: String::new(),
            user_id: None,
            model: None,
        })
        .await
        .expect("session creation should succeed");

    // Push usage to 0.3 -> below threshold
    svc.update_context_usage(UpdateContextUsageParams {
        project_id: pid,
        agent_instance_id: aid,
        session_id: session.session_id,
        input_tokens: 30_000,
        output_tokens: 30_000,
        total_input_tokens: None,
        total_output_tokens: None,
        context_usage_estimate: None,
    })
    .await
    .expect("context usage update should succeed");

    let current = svc
        .get_session(&pid, &aid, &session.session_id)
        .await
        .expect("get session should succeed");
    assert!(
        !svc.should_rollover(&current),
        "0.3 usage should not trigger rollover at 0.5 threshold"
    );

    // Push usage to 0.6 -> above threshold
    svc.update_context_usage(UpdateContextUsageParams {
        project_id: pid,
        agent_instance_id: aid,
        session_id: session.session_id,
        input_tokens: 30_000,
        output_tokens: 30_000,
        total_input_tokens: None,
        total_output_tokens: None,
        context_usage_estimate: None,
    })
    .await
    .expect("context usage update should succeed");

    let current = svc
        .get_session(&pid, &aid, &session.session_id)
        .await
        .expect("get session should succeed");
    assert!(
        svc.should_rollover(&current),
        "0.6 usage should trigger rollover at 0.5 threshold"
    );

    // Perform rollover
    let new_session = svc
        .rollover_session(RolloverSessionParams {
            project_id: pid,
            agent_instance_id: aid,
            session_id: session.session_id,
            summary: "Completed auth module".into(),
            next_task_id: None,
        })
        .await
        .expect("rollover should succeed");

    assert_eq!(new_session.status, SessionStatus::Active);
    assert_eq!(new_session.context_usage_estimate, 0.0);
    assert_eq!(
        new_session.summary_of_previous_context,
        "Completed auth module"
    );

    let sessions = db.lock().await;
    assert_eq!(sessions.len(), 2);

    let old = sessions
        .iter()
        .find(|s| s.id == session.session_id.to_string())
        .expect("session should exist in storage");
    assert_eq!(old.status.as_deref(), Some("rolled_over"));
}
