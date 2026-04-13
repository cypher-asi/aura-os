// Storage ↔ core conversions and authoritative storage access using a user JWT
// when present, otherwise the internal token (see `process_storage_sync_client`).
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

pub(crate) fn conv_node(sn: StorageProcessNode) -> ProcessNode {
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

pub(crate) fn conv_connection(sc: StorageProcessNodeConnection) -> ProcessNodeConnection {
    ProcessNodeConnection {
        connection_id: parse_id(&sc.id),
        process_id: parse_id(sc.process_id.as_deref().unwrap_or_default()),
        source_node_id: parse_id(sc.source_node_id.as_deref().unwrap_or_default()),
        source_handle: sc.source_handle,
        target_node_id: parse_id(sc.target_node_id.as_deref().unwrap_or_default()),
        target_handle: sc.target_handle,
    }
}

pub(crate) fn conv_run(sr: StorageProcessRun) -> ProcessRun {
    ProcessRun {
        run_id: parse_id(&sr.id),
        process_id: parse_id(sr.process_id.as_deref().unwrap_or_default()),
        status: sr
            .status
            .as_deref()
            .and_then(parse_enum)
            .unwrap_or(ProcessRunStatus::Pending),
        trigger: sr
            .trigger
            .as_deref()
            .and_then(parse_enum)
            .unwrap_or(ProcessRunTrigger::Manual),
        error: sr.error,
        started_at: parse_dt(&sr.started_at),
        completed_at: parse_dt_opt(&sr.completed_at),
        total_input_tokens: sr.total_input_tokens.map(|v| v as u64),
        total_output_tokens: sr.total_output_tokens.map(|v| v as u64),
        cost_usd: sr.cost_usd,
        output: sr.output,
        parent_run_id: parse_id_opt(&sr.parent_run_id),
        input_override: sr.input_override,
    }
}

pub(crate) type ProcessStorageSyncTarget = (Arc<StorageClient>, Option<String>);

/// Prefer a user JWT for desktop-triggered remote process access and fall back
/// to the internal token for service-owned paths.
pub(crate) fn process_storage_sync_client(
    storage_client: Option<&Arc<StorageClient>>,
    jwt: Option<&str>,
) -> Option<ProcessStorageSyncTarget> {
    let client = storage_client.cloned()?;
    if let Some(jwt) = jwt.filter(|token| !token.trim().is_empty()) {
        return Some((client, Some(jwt.to_string())));
    }
    client.has_internal_token().then_some((client, None))
}

pub(crate) fn process_storage_sync_target_from_client(
    storage_client: &StorageClient,
    jwt: Option<&str>,
) -> Option<ProcessStorageSyncTarget> {
    let client = Arc::new(storage_client.clone());
    if let Some(jwt) = jwt.filter(|token| !token.trim().is_empty()) {
        return Some((client, Some(jwt.to_string())));
    }
    client.has_internal_token().then_some((client, None))
}

pub(crate) async fn load_process_from_storage(
    target: &ProcessStorageSyncTarget,
    process_id: &ProcessId,
) -> Result<Process, ProcessError> {
    let (client, jwt) = target;
    let storage_process = if let Some(jwt) = jwt.as_deref() {
        client.get_process(&process_id.to_string(), jwt).await
    } else {
        client.get_process_internal(&process_id.to_string()).await
    };
    storage_process
        .map(conv_process)
        .map_err(|error| authoritative_process_read_error(process_id, &error))
}

pub(crate) async fn load_nodes_from_storage(
    target: &ProcessStorageSyncTarget,
    process_id: &ProcessId,
) -> Result<Vec<ProcessNode>, ProcessError> {
    let (client, jwt) = target;
    let storage_nodes = if let Some(jwt) = jwt.as_deref() {
        client
            .list_process_nodes(&process_id.to_string(), jwt)
            .await
    } else {
        client
            .list_process_nodes_internal(&process_id.to_string())
            .await
    };
    storage_nodes
        .map(|nodes| nodes.into_iter().map(conv_node).collect())
        .map_err(|error| {
            authoritative_process_storage_error(process_id, "load process nodes", &error)
        })
}

pub(crate) async fn load_connections_from_storage(
    target: &ProcessStorageSyncTarget,
    process_id: &ProcessId,
) -> Result<Vec<ProcessNodeConnection>, ProcessError> {
    let (client, jwt) = target;
    let storage_connections = if let Some(jwt) = jwt.as_deref() {
        client
            .list_process_connections(&process_id.to_string(), jwt)
            .await
    } else {
        client
            .list_process_connections_internal(&process_id.to_string())
            .await
    };
    storage_connections
        .map(|connections| connections.into_iter().map(conv_connection).collect())
        .map_err(|error| {
            authoritative_process_storage_error(process_id, "load process connections", &error)
        })
}

pub(crate) async fn sync_run_to_storage(
    target: &ProcessStorageSyncTarget,
    run: &ProcessRun,
    is_create: bool,
) -> Result<(), ProcessError> {
    let (client, jwt) = target;
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
        if let Some(jwt) = jwt.as_deref() {
            client
                .create_process_run(&run.process_id.to_string(), jwt, &req)
                .await
        } else {
            client.create_process_run_internal(&req).await
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
        if let Some(jwt) = jwt.as_deref() {
            client
                .update_process_run(
                    &run.process_id.to_string(),
                    &run.run_id.to_string(),
                    jwt,
                    &req,
                )
                .await
        } else {
            client
                .update_process_run_internal(&run.run_id.to_string(), &req)
                .await
        }
    }
    .map(|_| ())
    .map_err(|error| {
        ProcessError::Execution(format!(
            "Failed to persist run {} to aura-storage: {error}",
            run.run_id
        ))
    })
}

pub(crate) async fn sync_event_to_storage(
    target: &ProcessStorageSyncTarget,
    event: &ProcessEvent,
    is_create: bool,
) -> Result<(), ProcessError> {
    let (client, jwt) = target;
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
        if let Some(jwt) = jwt.as_deref() {
            client
                .create_process_event(
                    &event.process_id.to_string(),
                    &event.run_id.to_string(),
                    jwt,
                    &req,
                )
                .await
        } else {
            client.create_process_event_internal(&req).await
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
        if let Some(jwt) = jwt.as_deref() {
            client
                .update_process_event(&event.event_id.to_string(), jwt, &req)
                .await
        } else {
            client
                .update_process_event_internal(&event.event_id.to_string(), &req)
                .await
        }
    }
    .map(|_| ())
    .map_err(|error| {
        ProcessError::Execution(format!(
            "Failed to persist event {} to aura-storage: {error}",
            event.event_id
        ))
    })
}

pub(crate) async fn sync_artifact_to_storage(
    target: &ProcessStorageSyncTarget,
    artifact: &ProcessArtifact,
) -> Result<(), ProcessError> {
    let (client, jwt) = target;
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
    if let Some(jwt) = jwt.as_deref() {
        client
            .create_process_artifact(
                &artifact.process_id.to_string(),
                &artifact.run_id.to_string(),
                jwt,
                &req,
            )
            .await
    } else {
        client.create_process_artifact_internal(&req).await
    }
    .map(|_| ())
    .map_err(|error| {
        ProcessError::Execution(format!(
            "Failed to persist artifact {} to aura-storage: {error}",
            artifact.artifact_id
        ))
    })
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
