/// One parallel decomposed sub-task: workspace, automaton session, event collection.
struct DecomposedSubtaskWorkerArgs {
    semaphore: Arc<tokio::sync::Semaphore>,
    automaton_client: AutomatonClient,
    sub_task_id: String,
    sub_project_id: ProjectId,
    sub_process_id: ProcessId,
    sub_run_id: ProcessRunId,
    sub_workspace_dir: PathBuf,
    sub_token: Option<String>,
    sub_timeout: u64,
    sub_node_id: ProcessNodeId,
    sub_title: String,
    sub_task_description: String,
    sub_node_prompt: String,
    broadcast_tx: Option<broadcast::Sender<serde_json::Value>>,
    task_usage_totals: Arc<Mutex<HashMap<String, NodeTokenUsage>>>,
    sub_model: String,
    sub_project_agent_id: String,
    sub_node_label: String,
    sub_storage_client: StorageClient,
    run_base_input: u64,
    run_base_output: u64,
    run_base_cost: f64,
}

struct DecomposedSubtaskWorkspacePrep {
    workspace_path: String,
}

struct SubtaskAutomatonConnection {
    session_id: String,
    events_tx: broadcast::Sender<serde_json::Value>,
}

fn log_finalize_subtask_session_failure(
    result: Result<(), ProcessError>,
    sub_task_id: &str,
    sub_session_id: &str,
    message: &'static str,
) {
    if let Err(e) = result {
        warn!(
            task_id = %sub_task_id,
            session_id = %sub_session_id,
            error = %e,
            "{}", message
        );
    }
}

async fn prepare_decomposed_subtask_workspace(
    sub_task_id: &str,
    sub_workspace_dir: &Path,
    sub_node_prompt: &str,
    sub_task_description: &str,
) -> Result<DecomposedSubtaskWorkspacePrep, ProcessError> {
    tokio::fs::create_dir_all(sub_workspace_dir)
        .await
        .map_err(|e| {
            ProcessError::Execution(format!(
                "Failed to create sub-task workspace for {sub_task_id}: {e}"
            ))
        })?;

    let output_file = format!("output-{}.txt", sub_task_id);
    let input_files = materialize_workspace_inputs(
        sub_workspace_dir,
        &[
            (
                "process_node_prompt.txt",
                "original node prompt",
                sub_node_prompt,
            ),
            (
                "sub_task_context.txt",
                "sub-task instructions and context",
                sub_task_description,
            ),
        ],
    )
    .await?;
    let instructions = build_workspace_instructions(&output_file, &input_files);
    let instructions_path = sub_workspace_dir.join(".process-instructions");
    tokio::fs::write(&instructions_path, instructions.as_bytes())
        .await
        .map_err(|e| {
            ProcessError::Execution(format!(
                "Failed to write sub-task instructions for {sub_task_id}: {e}"
            ))
        })?;
    let workspace_path = sub_workspace_dir.to_string_lossy().to_string();
    Ok(DecomposedSubtaskWorkspacePrep { workspace_path })
}

async fn start_decomposed_subtask_automaton_stream(
    args: &DecomposedSubtaskWorkerArgs,
    workspace_path: &str,
    session_id: &str,
) -> Result<broadcast::Sender<serde_json::Value>, ProcessError> {
    let authed_ac = args
        .automaton_client
        .clone()
        .with_auth(args.sub_token.clone());
    match start_and_connect(
        &authed_ac,
        AutomatonStartParams {
            project_id: args.sub_project_id.to_string(),
            auth_token: args.sub_token.clone(),
            model: Some(args.sub_model.clone()),
            workspace_root: Some(workspace_path.to_string()),
            task_id: Some(args.sub_task_id.clone()),
            git_repo_url: None,
            git_branch: None,
            installed_tools: None,
            installed_integrations: None,
            prior_failure: None,
            work_log: Vec::new(),
        },
        2,
    )
    .await
    {
        Ok((_start_result, events_tx)) => Ok(events_tx),
        Err(e) => {
            log_finalize_subtask_session_failure(
                finalize_process_task_session(
                    &args.sub_storage_client,
                    args.sub_token.as_deref(),
                    session_id,
                    "failed",
                    0,
                    0,
                )
                .await,
                &args.sub_task_id,
                session_id,
                "Failed to mark sub-task session as failed after startup error",
            );
            Err(ProcessError::Execution(format!(
                "Sub-task automaton failed: {e}"
            )))
        }
    }
}

async fn connect_decomposed_subtask_automaton(
    args: &DecomposedSubtaskWorkerArgs,
    workspace_path: &str,
) -> Result<SubtaskAutomatonConnection, ProcessError> {
    let session_id = create_process_task_session(
        &args.sub_storage_client,
        args.sub_token.as_deref(),
        &args.sub_project_id,
        &args.sub_task_id,
        &args.sub_node_label,
        &ProcessNodeExecutionBinding {
            project_agent_id: args.sub_project_agent_id.clone(),
            model: args.sub_model.clone(),
        },
    )
    .await?;

    let events_tx =
        start_decomposed_subtask_automaton_stream(args, workspace_path, &session_id).await?;

    Ok(SubtaskAutomatonConnection {
        session_id,
        events_tx,
    })
}

struct DecomposedSubtaskEventFwd {
    proj: String,
    tid: String,
    pid: String,
    rid: String,
    nid: String,
    title: String,
}

fn apply_decomposed_subtask_automaton_event(
    args: &DecomposedSubtaskWorkerArgs,
    evt: &serde_json::Value,
    evt_type: &str,
    fwd: &DecomposedSubtaskEventFwd,
) {
    if let Some(ref tx) = args.broadcast_tx {
        if is_process_stream_forward_event(evt_type) {
            forward_process_event(
                tx,
                &fwd.proj,
                &fwd.tid,
                &fwd.pid,
                &fwd.rid,
                &fwd.nid,
                evt,
                Some(&fwd.title),
            );
        }
        if is_process_progress_broadcast_event(evt_type) {
            let usage = evt.get("usage").unwrap_or(evt);
            let (total_in, total_out, usage_model) =
                merge_parallel_usage_totals(&args.task_usage_totals, &fwd.tid, usage);
            let cost = estimate_cost_usd(usage_model.as_deref(), total_in, total_out);
            emit_process_event(
                tx,
                serde_json::json!({
                    "type": "process_run_progress",
                    "process_id": &fwd.pid,
                    "run_id": &fwd.rid,
                    "total_input_tokens": args.run_base_input + total_in,
                    "total_output_tokens": args.run_base_output + total_out,
                    "cost_usd": args.run_base_cost + cost,
                }),
            );
        }
    }
}

async fn collect_decomposed_subtask_events(
    args: &DecomposedSubtaskWorkerArgs,
    conn: &SubtaskAutomatonConnection,
) -> RunCompletion {
    let rx = conn.events_tx.subscribe();
    let fwd = DecomposedSubtaskEventFwd {
        proj: args.sub_project_id.to_string(),
        tid: args.sub_task_id.clone(),
        pid: args.sub_process_id.to_string(),
        rid: args.sub_run_id.to_string(),
        nid: args.sub_node_id.to_string(),
        title: args.sub_title.clone(),
    };

    collect_automaton_events(
        rx,
        Duration::from_secs(args.sub_timeout),
        |evt, evt_type| {
            apply_decomposed_subtask_automaton_event(args, evt, evt_type, &fwd);
        },
    )
    .await
}

async fn finish_decomposed_subtask_success(
    args: &DecomposedSubtaskWorkerArgs,
    sub_session_id: &str,
    out: CollectedOutput,
) -> Result<(String, u64, u64, Option<String>), ProcessError> {
    log_finalize_subtask_session_failure(
        finalize_process_task_session(
            &args.sub_storage_client,
            args.sub_token.as_deref(),
            sub_session_id,
            "completed",
            out.input_tokens,
            out.output_tokens,
        )
        .await,
        &args.sub_task_id,
        sub_session_id,
        "Failed to finalize sub-task session",
    );
    let output_file_path = args
        .sub_workspace_dir
        .join(format!("output-{}.txt", args.sub_task_id));
    let file_content = match tokio::fs::read_to_string(&output_file_path).await {
        Ok(content) if !content.trim().is_empty() => Some(content),
        _ => None,
    };
    let final_output = file_content.unwrap_or(out.output_text);
    Ok((final_output, out.input_tokens, out.output_tokens, out.model))
}

async fn finish_decomposed_subtask_failed(
    args: &DecomposedSubtaskWorkerArgs,
    sub_session_id: &str,
    message: String,
) -> Result<(String, u64, u64, Option<String>), ProcessError> {
    log_finalize_subtask_session_failure(
        finalize_process_task_session(
            &args.sub_storage_client,
            args.sub_token.as_deref(),
            sub_session_id,
            "failed",
            0,
            0,
        )
        .await,
        &args.sub_task_id,
        sub_session_id,
        "Failed to mark sub-task session as failed",
    );
    Err(ProcessError::Execution(message))
}

async fn finish_decomposed_subtask_timeout(
    args: &DecomposedSubtaskWorkerArgs,
    sub_session_id: &str,
) -> Result<(String, u64, u64, Option<String>), ProcessError> {
    log_finalize_subtask_session_failure(
        finalize_process_task_session(
            &args.sub_storage_client,
            args.sub_token.as_deref(),
            sub_session_id,
            "failed",
            0,
            0,
        )
        .await,
        &args.sub_task_id,
        sub_session_id,
        "Failed to mark timed out sub-task session as failed",
    );
    Err(ProcessError::Execution(format!(
        "Sub-task timed out after {}s for node {}",
        args.sub_timeout, args.sub_node_id
    )))
}

async fn dispatch_decomposed_subtask_completion(
    args: &DecomposedSubtaskWorkerArgs,
    sub_session_id: &str,
    completion: RunCompletion,
) -> Result<(String, u64, u64, Option<String>), ProcessError> {
    match completion {
        RunCompletion::Done(out) | RunCompletion::StreamClosed(out) => {
            finish_decomposed_subtask_success(args, sub_session_id, out).await
        }
        RunCompletion::Failed { message, .. } => {
            finish_decomposed_subtask_failed(args, sub_session_id, message).await
        }
        RunCompletion::Timeout(_) => finish_decomposed_subtask_timeout(args, sub_session_id).await,
    }
}

async fn run_decomposed_subtask_worker(
    args: DecomposedSubtaskWorkerArgs,
) -> Result<(String, u64, u64, Option<String>), ProcessError> {
    let _permit = args
        .semaphore
        .acquire()
        .await
        .map_err(|e| ProcessError::Execution(format!("Semaphore error: {e}")))?;

    let prep = prepare_decomposed_subtask_workspace(
        &args.sub_task_id,
        &args.sub_workspace_dir,
        &args.sub_node_prompt,
        &args.sub_task_description,
    )
    .await?;

    let conn = connect_decomposed_subtask_automaton(&args, &prep.workspace_path).await?;

    let completion = collect_decomposed_subtask_events(&args, &conn).await;

    dispatch_decomposed_subtask_completion(&args, &conn.session_id, completion).await
}
