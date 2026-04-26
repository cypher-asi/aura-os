//! `<note>.comments.json` sidecar I/O and the comment HTTP handlers.

use std::path::{Path, PathBuf};

use aura_os_core::ProjectId;
use axum::extract::{Path as AxumPath, Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};

use super::paths::{iso_now, resolve_rel_path};
use super::root::ensure_notes_root;
use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthSession};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct NoteComment {
    pub id: String,
    #[serde(rename = "authorId")]
    pub author_id: String,
    #[serde(rename = "authorName")]
    pub author_name: String,
    pub body: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub(super) struct CommentsFile {
    #[serde(default)]
    pub comments: Vec<NoteComment>,
}

fn comments_sidecar(note_abs: &Path) -> PathBuf {
    let name = note_abs
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    note_abs.with_file_name(format!("{name}.comments.json"))
}

async fn load_comments(note_abs: &Path) -> ApiResult<CommentsFile> {
    let sidecar = comments_sidecar(note_abs);
    match tokio::fs::read_to_string(&sidecar).await {
        Ok(raw) => serde_json::from_str(&raw)
            .map_err(|e| ApiError::internal(format!("invalid comments file: {e}"))),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(CommentsFile::default()),
        Err(err) => Err(ApiError::internal(format!(
            "failed to read comments file: {err}"
        ))),
    }
}

async fn save_comments(note_abs: &Path, file: &CommentsFile) -> ApiResult<()> {
    let sidecar = comments_sidecar(note_abs);
    let raw = serde_json::to_string_pretty(file)
        .map_err(|e| ApiError::internal(format!("failed to serialize comments: {e}")))?;
    tokio::fs::write(&sidecar, raw)
        .await
        .map_err(|e| ApiError::internal(format!("failed to write comments file: {e}")))?;
    Ok(())
}

#[derive(Debug, Deserialize)]
pub(crate) struct PathQuery {
    pub path: String,
}

pub(crate) async fn list_comments(
    State(state): State<AppState>,
    AuthSession(_session): AuthSession,
    AxumPath(project_id): AxumPath<ProjectId>,
    Query(query): Query<PathQuery>,
) -> ApiResult<Json<Vec<NoteComment>>> {
    let root = ensure_notes_root(&state.data_dir, &state.project_service, &project_id)?;
    let note_abs = resolve_rel_path(&root, &query.path)?;
    if !note_abs.is_file() {
        return Err(ApiError::not_found(format!(
            "note not found: {}",
            query.path
        )));
    }
    let file = load_comments(&note_abs).await?;
    Ok(Json(file.comments))
}

#[derive(Debug, Deserialize)]
pub(crate) struct AddCommentRequest {
    pub path: String,
    pub body: String,
    #[serde(default, rename = "authorName")]
    pub author_name: Option<String>,
}

pub(crate) async fn add_comment(
    State(state): State<AppState>,
    AuthSession(session): AuthSession,
    AxumPath(project_id): AxumPath<ProjectId>,
    Json(req): Json<AddCommentRequest>,
) -> ApiResult<Json<NoteComment>> {
    let root = ensure_notes_root(&state.data_dir, &state.project_service, &project_id)?;
    let note_abs = resolve_rel_path(&root, &req.path)?;
    if !note_abs.is_file() {
        return Err(ApiError::not_found(format!("note not found: {}", req.path)));
    }
    let trimmed = req.body.trim();
    if trimmed.is_empty() {
        return Err(ApiError::bad_request("comment body is required"));
    }
    let mut file = load_comments(&note_abs).await?;
    let comment = NoteComment {
        id: format!("cm_{}", uuid::Uuid::new_v4().as_simple()),
        author_id: session.user_id.clone(),
        author_name: req
            .author_name
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| session.user_id.clone()),
        body: trimmed.to_string(),
        created_at: iso_now(),
    };
    file.comments.push(comment.clone());
    save_comments(&note_abs, &file).await?;
    Ok(Json(comment))
}

#[derive(Debug, Deserialize)]
pub(crate) struct DeleteCommentRequest {
    pub path: String,
    pub id: String,
}

pub(crate) async fn delete_comment(
    State(state): State<AppState>,
    AuthSession(_session): AuthSession,
    AxumPath(project_id): AxumPath<ProjectId>,
    Json(req): Json<DeleteCommentRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    let root = ensure_notes_root(&state.data_dir, &state.project_service, &project_id)?;
    let note_abs = resolve_rel_path(&root, &req.path)?;
    if !note_abs.is_file() {
        return Err(ApiError::not_found(format!("note not found: {}", req.path)));
    }
    let mut file = load_comments(&note_abs).await?;
    let before = file.comments.len();
    file.comments.retain(|c| c.id != req.id);
    if file.comments.len() == before {
        return Err(ApiError::not_found(format!(
            "comment not found: {}",
            req.id
        )));
    }
    save_comments(&note_abs, &file).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
