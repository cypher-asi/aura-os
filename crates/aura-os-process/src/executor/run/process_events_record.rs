/// Create a new "running" event and persist + broadcast it.
async fn start_event(
    storage_target: &ProcessStorageSyncTarget,
    broadcast: &broadcast::Sender<serde_json::Value>,
    run: &ProcessRun,
    node: &ProcessNode,
    input: &str,
    started_at: DateTime<Utc>,
) -> Result<ProcessEvent, ProcessError> {
    let event = ProcessEvent {
        event_id: ProcessEventId::new(),
        run_id: run.run_id,
        node_id: node.node_id,
        process_id: run.process_id,
        status: ProcessEventStatus::Running,
        input_snapshot: summarize_input_snapshot(input),
        output: String::new(),
        started_at,
        completed_at: None,
        input_tokens: None,
        output_tokens: None,
        model: None,
        content_blocks: None,
    };

    sync_event_to_storage(storage_target, &event, true).await?;

    broadcast_node_status(broadcast, run, node, ProcessEventStatus::Running, None);
    Ok(event)
}

/// Update an existing event to a terminal status (completed / failed / skipped)
/// and persist + broadcast the change.
async fn complete_event(
    storage_target: &ProcessStorageSyncTarget,
    broadcast: &broadcast::Sender<serde_json::Value>,
    run: &ProcessRun,
    node: &ProcessNode,
    event: &mut ProcessEvent,
    status: ProcessEventStatus,
    output: &str,
    completed_at: DateTime<Utc>,
    token_usage: Option<&NodeTokenUsage>,
    content_blocks: Option<&[serde_json::Value]>,
) -> Result<(), ProcessError> {
    event.status = status;
    event.output = output.to_string();
    event.completed_at = Some(completed_at);
    event.input_tokens = token_usage.map(|u| u.input_tokens);
    event.output_tokens = token_usage.map(|u| u.output_tokens);
    event.model = token_usage.and_then(|u| u.model.clone());
    event.content_blocks = content_blocks.map(sanitize_content_blocks);

    sync_event_to_storage(storage_target, event, false).await?;

    broadcast_node_status(broadcast, run, node, status, token_usage);
    Ok(())
}

/// Shortcut for events that need no running phase (skipped nodes, pinned output).
async fn record_terminal_event(
    storage_target: &ProcessStorageSyncTarget,
    broadcast: &broadcast::Sender<serde_json::Value>,
    run: &ProcessRun,
    node: &ProcessNode,
    status: ProcessEventStatus,
    input: &str,
    output: &str,
    started_at: DateTime<Utc>,
    completed_at: DateTime<Utc>,
) -> Result<(), ProcessError> {
    let event = ProcessEvent {
        event_id: ProcessEventId::new(),
        run_id: run.run_id,
        node_id: node.node_id,
        process_id: run.process_id,
        status,
        input_snapshot: summarize_input_snapshot(input),
        output: output.to_string(),
        started_at,
        completed_at: Some(completed_at),
        input_tokens: None,
        output_tokens: None,
        model: None,
        content_blocks: None,
    };

    sync_event_to_storage(storage_target, &event, true).await?;

    broadcast_node_status(broadcast, run, node, status, None);
    Ok(())
}

fn broadcast_node_status(
    broadcast: &broadcast::Sender<serde_json::Value>,
    run: &ProcessRun,
    node: &ProcessNode,
    status: ProcessEventStatus,
    token_usage: Option<&NodeTokenUsage>,
) {
    let mut payload = serde_json::json!({
        "type": "process_node_executed",
        "process_id": run.process_id.to_string(),
        "run_id": run.run_id.to_string(),
        "node_id": node.node_id.to_string(),
        "node_type": format!("{:?}", node.node_type),
        "status": format!("{:?}", status),
    });
    if let Some(usage) = token_usage {
        payload["input_tokens"] = serde_json::json!(usage.input_tokens);
        payload["output_tokens"] = serde_json::json!(usage.output_tokens);
        if let Some(ref model) = usage.model {
            payload["model"] = serde_json::json!(model);
        }
    }
    emit_process_event(broadcast, payload);
}
