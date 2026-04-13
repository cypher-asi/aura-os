use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tracing::info;

use aura_os_core::{
    AgentId, OrgId, Process, ProcessArtifact, ProcessArtifactId, ProcessEvent, ProcessFolder,
    ProcessFolderId, ProcessId, ProcessNode, ProcessNodeConnection, ProcessNodeConnectionId,
    ProcessNodeId, ProcessNodeType, ProcessRun, ProcessRunId, ProcessRunTranscriptEvent,
    ProcessRunTrigger, ProjectId,
};
use aura_os_process::CreateProcessInput;
use aura_os_storage::{
    StorageClient, StorageProcess, StorageProcessArtifact, StorageProcessEvent,
    StorageProcessFolder, StorageProcessNode, StorageProcessNodeConnection, StorageProcessRun,
};

use crate::error::{map_network_error, map_storage_error, ApiError, ApiResult};
use crate::handlers::permissions::{require_org_role, require_process_edit_permission};
use crate::state::{AppState, AuthJwt, AuthSession};

// ---------------------------------------------------------------------------
// Org ID resolution for proxy path
// ---------------------------------------------------------------------------

/// Resolve the user's org IDs from aura-network.
async fn resolve_org_ids(state: &AppState, jwt: &str) -> ApiResult<Vec<String>> {
    let client = state.network_client.as_ref().ok_or_else(|| {
        ApiError::service_unavailable("aura-network is required for remote process proxy")
    })?;
    let orgs = client.list_orgs(jwt).await.map_err(map_network_error)?;
    let ids: Vec<String> = orgs.iter().map(|org| org.id.clone()).collect();
    if ids.is_empty() {
        return Err(ApiError::bad_request(
            "no org memberships are available for remote process proxy",
        ));
    }
    Ok(ids)
}

fn remote_process_storage_client(state: &AppState) -> Option<&Arc<StorageClient>> {
    state
        .storage_client
        .as_ref()
        .filter(|client| client.has_internal_token())
}

fn select_remote_process_org_id(
    project_org_id: Option<String>,
    fallback_org_ids: &[String],
) -> ApiResult<String> {
    if let Some(org_id) = project_org_id.filter(|org_id| org_id != &OrgId::nil().to_string()) {
        return Ok(org_id);
    }
    match fallback_org_ids {
        [org_id] => Ok(org_id.clone()),
        [] => Err(ApiError::bad_request(
            "no org memberships are available for remote process proxy",
        )),
        _ => Err(ApiError::bad_request(
            "could not resolve a single org for remote process proxy; attach the process to a project with a valid org",
        )),
    }
}

/// Resolve org_id from a project's org membership. Falls back only when there
/// is exactly one user org available.
fn resolve_org_for_project(
    state: &AppState,
    project_id: &str,
    fallback_org_ids: &[String],
) -> ApiResult<String> {
    let project_org_id = project_id
        .parse::<ProjectId>()
        .ok()
        .and_then(|project_id| state.project_service.get_project(&project_id).ok())
        .map(|project| project.org_id.to_string());
    select_remote_process_org_id(project_org_id, fallback_org_ids)
}

async fn list_remote_processes_for_orgs(
    client: &StorageClient,
    org_ids: &[String],
    jwt: &str,
) -> ApiResult<Vec<StorageProcess>> {
    let mut all = Vec::new();
    for org_id in org_ids {
        let list = client
            .list_processes(org_id, jwt)
            .await
            .map_err(map_storage_error)?;
        all.extend(list);
    }
    Ok(all)
}

async fn list_remote_process_folders_for_orgs(
    client: &StorageClient,
    org_ids: &[String],
    jwt: &str,
) -> ApiResult<Vec<StorageProcessFolder>> {
    let mut all = Vec::new();
    for org_id in org_ids {
        let list = client
            .list_process_folders(org_id, jwt)
            .await
            .map_err(map_storage_error)?;
        all.extend(list);
    }
    Ok(all)
}

fn resolve_remote_folder_org_id(
    request_org_id: Option<&str>,
    org_ids: &[String],
) -> ApiResult<String> {
    if let Some(org_id) = request_org_id {
        if org_ids.iter().any(|candidate| candidate == org_id) {
            return Ok(org_id.to_string());
        }
        return Err(ApiError::forbidden(
            "requested org is not available for remote process folder creation",
        ));
    }

    select_remote_process_org_id(None, org_ids)
}

/// Fetch a remote process and check that the user has edit permission (creator or admin).
async fn check_remote_process_edit_permission(
    state: &AppState,
    client: &StorageClient,
    process_id: &str,
    jwt: &str,
    session: &aura_os_core::ZeroAuthSession,
) -> ApiResult<()> {
    let process = client
        .get_process(process_id, jwt)
        .await
        .map_err(map_storage_error)?;
    let org_id = process
        .org_id
        .as_deref()
        .ok_or_else(|| ApiError::forbidden("process has no org"))?;
    let created_by = process.created_by.as_deref().unwrap_or_default();
    require_process_edit_permission(state, org_id, created_by, jwt, session).await
}

// ---------------------------------------------------------------------------
// StorageX → local entity conversions
// ---------------------------------------------------------------------------

fn parse_dt(s: &Option<String>) -> DateTime<Utc> {
    s.as_deref()
        .and_then(|v| DateTime::parse_from_rfc3339(v).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(Utc::now)
}

fn parse_dt_opt(s: &Option<String>) -> Option<DateTime<Utc>> {
    s.as_deref()
        .and_then(|v| DateTime::parse_from_rfc3339(v).ok())
        .map(|dt| dt.with_timezone(&Utc))
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

fn storage_tags_to_vec(v: &Option<serde_json::Value>) -> Vec<String> {
    v.as_ref()
        .and_then(|val| val.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| item.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

fn conv_process(sp: StorageProcess) -> Process {
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
        tags: storage_tags_to_vec(&sp.tags),
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

fn conv_run(sr: StorageProcessRun) -> ProcessRun {
    use aura_os_core::ProcessRunStatus;
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

fn conv_event(se: StorageProcessEvent) -> ProcessEvent {
    use aura_os_core::ProcessEventStatus;
    ProcessEvent {
        event_id: parse_id(&se.id),
        run_id: parse_id(se.run_id.as_deref().unwrap_or_default()),
        node_id: parse_id(se.node_id.as_deref().unwrap_or_default()),
        process_id: parse_id(se.process_id.as_deref().unwrap_or_default()),
        status: se
            .status
            .as_deref()
            .and_then(parse_enum)
            .unwrap_or(ProcessEventStatus::Pending),
        input_snapshot: se.input_snapshot.unwrap_or_default(),
        output: se.output.unwrap_or_default(),
        started_at: parse_dt(&se.started_at),
        completed_at: parse_dt_opt(&se.completed_at),
        input_tokens: se.input_tokens.map(|v| v as u64),
        output_tokens: se.output_tokens.map(|v| v as u64),
        model: se.model,
        content_blocks: se.content_blocks.and_then(|v| v.as_array().cloned()),
    }
}

fn conv_artifact(sa: StorageProcessArtifact) -> ProcessArtifact {
    use aura_os_core::ArtifactType;
    ProcessArtifact {
        artifact_id: parse_id(&sa.id),
        process_id: parse_id(sa.process_id.as_deref().unwrap_or_default()),
        run_id: parse_id(sa.run_id.as_deref().unwrap_or_default()),
        node_id: parse_id(sa.node_id.as_deref().unwrap_or_default()),
        artifact_type: sa
            .artifact_type
            .as_deref()
            .and_then(parse_enum)
            .unwrap_or(ArtifactType::Custom),
        name: sa.name.unwrap_or_default(),
        file_path: sa.file_path.unwrap_or_default(),
        size_bytes: sa.size_bytes.unwrap_or(0) as u64,
        metadata: sa.metadata.unwrap_or(serde_json::json!({})),
        created_at: parse_dt(&sa.created_at),
    }
}

fn conv_folder(sf: StorageProcessFolder) -> ProcessFolder {
    ProcessFolder {
        folder_id: parse_id(&sf.id),
        org_id: parse_id(sf.org_id.as_deref().unwrap_or_default()),
        user_id: sf.created_by.unwrap_or_default(),
        name: sf.name.unwrap_or_default(),
        created_at: parse_dt(&sf.created_at),
        updated_at: parse_dt(&sf.updated_at),
    }
}

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
    pub org_id: Option<String>,
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
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Json(req): Json<CreateProcessRequest>,
) -> ApiResult<Json<Process>> {
    if let Some(client) = remote_process_storage_client(&state) {
        let org_ids = resolve_org_ids(&state, &jwt).await?;
        let org_id = resolve_org_for_project(&state, &req.project_id, &org_ids)?;
        let storage_req = aura_os_storage::CreateProcessRequest {
            org_id,
            name: req.name.clone(),
            project_id: Some(req.project_id.clone()),
            folder_id: req.folder_id.clone(),
            description: req.description.clone(),
            enabled: Some(true),
            schedule: req.schedule.clone(),
            tags: Some(req.tags.clone()),
        };
        let sp = client
            .create_process(&jwt, &storage_req)
            .await
            .map_err(map_storage_error)?;
        let process_id = sp.id.clone();
        // Auto-create ignition node (matching local behavior)
        let node_req = aura_os_storage::CreateProcessNodeRequest {
            node_type: "ignition".to_string(),
            label: Some("Ignition".to_string()),
            agent_id: None,
            prompt: None,
            config: None,
            position_x: Some(250.0),
            position_y: Some(50.0),
        };
        if let Err(error) = client
            .create_process_node(&process_id, &jwt, &node_req)
            .await
        {
            if let Err(rollback_error) = client.delete_process(&process_id, &jwt).await {
                tracing::warn!(
                    process_id = %process_id,
                    error = %rollback_error,
                    "failed to roll back remote process after ignition node creation failed"
                );
            }
            return Err(map_storage_error(error));
        }
        return Ok(Json(conv_process(sp)));
    }

    let user_id = session
        .network_user_id
        .map(|id| id.to_string())
        .unwrap_or_else(|| session.user_id.clone());

    let project_id: ProjectId = req
        .project_id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid project_id"))?;

    let org_id: OrgId = "default".parse().unwrap_or_default();
    let input = CreateProcessInput {
        org_id,
        user_id,
        name: req.name,
        description: req.description.unwrap_or_default(),
        project_id: Some(project_id),
        folder_id: req.folder_id.and_then(|id| id.parse().ok()),
        schedule: req.schedule,
        tags: req.tags,
    };
    let process = state
        .super_agent_service
        .process_app
        .create_process_with_default_graph(input)
        .map_err(|e| ApiError::internal(e.to_string()))?;

    info!(process_id = %process.process_id, name = %process.name, "Process created");
    Ok(Json(process))
}

pub(crate) async fn list_processes(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(_session): AuthSession,
) -> ApiResult<Json<Vec<Process>>> {
    if let Some(client) = remote_process_storage_client(&state) {
        let org_ids = resolve_org_ids(&state, &jwt).await?;
        let all = list_remote_processes_for_orgs(client, &org_ids, &jwt)
            .await?
            .into_iter()
            .map(conv_process)
            .collect();
        return Ok(Json(all));
    }

    let processes = state
        .super_agent_service
        .process_store
        .list_processes()
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(processes))
}

pub(crate) async fn get_process(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path(id): Path<String>,
) -> ApiResult<Json<Process>> {
    if let Some(client) = remote_process_storage_client(&state) {
        let sp = client
            .get_process(&id, &jwt)
            .await
            .map_err(map_storage_error)?;
        return Ok(Json(conv_process(sp)));
    }

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
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(id): Path<String>,
    Json(req): Json<UpdateProcessRequest>,
) -> ApiResult<Json<Process>> {
    if let Some(client) = remote_process_storage_client(&state) {
        check_remote_process_edit_permission(&state, client, &id, &jwt, &session).await?;
        let storage_req = aura_os_storage::UpdateProcessRequest {
            name: req.name.clone(),
            description: req.description.clone(),
            project_id: req.project_id.clone(),
            folder_id: req.folder_id.clone(),
            enabled: req.enabled,
            schedule: req.schedule.clone().map(Some),
            tags: req.tags.clone(),
            ..Default::default()
        };
        let sp = client
            .update_process(&id, &jwt, &storage_req)
            .await
            .map_err(map_storage_error)?;
        return Ok(Json(conv_process(sp)));
    }
    // Local-only mode: ownership check only (no network client for admin role verification)
    let process_id: ProcessId = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid process ID"))?;

    let mut process = state
        .super_agent_service
        .process_store
        .get_process(&process_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| ApiError::not_found("process not found"))?;

    if process.user_id != session.user_id {
        return Err(ApiError::forbidden("only the process creator can edit this process"));
    }

    if let Some(name) = req.name {
        process.name = name;
    }
    if let Some(desc) = req.description {
        process.description = desc;
    }
    if let Some(pid) = req.project_id {
        process.project_id = pid.and_then(|id| id.parse().ok());
    }
    if let Some(fid) = req.folder_id {
        process.folder_id = fid.and_then(|id| id.parse().ok());
    }
    if let Some(sched) = req.schedule {
        process.schedule = Some(sched);
    }
    if let Some(tags) = req.tags {
        process.tags = tags;
    }
    if let Some(enabled) = req.enabled {
        process.enabled = enabled;
    }
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
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(id): Path<String>,
) -> ApiResult<Json<DeleteResponse>> {
    if let Some(client) = remote_process_storage_client(&state) {
        check_remote_process_edit_permission(&state, client, &id, &jwt, &session).await?;
        client
            .delete_process(&id, &jwt)
            .await
            .map_err(map_storage_error)?;
        return Ok(Json(DeleteResponse { deleted: true }));
    }
    // Local-only mode: ownership check only (no network client for admin role verification)
    let process_id: ProcessId = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid process ID"))?;

    let process = state
        .super_agent_service
        .process_store
        .get_process(&process_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| ApiError::not_found("process not found"))?;

    if process.user_id != session.user_id {
        return Err(ApiError::forbidden("only the process creator can delete this process"));
    }

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
        .await
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
    AuthJwt(jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path(id): Path<String>,
) -> ApiResult<Json<Vec<ProcessNode>>> {
    if let Some(client) = remote_process_storage_client(&state) {
        let nodes = client
            .list_process_nodes(&id, &jwt)
            .await
            .map_err(map_storage_error)?;
        return Ok(Json(nodes.into_iter().map(conv_node).collect()));
    }

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
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(id): Path<String>,
    Json(req): Json<CreateNodeRequest>,
) -> ApiResult<Json<ProcessNode>> {
    if let Some(client) = remote_process_storage_client(&state) {
        check_remote_process_edit_permission(&state, client, &id, &jwt, &session).await?;
        let storage_req = aura_os_storage::CreateProcessNodeRequest {
            node_type: serde_json::to_value(req.node_type)
                .ok()
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or_else(|| "action".to_string()),
            label: Some(req.label.clone()),
            agent_id: req.agent_id.clone(),
            prompt: Some(req.prompt.clone()),
            config: Some(if req.config.is_null() {
                serde_json::json!({})
            } else {
                req.config.clone()
            }),
            position_x: Some(req.position_x),
            position_y: Some(req.position_y),
        };
        let node = client
            .create_process_node(&id, &jwt, &storage_req)
            .await
            .map_err(map_storage_error)?;
        return Ok(Json(conv_node(node)));
    }
    // Local-only mode: ownership check on parent process
    let process_id: ProcessId = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid process ID"))?;

    let process = state
        .super_agent_service
        .process_store
        .get_process(&process_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| ApiError::not_found("process not found"))?;
    if process.user_id != session.user_id {
        return Err(ApiError::forbidden("only the process creator can edit this process"));
    }

    let now = Utc::now();
    let node = ProcessNode {
        node_id: ProcessNodeId::new(),
        process_id,
        node_type: req.node_type,
        label: req.label,
        agent_id: req.agent_id.and_then(|id| id.parse().ok()),
        prompt: req.prompt,
        config: if req.config.is_null() {
            serde_json::json!({})
        } else {
            req.config
        },
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
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path((id, node_id_str)): Path<(String, String)>,
    Json(req): Json<UpdateNodeRequest>,
) -> ApiResult<Json<ProcessNode>> {
    if let Some(client) = remote_process_storage_client(&state) {
        check_remote_process_edit_permission(&state, client, &id, &jwt, &session).await?;
        let storage_req = aura_os_storage::UpdateProcessNodeRequest {
            label: req.label.clone(),
            agent_id: req
                .agent_id
                .clone()
                .map(|a| if a.is_empty() { None } else { Some(a) }),
            prompt: req.prompt.clone(),
            config: req.config.clone(),
            position_x: req.position_x,
            position_y: req.position_y,
        };
        let node = client
            .update_process_node(&id, &node_id_str, &jwt, &storage_req)
            .await
            .map_err(map_storage_error)?;
        return Ok(Json(conv_node(node)));
    }

    // Local-only mode: ownership check on parent process
    let process_id: ProcessId = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid process ID"))?;

    let process = state
        .super_agent_service
        .process_store
        .get_process(&process_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| ApiError::not_found("process not found"))?;
    if process.user_id != session.user_id {
        return Err(ApiError::forbidden("only the process creator can edit this process"));
    }

    let node_id: ProcessNodeId = node_id_str
        .parse()
        .map_err(|_| ApiError::bad_request("invalid node ID"))?;

    let mut node = state
        .super_agent_service
        .process_store
        .get_node(&process_id, &node_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| ApiError::not_found("node not found"))?;

    if let Some(label) = req.label {
        node.label = label;
    }
    if let Some(agent_id) = req.agent_id {
        node.agent_id = if agent_id.is_empty() {
            None
        } else {
            agent_id.parse().ok()
        };
    }
    if let Some(prompt) = req.prompt {
        node.prompt = prompt;
    }
    if let Some(config) = req.config {
        node.config = config;
    }
    if let Some(x) = req.position_x {
        node.position_x = x;
    }
    if let Some(y) = req.position_y {
        node.position_y = y;
    }
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
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path((id, node_id_str)): Path<(String, String)>,
) -> ApiResult<Json<DeleteResponse>> {
    if let Some(client) = remote_process_storage_client(&state) {
        check_remote_process_edit_permission(&state, client, &id, &jwt, &session).await?;
        client
            .delete_process_node(&id, &node_id_str, &jwt)
            .await
            .map_err(map_storage_error)?;
        return Ok(Json(DeleteResponse { deleted: true }));
    }

    // Local-only mode: ownership check on parent process
    let process_id: ProcessId = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid process ID"))?;

    let process = state
        .super_agent_service
        .process_store
        .get_process(&process_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| ApiError::not_found("process not found"))?;
    if process.user_id != session.user_id {
        return Err(ApiError::forbidden("only the process creator can delete from this process"));
    }

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
    AuthJwt(jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path(id): Path<String>,
) -> ApiResult<Json<Vec<ProcessNodeConnection>>> {
    if let Some(client) = remote_process_storage_client(&state) {
        let conns = client
            .list_process_connections(&id, &jwt)
            .await
            .map_err(map_storage_error)?;
        return Ok(Json(conns.into_iter().map(conv_connection).collect()));
    }

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
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(id): Path<String>,
    Json(req): Json<CreateConnectionRequest>,
) -> ApiResult<Json<ProcessNodeConnection>> {
    if let Some(client) = remote_process_storage_client(&state) {
        check_remote_process_edit_permission(&state, client, &id, &jwt, &session).await?;
        let storage_req = aura_os_storage::CreateProcessConnectionRequest {
            source_node_id: req.source_node_id.clone(),
            source_handle: req.source_handle.clone(),
            target_node_id: req.target_node_id.clone(),
            target_handle: req.target_handle.clone(),
        };
        let conn = client
            .create_process_connection(&id, &jwt, &storage_req)
            .await
            .map_err(map_storage_error)?;
        return Ok(Json(conv_connection(conn)));
    }
    // Local-only mode: ownership check on parent process
    let process_id: ProcessId = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid process ID"))?;

    let process = state
        .super_agent_service
        .process_store
        .get_process(&process_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| ApiError::not_found("process not found"))?;
    if process.user_id != session.user_id {
        return Err(ApiError::forbidden("only the process creator can edit this process"));
    }

    let conn = ProcessNodeConnection {
        connection_id: ProcessNodeConnectionId::new(),
        process_id,
        source_node_id: req
            .source_node_id
            .parse()
            .map_err(|_| ApiError::bad_request("invalid source node ID"))?,
        source_handle: req.source_handle,
        target_node_id: req
            .target_node_id
            .parse()
            .map_err(|_| ApiError::bad_request("invalid target node ID"))?,
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
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path((id, conn_id_str)): Path<(String, String)>,
) -> ApiResult<Json<DeleteResponse>> {
    if let Some(client) = remote_process_storage_client(&state) {
        check_remote_process_edit_permission(&state, client, &id, &jwt, &session).await?;
        client
            .delete_process_connection(&id, &conn_id_str, &jwt)
            .await
            .map_err(map_storage_error)?;
        return Ok(Json(DeleteResponse { deleted: true }));
    }
    // Local-only mode: ownership check on parent process
    let process_id: ProcessId = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid process ID"))?;

    let process = state
        .super_agent_service
        .process_store
        .get_process(&process_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| ApiError::not_found("process not found"))?;
    if process.user_id != session.user_id {
        return Err(ApiError::forbidden("only the process creator can delete from this process"));
    }

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
    AuthJwt(jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path(id): Path<String>,
) -> ApiResult<Json<Vec<ProcessRun>>> {
    if let Some(client) = remote_process_storage_client(&state) {
        let runs = client
            .list_process_runs(&id, &jwt)
            .await
            .map_err(map_storage_error)?;
        return Ok(Json(runs.into_iter().map(conv_run).collect()));
    }

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
    AuthJwt(jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path((id, run_id_str)): Path<(String, String)>,
) -> ApiResult<Json<ProcessRun>> {
    if let Some(client) = remote_process_storage_client(&state) {
        let run = client
            .get_process_run(&id, &run_id_str, &jwt)
            .await
            .map_err(map_storage_error)?;
        return Ok(Json(conv_run(run)));
    }

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
        .await
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
    AuthJwt(jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path((id, run_id_str)): Path<(String, String)>,
) -> ApiResult<Json<Vec<ProcessEvent>>> {
    if let Some(client) = remote_process_storage_client(&state) {
        let events = client
            .list_process_run_events(&id, &run_id_str, &jwt)
            .await
            .map_err(map_storage_error)?;
        return Ok(Json(events.into_iter().map(conv_event).collect()));
    }

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

pub(crate) async fn list_run_transcript(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path((id, run_id_str)): Path<(String, String)>,
) -> ApiResult<Json<Vec<ProcessRunTranscriptEvent>>> {
    let process_id: ProcessId = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid process ID"))?;
    let run_id: ProcessRunId = run_id_str
        .parse()
        .map_err(|_| ApiError::bad_request("invalid run ID"))?;

    let transcript = state
        .super_agent_service
        .process_store
        .list_run_transcript(&process_id, &run_id)
        .map_err(|e| ApiError::internal(e.to_string()))?;

    Ok(Json(transcript))
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

pub(crate) async fn list_folders(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(_session): AuthSession,
) -> ApiResult<Json<Vec<ProcessFolder>>> {
    if let Some(client) = remote_process_storage_client(&state) {
        let org_ids = resolve_org_ids(&state, &jwt).await?;
        let all = list_remote_process_folders_for_orgs(client, &org_ids, &jwt)
            .await?
            .into_iter()
            .map(conv_folder)
            .collect();
        return Ok(Json(all));
    }

    let folders = state
        .super_agent_service
        .process_store
        .list_folders()
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(folders))
}

pub(crate) async fn create_folder(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Json(req): Json<CreateFolderRequest>,
) -> ApiResult<Json<ProcessFolder>> {
    if let Some(client) = remote_process_storage_client(&state) {
        let org_ids = resolve_org_ids(&state, &jwt).await?;
        let org_id = resolve_remote_folder_org_id(req.org_id.as_deref(), &org_ids)?;
        require_org_role(&state, &org_id, &jwt, &session, "admin").await?;
        let storage_req = aura_os_storage::CreateProcessFolderRequest {
            org_id,
            name: req.name.clone(),
        };
        let folder = client
            .create_process_folder(&jwt, &storage_req)
            .await
            .map_err(map_storage_error)?;
        return Ok(Json(conv_folder(folder)));
    }
    // Local-only mode: no network client for role verification
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
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(id): Path<String>,
    Json(req): Json<UpdateFolderRequest>,
) -> ApiResult<Json<ProcessFolder>> {
    if let Some(client) = remote_process_storage_client(&state) {
        // Find the folder's org_id by listing all user folders and matching by ID
        let org_ids = resolve_org_ids(&state, &jwt).await?;
        let all_folders = list_remote_process_folders_for_orgs(client, &org_ids, &jwt).await?;
        let folder_org = all_folders
            .iter()
            .find(|f| f.id == id)
            .and_then(|f| f.org_id.as_deref())
            .ok_or_else(|| ApiError::not_found("folder not found"))?
            .to_string();
        require_org_role(&state, &folder_org, &jwt, &session, "admin").await?;
        let storage_req = aura_os_storage::UpdateProcessFolderRequest {
            name: req.name.clone(),
        };
        let folder = client
            .update_process_folder(&id, &jwt, &storage_req)
            .await
            .map_err(map_storage_error)?;
        return Ok(Json(conv_folder(folder)));
    }
    // Local-only mode: no network client for role verification
    let folder_id: ProcessFolderId = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid folder ID"))?;

    let mut folder = state
        .super_agent_service
        .process_store
        .get_folder(&folder_id)
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| ApiError::not_found("folder not found"))?;

    if let Some(name) = req.name {
        folder.name = name;
    }
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
    AuthJwt(jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path((id, run_id_str)): Path<(String, String)>,
) -> ApiResult<Json<Vec<ProcessArtifact>>> {
    if let Some(client) = remote_process_storage_client(&state) {
        let artifacts = client
            .list_process_run_artifacts(&id, &run_id_str, &jwt)
            .await
            .map_err(map_storage_error)?;
        return Ok(Json(artifacts.into_iter().map(conv_artifact).collect()));
    }

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
    AuthJwt(jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path(artifact_id_str): Path<String>,
) -> ApiResult<Json<ProcessArtifact>> {
    if let Some(client) = remote_process_storage_client(&state) {
        let artifact = client
            .get_process_artifact(&artifact_id_str, &jwt)
            .await
            .map_err(map_storage_error)?;
        return Ok(Json(conv_artifact(artifact)));
    }

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
    Ok(Json(
        serde_json::json!({ "path": resolved.to_string_lossy() }),
    ))
}

pub(crate) async fn delete_folder(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(id): Path<String>,
) -> ApiResult<Json<DeleteResponse>> {
    if let Some(client) = remote_process_storage_client(&state) {
        let org_ids = resolve_org_ids(&state, &jwt).await?;
        // Find the folder's org_id by listing all user folders and matching by ID
        let all_folders = list_remote_process_folders_for_orgs(client, &org_ids, &jwt).await?;
        let folder_org = all_folders
            .iter()
            .find(|f| f.id == id)
            .and_then(|f| f.org_id.as_deref())
            .ok_or_else(|| ApiError::not_found("folder not found"))?
            .to_string();
        require_org_role(&state, &folder_org, &jwt, &session, "admin").await?;
        // Unassign processes from this folder before deleting
        let processes = list_remote_processes_for_orgs(client, &org_ids, &jwt).await?;
        for p in &processes {
            if p.folder_id.as_deref() == Some(id.as_str()) {
                let update = aura_os_storage::UpdateProcessRequest {
                    folder_id: Some(None),
                    ..Default::default()
                };
                let _ = client.update_process(&p.id, &jwt, &update).await;
            }
        }
        client
            .delete_process_folder(&id, &jwt)
            .await
            .map_err(map_storage_error)?;
        return Ok(Json(DeleteResponse { deleted: true }));
    }
    // Local-only mode: no network client for role verification
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

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use aura_os_storage::StorageClient;

    use super::{
        remote_process_storage_client, resolve_remote_folder_org_id, select_remote_process_org_id,
    };

    #[test]
    fn select_remote_process_org_id_prefers_project_org() {
        let org_id = select_remote_process_org_id(
            Some("11111111-1111-1111-1111-111111111111".to_string()),
            &["22222222-2222-2222-2222-222222222222".to_string()],
        )
        .expect("select org");

        assert_eq!(org_id, "11111111-1111-1111-1111-111111111111");
    }

    #[test]
    fn select_remote_process_org_id_uses_single_fallback_org() {
        let org_id = select_remote_process_org_id(
            None,
            &["22222222-2222-2222-2222-222222222222".to_string()],
        )
        .expect("select org");

        assert_eq!(org_id, "22222222-2222-2222-2222-222222222222");
    }

    #[test]
    fn select_remote_process_org_id_rejects_ambiguous_fallback_orgs() {
        let error = select_remote_process_org_id(
            None,
            &[
                "22222222-2222-2222-2222-222222222222".to_string(),
                "33333333-3333-3333-3333-333333333333".to_string(),
            ],
        )
        .expect_err("ambiguous orgs should fail");

        assert!(error.1 .0.error.contains("could not resolve a single org"));
    }

    #[test]
    fn resolve_remote_folder_org_id_accepts_explicit_membership() {
        let org_id = resolve_remote_folder_org_id(
            Some("22222222-2222-2222-2222-222222222222"),
            &[
                "11111111-1111-1111-1111-111111111111".to_string(),
                "22222222-2222-2222-2222-222222222222".to_string(),
            ],
        )
        .expect("resolve org");

        assert_eq!(org_id, "22222222-2222-2222-2222-222222222222");
    }

    #[test]
    fn resolve_remote_folder_org_id_rejects_non_member_org() {
        let error = resolve_remote_folder_org_id(
            Some("33333333-3333-3333-3333-333333333333"),
            &[
                "11111111-1111-1111-1111-111111111111".to_string(),
                "22222222-2222-2222-2222-222222222222".to_string(),
            ],
        )
        .expect_err("non-member org should fail");

        assert!(error.1 .0.error.contains("requested org is not available"));
    }

    #[tokio::test]
    async fn remote_process_storage_client_requires_internal_token() {
        let db_dir = tempfile::tempdir().expect("tempdir");
        let db_path = db_dir.path().join("settings.db");
        let mut state = crate::build_app_state(&db_path).expect("build app state");

        state.storage_client = Some(Arc::new(StorageClient::with_base_url(
            "http://localhost:8080",
        )));
        assert!(remote_process_storage_client(&state).is_none());

        state.storage_client = Some(Arc::new(StorageClient::with_base_url_and_token(
            "http://localhost:8080",
            "internal-token",
        )));
        assert!(remote_process_storage_client(&state).is_some());
    }
}
