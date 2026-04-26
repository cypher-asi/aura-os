//! Filesystem path helpers for project workspaces.
//!
//! Covers slug generation, canonical workspace paths under `data_dir`,
//! safe import-path sanitization, and writing imported files to disk.

use std::path::{Component, Path as FsPath, PathBuf};

use base64::Engine;

use aura_os_core::ProjectId;

use crate::dto::ImportedProjectFile;
use crate::error::{ApiError, ApiResult};

pub(crate) fn canonical_workspace_path(
    data_dir: &std::path::Path,
    project_id: &ProjectId,
) -> PathBuf {
    data_dir.join("workspaces").join(project_id.to_string())
}

pub(crate) fn ensure_canonical_workspace_dir(
    data_dir: &std::path::Path,
    project_id: &ProjectId,
) -> ApiResult<PathBuf> {
    let workspace_root = canonical_workspace_path(data_dir, project_id);
    std::fs::create_dir_all(&workspace_root).map_err(|e| {
        ApiError::internal(format!(
            "failed to create workspace directory {}: {e}",
            workspace_root.display()
        ))
    })?;
    Ok(workspace_root)
}

pub(crate) fn slugify(name: &str) -> String {
    let s = name
        .trim()
        .to_lowercase()
        .replace(char::is_whitespace, "-")
        .replace(|c: char| !c.is_ascii_alphanumeric() && c != '-', "");
    if s.is_empty() {
        "unnamed-project".to_string()
    } else {
        s
    }
}

/// Trim and empty-collapse an optional path. Used to turn empty-string inputs
/// (common from web forms) into a proper `None`.
pub(crate) fn normalize_optional_path(value: &Option<String>) -> Option<String> {
    value
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn sanitize_import_path(relative_path: &str) -> ApiResult<PathBuf> {
    let candidate = FsPath::new(relative_path);
    let mut sanitized = PathBuf::new();

    for component in candidate.components() {
        match component {
            Component::Normal(part) => sanitized.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(ApiError::bad_request(format!(
                    "invalid imported file path: {relative_path}",
                )));
            }
        }
    }

    if sanitized.as_os_str().is_empty() {
        return Err(ApiError::bad_request(
            "imported files must include a relative path".to_string(),
        ));
    }

    Ok(sanitized)
}

pub(crate) async fn write_imported_files(
    workspace_root: &FsPath,
    files: Vec<ImportedProjectFile>,
) -> ApiResult<()> {
    if files.is_empty() {
        return Err(ApiError::bad_request(
            "select at least one file to import".to_string(),
        ));
    }

    for file in files {
        let relative_path = sanitize_import_path(&file.relative_path)?;
        let destination = workspace_root.join(relative_path);
        if let Some(parent) = destination.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|e| {
                ApiError::internal(format!(
                    "failed to create imported workspace directories: {e}",
                ))
            })?;
        }

        let contents = base64::engine::general_purpose::STANDARD
            .decode(file.contents_base64)
            .map_err(|e| ApiError::bad_request(format!("invalid imported file contents: {e}",)))?;

        tokio::fs::write(&destination, contents)
            .await
            .map_err(|e| {
                ApiError::internal(format!(
                    "failed to write imported file {}: {e}",
                    destination.display(),
                ))
            })?;
    }

    Ok(())
}
