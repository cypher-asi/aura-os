#[allow(clippy::too_many_arguments)]
fn execute_run<'a>(
    executor: &'a ProcessExecutor,
    store: &'a ProcessStore,
    broadcast: &'a broadcast::Sender<serde_json::Value>,
    run: &'a ProcessRun,
    data_dir: &'a Path,
    rocks_store: &'a RocksStore,
    agent_service: &'a AgentService,
    org_service: &'a OrgService,
    auth_jwt: Option<&'a str>,
) -> Pin<Box<dyn Future<Output = Result<(), ProcessError>> + Send + 'a>> {
    Box::pin(async move {
        let jwt = auth_jwt
            .map(str::to_string)
            .or_else(|| rocks_store.get_jwt());
        let storage_sync_client =
            process_storage_sync_client(executor.storage_client.as_ref(), jwt.as_deref());
        let mut current_run = run.clone();
        current_run.status = ProcessRunStatus::Running;
        store.save_run(&current_run)?;
        if let Some((client, sync_jwt)) = storage_sync_client {
            sync_run_to_storage(client, sync_jwt, &current_run, false).await;
        }

        // When authoritative storage is enabled, fail closed on process graph
        // reads instead of reviving the local shadow copy.
        let nodes = if let Some((client, sync_jwt)) = storage_sync_client {
            let storage_nodes = if let Some(jwt) = sync_jwt {
                client
                    .list_process_nodes(&run.process_id.to_string(), jwt)
                    .await
            } else {
                client
                    .list_process_nodes_internal(&run.process_id.to_string())
                    .await
            };
            storage_nodes
                .map(|sn| sn.into_iter().map(conv_node).collect())
                .map_err(|error| {
                    authoritative_process_storage_error(
                        &run.process_id,
                        "load process nodes",
                        &error,
                    )
                })?
        } else {
            store.list_nodes(&run.process_id)?
        };
        let connections = if let Some((client, sync_jwt)) = storage_sync_client {
            let storage_connections = if let Some(jwt) = sync_jwt {
                client
                    .list_process_connections(&run.process_id.to_string(), jwt)
                    .await
            } else {
                client
                    .list_process_connections_internal(&run.process_id.to_string())
                    .await
            };
            storage_connections
                .map(|sc| sc.into_iter().map(conv_connection).collect())
                .map_err(|error| {
                    authoritative_process_storage_error(
                        &run.process_id,
                        "load process connections",
                        &error,
                    )
                })?
        } else {
            store.list_connections(&run.process_id)?
        };

        let sorted = topological_sort(&nodes, &connections)?;
        let reachable = reachable_from_ignition(&nodes, &connections);
        let sorted: Vec<ProcessNodeId> = sorted
            .into_iter()
            .filter(|id| reachable.contains(id))
            .collect();
        let nodes_by_id: HashMap<ProcessNodeId, &ProcessNode> =
            nodes.iter().map(|n| (n.node_id, n)).collect();

        let workspace_dir = data_dir
            .join("process-workspaces")
            .join(run.process_id.to_string())
            .join(run.run_id.to_string());
        tokio::fs::create_dir_all(&workspace_dir)
            .await
            .map_err(|e| {
                ProcessError::Execution(format!("Failed to create process workspace: {e}"))
            })?;
        let workspace_path = workspace_dir.to_string_lossy().to_string();

        // ── create spec + tasks ────────────────────────────────────────────
        let process = if let Some((client, sync_jwt)) = storage_sync_client {
            let storage_process = if let Some(jwt) = sync_jwt {
                client.get_process(&run.process_id.to_string(), jwt).await
            } else {
                client.get_process_internal(&run.process_id.to_string()).await
            };
            storage_process
                .map(conv_process)
                .map_err(|error| authoritative_process_read_error(&run.process_id, &error))?
        } else {
            store
                .get_process(&run.process_id)?
                .ok_or_else(|| ProcessError::NotFound(run.process_id.to_string()))?
        };
        let project_id = process
            .project_id
            .ok_or_else(|| ProcessError::Execution("Process has no project_id".into()))?;
        let storage = executor.storage_client.as_ref().ok_or_else(|| {
            ProcessError::Execution("StorageClient required for process execution".into())
        })?;
        let (spec_id_for_run, node_task_ids) = create_spec_and_tasks(
            storage,
            jwt.as_deref(),
            &project_id,
            &process,
            &nodes,
            &sorted,
            &reachable,
            agent_service,
            org_service,
        )
        .await?;

        // node_id → output text (only present for completed nodes)
        let mut node_outputs: HashMap<ProcessNodeId, String> = HashMap::new();
        // condition node_id → whether it evaluated true
        let mut condition_results: HashMap<ProcessNodeId, bool> = HashMap::new();
        // aggregate usage across the run
        let mut run_input_tokens: u64 = 0;
        let mut run_output_tokens: u64 = 0;
        let mut run_cost_usd: f64 = 0.0;

        for &node_id in &sorted {
            let node = *nodes_by_id
                .get(&node_id)
                .ok_or_else(|| ProcessError::NodeNotFound(node_id.to_string()))?;

            if node.node_type == ProcessNodeType::Group {
                continue;
            }

            // ── gather upstream context ────────────────────────────────────
            let incoming: Vec<_> = connections
                .iter()
                .filter(|c| c.target_node_id == node_id)
                .collect();

            let mut upstream_parts: Vec<&str> = Vec::new();
            let mut has_valid_upstream = false;

            for conn in &incoming {
                if let Some(&cond_result) = condition_results.get(&conn.source_node_id) {
                    let is_false_edge = conn.source_handle.as_deref() == Some("false");
                    if (cond_result && is_false_edge) || (!cond_result && !is_false_edge) {
                        continue;
                    }
                }

                if let Some(output) = node_outputs.get(&conn.source_node_id) {
                    has_valid_upstream = true;
                    if !output.is_empty() {
                        upstream_parts.push(output);
                    }
                }
            }

            // Nodes with upstream dependencies but no valid completed parent → skip
            if !incoming.is_empty() && !has_valid_upstream {
                let now = Utc::now();
                record_terminal_event(
                    store,
                    broadcast,
                    run,
                    node,
                    ProcessEventStatus::Skipped,
                    "",
                    "",
                    now,
                    now,
                );
                continue;
            }

            let mut upstream_context = upstream_parts.join("\n\n---\n\n");

            // ── resolve input artifact refs ────────────────────────────────
            if let Some(refs) = node
                .config
                .get("input_artifact_refs")
                .and_then(|v| v.as_array())
            {
                for aref in refs {
                    if let Some(artifact_ctx) = resolve_artifact_ref(aref, store, data_dir).await {
                        if !upstream_context.is_empty() {
                            upstream_context.push_str("\n\n---\n\n");
                        }
                        upstream_context.push_str(&artifact_ctx);
                    }
                }
            }

            if let Some(vault_path) = node.config.get("vault_path").and_then(|v| v.as_str()) {
                if !vault_path.is_empty() {
                    upstream_context.push_str(&format!(
                        "\n\n## Obsidian Vault\n\nWrite output to: {vault_path}"
                    ));
                }
            }

            // ── persist + broadcast running status ───────────────────────────
            let node_started_at = Utc::now();
            let mut running_event = start_event(
                store,
                broadcast,
                run,
                node,
                &upstream_context,
                node_started_at,
            );

            // ── check for pinned output (skip execution) ──────────────────
            if let Some(pinned) = node.config.get("pinned_output").and_then(|v| v.as_str()) {
                if let Some(ref mut evt) = running_event {
                    complete_event(
                        store,
                        broadcast,
                        run,
                        node,
                        evt,
                        ProcessEventStatus::Completed,
                        pinned,
                        Utc::now(),
                        None,
                        None,
                    );
                } else {
                    record_terminal_event(
                        store,
                        broadcast,
                        run,
                        node,
                        ProcessEventStatus::Completed,
                        &upstream_context,
                        pinned,
                        node_started_at,
                        Utc::now(),
                    );
                }
                node_outputs.insert(node_id, pinned.to_string());

                emit_process_event(
                    store,
                    broadcast,
                    serde_json::json!({
                        "type": "process_run_progress",
                        "process_id": run.process_id.to_string(),
                        "run_id": run.run_id.to_string(),
                        "total_input_tokens": run_input_tokens,
                        "total_output_tokens": run_output_tokens,
                        "cost_usd": run_cost_usd,
                    }),
                );
                continue;
            }

            // ── execute node ───────────────────────────────────────────────
            if node.node_type == ProcessNodeType::Ignition {
                if let Some(ref override_text) = run.input_override {
                    let now = Utc::now();
                    if let Some(ref mut evt) = running_event {
                        complete_event(
                            store,
                            broadcast,
                            run,
                            node,
                            evt,
                            ProcessEventStatus::Completed,
                            override_text,
                            now,
                            None,
                            None,
                        );
                    }
                    node_outputs.insert(node_id, override_text.clone());
                    continue;
                }
            }

            let result: Result<NodeResult, ProcessError> = match node.node_type {
                ProcessNodeType::Ignition => execute_ignition(node).map(|s| NodeResult {
                    downstream_output: s,
                    display_output: None,
                    token_usage: None,
                    content_blocks: None,
                }),
                ProcessNodeType::Action
                | ProcessNodeType::Prompt
                | ProcessNodeType::Artifact
                | ProcessNodeType::Condition => {
                    let task_id = node_task_ids.get(&node_id).ok_or_else(|| {
                        ProcessError::Execution(format!("No task created for node {}", node_id))
                    })?;
                    let timeout_secs = node
                        .config
                        .get("timeout_seconds")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(DEFAULT_HARNESS_TIMEOUT_SECS);
                    execute_action_via_automaton(
                        node,
                        task_id,
                        &project_id,
                        &run.process_id,
                        &run.run_id,
                        &executor.automaton_client,
                        store,
                        storage,
                        &spec_id_for_run,
                        Some(broadcast),
                        &workspace_path,
                        timeout_secs,
                        jwt.as_deref(),
                        &executor.task_service,
                        agent_service,
                        org_service,
                        &upstream_context,
                        &executor.http_client,
                        &executor.router_url,
                        run_input_tokens,
                        run_output_tokens,
                        run_cost_usd,
                    )
                    .await
                }
                ProcessNodeType::Delay => execute_delay(node).await.map(|s| NodeResult {
                    downstream_output: s,
                    display_output: None,
                    token_usage: None,
                    content_blocks: None,
                }),
                ProcessNodeType::SubProcess => {
                    execute_subprocess(node, &upstream_context, executor, &run.run_id).await
                }
                ProcessNodeType::ForEach => {
                    execute_foreach(
                        node,
                        &upstream_context,
                        executor,
                        &project_id,
                        &run.run_id,
                        run_input_tokens,
                        run_output_tokens,
                        run_cost_usd,
                    )
                    .await
                }
                ProcessNodeType::Merge => {
                    let display = format!(
                        "Merged {} upstream output(s) ({} bytes)",
                        incoming.len(),
                        upstream_context.len(),
                    );
                    Ok(NodeResult {
                        downstream_output: upstream_context.clone(),
                        display_output: Some(display),
                        token_usage: None,
                        content_blocks: None,
                    })
                }
                ProcessNodeType::Group => unreachable!("Group nodes are filtered before execution"),
            };

            let node_completed_at = Utc::now();

            match result {
                Ok(node_result) => {
                    if node.node_type == ProcessNodeType::Condition {
                        condition_results.insert(
                            node_id,
                            parse_condition_result(&node_result.downstream_output),
                        );
                    }

                    if let Some(ref usage) = node_result.token_usage {
                        run_input_tokens += usage.input_tokens;
                        run_output_tokens += usage.output_tokens;
                        run_cost_usd += estimate_cost_usd(
                            usage.model.as_deref(),
                            usage.input_tokens,
                            usage.output_tokens,
                        );
                    }

                    current_run.total_input_tokens = Some(run_input_tokens);
                    current_run.total_output_tokens = Some(run_output_tokens);
                    current_run.cost_usd = Some(run_cost_usd);
                    store.save_run(&current_run)?;

                    let event_output = node_result
                        .display_output
                        .as_deref()
                        .unwrap_or(&node_result.downstream_output);

                    if let Some(ref mut evt) = running_event {
                        complete_event(
                            store,
                            broadcast,
                            run,
                            node,
                            evt,
                            ProcessEventStatus::Completed,
                            event_output,
                            node_completed_at,
                            node_result.token_usage.as_ref(),
                            node_result.content_blocks.as_deref(),
                        );
                    }

                    emit_process_event(
                        store,
                        broadcast,
                        serde_json::json!({
                            "type": "process_run_progress",
                            "process_id": run.process_id.to_string(),
                            "run_id": run.run_id.to_string(),
                            "total_input_tokens": run_input_tokens,
                            "total_output_tokens": run_output_tokens,
                            "cost_usd": run_cost_usd,
                        }),
                    );

                    if let Some(tid) = node_task_ids.get(&node_id) {
                        if let (Some(task_id), Some(spec_id)) =
                            (tid.parse().ok(), spec_id_for_run.parse().ok())
                        {
                            if let Err(e) = executor
                                .task_service
                                .transition_task(&project_id, &spec_id, &task_id, TaskStatus::Done)
                                .await
                            {
                                warn!(task_id = %tid, error = %e, "Failed to transition task to Done");
                            }
                        }
                    }

                    node_outputs.insert(node_id, node_result.downstream_output);
                }
                Err(e) => {
                    let err_msg = e.to_string();
                    if let Some(ref mut evt) = running_event {
                        complete_event(
                            store,
                            broadcast,
                            run,
                            node,
                            evt,
                            ProcessEventStatus::Failed,
                            &err_msg,
                            node_completed_at,
                            None,
                            None,
                        );
                    }

                    if let Some(tid) = node_task_ids.get(&node_id) {
                        if let (Some(task_id), Some(spec_id)) =
                            (tid.parse().ok(), spec_id_for_run.parse().ok())
                        {
                            if let Err(te) = executor
                                .task_service
                                .transition_task(
                                    &project_id,
                                    &spec_id,
                                    &task_id,
                                    TaskStatus::Failed,
                                )
                                .await
                            {
                                warn!(task_id = %tid, error = %te, "Failed to transition task to Failed");
                            }
                        }
                    }

                    current_run.status = ProcessRunStatus::Failed;
                    current_run.error = Some(err_msg);
                    current_run.completed_at = Some(Utc::now());
                    current_run.total_input_tokens = Some(run_input_tokens);
                    current_run.total_output_tokens = Some(run_output_tokens);
                    current_run.cost_usd = Some(run_cost_usd);
                    store.save_run(&current_run)?;
                    if let Some((client, sync_jwt)) = storage_sync_client {
                        sync_run_to_storage(client, sync_jwt, &current_run, false).await;
                    }

                    if let Some((client, sync_jwt)) = storage_sync_client {
                        if let Ok(events) = store.list_events_for_run(&run.process_id, &run.run_id)
                        {
                            for ev in &events {
                                sync_event_to_storage(client, sync_jwt, ev, true).await;
                            }
                        }
                        if let Ok(arts) = store.list_artifacts_for_run(&run.process_id, &run.run_id)
                        {
                            for art in &arts {
                                sync_artifact_to_storage(client, sync_jwt, art).await;
                            }
                        }
                    }

                    emit_process_event(
                        store,
                        broadcast,
                        serde_json::json!({
                            "type": "process_run_failed",
                            "process_id": run.process_id.to_string(),
                            "run_id": run.run_id.to_string(),
                            "error": current_run.error,
                            "total_input_tokens": run_input_tokens,
                            "total_output_tokens": run_output_tokens,
                            "cost_usd": run_cost_usd,
                        }),
                    );

                    return Err(e);
                }
            }
        }

        // Determine canonical run output from terminal (leaf) nodes — those with
        // no outgoing edges in the graph.
        let nodes_with_outgoing: std::collections::HashSet<ProcessNodeId> =
            connections.iter().map(|c| c.source_node_id).collect();
        let terminal_outputs: Vec<&str> = sorted
            .iter()
            .filter(|id| !nodes_with_outgoing.contains(id))
            .filter_map(|id| node_outputs.get(id).map(|s| s.as_str()))
            .collect();

        let run_output = if terminal_outputs.len() == 1 {
            Some(terminal_outputs[0].to_string())
        } else if terminal_outputs.len() > 1 {
            Some(terminal_outputs.join("\n\n---\n\n"))
        } else {
            None
        };

        current_run.status = ProcessRunStatus::Completed;
        current_run.completed_at = Some(Utc::now());
        current_run.total_input_tokens = Some(run_input_tokens);
        current_run.total_output_tokens = Some(run_output_tokens);
        current_run.cost_usd = Some(run_cost_usd);
        current_run.output = run_output;
        store.save_run(&current_run)?;
        if let Some((client, sync_jwt)) = storage_sync_client {
            sync_run_to_storage(client, sync_jwt, &current_run, false).await;
            if let Ok(events) = store.list_events_for_run(&run.process_id, &run.run_id) {
                for ev in &events {
                    sync_event_to_storage(client, sync_jwt, ev, true).await;
                }
            }
            if let Ok(arts) = store.list_artifacts_for_run(&run.process_id, &run.run_id) {
                for art in &arts {
                    sync_artifact_to_storage(client, sync_jwt, art).await;
                }
            }
        }

        emit_process_event(
            store,
            broadcast,
            serde_json::json!({
                "type": "process_run_completed",
                "process_id": run.process_id.to_string(),
                "run_id": run.run_id.to_string(),
                "total_input_tokens": run_input_tokens,
                "total_output_tokens": run_output_tokens,
                "cost_usd": run_cost_usd,
            }),
        );

        Ok(())
    }) // end Box::pin(async move { ... })
}
