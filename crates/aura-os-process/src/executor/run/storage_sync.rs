// Storage ↔ core conversions and best-effort sync to authoritative aura-storage
// when an internal token is configured (see `internal_process_sync_client`).
// Types come from the parent `run` module (`mod.rs` imports).

fn parse_dt(s: &Option<String>) -> chrono::DateTime<chrono::Utc> {
    s.as_deref()
        .and_then(|v| chrono::DateTime::parse_from_rfc3339(v).ok())
        .map(|dt| dt.with_timezone(&chrono::Utc))
        .unwrap_or_else(chrono::Utc::now)
}

fn parse_dt_opt(s: &Option<String>) -> Option<chrono::DateTime<chrono::Utc>> {
    s.as_deref()
        .and_then(|v| chrono::DateTime::parse_from_rfc3339(v).ok())
        .map(|dt| dt.with_timezone(&chrono::Utc))
}

fn parse_id<T: std::str::FromStr + Default>(s: &str) -> T {
    s.parse().unwrap_or_default()
}

fn parse_id_opt<T: std::str::FromStr>(s: &Option<String>) -> Option<T> {
    s.as_deref().and_then(|v| v.parse().ok())
}

fn parse_enum<T: serde::de::DeserializeOwned>(s: &str) -> Option<T> {
    serde_json::from_value(serde_json::Value::String(s.to_string())).ok()
}

pub(crate) fn conv_process(sp: StorageProcess) -> Process {
    Process {
        process_id: parse_id(&sp.id),
        org_id: parse_id(
            sp.org_id
                .as_deref()
                .unwrap_or("00000000-0000-0000-0000-000000000000"),
        ),
        user_id: sp.created_by.unwrap_or_default(),
        project_id: parse_id_opt(&sp.project_id),
        name: sp.name.unwrap_or_default(),
        description: sp.description.unwrap_or_default(),
        enabled: sp.enabled.unwrap_or(true),
        folder_id: parse_id_opt(&sp.folder_id),
        schedule: sp.schedule,
        tags: sp
            .tags
            .as_ref()
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|i| i.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default(),
        last_run_at: parse_dt_opt(&sp.last_run_at),
        next_run_at: parse_dt_opt(&sp.next_run_at),
        created_at: parse_dt(&sp.created_at),
        updated_at: parse_dt(&sp.updated_at),
    }
}

fn conv_node(sn: StorageProcessNode) -> ProcessNode {
    ProcessNode {
        node_id: parse_id(&sn.id),
        process_id: parse_id(sn.process_id.as_deref().unwrap_or_default()),
        node_type: sn
            .node_type
            .as_deref()
            .and_then(parse_enum)
            .unwrap_or(ProcessNodeType::Action),
        label: sn.label.unwrap_or_default(),
        agent_id: parse_id_opt::<AgentId>(&sn.agent_id),
        prompt: sn.prompt.unwrap_or_default(),
        config: sn.config.unwrap_or(serde_json::json!({})),
        position_x: sn.position_x.unwrap_or(0.0),
        position_y: sn.position_y.unwrap_or(0.0),
        created_at: parse_dt(&sn.created_at),
        updated_at: parse_dt(&sn.updated_at),
    }
}

fn conv_connection(sc: StorageProcessNodeConnection) -> ProcessNodeConnection {
    ProcessNodeConnection {
        connection_id: parse_id(&sc.id),
        process_id: parse_id(sc.process_id.as_deref().unwrap_or_default()),
        source_node_id: parse_id(sc.source_node_id.as_deref().unwrap_or_default()),
        source_handle: sc.source_handle,
        target_node_id: parse_id(sc.target_node_id.as_deref().unwrap_or_default()),
        target_handle: sc.target_handle,
    }
}

/// Attempt to sync a run to aura-storage. Failures are logged but not fatal.
async fn sync_run_to_storage(client: &StorageClient, run: &ProcessRun, is_create: bool) {
    if is_create {
        let req = aura_os_storage::CreateProcessRunRequest {
            id: Some(run.run_id.to_string()),
            process_id: run.process_id.to_string(),
            trigger: Some(
                serde_json::to_value(run.trigger)
                    .ok()
                    .and_then(|v| v.as_str().map(String::from))
                    .unwrap_or_else(|| "manual".to_string()),
            ),
            parent_run_id: run.parent_run_id.map(|id| id.to_string()),
            input_override: run.input_override.clone(),
        };
        if let Err(e) = client.create_process_run_internal(&req).await {
            warn!(run_id = %run.run_id, error = %e, "Failed to sync run create to storage");
        }
    } else {
        let req = aura_os_storage::UpdateProcessRunRequest {
            status: Some(
                serde_json::to_value(run.status)
                    .ok()
                    .and_then(|v| v.as_str().map(String::from))
                    .unwrap_or_default(),
            ),
            error: run.error.as_ref().map(|e| Some(e.clone())),
            completed_at: run.completed_at.map(|dt| Some(dt.to_rfc3339())),
            total_input_tokens: run.total_input_tokens.map(|v| v as i64),
            total_output_tokens: run.total_output_tokens.map(|v| v as i64),
            cost_usd: run.cost_usd,
            output: run.output.as_ref().map(|o| Some(o.clone())),
        };
        if let Err(e) = client
            .update_process_run_internal(&run.run_id.to_string(), &req)
            .await
        {
            warn!(run_id = %run.run_id, error = %e, "Failed to sync run update to storage");
        }
    }
}

/// Attempt to sync an event to aura-storage. Failures are logged but not fatal.
async fn sync_event_to_storage(client: &StorageClient, event: &ProcessEvent, is_create: bool) {
    if is_create {
        let req = aura_os_storage::CreateProcessEventRequest {
            id: Some(event.event_id.to_string()),
            run_id: event.run_id.to_string(),
            node_id: event.node_id.to_string(),
            process_id: event.process_id.to_string(),
            status: Some(
                serde_json::to_value(event.status)
                    .ok()
                    .and_then(|v| v.as_str().map(String::from))
                    .unwrap_or_default(),
            ),
            input_snapshot: Some(event.input_snapshot.clone()),
            output: Some(event.output.clone()),
        };
        if let Err(e) = client.create_process_event_internal(&req).await {
            warn!(event_id = %event.event_id, error = %e, "Failed to sync event create to storage");
        }
    } else {
        let req = aura_os_storage::UpdateProcessEventRequest {
            status: Some(
                serde_json::to_value(event.status)
                    .ok()
                    .and_then(|v| v.as_str().map(String::from))
                    .unwrap_or_default(),
            ),
            output: Some(event.output.clone()),
            completed_at: event.completed_at.map(|dt| Some(dt.to_rfc3339())),
            input_tokens: event.input_tokens.map(|v| v as i64),
            output_tokens: event.output_tokens.map(|v| v as i64),
            model: event.model.clone(),
            content_blocks: event
                .content_blocks
                .as_ref()
                .map(|blocks| serde_json::Value::Array(blocks.clone())),
        };
        if let Err(e) = client
            .update_process_event_internal(&event.event_id.to_string(), &req)
            .await
        {
            warn!(event_id = %event.event_id, error = %e, "Failed to sync event update to storage");
        }
    }
}

/// Attempt to sync an artifact to aura-storage. Failures are logged but not fatal.
async fn sync_artifact_to_storage(client: &StorageClient, artifact: &ProcessArtifact) {
    let req = aura_os_storage::CreateProcessArtifactRequest {
        id: Some(artifact.artifact_id.to_string()),
        process_id: artifact.process_id.to_string(),
        run_id: artifact.run_id.to_string(),
        node_id: artifact.node_id.to_string(),
        artifact_type: serde_json::to_value(artifact.artifact_type)
            .ok()
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or_else(|| "custom".to_string()),
        name: artifact.name.clone(),
        file_path: artifact.file_path.clone(),
        size_bytes: Some(artifact.size_bytes as i64),
        metadata: Some(artifact.metadata.clone()),
    };
    if let Err(e) = client.create_process_artifact_internal(&req).await {
        warn!(artifact_id = %artifact.artifact_id, error = %e, "Failed to sync artifact to storage");
    }
}

fn internal_process_sync_client(
    storage_client: Option<&Arc<StorageClient>>,
) -> Option<&StorageClient> {
    storage_client
        .map(Arc::as_ref)
        .filter(|client| client.has_internal_token())
}

fn authoritative_process_storage_error(
    process_id: &ProcessId,
    action: &str,
    error: &StorageError,
) -> ProcessError {
    ProcessError::Execution(format!(
        "Failed to {action} from authoritative process storage for process {process_id}: {error}"
    ))
}

fn authoritative_process_read_error(process_id: &ProcessId, error: &StorageError) -> ProcessError {
    match error {
        StorageError::Server { status: 404, .. } => ProcessError::NotFound(process_id.to_string()),
        _ => authoritative_process_storage_error(process_id, "load process", error),
    }
}
