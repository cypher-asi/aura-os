#[allow(clippy::too_many_arguments)]
fn parallel_decompose_run_input<'a>(
    node: &'a ProcessNode,
    project_id: &'a ProjectId,
    process_id: &'a ProcessId,
    run_id: &'a ProcessRunId,
    automaton_client: &'a AutomatonClient,
    store: &'a ProcessStore,
    storage_client: &'a StorageClient,
    spec_id: &'a str,
    broadcast: Option<&'a broadcast::Sender<serde_json::Value>>,
    project_path: &'a str,
    timeout_secs: u64,
    token: Option<&'a str>,
    agent_service: &'a AgentService,
    org_service: &'a OrgService,
    run_base_input: u64,
    run_base_output: u64,
    run_base_cost: f64,
    bc: &'a DecomposeActionBroadcastCtx<'a>,
) -> ParallelDecomposeRunInput<'a> {
    ParallelDecomposeRunInput {
        node,
        project_id,
        process_id,
        run_id,
        automaton_client,
        store,
        storage_client,
        spec_id,
        broadcast,
        project_path,
        timeout_secs,
        token,
        agent_service,
        org_service,
        run_base_input,
        run_base_output,
        run_base_cost,
        bc,
    }
}

async fn finalize_automaton_action_from_subtasks(
    single: SingleAutomatonActionArgs<'_>,
    spec_id: &str,
    sub_tasks: Vec<SubTaskPlan>,
    bc: &DecomposeActionBroadcastCtx<'_>,
) -> Result<NodeResult, ProcessError> {
    if sub_tasks.len() <= 1 {
        send_decompose_action_text(bc, "Single task — executing directly.\n\n");
        return run_single_automaton_action(single).await;
    }

    info!(
        node_id = %single.node.node_id,
        sub_task_count = sub_tasks.len(),
        "Executing node with decomposed sub-tasks"
    );

    let inp = parallel_decompose_run_input(
        single.node,
        single.project_id,
        single.process_id,
        single.run_id,
        single.automaton_client,
        single.store,
        single.storage_client,
        spec_id,
        single.broadcast,
        single.project_path,
        single.timeout_secs,
        single.token,
        single.agent_service,
        single.org_service,
        single.run_base_input,
        single.run_base_output,
        single.run_base_cost,
        bc,
    );
    run_parallel_decomposed_subtasks(inp, sub_tasks).await
}

async fn plan_automaton_sub_tasks_for_action(
    node: &ProcessNode,
    upstream_context: &str,
    http_client: &reqwest::Client,
    router_url: &str,
    token: Option<&str>,
    bc: &DecomposeActionBroadcastCtx<'_>,
) -> Vec<SubTaskPlan> {
    let plan_mode = resolve_action_plan_mode(&node.config);
    let mut sub_tasks = initial_sub_task_plans(node, upstream_context, plan_mode);
    maybe_enrich_subtasks_with_llm(
        node,
        plan_mode,
        &mut sub_tasks,
        http_client,
        router_url,
        token,
        upstream_context,
        bc,
    )
    .await;
    sub_tasks
}

#[allow(clippy::too_many_arguments)]
async fn execute_action_via_automaton(
    node: &ProcessNode,
    task_id: &str,
    project_id: &ProjectId,
    process_id: &ProcessId,
    run_id: &ProcessRunId,
    automaton_client: &AutomatonClient,
    store: &ProcessStore,
    storage_client: &StorageClient,
    spec_id: &str,
    broadcast: Option<&broadcast::Sender<serde_json::Value>>,
    project_path: &str,
    timeout_secs: u64,
    token: Option<&str>,
    task_service: &TaskService,
    agent_service: &AgentService,
    org_service: &OrgService,
    upstream_context: &str,
    http_client: &reqwest::Client,
    router_url: &str,
    run_base_input: u64,
    run_base_output: u64,
    run_base_cost: f64,
) -> Result<NodeResult, ProcessError> {
    let single = SingleAutomatonActionArgs {
        node,
        task_id,
        project_id,
        process_id,
        run_id,
        automaton_client,
        store,
        storage_client,
        broadcast,
        project_path,
        timeout_secs,
        token,
        task_service,
        agent_service,
        org_service,
        upstream_context,
        run_base_input,
        run_base_output,
        run_base_cost,
    };

    if node.node_type == ProcessNodeType::Condition {
        return run_single_automaton_action(single).await;
    }

    let ids = DecomposeActionIdStrings::for_node(project_id, process_id, run_id, node);
    let bc = ids.broadcast_ctx(store, broadcast, task_id);

    let sub_tasks = plan_automaton_sub_tasks_for_action(
        node,
        upstream_context,
        http_client,
        router_url,
        token,
        &bc,
    )
    .await;

    finalize_automaton_action_from_subtasks(single, spec_id, sub_tasks, &bc).await
}
