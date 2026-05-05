use std::str::FromStr;

use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use tracing::warn;

use aura_os_core::ProjectId;
use aura_os_storage::{CreateProjectArtifactRequest, StorageProjectArtifact};

use crate::error::{ApiError, ApiResult};
use crate::handlers::projects_helpers::canonical_workspace_path;
use crate::state::{AppState, AuthJwt};

/// Cap a single thumbnail upload at 2 MiB. A typical 256x256 PNG is
/// ~10-30 KB, so this gives plenty of headroom for transparency /
/// retina captures while still bounding worst-case payload size.
pub(crate) const THUMBNAIL_MAX_BYTES: usize = 2 * 1024 * 1024;

const PNG_MAGIC: &[u8] = &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

fn map_storage_error(e: aura_os_storage::StorageError) -> (axum::http::StatusCode, Json<ApiError>) {
    ApiError::internal(format!("storage error: {e}"))
}

fn require_storage_client(
    state: &AppState,
) -> Result<&std::sync::Arc<aura_os_storage::StorageClient>, (axum::http::StatusCode, Json<ApiError>)>
{
    state
        .storage_client
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("aura-storage not configured"))
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
    // Best-effort: clean up any thumbnail file we wrote for this
    // artifact. Failures are intentionally swallowed — orphan PNGs
    // are harmless and small, and we never want a missing file to
    // block deletion of the artifact record itself.
    if let Some(path) = thumbnail_path_for_lookup(&state, &artifact_id, &jwt).await {
        let _ = tokio::fs::remove_file(&path).await;
    }
    Ok(Json(serde_json::json!({ "deleted": true })))
}

/// Resolve the on-disk thumbnail path for an artifact. Returns
/// `Err(_)` if the artifact can't be looked up, the project id is
/// missing, or the project id can't be parsed (the latter would mean
/// the server and storage backend disagree on id format, which is a
/// real bug worth surfacing — not a silent skip).
async fn thumbnail_path(
    state: &AppState,
    artifact_id: &str,
    jwt: &str,
) -> ApiResult<std::path::PathBuf> {
    let client = require_storage_client(state)?;
    let artifact = client
        .get_project_artifact(artifact_id, jwt)
        .await
        .map_err(map_storage_error)?;
    let raw_project_id = artifact.project_id.ok_or_else(|| {
        ApiError::not_found(format!(
            "artifact {artifact_id} has no associated project"
        ))
    })?;
    let project_id = ProjectId::from_str(&raw_project_id).map_err(|e| {
        ApiError::internal(format!(
            "unparseable project id '{raw_project_id}' for artifact {artifact_id}: {e}"
        ))
    })?;
    let workspace = canonical_workspace_path(&state.data_dir, &project_id);
    Ok(workspace
        .join(".thumbnails")
        .join(format!("{artifact_id}.png")))
}

/// Best-effort variant used by the delete handler — never propagates
/// errors so a thumbnail-cleanup miss can't fail the delete itself.
async fn thumbnail_path_for_lookup(
    state: &AppState,
    artifact_id: &str,
    jwt: &str,
) -> Option<std::path::PathBuf> {
    thumbnail_path(state, artifact_id, jwt).await.ok()
}

/// Write the captured PNG snapshot of a 3D model to
/// `<data_dir>/workspaces/<project_id>/.thumbnails/<artifact_id>.png`.
/// The PNG magic bytes are validated up front so the endpoint can't
/// be used to drop arbitrary blobs onto the server's filesystem.
pub(crate) async fn put_artifact_thumbnail(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(artifact_id): Path<String>,
    body: Bytes,
) -> ApiResult<Json<serde_json::Value>> {
    if body.len() > THUMBNAIL_MAX_BYTES {
        return Err(ApiError::bad_request(format!(
            "thumbnail payload {} bytes exceeds the {} byte limit",
            body.len(),
            THUMBNAIL_MAX_BYTES
        )));
    }
    if body.len() < PNG_MAGIC.len() || &body[..PNG_MAGIC.len()] != PNG_MAGIC {
        return Err(ApiError::bad_request(
            "thumbnail body is not a valid PNG (magic bytes mismatch)".to_string(),
        ));
    }

    let path = thumbnail_path(&state, &artifact_id, &jwt).await?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| {
            ApiError::internal(format!(
                "failed to create thumbnail directory {}: {e}",
                parent.display()
            ))
        })?;
    }

    // Atomic write: stage at <name>.tmp then rename so a half-written
    // PNG can never be read by the GET handler.
    let tmp_path = path.with_extension("png.tmp");
    tokio::fs::write(&tmp_path, &body).await.map_err(|e| {
        ApiError::internal(format!(
            "failed to write thumbnail tmp file {}: {e}",
            tmp_path.display()
        ))
    })?;
    tokio::fs::rename(&tmp_path, &path).await.map_err(|e| {
        ApiError::internal(format!(
            "failed to commit thumbnail file {}: {e}",
            path.display()
        ))
    })?;

    Ok(Json(serde_json::json!({
        "thumbnailUrl": format!("/api/artifacts/{artifact_id}/thumbnail"),
    })))
}

/// Serve the previously-captured PNG. Returns 404 if the file is
/// missing so the frontend can fall back to its source-image / cube
/// placeholder via the `<img onError>` chain.
pub(crate) async fn get_artifact_thumbnail(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(artifact_id): Path<String>,
) -> Response {
    let path = match thumbnail_path(&state, &artifact_id, &jwt).await {
        Ok(p) => p,
        Err((status, body)) => return (status, body).into_response(),
    };
    match tokio::fs::read(&path).await {
        Ok(bytes) => (
            [
                (header::CONTENT_TYPE, "image/png"),
                // Short cache: the file path is keyed by artifact id
                // (immutable), but we expose the URL with a cache-bust
                // query param from the client side after upload, so a
                // modest cache window here is safe and avoids
                // re-downloading thumbs on every sidekick render.
                (header::CACHE_CONTROL, "private, max-age=300"),
            ],
            bytes,
        )
            .into_response(),
        Err(e) => {
            if e.kind() == std::io::ErrorKind::NotFound {
                (StatusCode::NOT_FOUND, "thumbnail not found").into_response()
            } else {
                warn!(artifact_id = %artifact_id, error = %e, "failed to read thumbnail file");
                (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
            }
        }
    }
}
