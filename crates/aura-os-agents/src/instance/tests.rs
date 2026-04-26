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
