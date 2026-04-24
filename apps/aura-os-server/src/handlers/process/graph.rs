use axum::extract::{Path, State};
use axum::Json;

use aura_os_core::{ProcessNode, ProcessNodeConnection};

use super::common::{check_remote_process_edit_permission, require_process_storage_client};
use super::conversions::{conv_connection, conv_node};
use super::dto::{CreateConnectionRequest, CreateNodeRequest, DeleteResponse, UpdateNodeRequest};
use crate::error::{map_storage_error, ApiResult};
use crate::state::{AppState, AuthJwt, AuthSession};

pub(crate) async fn list_nodes(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path(id): Path<String>,
) -> ApiResult<Json<Vec<ProcessNode>>> {
    let client = require_process_storage_client(&state)?;
    let nodes = client
        .list_process_nodes(&id, &jwt)
        .await
        .map_err(map_storage_error)?;
    Ok(Json(nodes.into_iter().map(conv_node).collect()))
}

pub(crate) async fn create_node(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(id): Path<String>,
    Json(req): Json<CreateNodeRequest>,
) -> ApiResult<Json<ProcessNode>> {
    let client = require_process_storage_client(&state)?;
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
    Ok(Json(conv_node(node)))
}

pub(crate) async fn update_node(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path((id, node_id_str)): Path<(String, String)>,
    Json(req): Json<UpdateNodeRequest>,
) -> ApiResult<Json<ProcessNode>> {
    let client = require_process_storage_client(&state)?;
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
    Ok(Json(conv_node(node)))
}

pub(crate) async fn delete_node(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path((id, node_id_str)): Path<(String, String)>,
) -> ApiResult<Json<DeleteResponse>> {
    let client = require_process_storage_client(&state)?;
    check_remote_process_edit_permission(&state, client, &id, &jwt, &session).await?;
    client
        .delete_process_node(&id, &node_id_str, &jwt)
        .await
        .map_err(map_storage_error)?;
    Ok(Json(DeleteResponse { deleted: true }))
}

pub(crate) async fn list_connections(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path(id): Path<String>,
) -> ApiResult<Json<Vec<ProcessNodeConnection>>> {
    let client = require_process_storage_client(&state)?;
    let conns = client
        .list_process_connections(&id, &jwt)
        .await
        .map_err(map_storage_error)?;
    Ok(Json(conns.into_iter().map(conv_connection).collect()))
}

pub(crate) async fn create_connection(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(id): Path<String>,
    Json(req): Json<CreateConnectionRequest>,
) -> ApiResult<Json<ProcessNodeConnection>> {
    let client = require_process_storage_client(&state)?;
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
    Ok(Json(conv_connection(conn)))
}

pub(crate) async fn delete_connection(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path((id, conn_id_str)): Path<(String, String)>,
) -> ApiResult<Json<DeleteResponse>> {
    let client = require_process_storage_client(&state)?;
    check_remote_process_edit_permission(&state, client, &id, &jwt, &session).await?;
    client
        .delete_process_connection(&id, &conn_id_str, &jwt)
        .await
        .map_err(map_storage_error)?;
    Ok(Json(DeleteResponse { deleted: true }))
}
