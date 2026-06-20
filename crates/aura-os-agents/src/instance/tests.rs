use super::*;

fn make_instance_with_role(role: AgentInstanceRole) -> AgentInstance {
    AgentInstance {
        agent_instance_id: AgentInstanceId::new(),
        project_id: ProjectId::new(),
        agent_id: AgentId::new(),
        org_id: None,
        name: "Atlas".to_string(),
        role: "Engineer".to_string(),
        personality: String::new(),
        system_prompt: String::new(),
        skills: Vec::new(),
        icon: None,
        machine_type: "local".to_string(),
        adapter_type: "aura_harness".to_string(),
        environment: "local_host".to_string(),
        auth_source: "aura_managed".to_string(),
        integration_id: None,
        default_model: None,
        workspace_path: None,
        status: AgentStatus::Idle,
        current_task_id: None,
        current_session_id: None,
        instance_role: role,
        source: None,
        total_input_tokens: 0,
        total_output_tokens: 0,
        model: None,
        permissions: Default::default(),
        intent_classifier: None,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
    }
}

#[test]
fn pick_run_template_prefers_loop_over_chat_over_other() {
    let chat = make_instance_with_role(AgentInstanceRole::Chat);
    let loop_inst = make_instance_with_role(AgentInstanceRole::Loop);
    let executor = make_instance_with_role(AgentInstanceRole::Executor);

    let all = [chat.clone(), loop_inst.clone(), executor.clone()];
    let pick = pick_run_template_from_instances(&all).expect("at least one instance available");
    assert_eq!(pick.agent_instance_id, loop_inst.agent_instance_id);

    let chat_and_exec = [chat.clone(), executor.clone()];
    let pick = pick_run_template_from_instances(&chat_and_exec).expect("chat fallback available");
    assert_eq!(pick.agent_instance_id, chat.agent_instance_id);

    let only_executor = make_instance_with_role(AgentInstanceRole::Executor);
    let executor_only = [only_executor.clone()];
    let pick = pick_run_template_from_instances(&executor_only).expect("executor-only fallback");
    assert_eq!(pick.agent_instance_id, only_executor.agent_instance_id);
}

#[test]
fn pick_run_template_returns_none_for_empty_slice() {
    assert!(pick_run_template_from_instances(&[]).is_none());
}

#[test]
fn pick_loop_template_prefers_chat_and_skips_executor() {
    let chat = make_instance_with_role(AgentInstanceRole::Chat);
    let executor = make_instance_with_role(AgentInstanceRole::Executor);

    let chat_and_exec = [chat.clone(), executor.clone()];
    let pick =
        pick_loop_template_from_instances(&chat_and_exec).expect("chat available as loop template");
    assert_eq!(pick.agent_instance_id, chat.agent_instance_id);

    let executor_only = [make_instance_with_role(AgentInstanceRole::Executor)];
    assert!(pick_loop_template_from_instances(&executor_only).is_none());
}

#[test]
fn pick_loop_template_returns_none_for_empty_slice() {
    assert!(pick_loop_template_from_instances(&[]).is_none());
}

#[test]
fn validate_transition_allows_restoring_archived_instance() {
    assert!(
        AgentInstanceService::validate_transition(AgentStatus::Archived, AgentStatus::Idle)
            .is_ok()
    );
}

fn service_with_temp_store() -> (AgentInstanceService, tempfile::TempDir) {
    let dir = tempfile::tempdir().expect("create tempdir");
    let store = Arc::new(SettingsStore::open(dir.path()).expect("open settings store"));
    let runtime: RuntimeAgentStateMap = Arc::new(tokio::sync::Mutex::new(HashMap::new()));
    (AgentInstanceService::new(store, None, runtime, None), dir)
}

#[tokio::test]
async fn ledger_records_loop_and_executor_but_not_chat() {
    let (svc, _dir) = service_with_temp_store();
    let project = ProjectId::new();
    let executor = AgentInstanceId::new();
    let loop_id = AgentInstanceId::new();
    let chat = AgentInstanceId::new();

    svc.record_system_instance(&project, &executor, AgentInstanceRole::Executor)
        .await;
    svc.record_system_instance(&project, &loop_id, AgentInstanceRole::Loop)
        .await;
    // Chat rows are user-facing and must never be ledgered.
    svc.record_system_instance(&project, &chat, AgentInstanceRole::Chat)
        .await;

    let ids = svc.system_instance_ids(&project);
    assert_eq!(ids.len(), 2);
    assert!(ids.contains(&executor));
    assert!(ids.contains(&loop_id));
    assert!(!ids.contains(&chat));

    // Only the executor is a reclaimable ephemeral row; the loop is
    // persistent and must not be swept.
    assert_eq!(svc.ledger_executor_ids(&project), vec![executor]);
}

#[tokio::test]
async fn ledger_is_scoped_per_project() {
    let (svc, _dir) = service_with_temp_store();
    let project_a = ProjectId::new();
    let project_b = ProjectId::new();
    let exec_a = AgentInstanceId::new();
    let exec_b = AgentInstanceId::new();

    svc.record_system_instance(&project_a, &exec_a, AgentInstanceRole::Executor)
        .await;
    svc.record_system_instance(&project_b, &exec_b, AgentInstanceRole::Executor)
        .await;

    let ids_a = svc.system_instance_ids(&project_a);
    assert!(ids_a.contains(&exec_a));
    assert!(!ids_a.contains(&exec_b));
    assert_eq!(svc.ledger_executor_ids(&project_b), vec![exec_b]);
}

#[tokio::test]
async fn ledger_forget_removes_only_the_target_entry() {
    let (svc, _dir) = service_with_temp_store();
    let project = ProjectId::new();
    let executor = AgentInstanceId::new();
    let loop_id = AgentInstanceId::new();

    svc.record_system_instance(&project, &executor, AgentInstanceRole::Executor)
        .await;
    svc.record_system_instance(&project, &loop_id, AgentInstanceRole::Loop)
        .await;

    svc.forget_system_instance(&executor).await;

    let ids = svc.system_instance_ids(&project);
    assert!(!ids.contains(&executor));
    assert!(ids.contains(&loop_id));

    // Forgetting an untracked id is a no-op and must not error.
    svc.forget_system_instance(&AgentInstanceId::new()).await;
    assert_eq!(svc.system_instance_ids(&project).len(), 1);
}

#[tokio::test]
async fn ledger_survives_reload_from_disk() {
    let dir = tempfile::tempdir().expect("create tempdir");
    let project = ProjectId::new();
    let executor = AgentInstanceId::new();
    {
        let store = Arc::new(SettingsStore::open(dir.path()).expect("open store"));
        let runtime: RuntimeAgentStateMap = Arc::new(tokio::sync::Mutex::new(HashMap::new()));
        let svc = AgentInstanceService::new(store, None, runtime, None);
        svc.record_system_instance(&project, &executor, AgentInstanceRole::Executor)
            .await;
    }
    // Re-open the store: the ledger is persisted, so a server restart
    // (which is what orphans dev-run executors) can still identify it.
    let store = Arc::new(SettingsStore::open(dir.path()).expect("reopen store"));
    let runtime: RuntimeAgentStateMap = Arc::new(tokio::sync::Mutex::new(HashMap::new()));
    let svc = AgentInstanceService::new(store, None, runtime, None);
    assert!(svc.system_instance_ids(&project).contains(&executor));
}
