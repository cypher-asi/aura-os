#[allow(clippy::too_many_arguments)]
async fn execute_single_automaton(
    node: &ProcessNode,
    task_id: &str,
    project_id: &ProjectId,
    process_id: &ProcessId,
    run_id: &ProcessRunId,
    automaton_client: &AutomatonClient,
    storage_client: &StorageClient,
    broadcast: Option<&broadcast::Sender<serde_json::Value>>,
    project_path: &str,
    timeout_secs: u64,
    token: Option<&str>,
    _task_service: &TaskService,
    agent_service: &AgentService,
    org_service: &OrgService,
    upstream_context: &str,
    run_base_input: u64,
    run_base_output: u64,
    run_base_cost: f64,
) -> Result<NodeResult, ProcessError> {
    let binding = resolve_or_create_process_node_binding(
        storage_client,
        token.ok_or_else(|| ProcessError::Execution("No JWT for node execution".into()))?,
        project_id,
        node,
        agent_service,
        org_service,
    )
    .await?;

    let output_file = node
        .config
        .get("output_file")
        .and_then(|v| v.as_str())
        .unwrap_or("output.txt");
    let input_files = materialize_workspace_inputs(
        Path::new(project_path),
        &[
            (
                "process_node_prompt.txt",
                "original node prompt",
                node.prompt.as_str(),
            ),
            (
                "upstream_context.txt",
                "upstream node output and referenced artifacts",
                upstream_context,
            ),
        ],
    )
    .await?;
    let instructions = build_workspace_instructions(output_file, &input_files);
    let instructions_path = Path::new(project_path).join(".process-instructions");
    tokio::fs::write(&instructions_path, instructions.as_bytes())
        .await
        .map_err(|e| {
            ProcessError::Execution(format!(
                "Failed to write node instructions for {}: {e}",
                node.node_id
            ))
        })?;
    let session_id = create_process_task_session(
        storage_client,
        token,
        project_id,
        task_id,
        &node.label,
        &binding,
    )
    .await?;

    let authed_client = automaton_client
        .clone()
        .with_auth(token.map(|s| s.to_string()));
    let (start_result, events_tx) = match start_and_connect(
        &authed_client,
        AutomatonStartParams {
            project_id: project_id.to_string(),
            auth_token: token.map(|s| s.to_string()),
            model: Some(binding.model.clone()),
            workspace_root: Some(project_path.to_string()),
            task_id: Some(task_id.to_string()),
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
        Ok(result) => result,
        Err(e) => {
            if let Err(finalize_err) =
                finalize_process_task_session(storage_client, token, &session_id, "failed", 0, 0)
                    .await
            {
                warn!(
                    task_id = %task_id,
                    session_id = %session_id,
                    error = %finalize_err,
                    "Failed to mark process node session as failed after startup error"
                );
            }
            return Err(ProcessError::Execution(format!(
                "Failed to start automaton: {e}"
            )));
        }
    };

    info!(
        automaton_id = %start_result.automaton_id,
        task_id = %task_id,
        node_id = %node.node_id,
        "Automaton started for process node"
    );

    let rx = events_tx.subscribe();
    let proj = project_id.to_string();
    let tid = task_id.to_string();
    let pid = process_id.to_string();
    let rid = run_id.to_string();
    let nid = node.node_id.to_string();
    let tx = broadcast.cloned();

    let mut node_in: u64 = 0;
    let mut node_out: u64 = 0;

    let completion =
        collect_automaton_events(rx, Duration::from_secs(timeout_secs), |evt, evt_type| {
            if let Some(ref tx) = tx {
                if is_process_stream_forward_event(evt_type) {
                    forward_process_event(tx, &proj, &tid, &pid, &rid, &nid, evt, None);
                }
                if is_process_progress_broadcast_event(evt_type) {
                    let usage = evt.get("usage").unwrap_or(evt);
                    let (next_in, next_out, usage_model) =
                        merge_usage_totals(usage, node_in, node_out);
                    node_in = next_in;
                    node_out = next_out;
                    let cost = estimate_cost_usd(usage_model.as_deref(), node_in, node_out);
                    emit_process_event(
                        tx,
                        serde_json::json!({
                            "type": "process_run_progress",
                            "process_id": &pid,
                            "run_id": &rid,
                            "total_input_tokens": run_base_input + node_in,
                            "total_output_tokens": run_base_output + node_out,
                            "cost_usd": run_base_cost + cost,
                        }),
                    );
                }
            }
        })
        .await;

    let out = match completion {
        RunCompletion::Done(out) | RunCompletion::StreamClosed(out) => out,
        RunCompletion::Failed { message, .. } => {
            if let Err(e) = finalize_process_task_session(
                storage_client,
                token,
                &session_id,
                "failed",
                node_in,
                node_out,
            )
            .await
            {
                warn!(
                    task_id = %task_id,
                    session_id = %session_id,
                    error = %e,
                    "Failed to mark process node session as failed"
                );
            }
            return Err(ProcessError::Execution(message));
        }
        RunCompletion::Timeout(_) => {
            if let Err(e) = finalize_process_task_session(
                storage_client,
                token,
                &session_id,
                "failed",
                node_in,
                node_out,
            )
            .await
            {
                warn!(
                    task_id = %task_id,
                    session_id = %session_id,
                    error = %e,
                    "Failed to mark timed out process node session as failed"
                );
            }
            return Err(ProcessError::Execution(format!(
                "Automaton timed out after {timeout_secs}s for node {}",
                node.node_id
            )));
        }
    };

    let output_file_path = Path::new(project_path).join(output_file);
    let file_content = match tokio::fs::read_to_string(&output_file_path).await {
        Ok(content) if !content.trim().is_empty() => Some(content),
        _ => None,
    };

    let raw_downstream = file_content.unwrap_or_else(|| out.output_text.clone());

    if raw_downstream.trim().is_empty() {
        if let Err(e) = finalize_process_task_session(
            storage_client,
            token,
            &session_id,
            "failed",
            out.input_tokens,
            out.output_tokens,
        )
        .await
        {
            warn!(
                task_id = %task_id,
                session_id = %session_id,
                error = %e,
                "Failed to mark empty-output process node session as failed"
            );
        }
        return Err(ProcessError::Execution(format!(
            "Automaton produced no output for node {}",
            node.node_id
        )));
    }

    let downstream = compact_node_output(
        &node.config,
        &raw_downstream,
        OutputCompactionMode::Auto,
        "max_downstream_chars",
    );

    let rel_path = format!(
        "process-workspaces/{}/{}/{}",
        process_id, run_id, output_file
    );
    let artifact = ProcessArtifact {
        artifact_id: ProcessArtifactId::new(),
        process_id: *process_id,
        run_id: *run_id,
        node_id: node.node_id,
        artifact_type: ArtifactType::Document,
        name: output_file.to_string(),
        file_path: rel_path,
        size_bytes: raw_downstream.len() as u64,
        metadata: serde_json::json!({}),
        created_at: Utc::now(),
    };
    let target =
        process_storage_sync_target_from_client(storage_client, token).ok_or_else(|| {
            ProcessError::Execution(
                "aura-storage is required for process artifact persistence".into(),
            )
        })?;
    sync_artifact_to_storage(&target, &artifact).await?;

    if let Err(e) = finalize_process_task_session(
        storage_client,
        token,
        &session_id,
        "completed",
        out.input_tokens,
        out.output_tokens,
    )
    .await
    {
        warn!(
            task_id = %task_id,
            session_id = %session_id,
            error = %e,
            "Failed to finalize process node session"
        );
    }

    let token_usage = if out.input_tokens > 0 || out.output_tokens > 0 {
        Some(NodeTokenUsage {
            input_tokens: out.input_tokens,
            output_tokens: out.output_tokens,
            model: out.model,
        })
    } else {
        None
    };

    Ok(NodeResult {
        downstream_output: downstream,
        display_output: None,
        token_usage,
        content_blocks: if out.content_blocks.is_empty() {
            None
        } else {
            Some(out.content_blocks)
        },
    })
}

// ---------------------------------------------------------------------------
// Per-node execution
// ---------------------------------------------------------------------------
