//! JSON metadata handlers: read and write the per-project
//! `appearance.json` file. The shape is opaque — the server validates
//! the body is a JSON object and writes it back verbatim. Evolving
//! the schema is a frontend-only concern.

use axum::extract::{Path as AxumPath, State};
use axum::Json;
use serde_json::{json, Value};

use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthJwt};

use super::paths::{appearance_dir, parse_project_id, APPEARANCE_FILENAME};

/// `GET /api/projects/:project_id/appearance` — returns the stored
/// appearance JSON, or an empty object when no file exists yet.
pub(crate) async fn get_appearance(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AxumPath(project_id): AxumPath<String>,
) -> ApiResult<Json<Value>> {
    let project_id = parse_project_id(&project_id)?;
    let path = appearance_dir(&state, &project_id).join(APPEARANCE_FILENAME);
    match tokio::fs::read(&path).await {
        Ok(bytes) => {
            let value: Value = serde_json::from_slice(&bytes).map_err(|e| {
                ApiError::internal(format!(
                    "appearance file at {} is not valid JSON: {e}",
                    path.display()
                ))
            })?;
            Ok(Json(value))
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(Json(json!({}))),
        Err(err) => Err(ApiError::internal(format!(
            "failed to read appearance file {}: {err}",
            path.display()
        ))),
    }
}

/// `PUT /api/projects/:project_id/appearance` — writes the request
/// body to `appearance.json` atomically. Body must be a JSON object;
/// arrays and scalars are rejected so callers can't accidentally erase
/// the file shape.
pub(crate) async fn put_appearance(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AxumPath(project_id): AxumPath<String>,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    if !body.is_object() {
        return Err(ApiError::bad_request(
            "appearance payload must be a JSON object".to_string(),
        ));
    }
    let project_id = parse_project_id(&project_id)?;
    let dir = appearance_dir(&state, &project_id);
    tokio::fs::create_dir_all(&dir).await.map_err(|e| {
        ApiError::internal(format!(
            "failed to create appearance directory {}: {e}",
            dir.display()
        ))
    })?;
    let path = dir.join(APPEARANCE_FILENAME);
    let tmp = dir.join(format!("{APPEARANCE_FILENAME}.tmp"));
    let bytes = serde_json::to_vec_pretty(&body)
        .map_err(|e| ApiError::internal(format!("failed to serialize appearance: {e}")))?;
    tokio::fs::write(&tmp, &bytes).await.map_err(|e| {
        ApiError::internal(format!(
            "failed to write appearance tmp file {}: {e}",
            tmp.display()
        ))
    })?;
    tokio::fs::rename(&tmp, &path).await.map_err(|e| {
        ApiError::internal(format!(
            "failed to commit appearance file {}: {e}",
            path.display()
        ))
    })?;
    Ok(Json(body))
}
