use axum::extract::{Path, State};
use axum::Json;

use aura_os_core::Process;

use super::common::{
    check_remote_process_edit_permission, list_remote_processes_for_orgs,
    require_process_storage_client, resolve_org_for_project, resolve_org_ids,
};
use super::conversions::conv_process;
use super::dto::{CreateProcessRequest, DeleteResponse, UpdateProcessRequest};
use crate::error::{map_storage_error, ApiResult};
use crate::state::{AppState, AuthJwt, AuthSession};

pub(crate) async fn create_process(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Json(req): Json<CreateProcessRequest>,
) -> ApiResult<Json<Process>> {
    let client = require_process_storage_client(&state)?;
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

    Ok(Json(conv_process(sp)))
}

pub(crate) async fn list_processes(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(_session): AuthSession,
) -> ApiResult<Json<Vec<Process>>> {
    let client = require_process_storage_client(&state)?;
    let org_ids = resolve_org_ids(&state, &jwt).await?;
    let all = list_remote_processes_for_orgs(client, &org_ids, &jwt)
        .await?
        .into_iter()
        .map(conv_process)
        .collect();
    Ok(Json(all))
}

pub(crate) async fn get_process(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path(id): Path<String>,
) -> ApiResult<Json<Process>> {
    let client = require_process_storage_client(&state)?;
    let sp = client
        .get_process(&id, &jwt)
        .await
        .map_err(map_storage_error)?;
    Ok(Json(conv_process(sp)))
}

pub(crate) async fn update_process(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(id): Path<String>,
    Json(req): Json<UpdateProcessRequest>,
) -> ApiResult<Json<Process>> {
    let client = require_process_storage_client(&state)?;
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
    Ok(Json(conv_process(sp)))
}

pub(crate) async fn delete_process(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(id): Path<String>,
) -> ApiResult<Json<DeleteResponse>> {
    let client = require_process_storage_client(&state)?;
    check_remote_process_edit_permission(&state, client, &id, &jwt, &session).await?;
    client
        .delete_process(&id, &jwt)
        .await
        .map_err(map_storage_error)?;
    Ok(Json(DeleteResponse { deleted: true }))
}
