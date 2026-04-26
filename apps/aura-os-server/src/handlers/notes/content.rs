//! Per-note read/write handlers and the helper that keeps the on-disk
//! filename in sync with the first-line title.

use std::path::{Path, PathBuf};

use aura_os_core::ProjectId;
use axum::extract::{Path as AxumPath, Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use tracing::{debug, warn};

use super::frontmatter::{
    extract_title, parse_frontmatter, render_note, word_count_of, NoteFrontmatter,
};
use super::paths::{
    iso_now, rel_of, resolve_rel_path, slug_stem, system_time_to_rfc3339, to_forward_slashes,
    unique_path,
};
use super::root::ensure_notes_root;
use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthSession};

#[derive(Debug, Deserialize)]
pub(crate) struct PathQuery {
    pub path: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct ReadResponse {
    pub content: String,
    pub title: String,
    pub frontmatter: NoteFrontmatter,
    #[serde(rename = "absPath")]
    pub abs_path: String,
    #[serde(rename = "updatedAt", skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    #[serde(rename = "wordCount")]
    pub word_count: usize,
}

pub(crate) async fn read_note(
    State(state): State<AppState>,
    AuthSession(_session): AuthSession,
    AxumPath(project_id): AxumPath<ProjectId>,
    Query(query): Query<PathQuery>,
) -> ApiResult<Json<ReadResponse>> {
    let root = ensure_notes_root(&state.data_dir, &state.project_service, &project_id)?;
    let abs = resolve_rel_path(&root, &query.path)?;
    if !abs.is_file() {
        return Err(ApiError::not_found(format!(
            "note not found: {}",
            query.path
        )));
    }
    let content = tokio::fs::read_to_string(&abs)
        .await
        .map_err(|e| ApiError::internal(format!("failed to read note: {e}")))?;
    let (frontmatter, body) = parse_frontmatter(&content);
    let title = extract_title(&content);
    let updated_at = tokio::fs::metadata(&abs)
        .await
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(system_time_to_rfc3339);
    Ok(Json(ReadResponse {
        content,
        title,
        frontmatter,
        abs_path: to_forward_slashes(&abs),
        updated_at,
        word_count: word_count_of(&body),
    }))
}

#[derive(Debug, Deserialize)]
pub(crate) struct WriteRequest {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct WriteResponse {
    pub ok: bool,
    pub title: String,
    #[serde(rename = "relPath")]
    pub rel_path: String,
    #[serde(rename = "absPath")]
    pub abs_path: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    #[serde(rename = "wordCount")]
    pub word_count: usize,
}

pub(crate) async fn write_note(
    State(state): State<AppState>,
    AuthSession(_session): AuthSession,
    AxumPath(project_id): AxumPath<ProjectId>,
    Json(req): Json<WriteRequest>,
) -> ApiResult<Json<WriteResponse>> {
    let root = ensure_notes_root(&state.data_dir, &state.project_service, &project_id)?;
    let abs = resolve_rel_path(&root, &req.path)?;
    if abs.extension().and_then(|s| s.to_str()) != Some("md") {
        return Err(ApiError::bad_request("only .md notes can be written"));
    }
    if let Some(parent) = abs.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| ApiError::internal(format!("failed to create parent dir: {e}")))?;
    }

    let (frontmatter, body) = parse_frontmatter(&req.content);
    let now = iso_now();
    let frontmatter = stamped_frontmatter(frontmatter, &now);
    let rendered = render_note(&frontmatter, &body);
    let title = extract_title(&rendered);

    persist_note(&abs, &rendered).await?;
    debug!(path = %abs.display(), "wrote note");

    let final_abs = match maybe_rename_for_title(&abs, &title).await {
        Ok(next) => next,
        Err(err) => {
            warn!(path = %abs.display(), %err, "failed to rename note file after write");
            abs
        }
    };

    Ok(Json(WriteResponse {
        ok: true,
        title,
        rel_path: rel_of(&root, &final_abs),
        abs_path: to_forward_slashes(&final_abs),
        updated_at: now,
        word_count: word_count_of(&body),
    }))
}

fn stamped_frontmatter(mut fm: NoteFrontmatter, now: &str) -> NoteFrontmatter {
    if fm.created_at.is_none() {
        fm.created_at = Some(now.to_string());
    }
    fm.updated_at = Some(now.to_string());
    fm
}

/// Atomic-ish write: stage to `<path>.tmp` then rename into place so a
/// crash mid-write doesn't leave a half-baked `.md` file on disk.
async fn persist_note(abs: &Path, rendered: &str) -> ApiResult<()> {
    let tmp = abs.with_extension("md.tmp");
    tokio::fs::write(&tmp, rendered)
        .await
        .map_err(|e| ApiError::internal(format!("failed to write tmp file: {e}")))?;
    tokio::fs::rename(&tmp, abs)
        .await
        .map_err(|e| ApiError::internal(format!("failed to rename tmp file: {e}")))?;
    Ok(())
}

/// If `title` slugifies to a different stem than the current filename,
/// rename the `.md` file (and its `.comments.json` sidecar) to match,
/// using `unique_path` to avoid clobbering an existing sibling.
/// Empty titles or a no-op slug leave the filename unchanged.
async fn maybe_rename_for_title(current: &Path, title: &str) -> std::io::Result<PathBuf> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Ok(current.to_path_buf());
    }
    let new_stem = slug_stem(trimmed);
    if new_stem.is_empty() || new_stem == "untitled" {
        return Ok(current.to_path_buf());
    }
    let current_stem = current
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or_default();
    if current_stem == new_stem {
        return Ok(current.to_path_buf());
    }
    let parent = current.parent().unwrap_or_else(|| Path::new(""));
    let desired = parent.join(format!("{new_stem}.md"));
    if desired == current {
        return Ok(current.to_path_buf());
    }
    let target = unique_path(desired);
    tokio::fs::rename(current, &target).await?;
    move_comments_sidecar(current, &target).await;
    Ok(target)
}

async fn move_comments_sidecar(current: &Path, target: &Path) {
    let current_name = current
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let old_sidecar = current.with_file_name(format!("{current_name}.comments.json"));
    if !old_sidecar.exists() {
        return;
    }
    let target_name = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let new_sidecar = target.with_file_name(format!("{target_name}.comments.json"));
    if let Err(err) = tokio::fs::rename(&old_sidecar, &new_sidecar).await {
        warn!(
            from = %old_sidecar.display(),
            to = %new_sidecar.display(),
            %err,
            "failed to move comments sidecar during note rename",
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tempfile::TempDir;

    fn setup() -> (TempDir, PathBuf) {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("notes").join("proj-1");
        std::fs::create_dir_all(&root).unwrap();
        (tmp, root)
    }

    #[tokio::test]
    async fn maybe_rename_for_title_renames_matching_stem() {
        let (_tmp, root) = setup();
        let original = root.join("untitled.md");
        std::fs::write(&original, "# Hello").unwrap();
        let next = maybe_rename_for_title(&original, "Hello world")
            .await
            .unwrap();
        assert_eq!(
            next.file_name().unwrap().to_string_lossy(),
            "hello-world.md"
        );
        assert!(next.exists());
        assert!(!original.exists());
    }

    #[tokio::test]
    async fn maybe_rename_for_title_moves_comments_sidecar() {
        let (_tmp, root) = setup();
        let original = root.join("untitled.md");
        std::fs::write(&original, "# Hello").unwrap();
        let sidecar = root.join("untitled.md.comments.json");
        std::fs::write(&sidecar, "{\"comments\":[]}").unwrap();

        let next = maybe_rename_for_title(&original, "Hello world")
            .await
            .unwrap();
        assert!(next.exists());
        assert!(!sidecar.exists());
        let moved = root.join("hello-world.md.comments.json");
        assert!(moved.exists());
    }

    #[tokio::test]
    async fn maybe_rename_for_title_no_op_when_stem_matches() {
        let (_tmp, root) = setup();
        let original = root.join("hello-world.md");
        std::fs::write(&original, "# Hello world").unwrap();
        let next = maybe_rename_for_title(&original, "Hello world")
            .await
            .unwrap();
        assert_eq!(next, original);
        assert!(next.exists());
    }

    #[tokio::test]
    async fn maybe_rename_for_title_adds_suffix_on_collision() {
        let (_tmp, root) = setup();
        std::fs::write(root.join("hello-world.md"), "# Existing").unwrap();
        let original = root.join("untitled.md");
        std::fs::write(&original, "# Hello world").unwrap();
        let next = maybe_rename_for_title(&original, "Hello world")
            .await
            .unwrap();
        assert_eq!(
            next.file_name().unwrap().to_string_lossy(),
            "hello-world-2.md"
        );
        assert!(next.exists());
        assert!(!original.exists());
    }

    #[tokio::test]
    async fn maybe_rename_for_title_skips_empty_title() {
        let (_tmp, root) = setup();
        let original = root.join("untitled.md");
        std::fs::write(&original, "").unwrap();
        let next = maybe_rename_for_title(&original, "   ").await.unwrap();
        assert_eq!(next, original);
    }
}
