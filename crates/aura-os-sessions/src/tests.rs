use super::*;
use aura_os_core::{AgentInstanceId, ProjectId, Session, SessionId, SessionStatus};
use chrono::Utc;
use std::sync::Arc;

#[tokio::test]
async fn should_rollover_at_threshold() {
    let tmp = tempfile::TempDir::new().expect("temp dir should be created");
    let store = Arc::new(
        aura_os_store::SettingsStore::open(tmp.path()).expect("SettingsStore should open"),
    );
    let svc = SessionService::new(store, 0.8, 150_000);

    let below = Session {
        session_id: SessionId::new(),
        agent_instance_id: AgentInstanceId::new(),
        project_id: ProjectId::new(),
        active_task_id: None,
        tasks_worked: vec![],
        context_usage_estimate: 0.79,
        total_input_tokens: 0,
        total_output_tokens: 0,
        summary_of_previous_context: String::new(),
        status: SessionStatus::Active,
        user_id: None,
        model: None,
        started_at: Utc::now(),
        ended_at: None,
    };
    assert!(!svc.should_rollover(&below));

    let at = Session {
        context_usage_estimate: 0.8,
        ..below.clone()
    };
    assert!(svc.should_rollover(&at));

    let above = Session {
        context_usage_estimate: 0.95,
        ..below
    };
    assert!(svc.should_rollover(&above));
}

#[tokio::test]
async fn create_session_returns_active_session() {
    let tmp = tempfile::TempDir::new().expect("temp dir should be created");
    let store = Arc::new(
        aura_os_store::SettingsStore::open(tmp.path()).expect("SettingsStore should open"),
    );
    let svc = SessionService::new(store, 0.8, 150_000);

    let pid = ProjectId::new();
    let aid = AgentInstanceId::new();
    let session = svc
        .create_session(CreateSessionParams {
            agent_instance_id: aid,
            project_id: pid,
            active_task_id: None,
            summary: "initial context".into(),
            user_id: None,
            model: None,
        })
        .await
        .expect("session creation should succeed");

    assert_eq!(session.status, SessionStatus::Active);
    assert_eq!(session.summary_of_previous_context, "initial context");
    assert_eq!(session.project_id, pid);
    assert_eq!(session.agent_instance_id, aid);
    assert_eq!(session.context_usage_estimate, 0.0);
}
