use std::sync::Arc;

use aura_core::*;
use aura_services::{AgentError, AgentService, SessionService};
use aura_store::RocksStore;

fn create_store() -> Arc<RocksStore> {
    let dir = tempfile::tempdir().unwrap();
    Arc::new(RocksStore::open(dir.path()).unwrap())
}

fn setup_project(store: &RocksStore) -> ProjectId {
    let pid = ProjectId::new();
    let now = chrono::Utc::now();
    let project = Project {
        project_id: pid,
        org_id: OrgId::new(),
        name: "Test Project".into(),
        description: "desc".into(),
        linked_folder_path: ".".into(),
        requirements_doc_path: None,
        current_status: ProjectStatus::Planning,
        github_integration_id: None,
        github_repo_full_name: None,
        build_command: None,
        test_command: None,
        created_at: now,
        updated_at: now,
    };
    store.put_project(&project).unwrap();
    pid
}

// ---------------------------------------------------------------------------
// Agent Transition Tests
// ---------------------------------------------------------------------------

#[test]
fn agent_create_starts_idle() {
    let store = create_store();
    let svc = AgentService::new(store.clone());
    let pid = setup_project(&store);

    let agent = svc.create_agent(&pid, "Agent-1".into()).unwrap();
    assert_eq!(agent.status, AgentStatus::Idle);
    assert!(agent.current_task_id.is_none());
    assert!(agent.current_session_id.is_none());
}

#[test]
fn agent_idle_to_working_via_start_working() {
    let store = create_store();
    let svc = AgentService::new(store.clone());
    let pid = setup_project(&store);

    let agent = svc.create_agent(&pid, "Agent-1".into()).unwrap();
    let tid = TaskId::new();
    let sid = SessionId::new();

    let working = svc
        .start_working(&pid, &agent.agent_id, &tid, &sid)
        .unwrap();
    assert_eq!(working.status, AgentStatus::Working);
    assert_eq!(working.current_task_id, Some(tid));
    assert_eq!(working.current_session_id, Some(sid));
}

#[test]
fn agent_working_to_idle_via_finish_working() {
    let store = create_store();
    let svc = AgentService::new(store.clone());
    let pid = setup_project(&store);

    let agent = svc.create_agent(&pid, "Agent-1".into()).unwrap();
    let tid = TaskId::new();
    let sid = SessionId::new();
    svc.start_working(&pid, &agent.agent_id, &tid, &sid)
        .unwrap();

    let idle = svc.finish_working(&pid, &agent.agent_id).unwrap();
    assert_eq!(idle.status, AgentStatus::Idle);
    assert!(idle.current_task_id.is_none());
}

#[test]
fn agent_legal_transitions_succeed() {
    let legal_pairs = vec![
        (AgentStatus::Idle, AgentStatus::Working),
        (AgentStatus::Working, AgentStatus::Idle),
        (AgentStatus::Working, AgentStatus::Blocked),
        (AgentStatus::Working, AgentStatus::Error),
        (AgentStatus::Working, AgentStatus::Stopped),
        (AgentStatus::Blocked, AgentStatus::Working),
        (AgentStatus::Idle, AgentStatus::Stopped),
        (AgentStatus::Stopped, AgentStatus::Idle),
        (AgentStatus::Error, AgentStatus::Idle),
    ];
    for (from, to) in legal_pairs {
        assert!(
            AgentService::validate_transition(from, to).is_ok(),
            "Expected {from:?} -> {to:?} to be legal"
        );
    }
}

#[test]
fn agent_illegal_transitions_fail() {
    let illegal_pairs = vec![
        (AgentStatus::Idle, AgentStatus::Blocked),
        (AgentStatus::Idle, AgentStatus::Error),
        (AgentStatus::Idle, AgentStatus::Idle),
        (AgentStatus::Working, AgentStatus::Working),
        (AgentStatus::Blocked, AgentStatus::Idle),
        (AgentStatus::Blocked, AgentStatus::Stopped),
        (AgentStatus::Error, AgentStatus::Working),
        (AgentStatus::Error, AgentStatus::Stopped),
        (AgentStatus::Stopped, AgentStatus::Working),
        (AgentStatus::Stopped, AgentStatus::Blocked),
    ];
    for (from, to) in illegal_pairs {
        let result = AgentService::validate_transition(from, to);
        assert!(result.is_err(), "Expected {from:?} -> {to:?} to be illegal");
        match result.unwrap_err() {
            AgentError::IllegalTransition { current, target } => {
                assert_eq!(current, from);
                assert_eq!(target, to);
            }
            _ => panic!("Wrong error variant"),
        }
    }
}

#[test]
fn agent_transition_via_service() {
    let store = create_store();
    let svc = AgentService::new(store.clone());
    let pid = setup_project(&store);

    let agent = svc.create_agent(&pid, "Agent-1".into()).unwrap();

    let stopped = svc
        .transition_agent(&pid, &agent.agent_id, AgentStatus::Stopped)
        .unwrap();
    assert_eq!(stopped.status, AgentStatus::Stopped);

    let idle = svc
        .transition_agent(&pid, &stopped.agent_id, AgentStatus::Idle)
        .unwrap();
    assert_eq!(idle.status, AgentStatus::Idle);
}

#[test]
fn agent_not_found() {
    let store = create_store();
    let svc = AgentService::new(store.clone());
    let pid = ProjectId::new();
    let aid = AgentId::new();

    let result = svc.get_agent(&pid, &aid);
    assert!(matches!(result, Err(AgentError::NotFound)));
}

#[test]
fn agent_list() {
    let store = create_store();
    let svc = AgentService::new(store.clone());
    let pid = setup_project(&store);

    svc.create_agent(&pid, "Agent-1".into()).unwrap();
    svc.create_agent(&pid, "Agent-2".into()).unwrap();

    let agents = svc.list_agents(&pid).unwrap();
    assert_eq!(agents.len(), 2);
}

// ---------------------------------------------------------------------------
// Session Lifecycle Tests
// ---------------------------------------------------------------------------

#[test]
fn session_create_active() {
    let store = create_store();
    let svc = SessionService::new(store.clone());
    let pid = ProjectId::new();
    let aid = AgentId::new();

    let session = svc.create_session(&aid, &pid, None, String::new(), None, None).unwrap();
    assert_eq!(session.status, SessionStatus::Active);
    assert_eq!(session.context_usage_estimate, 0.0);
    assert!(session.ended_at.is_none());
    assert!(session.summary_of_previous_context.is_empty());
}

#[test]
fn session_update_context_usage() {
    let store = create_store();
    let svc = SessionService::new(store.clone());
    let pid = ProjectId::new();
    let aid = AgentId::new();

    let session = svc.create_session(&aid, &pid, None, String::new(), None, None).unwrap();

    // 50k input + 50k output = 100k / 200k = 0.5
    let updated = svc
        .update_context_usage(&pid, &aid, &session.session_id, 50_000, 50_000)
        .unwrap();
    assert!((updated.context_usage_estimate - 0.5).abs() < f64::EPSILON);
}

#[test]
fn session_context_usage_accumulates() {
    let store = create_store();
    let svc = SessionService::new(store.clone());
    let pid = ProjectId::new();
    let aid = AgentId::new();

    let session = svc.create_session(&aid, &pid, None, String::new(), None, None).unwrap();

    // Turn 1: 20k / 200k = 0.1
    svc.update_context_usage(&pid, &aid, &session.session_id, 10_000, 10_000)
        .unwrap();
    // Turn 2: another 0.1 => 0.2
    let s = svc
        .update_context_usage(&pid, &aid, &session.session_id, 10_000, 10_000)
        .unwrap();
    assert!((s.context_usage_estimate - 0.2).abs() < 1e-10);
}

#[test]
fn session_context_usage_caps_at_one() {
    let store = create_store();
    let svc = SessionService::new(store.clone());
    let pid = ProjectId::new();
    let aid = AgentId::new();

    let session = svc.create_session(&aid, &pid, None, String::new(), None, None).unwrap();

    // 300k tokens > 200k window => should cap at 1.0
    let s = svc
        .update_context_usage(&pid, &aid, &session.session_id, 200_000, 100_000)
        .unwrap();
    assert!((s.context_usage_estimate - 1.0).abs() < f64::EPSILON);
}

#[test]
fn session_should_rollover_threshold() {
    let store = create_store();
    let svc = SessionService::new(store.clone());
    let pid = ProjectId::new();
    let aid = AgentId::new();

    let session = svc.create_session(&aid, &pid, None, String::new(), None, None).unwrap();

    // Below threshold
    assert!(!svc.should_rollover(&session));

    // Push to exactly 0.5
    let s = svc
        .update_context_usage(&pid, &aid, &session.session_id, 50_000, 50_000)
        .unwrap();
    assert!(svc.should_rollover(&s));
}

#[test]
fn session_rollover_creates_new_session() {
    let store = create_store();
    let svc = SessionService::new(store.clone());
    let pid = ProjectId::new();
    let aid = AgentId::new();

    let session = svc.create_session(&aid, &pid, None, String::new(), None, None).unwrap();
    let old_id = session.session_id;

    let new_session = svc
        .rollover_session(&pid, &aid, &old_id, "Summary of work done".into(), None)
        .unwrap();

    // Old session should be RolledOver
    let old = svc.get_session(&pid, &aid, &old_id).unwrap();
    assert_eq!(old.status, SessionStatus::RolledOver);
    assert!(old.ended_at.is_some());

    // New session should be Active with summary
    assert_eq!(new_session.status, SessionStatus::Active);
    assert_eq!(new_session.context_usage_estimate, 0.0);
    assert_eq!(
        new_session.summary_of_previous_context,
        "Summary of work done"
    );
    assert_ne!(new_session.session_id, old_id);
}

#[test]
fn session_end_completed() {
    let store = create_store();
    let svc = SessionService::new(store.clone());
    let pid = ProjectId::new();
    let aid = AgentId::new();

    let session = svc.create_session(&aid, &pid, None, String::new(), None, None).unwrap();
    let ended = svc
        .end_session(&pid, &aid, &session.session_id, SessionStatus::Completed)
        .unwrap();

    assert_eq!(ended.status, SessionStatus::Completed);
    assert!(ended.ended_at.is_some());
}

#[test]
fn session_end_failed() {
    let store = create_store();
    let svc = SessionService::new(store.clone());
    let pid = ProjectId::new();
    let aid = AgentId::new();

    let session = svc.create_session(&aid, &pid, None, String::new(), None, None).unwrap();
    let ended = svc
        .end_session(&pid, &aid, &session.session_id, SessionStatus::Failed)
        .unwrap();

    assert_eq!(ended.status, SessionStatus::Failed);
    assert!(ended.ended_at.is_some());
}

#[test]
fn session_count() {
    let store = create_store();
    let svc = SessionService::new(store.clone());
    let pid = ProjectId::new();
    let aid = AgentId::new();

    assert_eq!(svc.session_count(&pid, &aid).unwrap(), 0);

    let s1 = svc.create_session(&aid, &pid, None, String::new(), None, None).unwrap();
    assert_eq!(svc.session_count(&pid, &aid).unwrap(), 1);

    svc.rollover_session(&pid, &aid, &s1.session_id, "summary".into(), None)
        .unwrap();
    assert_eq!(svc.session_count(&pid, &aid).unwrap(), 2);
}

#[test]
fn session_list() {
    let store = create_store();
    let svc = SessionService::new(store.clone());
    let pid = ProjectId::new();
    let aid = AgentId::new();

    svc.create_session(&aid, &pid, None, String::new(), None, None).unwrap();
    svc.create_session(&aid, &pid, None, "second".into(), None, None)
        .unwrap();

    let sessions = svc.list_sessions(&pid, &aid).unwrap();
    assert_eq!(sessions.len(), 2);
}

// ---------------------------------------------------------------------------
// Integration: Agent + Session coordination
// ---------------------------------------------------------------------------

#[test]
fn agent_session_integration() {
    let store = create_store();
    let agent_svc = AgentService::new(store.clone());
    let session_svc = SessionService::new(store.clone());
    let pid = setup_project(&store);

    let agent = agent_svc.create_agent(&pid, "dev-agent".into()).unwrap();
    let tid = TaskId::new();

    // Create session
    let session = session_svc
        .create_session(&agent.agent_id, &pid, Some(tid), String::new(), None, None)
        .unwrap();

    // Start working
    let working = agent_svc
        .start_working(&pid, &agent.agent_id, &tid, &session.session_id)
        .unwrap();
    assert_eq!(working.status, AgentStatus::Working);
    assert_eq!(working.current_session_id, Some(session.session_id));

    // Simulate context usage
    session_svc
        .update_context_usage(&pid, &agent.agent_id, &session.session_id, 60_000, 60_000)
        .unwrap();

    // Finish working
    agent_svc.finish_working(&pid, &agent.agent_id).unwrap();

    // Check rollover needed
    let updated = session_svc
        .get_session(&pid, &agent.agent_id, &session.session_id)
        .unwrap();
    assert!(session_svc.should_rollover(&updated));

    // Rollover
    let new_session = session_svc
        .rollover_session(
            &pid,
            &agent.agent_id,
            &session.session_id,
            "Completed task, wrote files".into(),
            None,
        )
        .unwrap();
    assert_eq!(new_session.status, SessionStatus::Active);
    assert_eq!(session_svc.session_count(&pid, &agent.agent_id).unwrap(), 2);
}
