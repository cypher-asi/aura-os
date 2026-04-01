use axum::extract::{Path, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use tracing::info;

use aura_os_core::{
    Process, ProcessEvent, ProcessId, ProcessNode, ProcessNodeConnection,
    ProcessNodeConnectionId, ProcessNodeId, ProcessNodeType, ProcessRun, ProcessRunId,
    ProcessRunTrigger,
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
    pub schedule: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Deserialize)]
pub(crate) struct UpdateProcessRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub schedule: Option<String>,
    pub tags: Option<Vec<String>>,
    pub enabled: Option<bool>,
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

    let now = Utc::now();
    let process = Process {
        process_id: ProcessId::new(),
        org_id: "default".parse().unwrap_or_default(),
        user_id,
        name: req.name,
        description: req.description.unwrap_or_default(),
        enabled: true,
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
        .map_err(|e| ApiError::internal(e.to_string()))?;

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
