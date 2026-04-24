use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;

use aura_os_storage::{CreateProjectArtifactRequest, StorageProjectArtifact};

use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthJwt};

fn map_storage_error(e: aura_os_storage::StorageError) -> (axum::http::StatusCode, Json<ApiError>) {
    ApiError::internal(format!("storage error: {e}"))
}

fn require_storage_client(
    state: &AppState,
) -> Result<&std::sync::Arc<aura_os_storage::StorageClient>, (axum::http::StatusCode, Json<ApiError>)>
{
    state.storage_client.as_ref().ok_or_else(|| {
        ApiError::service_unavailable("aura-storage not configured")
    })
}

#[derive(Deserialize)]
pub(crate) struct ListArtifactsParams {
    #[serde(rename = "type")]
    pub artifact_type: Option<String>,
}

pub(crate) async fn list_project_artifacts(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<String>,
    Query(params): Query<ListArtifactsParams>,
) -> ApiResult<Json<Vec<StorageProjectArtifact>>> {
    let client = require_storage_client(&state)?;
    let artifacts = client
        .list_project_artifacts(&project_id, params.artifact_type.as_deref(), &jwt)
        .await
        .map_err(map_storage_error)?;
    Ok(Json(artifacts))
}

pub(crate) async fn create_project_artifact(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<String>,
    Json(req): Json<CreateProjectArtifactRequest>,
) -> ApiResult<Json<StorageProjectArtifact>> {
    let client = require_storage_client(&state)?;
    let artifact = client
        .create_project_artifact(&project_id, &jwt, &req)
        .await
        .map_err(map_storage_error)?;
    Ok(Json(artifact))
}

pub(crate) async fn get_project_artifact(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(artifact_id): Path<String>,
) -> ApiResult<Json<StorageProjectArtifact>> {
    let client = require_storage_client(&state)?;
    let artifact = client
        .get_project_artifact(&artifact_id, &jwt)
        .await
        .map_err(map_storage_error)?;
    Ok(Json(artifact))
}

pub(crate) async fn delete_project_artifact(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(artifact_id): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    let client = require_storage_client(&state)?;
    client
        .delete_project_artifact(&artifact_id, &jwt)
        .await
        .map_err(map_storage_error)?;
    Ok(Json(serde_json::json!({ "deleted": true })))
}
