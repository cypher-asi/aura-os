/// Create a new "running" event and persist + broadcast it.
fn start_event(
    store: &ProcessStore,
    broadcast: &broadcast::Sender<serde_json::Value>,
    run: &ProcessRun,
    node: &ProcessNode,
    input: &str,
    started_at: DateTime<Utc>,
) -> Option<ProcessEvent> {
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

    if let Err(e) = store.save_event(&event) {
        warn!(event_id = %event.event_id, error = %e, "Failed to save process event");
        return None;
    }

    broadcast_node_status(
        store,
        broadcast,
        run,
        node,
        ProcessEventStatus::Running,
        None,
    );
    Some(event)
}

/// Update an existing event to a terminal status (completed / failed / skipped)
/// and persist + broadcast the change.
fn complete_event(
    store: &ProcessStore,
    broadcast: &broadcast::Sender<serde_json::Value>,
    run: &ProcessRun,
    node: &ProcessNode,
    event: &mut ProcessEvent,
    status: ProcessEventStatus,
    output: &str,
    completed_at: DateTime<Utc>,
    token_usage: Option<&NodeTokenUsage>,
    content_blocks: Option<&[serde_json::Value]>,
) {
    event.status = status;
    event.output = output.to_string();
    event.completed_at = Some(completed_at);
    event.input_tokens = token_usage.map(|u| u.input_tokens);
    event.output_tokens = token_usage.map(|u| u.output_tokens);
    event.model = token_usage.and_then(|u| u.model.clone());
    event.content_blocks = content_blocks.map(sanitize_content_blocks);

    if let Err(e) = store.update_event(event) {
        warn!(event_id = %event.event_id, error = %e, "Failed to update process event");
    }

    broadcast_node_status(store, broadcast, run, node, status, token_usage);
}

/// Shortcut for events that need no running phase (skipped nodes, pinned output).
fn record_terminal_event(
    store: &ProcessStore,
    broadcast: &broadcast::Sender<serde_json::Value>,
    run: &ProcessRun,
    node: &ProcessNode,
    status: ProcessEventStatus,
    input: &str,
    output: &str,
    started_at: DateTime<Utc>,
    completed_at: DateTime<Utc>,
) {
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

    if let Err(e) = store.save_event(&event) {
        warn!(event_id = %event.event_id, error = %e, "Failed to save process event");
    }

    broadcast_node_status(store, broadcast, run, node, status, None);
}

fn broadcast_node_status(
    store: &ProcessStore,
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
    emit_process_event(store, broadcast, payload);
}
