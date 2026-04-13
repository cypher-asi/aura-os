struct ParallelDecomposeRunInput<'a> {
    node: &'a ProcessNode,
    project_id: &'a ProjectId,
    process_id: &'a ProcessId,
    run_id: &'a ProcessRunId,
    automaton_client: &'a AutomatonClient,
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
}

async fn storage_create_decomposed_subtask(
    inp: &ParallelDecomposeRunInput<'_>,
    idx: usize,
    sub_task: &SubTaskPlan,
    jwt: &str,
    binding: &ProcessNodeExecutionBinding,
    storage_client_for_subtasks: &StorageClient,
) -> Result<aura_os_storage::StorageTask, ProcessError> {
    let pid = inp.project_id.to_string();
    storage_client_for_subtasks
        .create_task(
            &pid,
            jwt,
            &aura_os_storage::CreateTaskRequest {
                spec_id: inp.spec_id.to_string(),
                title: sub_task.title.clone(),
                org_id: None,
                description: Some(format!(
                    "Original task instructions:\n{}\n\n---\nSub-task:\n{}",
                    inp.node.prompt, sub_task.description,
                )),
                status: Some("ready".to_string()),
                order_index: Some((idx + 100) as i32),
                dependency_ids: None,
                assigned_project_agent_id: Some(binding.project_agent_id.clone()),
            },
        )
        .await
        .map_err(|e| ProcessError::Execution(format!("Failed to create sub-task: {e}")))
}

fn spawn_decomposed_subtask_worker_for_created(
    inp: &ParallelDecomposeRunInput<'_>,
    sub_task: &SubTaskPlan,
    created_task: &aura_os_storage::StorageTask,
    binding: &ProcessNodeExecutionBinding,
    semaphore: Arc<tokio::sync::Semaphore>,
    shared_usage_totals: Arc<Mutex<HashMap<String, NodeTokenUsage>>>,
    storage_client_for_subtasks: StorageClient,
    parent_workspace: &Path,
) -> DecomposedSubtaskJoinHandle {
    let sub_workspace_dir = build_subtask_workspace(parent_workspace, &created_task.id);
    tokio::spawn(run_decomposed_subtask_worker(DecomposedSubtaskWorkerArgs {
        semaphore,
        automaton_client: inp.automaton_client.clone(),
        sub_task_id: created_task.id.clone(),
        sub_project_id: *inp.project_id,
        sub_process_id: *inp.process_id,
        sub_run_id: *inp.run_id,
        sub_workspace_dir,
        sub_token: inp.token.map(|s| s.to_string()),
        sub_timeout: inp.timeout_secs,
        sub_node_id: inp.node.node_id,
        sub_title: sub_task.title.clone(),
        sub_task_description: sub_task.description.clone(),
        sub_node_prompt: inp.node.prompt.clone(),
        broadcast_tx: inp.broadcast.cloned(),
        task_usage_totals: shared_usage_totals,
        sub_model: binding.model.clone(),
        sub_project_agent_id: binding.project_agent_id.clone(),
        sub_node_label: inp.node.label.clone(),
        sub_storage_client: storage_client_for_subtasks,
        run_base_input: inp.run_base_input,
        run_base_output: inp.run_base_output,
        run_base_cost: inp.run_base_cost,
    }))
}

async fn create_one_decomposed_subtask_worker(
    inp: &ParallelDecomposeRunInput<'_>,
    idx: usize,
    sub_tasks: &[SubTaskPlan],
    jwt: &str,
    binding: &ProcessNodeExecutionBinding,
    semaphore: Arc<tokio::sync::Semaphore>,
    shared_usage_totals: Arc<Mutex<HashMap<String, NodeTokenUsage>>>,
    storage_client_for_subtasks: StorageClient,
    parent_workspace: &Path,
) -> Result<DecomposedSubtaskJoinHandle, ProcessError> {
    let sub_task = &sub_tasks[idx];
    let created_task = storage_create_decomposed_subtask(
        inp,
        idx,
        sub_task,
        jwt,
        binding,
        &storage_client_for_subtasks,
    )
    .await?;

    info!(
        node_id = %inp.node.node_id,
        sub_task_idx = idx,
        sub_task_id = %created_task.id,
        title = %sub_task.title,
        "Created sub-task"
    );

    send_decompose_action_text(
        inp.bc,
        &format!(
            "  Creating task {}/{}... {}\n",
            idx + 1,
            sub_tasks.len(),
            sub_task.title
        ),
    );

    Ok(spawn_decomposed_subtask_worker_for_created(
        inp,
        sub_task,
        &created_task,
        binding,
        semaphore,
        shared_usage_totals,
        storage_client_for_subtasks,
        parent_workspace,
    ))
}

async fn spawn_all_decomposed_subtask_workers(
    inp: &ParallelDecomposeRunInput<'_>,
    sub_tasks: &[SubTaskPlan],
    jwt: &str,
    binding: &ProcessNodeExecutionBinding,
    semaphore: Arc<tokio::sync::Semaphore>,
    shared_usage_totals: Arc<Mutex<HashMap<String, NodeTokenUsage>>>,
    storage_client_for_subtasks: StorageClient,
    parent_workspace: &Path,
) -> Result<Vec<DecomposedSubtaskJoinHandle>, ProcessError> {
    let mut handles = Vec::with_capacity(sub_tasks.len());
    for idx in 0..sub_tasks.len() {
        handles.push(
            create_one_decomposed_subtask_worker(
                inp,
                idx,
                sub_tasks,
                jwt,
                binding,
                semaphore.clone(),
                shared_usage_totals.clone(),
                storage_client_for_subtasks.clone(),
                parent_workspace,
            )
            .await?,
        );
    }
    Ok(handles)
}

async fn parallel_decompose_spawn_handles(
    inp: &ParallelDecomposeRunInput<'_>,
    sub_tasks: &[SubTaskPlan],
) -> Result<(Vec<DecomposedSubtaskJoinHandle>, usize), ProcessError> {
    let requested_max_concurrency = inp
        .node
        .config
        .get("max_concurrency")
        .and_then(|v| v.as_u64())
        .unwrap_or(3) as usize;
    let max_concurrency = requested_max_concurrency.max(1);

    let jwt = inp
        .token
        .ok_or_else(|| ProcessError::Execution("No JWT for sub-task creation".into()))?;
    let binding = resolve_or_create_process_node_binding(
        inp.storage_client,
        jwt,
        inp.project_id,
        inp.node,
        inp.agent_service,
        inp.org_service,
    )
    .await?;
    let storage_client_for_subtasks = inp.storage_client.clone();

    let semaphore = Arc::new(tokio::sync::Semaphore::new(max_concurrency));
    let shared_usage_totals = Arc::new(Mutex::new(HashMap::<String, NodeTokenUsage>::new()));
    let parent_workspace = PathBuf::from(inp.project_path);

    let handles = spawn_all_decomposed_subtask_workers(
        inp,
        sub_tasks,
        jwt,
        &binding,
        semaphore,
        shared_usage_totals,
        storage_client_for_subtasks,
        &parent_workspace,
    )
    .await?;

    Ok((handles, max_concurrency))
}

async fn run_parallel_decomposed_subtasks(
    inp: ParallelDecomposeRunInput<'_>,
    sub_tasks: Vec<SubTaskPlan>,
) -> Result<NodeResult, ProcessError> {
    send_decompose_action_text(
        inp.bc,
        &format!("\n\nCreating {} sub-tasks...\n", sub_tasks.len()),
    );

    let (handles, max_concurrency) = parallel_decompose_spawn_handles(&inp, &sub_tasks).await?;

    send_decompose_action_text(
        inp.bc,
        &format!(
            "\nExecuting {} sub-tasks (max {} concurrent)...\n\n",
            sub_tasks.len(),
            max_concurrency
        ),
    );

    join_decomposed_subtask_handles(
        handles,
        &sub_tasks,
        inp.storage_client,
        inp.broadcast,
        inp.bc.proj_str,
        inp.bc.task_id,
        inp.bc.pid_str,
        inp.bc.rid_str,
        inp.bc.nid_str,
        inp.node,
        inp.project_path,
        inp.process_id,
        inp.run_id,
        inp.token,
    )
    .await
}
