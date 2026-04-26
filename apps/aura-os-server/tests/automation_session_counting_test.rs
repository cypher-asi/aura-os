//! Integration test for automation runs counting toward the Sidekick
//! "Sessions" stat.
//!
//! `total_sessions` on `ProjectStats` is sourced from the
//! `sessions` table in aura-storage, which is populated by
//! `SessionService::create_session`. Until the dev-loop adapter and
//! forwarder were wired into `SessionService`, only the chat path
//! created session rows, so `total_sessions` was effectively
//! "completed chats" for any project that only ever ran automation.
//!
//! This test asserts the lifecycle the dev-loop adapter and forwarder
//! drive against `SessionService`:
//!
//! 1. `start_loop` / `run_single_task` call
//!    `SessionService::create_session` with the loop's
//!    `agent_instance_id`, materialising a row visible to
//!    `list_sessions` (and therefore to `total_sessions`).
//! 2. Every `task_started` event the forwarder receives invokes
//!    `SessionService::record_task_worked`, bumping
//!    `tasks_worked_count` so per-session work is reflected in stats.
//! 3. When the forwarder reaches terminal status it calls
//!    `SessionService::end_session` with `Completed` / `Failed`,
//!    flipping `status` and stamping `ended_at` so dashboards stop
//!    showing the run as in-flight.

mod common;

use aura_os_core::{AgentInstanceId, ProjectId, SessionStatus, TaskId};
use aura_os_sessions::CreateSessionParams;

use common::*;

#[tokio::test]
async fn automation_run_creates_updates_and_ends_storage_session() {
    let (_app, state, storage, _db) = build_test_app_with_storage().await;

    let project_id = ProjectId::new();
    let agent_instance_id = AgentInstanceId::new();
    let task_id = TaskId::new();

    // The dev-loop adapter calls `state.session_service.create_session`
    // before launching the harness automaton. The mock storage keys
    // sessions on the `project-agents/:id/sessions` path, where the
    // session service substitutes the `agent_instance_id` for the
    // `project_agent_id` (the chat path looks up the binding first;
    // automation doesn't have a separate binding to look up).
    let session = state
        .session_service
        .create_session(CreateSessionParams {
            agent_instance_id,
            project_id,
            active_task_id: Some(task_id),
            summary: String::new(),
            user_id: Some("u1".into()),
            model: Some("test-model".into()),
        })
        .await
        .expect("create_session should materialise a row in mock storage");
    let session_id = session.session_id;

    // Sanity: the row landed in mock storage and carries the routing
    // keys subscribers (and `total_sessions` aggregations) need.
    let stored = storage
        .list_sessions(&agent_instance_id.to_string(), TEST_JWT)
        .await
        .expect("list_sessions should succeed against mock storage");
    assert_eq!(
        stored.len(),
        1,
        "automation run should create exactly one storage session"
    );
    assert_eq!(stored[0].id, session_id.to_string());
    assert_eq!(stored[0].status.as_deref(), Some("active"));
    assert_eq!(stored[0].tasks_worked_count, Some(0));
    assert_eq!(
        stored[0].project_id.as_deref(),
        Some(&*project_id.to_string())
    );

    // The forwarder drives `record_task_worked` on every
    // `task_started` event. After two distinct task_starts the
    // per-session counter reflects both — exactly what the stats
    // dashboard renders for "tasks worked this session".
    state
        .session_service
        .record_task_worked(&project_id, &agent_instance_id, &session_id, task_id)
        .await
        .expect("first record_task_worked should succeed");
    state
        .session_service
        .record_task_worked(&project_id, &agent_instance_id, &session_id, TaskId::new())
        .await
        .expect("second record_task_worked should succeed");

    let after_tasks = storage
        .get_session(&session_id.to_string(), TEST_JWT)
        .await
        .expect("get_session should round-trip");
    assert_eq!(
        after_tasks.tasks_worked_count,
        Some(2),
        "tasks_worked_count must increment on every task_started event"
    );

    // On terminal status the forwarder ends the session with the
    // correct outcome (Completed for normal exit, Failed otherwise).
    // Either way the row stops looking active and `ended_at` is
    // stamped — the latter keeps dashboards from rendering an old run
    // as still in-flight after the WS stream is gone.
    state
        .session_service
        .end_session(
            &project_id,
            &agent_instance_id,
            &session_id,
            SessionStatus::Completed,
        )
        .await
        .expect("end_session should succeed");

    let after_end = storage
        .get_session(&session_id.to_string(), TEST_JWT)
        .await
        .expect("get_session should round-trip after end");
    assert_eq!(after_end.status.as_deref(), Some("completed"));
    assert!(
        after_end.ended_at.is_some(),
        "ending a session must stamp ended_at"
    );
}

#[tokio::test]
async fn failed_automation_run_marks_session_failed() {
    // Failed runs need to land in storage as `failed` — not `completed`
    // — so dashboards can distinguish "loop ran clean" from "loop hit
    // a terminal harness error". The forwarder flips this based on
    // whether the harness ended in success or failure; we exercise
    // the `Failed` branch end-to-end here.
    let (_app, state, storage, _db) = build_test_app_with_storage().await;

    let project_id = ProjectId::new();
    let agent_instance_id = AgentInstanceId::new();

    let session = state
        .session_service
        .create_session(CreateSessionParams {
            agent_instance_id,
            project_id,
            active_task_id: None,
            summary: String::new(),
            user_id: Some("u1".into()),
            model: None,
        })
        .await
        .expect("create_session should succeed");

    state
        .session_service
        .end_session(
            &project_id,
            &agent_instance_id,
            &session.session_id,
            SessionStatus::Failed,
        )
        .await
        .expect("end_session(Failed) should succeed");

    let stored = storage
        .get_session(&session.session_id.to_string(), TEST_JWT)
        .await
        .expect("get_session should succeed");
    assert_eq!(stored.status.as_deref(), Some("failed"));
}

#[tokio::test]
async fn parallel_automation_runs_do_not_share_sessions() {
    // The whole point of session-per-run is letting the Sidekick
    // count concurrent automation activity correctly. Two runs in
    // the same project under different `agent_instance_id`s must
    // produce two distinct session rows (one per loop), not one
    // shared row that gets clobbered by whichever finishes last.
    let (_app, state, storage, _db) = build_test_app_with_storage().await;

    let project_id = ProjectId::new();
    let aiid_a = AgentInstanceId::new();
    let aiid_b = AgentInstanceId::new();

    let session_a = state
        .session_service
        .create_session(CreateSessionParams {
            agent_instance_id: aiid_a,
            project_id,
            active_task_id: None,
            summary: String::new(),
            user_id: Some("u1".into()),
            model: None,
        })
        .await
        .expect("create_session a");
    let session_b = state
        .session_service
        .create_session(CreateSessionParams {
            agent_instance_id: aiid_b,
            project_id,
            active_task_id: None,
            summary: String::new(),
            user_id: Some("u1".into()),
            model: None,
        })
        .await
        .expect("create_session b");

    assert_ne!(
        session_a.session_id, session_b.session_id,
        "concurrent runs must mint distinct session ids"
    );

    let listed_a = storage
        .list_sessions(&aiid_a.to_string(), TEST_JWT)
        .await
        .expect("list_sessions a");
    let listed_b = storage
        .list_sessions(&aiid_b.to_string(), TEST_JWT)
        .await
        .expect("list_sessions b");
    assert_eq!(listed_a.len(), 1);
    assert_eq!(listed_b.len(), 1);
    assert_eq!(listed_a[0].id, session_a.session_id.to_string());
    assert_eq!(listed_b[0].id, session_b.session_id.to_string());
}
