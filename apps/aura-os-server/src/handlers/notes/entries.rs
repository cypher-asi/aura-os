//! Tree entry CRUD: create note/folder, rename, delete.

use std::path::PathBuf;

use aura_os_core::ProjectId;
use axum::extract::{Path as AxumPath, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use tracing::warn;

use super::frontmatter::{render_note, NoteFrontmatter};
use super::paths::{
    iso_now, rel_of, resolve_rel_path, sanitize_segment, slug_stem, to_forward_slashes, unique_path,
};
use super::root::ensure_notes_root;
use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthSession};
use aura_os_core::ZeroAuthSession;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum CreateKind {
    Note,
    Folder,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CreateRequest {
    #[serde(default, rename = "parentPath")]
    pub parent_path: String,
    pub name: String,
    pub kind: CreateKind,
}

#[derive(Debug, Serialize)]
pub(crate) struct CreateResponse {
    #[serde(rename = "relPath")]
    pub rel_path: String,
    pub title: String,
    #[serde(rename = "absPath")]
    pub abs_path: String,
}

pub(crate) async fn create_entry(
    State(state): State<AppState>,
    AuthSession(session): AuthSession,
    AxumPath(project_id): AxumPath<ProjectId>,
    Json(req): Json<CreateRequest>,
) -> ApiResult<Json<CreateResponse>> {
    let root = ensure_notes_root(&state.data_dir, &state.project_service, &project_id)?;
    let parent = resolve_rel_path(&root, &req.parent_path)?;
    tokio::fs::create_dir_all(&parent)
        .await
        .map_err(|e| ApiError::internal(format!("failed to create parent dir: {e}")))?;

    match req.kind {
        CreateKind::Folder => create_folder_entry(&root, &parent, &req.name).await,
        CreateKind::Note => create_note_entry(&root, &parent, &req.name, &session).await,
    }
}

async fn create_folder_entry(
    root: &std::path::Path,
    parent: &std::path::Path,
    raw_name: &str,
) -> ApiResult<Json<CreateResponse>> {
    let name = sanitize_segment(raw_name, "untitled-folder");
    let target = unique_path(parent.join(&name));
    tokio::fs::create_dir(&target)
        .await
        .map_err(|e| ApiError::internal(format!("failed to create folder: {e}")))?;
    Ok(Json(CreateResponse {
        title: name,
        rel_path: rel_of(root, &target),
        abs_path: to_forward_slashes(&target),
    }))
}

async fn create_note_entry(
    root: &std::path::Path,
    parent: &std::path::Path,
    raw_name: &str,
    session: &ZeroAuthSession,
) -> ApiResult<Json<CreateResponse>> {
    let display_name = raw_name.trim();
    let display_title = if display_name.is_empty() {
        "Untitled".to_string()
    } else {
        display_name.to_string()
    };
    let stem = slug_stem(&display_title);
    let target = unique_path(parent.join(format!("{stem}.md")));

    // Prefer the caller's display name so the Info panel can render
    // "Created by <name>" without a separate lookup. Fall back to the
    // raw user_id only when the session doesn't carry a name.
    let created_by = if session.display_name.trim().is_empty() {
        session.user_id.clone()
    } else {
        session.display_name.clone()
    };
    let frontmatter = NoteFrontmatter {
        created_at: Some(iso_now()),
        created_by: Some(created_by),
        updated_at: Some(iso_now()),
    };
    let body = format!("# {display_title}\n\n");
    let content = render_note(&frontmatter, &body);
    tokio::fs::write(&target, &content)
        .await
        .map_err(|e| ApiError::internal(format!("failed to write note: {e}")))?;

    Ok(Json(CreateResponse {
        title: display_title,
        rel_path: rel_of(root, &target),
        abs_path: to_forward_slashes(&target),
    }))
}

#[derive(Debug, Deserialize)]
pub(crate) struct RenameRequest {
    pub from: String,
    pub to: String,
}

pub(crate) async fn rename_entry(
    State(state): State<AppState>,
    AuthSession(_session): AuthSession,
    AxumPath(project_id): AxumPath<ProjectId>,
    Json(req): Json<RenameRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    let root = ensure_notes_root(&state.data_dir, &state.project_service, &project_id)?;
    let from = resolve_rel_path(&root, &req.from)?;
    let to = resolve_rel_path(&root, &req.to)?;
    if !from.exists() {
        return Err(ApiError::not_found(format!(
            "source not found: {}",
            req.from
        )));
    }
    if to.exists() {
        return Err(ApiError::conflict(format!(
            "destination already exists: {}",
            req.to
        )));
    }
    if let Some(parent) = to.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| ApiError::internal(format!("failed to create parent dir: {e}")))?;
    }
    tokio::fs::rename(&from, &to)
        .await
        .map_err(|e| ApiError::internal(format!("failed to rename: {e}")))?;
    Ok(Json(serde_json::json!({
        "ok": true,
        "relPath": rel_of(&root, &to),
        "absPath": to_forward_slashes(&to),
    })))
}

#[derive(Debug, Deserialize)]
pub(crate) struct DeleteRequest {
    pub path: String,
}

pub(crate) async fn delete_entry(
    State(state): State<AppState>,
    AuthSession(_session): AuthSession,
    AxumPath(project_id): AxumPath<ProjectId>,
    Json(req): Json<DeleteRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    let root = ensure_notes_root(&state.data_dir, &state.project_service, &project_id)?;
    let target = resolve_rel_path(&root, &req.path)?;
    if !target.exists() {
        return Err(ApiError::not_found(format!("not found: {}", req.path)));
    }
    if target.is_dir() {
        tokio::fs::remove_dir_all(&target)
            .await
            .map_err(|e| ApiError::internal(format!("failed to delete folder: {e}")))?;
    } else {
        delete_note_file(&target).await?;
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn delete_note_file(target: &std::path::Path) -> ApiResult<()> {
    tokio::fs::remove_file(target)
        .await
        .map_err(|e| ApiError::internal(format!("failed to delete note: {e}")))?;
    let sidecar = sidecar_for(target);
    if sidecar.exists() {
        if let Err(err) = tokio::fs::remove_file(&sidecar).await {
            warn!(path = %sidecar.display(), %err, "failed to remove comments sidecar");
        }
    }
    Ok(())
}

fn sidecar_for(note_abs: &std::path::Path) -> PathBuf {
    note_abs.with_extension("md.comments.json")
}
