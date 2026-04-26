use axum::extract::{Path, State};
use axum::Json;

use aura_os_core::ProcessFolder;

use super::common::{
    list_remote_process_folders_for_orgs, list_remote_processes_for_orgs,
    require_process_storage_client, resolve_org_ids, resolve_remote_folder_org_id,
};
use super::conversions::conv_folder;
use super::dto::{CreateFolderRequest, DeleteResponse, UpdateFolderRequest};
use crate::error::{map_storage_error, ApiError, ApiResult};
use crate::handlers::permissions::require_org_role;
use crate::state::{AppState, AuthJwt, AuthSession};

pub(crate) async fn list_folders(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(_session): AuthSession,
) -> ApiResult<Json<Vec<ProcessFolder>>> {
    let client = require_process_storage_client(&state)?;
    let org_ids = resolve_org_ids(&state, &jwt).await?;
    let all = list_remote_process_folders_for_orgs(client, &org_ids, &jwt)
        .await?
        .into_iter()
        .map(conv_folder)
        .collect();
    Ok(Json(all))
}

pub(crate) async fn create_folder(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Json(req): Json<CreateFolderRequest>,
) -> ApiResult<Json<ProcessFolder>> {
    let client = require_process_storage_client(&state)?;
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
    Ok(Json(conv_folder(folder)))
}

pub(crate) async fn update_folder(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(id): Path<String>,
    Json(req): Json<UpdateFolderRequest>,
) -> ApiResult<Json<ProcessFolder>> {
    let client = require_process_storage_client(&state)?;
    let org_ids = resolve_org_ids(&state, &jwt).await?;
    let folder_org = resolve_existing_folder_org(client, &id, &org_ids, &jwt).await?;
    require_org_role(&state, &folder_org, &jwt, &session, "admin").await?;
    let storage_req = aura_os_storage::UpdateProcessFolderRequest {
        name: req.name.clone(),
    };
    let folder = client
        .update_process_folder(&id, &jwt, &storage_req)
        .await
        .map_err(map_storage_error)?;
    Ok(Json(conv_folder(folder)))
}

pub(crate) async fn delete_folder(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(id): Path<String>,
) -> ApiResult<Json<DeleteResponse>> {
    let client = require_process_storage_client(&state)?;
    let org_ids = resolve_org_ids(&state, &jwt).await?;
    let folder_org = resolve_existing_folder_org(client, &id, &org_ids, &jwt).await?;
    require_org_role(&state, &folder_org, &jwt, &session, "admin").await?;
    clear_folder_from_processes(client, &id, &org_ids, &jwt).await?;
    client
        .delete_process_folder(&id, &jwt)
        .await
        .map_err(map_storage_error)?;
    Ok(Json(DeleteResponse { deleted: true }))
}

async fn resolve_existing_folder_org(
    client: &aura_os_storage::StorageClient,
    id: &str,
    org_ids: &[String],
    jwt: &str,
) -> ApiResult<String> {
    let all_folders = list_remote_process_folders_for_orgs(client, org_ids, jwt).await?;
    all_folders
        .iter()
        .find(|f| f.id == id)
        .and_then(|f| f.org_id.as_deref())
        .ok_or_else(|| ApiError::not_found("folder not found"))
        .map(str::to_string)
}

async fn clear_folder_from_processes(
    client: &aura_os_storage::StorageClient,
    id: &str,
    org_ids: &[String],
    jwt: &str,
) -> ApiResult<()> {
    let processes = list_remote_processes_for_orgs(client, org_ids, jwt).await?;
    for p in &processes {
        if p.folder_id.as_deref() == Some(id) {
            let update = aura_os_storage::UpdateProcessRequest {
                folder_id: Some(None),
                ..Default::default()
            };
            client
                .update_process(&p.id, jwt, &update)
                .await
                .map_err(map_storage_error)?;
        }
    }
    Ok(())
}
