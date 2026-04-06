use axum::extract::{Path, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use tracing::info;

use aura_os_core::{
    Process, ProcessArtifact, ProcessArtifactId, ProcessEvent, ProcessFolder, ProcessFolderId,
    ProcessId, ProcessNode, ProcessNodeConnection, ProcessNodeConnectionId, ProcessNodeId,
    ProcessNodeType, ProcessRun, ProcessRunId, ProcessRunTrigger, ProjectId,
};
use chrono::Utc;

use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthJwt, AuthSession};

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub(crate) struct CreateProcessRequest {
    pub name: String,
    pub description: Option<String>,
    pub project_id: String,
    pub folder_id: Option<String>,
    pub schedule: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Deserialize)]
pub(crate) struct UpdateProcessRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub project_id: Option<Option<String>>,
    pub folder_id: Option<Option<String>>,
    pub schedule: Option<String>,
    pub tags: Option<Vec<String>>,
    pub enabled: Option<bool>,
}

#[derive(Deserialize)]
pub(crate) struct CreateFolderRequest {
    pub name: String,
}

#[derive(Deserialize)]
pub(crate) struct UpdateFolderRequest {
    pub name: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct CreateNodeRequest {
    pub node_type: ProcessNodeType,
    pub label: String,
    pub agent_id: Option<String>,
    #[serde(default)]
    pub prompt: String,
    #[serde(default)]
    pub config: serde_json::Value,
    #[serde(default)]
    pub position_x: f64,
    #[serde(default)]
    pub position_y: f64,
}

#[derive(Deserialize)]
pub(crate) struct UpdateNodeRequest {
    pub label: Option<String>,
    pub agent_id: Option<String>,
    pub prompt: Option<String>,
    pub config: Option<serde_json::Value>,
    pub position_x: Option<f64>,
    pub position_y: Option<f64>,
}

#[derive(Deserialize)]
pub(crate) struct CreateConnectionRequest {
    pub source_node_id: String,
    pub source_handle: Option<String>,
    pub target_node_id: String,
    pub target_handle: Option<String>,
}

#[derive(Serialize)]
pub(crate) struct DeleteResponse {
    pub deleted: bool,
}

// ---------------------------------------------------------------------------
// Process CRUD
// ---------------------------------------------------------------------------

pub(crate) async fn create_process(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Json(req): Json<CreateProcessRequest>,
) -> ApiResult<Json<Process>> {
    let user_id = session
        .network_user_id
        .map(|id| id.to_string())
        .unwrap_or_else(|| session.user_id.clone());

    let project_id: ProjectId = req.project_id.parse()
        .map_err(|_| ApiError::bad_request("invalid project_id"))?;

    let now = Utc::now();
    let process = Process {
        process_id: ProcessId::new(),
        org_id: "default".parse().unwrap_or_default(),
        user_id,
        project_id: Some(project_id),
        name: req.name,
        description: req.description.unwrap_or_default(),
        enabled: true,
        folder_id: req.folder_id.and_then(|id| id.parse().ok()),
        schedule: req.schedule,
        tags: req.tags,
        last_run_at: None,
        next_run_at: None,
        created_at: now,
        updated_at: now,
    };

    state
        .super_agent_service
        .process_store
        .save_process(&process)
        .map_err(|e| ApiError::internal(e.to_string()))?;

    // Auto-create the Ignition node
    let ignition = ProcessNode {
        node_id: ProcessNodeId::new(),
        process_id: process.process_id,
        node_type: ProcessNodeType::Ignition,
        label: "Ignition".to_string(),
        agent_id: None,
        prompt: String::new(),
        config: serde_json::json!({}),
        position_x: 250.0,
        position_y: 50.0,
        created_at: now,
        updated_at: now,
    };
    state
        .super_agent_service
        .process_store
        .save_node(&ignition)
        .map_err(|e| ApiError::internal(e.to_string()))?;

    info!(process_id = %process.process_id, name = %process.name, "Process created");
    Ok(Json(process))
}

pub(crate) async fn list_processes(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
) -> ApiResult<Json<Vec<Process>>> {
    let processes = state
        .super_agent_service
        .process_store
        .list_processes()
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(processes))
}

pub(crate) async fn get_process(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path(id): Path<String>,
) -> ApiResult<Json<Process>> {
    let process_id: ProcessId = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid process ID"))?;

    let process = state
        .super_agent_service
        .process_store
        .get_process(&process_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| ApiError::not_found("process not found"))?;

    Ok(Json(process))
}

pub(crate) async fn update_process(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path(id): Path<String>,
    Json(req): Json<UpdateProcessRequest>,
) -> ApiResult<Json<Process>> {
    let process_id: ProcessId = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid process ID"))?;

    let mut process = state
        .super_agent_service
        .process_store
        .get_process(&process_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| ApiError::not_found("process not found"))?;

    if let Some(name) = req.name { process.name = name; }
    if let Some(desc) = req.description { process.description = desc; }
    if let Some(pid) = req.project_id {
        process.project_id = pid.and_then(|id| id.parse().ok());
    }
    if let Some(fid) = req.folder_id {
        process.folder_id = fid.and_then(|id| id.parse().ok());
    }
    if let Some(sched) = req.schedule { process.schedule = Some(sched); }
    if let Some(tags) = req.tags { process.tags = tags; }
    if let Some(enabled) = req.enabled { process.enabled = enabled; }
    process.updated_at = Utc::now();

    state
        .super_agent_service
        .process_store
        .save_process(&process)
        .map_err(|e| ApiError::internal(e.to_string()))?;

    Ok(Json(process))
}

pub(crate) async fn delete_process(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path(id): Path<String>,
) -> ApiResult<Json<DeleteResponse>> {
    let process_id: ProcessId = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid process ID"))?;

    state
        .super_agent_service
        .process_store
        .delete_process(&process_id)
        .map_err(|e| ApiError::internal(e.to_string()))?;

    Ok(Json(DeleteResponse { deleted: true }))
}

// ---------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------

pub(crate) async fn trigger_process(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path(id): Path<String>,
) -> ApiResult<Json<ProcessRun>> {
    let process_id: ProcessId = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid process ID"))?;

    let run = state
        .super_agent_service
        .process_executor
        .trigger(&process_id, ProcessRunTrigger::Manual)
        .map_err(|e| {
            if matches!(e, aura_os_process::ProcessError::RunAlreadyActive) {
                ApiError::conflict(e.to_string())
            } else {
                ApiError::internal(e.to_string())
            }
        })?;

    Ok(Json(run))
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

pub(crate) async fn list_nodes(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path(id): Path<String>,
) -> ApiResult<Json<Vec<ProcessNode>>> {
    let process_id: ProcessId = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid process ID"))?;

    let nodes = state
        .super_agent_service
        .process_store
        .list_nodes(&process_id)
        .map_err(|e| ApiError::internal(e.to_string()))?;

    Ok(Json(nodes))
}

pub(crate) async fn create_node(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path(id): Path<String>,
    Json(req): Json<CreateNodeRequest>,
) -> ApiResult<Json<ProcessNode>> {
    let process_id: ProcessId = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid process ID"))?;

    let now = Utc::now();
    let node = ProcessNode {
        node_id: ProcessNodeId::new(),
        process_id,
        node_type: req.node_type,
        label: req.label,
        agent_id: req.agent_id.and_then(|id| id.parse().ok()),
        prompt: req.prompt,
        config: if req.config.is_null() { serde_json::json!({}) } else { req.config },
        position_x: req.position_x,
        position_y: req.position_y,
        created_at: now,
        updated_at: now,
    };

    state
        .super_agent_service
        .process_store
        .save_node(&node)
        .map_err(|e| ApiError::internal(e.to_string()))?;

    Ok(Json(node))
}

pub(crate) async fn update_node(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path((id, node_id_str)): Path<(String, String)>,
    Json(req): Json<UpdateNodeRequest>,
) -> ApiResult<Json<ProcessNode>> {
    let process_id: ProcessId = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid process ID"))?;
    let node_id: ProcessNodeId = node_id_str
        .parse()
        .map_err(|_| ApiError::bad_request("invalid node ID"))?;

    let mut node = state
        .super_agent_service
        .process_store
        .get_node(&process_id, &node_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| ApiError::not_found("node not found"))?;

    if let Some(label) = req.label { node.label = label; }
    if let Some(agent_id) = req.agent_id {
        node.agent_id = if agent_id.is_empty() { None } else { agent_id.parse().ok() };
    }
    if let Some(prompt) = req.prompt { node.prompt = prompt; }
    if let Some(config) = req.config { node.config = config; }
    if let Some(x) = req.position_x { node.position_x = x; }
    if let Some(y) = req.position_y { node.position_y = y; }
    node.updated_at = Utc::now();

    state
        .super_agent_service
        .process_store
        .save_node(&node)
        .map_err(|e| ApiError::internal(e.to_string()))?;

    Ok(Json(node))
}

pub(crate) async fn delete_node(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path((id, node_id_str)): Path<(String, String)>,
) -> ApiResult<Json<DeleteResponse>> {
    let process_id: ProcessId = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid process ID"))?;
    let node_id: ProcessNodeId = node_id_str
        .parse()
        .map_err(|_| ApiError::bad_request("invalid node ID"))?;

    state
        .super_agent_service
        .process_store
        .delete_node(&process_id, &node_id)
        .map_err(|e| ApiError::internal(e.to_string()))?;

    Ok(Json(DeleteResponse { deleted: true }))
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

pub(crate) async fn list_connections(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path(id): Path<String>,
) -> ApiResult<Json<Vec<ProcessNodeConnection>>> {
    let process_id: ProcessId = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid process ID"))?;

    let conns = state
        .super_agent_service
        .process_store
        .list_connections(&process_id)
        .map_err(|e| ApiError::internal(e.to_string()))?;

    info!(
        process_id = %process_id,
        connection_count = conns.len(),
        connections = ?conns
    );

    Ok(Json(conns))
}

pub(crate) async fn create_connection(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path(id): Path<String>,
    Json(req): Json<CreateConnectionRequest>,
) -> ApiResult<Json<ProcessNodeConnection>> {
    let process_id: ProcessId = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid process ID"))?;

    let conn = ProcessNodeConnection {
        connection_id: ProcessNodeConnectionId::new(),
        process_id,
        source_node_id: req.source_node_id.parse().map_err(|_| ApiError::bad_request("invalid source node ID"))?,
        source_handle: req.source_handle,
        target_node_id: req.target_node_id.parse().map_err(|_| ApiError::bad_request("invalid target node ID"))?,
        target_handle: req.target_handle,
    };

    state
        .super_agent_service
        .process_store
        .save_connection(&conn)
        .map_err(|e| ApiError::internal(e.to_string()))?;

    info!(
        process_id = %process_id,
        connection_id = %conn.connection_id,
        source_node_id = %conn.source_node_id,
        source_handle = ?conn.source_handle,
        target_node_id = %conn.target_node_id,
        target_handle = ?conn.target_handle,
        "Created process connection"
    );

    Ok(Json(conn))
}

pub(crate) async fn delete_connection(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path((id, conn_id_str)): Path<(String, String)>,
) -> ApiResult<Json<DeleteResponse>> {
    let process_id: ProcessId = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid process ID"))?;
    let connection_id: ProcessNodeConnectionId = conn_id_str
        .parse()
        .map_err(|_| ApiError::bad_request("invalid connection ID"))?;

    state
        .super_agent_service
        .process_store
        .delete_connection(&process_id, &connection_id)
        .map_err(|e| ApiError::internal(e.to_string()))?;

    Ok(Json(DeleteResponse { deleted: true }))
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

pub(crate) async fn list_runs(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path(id): Path<String>,
) -> ApiResult<Json<Vec<ProcessRun>>> {
    let process_id: ProcessId = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid process ID"))?;

    let runs = state
        .super_agent_service
        .process_store
        .list_runs(&process_id)
        .map_err(|e| ApiError::internal(e.to_string()))?;

    Ok(Json(runs))
}

pub(crate) async fn get_run(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path((id, run_id_str)): Path<(String, String)>,
) -> ApiResult<Json<ProcessRun>> {
    let process_id: ProcessId = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid process ID"))?;
    let run_id: ProcessRunId = run_id_str
        .parse()
        .map_err(|_| ApiError::bad_request("invalid run ID"))?;

    let run = state
        .super_agent_service
        .process_store
        .get_run(&process_id, &run_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| ApiError::not_found("run not found"))?;

    Ok(Json(run))
}

pub(crate) async fn cancel_run(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path((id, run_id_str)): Path<(String, String)>,
) -> ApiResult<Json<serde_json::Value>> {
    let process_id: ProcessId = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid process ID"))?;
    let run_id: ProcessRunId = run_id_str
        .parse()
        .map_err(|_| ApiError::bad_request("invalid run ID"))?;

    state
        .super_agent_service
        .process_executor
        .cancel_run(&process_id, &run_id)
        .map_err(|e| {
            if matches!(e, aura_os_process::ProcessError::RunNotActive) {
                ApiError::conflict(e.to_string())
            } else {
                ApiError::internal(e.to_string())
            }
        })?;

    Ok(Json(serde_json::json!({ "status": "cancelled" })))
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

pub(crate) async fn list_run_events(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path((id, run_id_str)): Path<(String, String)>,
) -> ApiResult<Json<Vec<ProcessEvent>>> {
    let process_id: ProcessId = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid process ID"))?;
    let run_id: ProcessRunId = run_id_str
        .parse()
        .map_err(|_| ApiError::bad_request("invalid run ID"))?;

    let events = state
        .super_agent_service
        .process_store
        .list_events_for_run(&process_id, &run_id)
        .map_err(|e| ApiError::internal(e.to_string()))?;

    Ok(Json(events))
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

pub(crate) async fn list_folders(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
) -> ApiResult<Json<Vec<ProcessFolder>>> {
    let folders = state
        .super_agent_service
        .process_store
        .list_folders()
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(folders))
}

pub(crate) async fn create_folder(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Json(req): Json<CreateFolderRequest>,
) -> ApiResult<Json<ProcessFolder>> {
    let user_id = session
        .network_user_id
        .map(|id| id.to_string())
        .unwrap_or_else(|| session.user_id.clone());

    let now = Utc::now();
    let folder = ProcessFolder {
        folder_id: ProcessFolderId::new(),
        org_id: "default".parse().unwrap_or_default(),
        user_id,
        name: req.name,
        created_at: now,
        updated_at: now,
    };

    state
        .super_agent_service
        .process_store
        .save_folder(&folder)
        .map_err(|e| ApiError::internal(e.to_string()))?;

    info!(folder_id = %folder.folder_id, name = %folder.name, "Process folder created");
    Ok(Json(folder))
}

pub(crate) async fn update_folder(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path(id): Path<String>,
    Json(req): Json<UpdateFolderRequest>,
) -> ApiResult<Json<ProcessFolder>> {
    let folder_id: ProcessFolderId = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid folder ID"))?;

    let mut folder = state
        .super_agent_service
        .process_store
        .get_folder(&folder_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| ApiError::not_found("folder not found"))?;

    if let Some(name) = req.name { folder.name = name; }
    folder.updated_at = Utc::now();

    state
        .super_agent_service
        .process_store
        .save_folder(&folder)
        .map_err(|e| ApiError::internal(e.to_string()))?;

    Ok(Json(folder))
}

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

pub(crate) async fn list_run_artifacts(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path((id, run_id_str)): Path<(String, String)>,
) -> ApiResult<Json<Vec<ProcessArtifact>>> {
    let process_id: ProcessId = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid process ID"))?;
    let run_id: ProcessRunId = run_id_str
        .parse()
        .map_err(|_| ApiError::bad_request("invalid run ID"))?;

    let artifacts = state
        .super_agent_service
        .process_store
        .list_artifacts_for_run(&process_id, &run_id)
        .map_err(|e| ApiError::internal(e.to_string()))?;

    Ok(Json(artifacts))
}

pub(crate) async fn get_artifact(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path(artifact_id_str): Path<String>,
) -> ApiResult<Json<ProcessArtifact>> {
    let artifact_id: ProcessArtifactId = artifact_id_str
        .parse()
        .map_err(|_| ApiError::bad_request("invalid artifact ID"))?;

    let artifact = state
        .super_agent_service
        .process_store
        .get_artifact(&artifact_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| ApiError::not_found("artifact not found"))?;

    Ok(Json(artifact))
}

pub(crate) async fn get_artifact_content(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path(artifact_id_str): Path<String>,
) -> ApiResult<String> {
    let artifact_id: ProcessArtifactId = artifact_id_str
        .parse()
        .map_err(|_| ApiError::bad_request("invalid artifact ID"))?;

    let artifact = state
        .super_agent_service
        .process_store
        .get_artifact(&artifact_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| ApiError::not_found("artifact not found"))?;

    let file_path = state.data_dir.join(&artifact.file_path);
    let content = tokio::fs::read_to_string(&file_path)
        .await
        .map_err(|e| ApiError::internal(format!("Failed to read artifact file: {e}")))?;

    Ok(content)
}

pub(crate) async fn get_artifact_path(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path(artifact_id_str): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    let artifact_id: ProcessArtifactId = artifact_id_str
        .parse()
        .map_err(|_| ApiError::bad_request("invalid artifact ID"))?;

    let artifact = state
        .super_agent_service
        .process_store
        .get_artifact(&artifact_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| ApiError::not_found("artifact not found"))?;

    let resolved = state.data_dir.join(&artifact.file_path);
    Ok(Json(serde_json::json!({ "path": resolved.to_string_lossy() })))
}

pub(crate) async fn delete_folder(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path(id): Path<String>,
) -> ApiResult<Json<DeleteResponse>> {
    let folder_id: ProcessFolderId = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid folder ID"))?;

    // Unassign processes from this folder before deleting it
    let processes = state
        .super_agent_service
        .process_store
        .list_processes()
        .map_err(|e| ApiError::internal(e.to_string()))?;

    for mut p in processes {
        if p.folder_id == Some(folder_id) {
            p.folder_id = None;
            p.updated_at = Utc::now();
            state
                .super_agent_service
                .process_store
                .save_process(&p)
                .map_err(|e| ApiError::internal(e.to_string()))?;
        }
    }

    state
        .super_agent_service
        .process_store
        .delete_folder(&folder_id)
        .map_err(|e| ApiError::internal(e.to_string()))?;

    Ok(Json(DeleteResponse { deleted: true }))
}
