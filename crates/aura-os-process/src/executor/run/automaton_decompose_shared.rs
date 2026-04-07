struct DecomposeActionBroadcastCtx<'a> {
    store: &'a ProcessStore,
    broadcast: Option<&'a broadcast::Sender<serde_json::Value>>,
    proj_str: &'a str,
    task_id: &'a str,
    pid_str: &'a str,
    rid_str: &'a str,
    nid_str: &'a str,
}

fn send_decompose_action_text(ctx: &DecomposeActionBroadcastCtx<'_>, message: &str) {
    if let Some(tx) = ctx.broadcast {
        send_process_text(
            ctx.store,
            tx,
            ctx.proj_str,
            ctx.task_id,
            ctx.pid_str,
            ctx.rid_str,
            ctx.nid_str,
            message,
        );
    }
}

struct DecomposeActionIdStrings {
    proj: String,
    pid: String,
    rid: String,
    nid: String,
}

impl DecomposeActionIdStrings {
    fn for_node(
        project_id: &ProjectId,
        process_id: &ProcessId,
        run_id: &ProcessRunId,
        node: &ProcessNode,
    ) -> Self {
        Self {
            proj: project_id.to_string(),
            pid: process_id.to_string(),
            rid: run_id.to_string(),
            nid: node.node_id.to_string(),
        }
    }

    fn broadcast_ctx<'a>(
        &'a self,
        store: &'a ProcessStore,
        broadcast: Option<&'a broadcast::Sender<serde_json::Value>>,
        task_id: &'a str,
    ) -> DecomposeActionBroadcastCtx<'a> {
        DecomposeActionBroadcastCtx {
            store,
            broadcast,
            proj_str: &self.proj,
            task_id,
            pid_str: &self.pid,
            rid_str: &self.rid,
            nid_str: &self.nid,
        }
    }
}

struct SingleAutomatonActionArgs<'a> {
    node: &'a ProcessNode,
    task_id: &'a str,
    project_id: &'a ProjectId,
    process_id: &'a ProcessId,
    run_id: &'a ProcessRunId,
    automaton_client: &'a AutomatonClient,
    store: &'a ProcessStore,
    storage_client: &'a StorageClient,
    broadcast: Option<&'a broadcast::Sender<serde_json::Value>>,
    project_path: &'a str,
    timeout_secs: u64,
    token: Option<&'a str>,
    task_service: &'a TaskService,
    agent_service: &'a AgentService,
    org_service: &'a OrgService,
    upstream_context: &'a str,
    run_base_input: u64,
    run_base_output: u64,
    run_base_cost: f64,
}

async fn run_single_automaton_action(
    args: SingleAutomatonActionArgs<'_>,
) -> Result<NodeResult, ProcessError> {
    execute_single_automaton(
        args.node,
        args.task_id,
        args.project_id,
        args.process_id,
        args.run_id,
        args.automaton_client,
        args.store,
        args.storage_client,
        args.broadcast,
        args.project_path,
        args.timeout_secs,
        args.token,
        args.task_service,
        args.agent_service,
        args.org_service,
        args.upstream_context,
        args.run_base_input,
        args.run_base_output,
        args.run_base_cost,
    )
    .await
}

fn initial_sub_task_plans(
    node: &ProcessNode,
    upstream_context: &str,
    plan_mode: ActionPlanMode,
) -> Vec<SubTaskPlan> {
    match plan_mode {
        ActionPlanMode::SinglePath => vec![single_sub_task(node, upstream_context)],
        ActionPlanMode::Decompose => plan_sub_tasks(node, upstream_context),
    }
}

async fn maybe_enrich_subtasks_with_llm(
    node: &ProcessNode,
    plan_mode: ActionPlanMode,
    sub_tasks: &mut Vec<SubTaskPlan>,
    http_client: &reqwest::Client,
    router_url: &str,
    token: Option<&str>,
    upstream_context: &str,
    ctx: &DecomposeActionBroadcastCtx<'_>,
) {
    if sub_tasks.len() > 1 || plan_mode != ActionPlanMode::Decompose {
        return;
    }
    let Some(jwt) = token else {
        return;
    };
    info!(node_id = %node.node_id, "Heuristic split found 1 task; attempting LLM-based planning");
    match plan_sub_tasks_via_llm(http_client, router_url, jwt, node, upstream_context).await {
        Ok(llm_tasks) if llm_tasks.len() > 1 => {
            info!(
                node_id = %node.node_id,
                sub_task_count = llm_tasks.len(),
                "LLM planning decomposed into {} sub-tasks",
                llm_tasks.len()
            );
            send_decompose_action_text(
                ctx,
                &format!(
                    "Planned {} sub-tasks via LLM decomposition.\n\n",
                    llm_tasks.len()
                ),
            );
            *sub_tasks = llm_tasks;
        }
        Ok(_) => {
            info!(node_id = %node.node_id, "LLM planning confirmed single task");
        }
        Err(e) => {
            warn!(node_id = %node.node_id, error = %e, "LLM planning failed; falling back to single execution");
        }
    }
}
