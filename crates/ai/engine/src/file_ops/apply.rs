use std::path::Path;

use tracing::{error, info};

use crate::error::EngineError;
use aura_core::fuzzy_search_replace;

use super::{validate_path, FileOp};

pub async fn apply_file_ops(base_path: &Path, ops: &[FileOp]) -> Result<(), EngineError> {
    info!(base = %base_path.display(), count = ops.len(), "applying file operations");

    for op in ops {
        match op {
            FileOp::Create { path, content } | FileOp::Modify { path, content } => {
                let full_path = base_path.join(path);
                if let Err(e) = validate_path(base_path, &full_path) {
                    error!(path = %path, error = %e, "path validation failed");
                    return Err(e);
                }
                if let Some(parent) = full_path.parent() {
                    tokio::fs::create_dir_all(parent)
                        .await
                        .map_err(|e| EngineError::Io(e.to_string()))?;
                }
                tokio::fs::write(&full_path, content).await.map_err(|e| {
                    error!(path = %path, error = %e, "failed to write file");
                    EngineError::Io(e.to_string())
                })?;
                info!(path = %path, bytes = content.len(), "wrote file");
            }
            FileOp::Delete { path } => {
                let full_path = base_path.join(path);
                if let Err(e) = validate_path(base_path, &full_path) {
                    error!(path = %path, error = %e, "path validation failed");
                    return Err(e);
                }
                if full_path.exists() {
                    tokio::fs::remove_file(&full_path).await.map_err(|e| {
                        error!(path = %path, error = %e, "failed to delete file");
                        EngineError::Io(e.to_string())
                    })?;
                    info!(path = %path, "deleted file");
                }
            }
            FileOp::SearchReplace { path, replacements } => {
                apply_search_replace(base_path, path, replacements).await?;
            }
        }
    }

    info!(
        count = ops.len(),
        "all file operations applied successfully"
    );
    Ok(())
}

async fn apply_search_replace(
    base_path: &Path,
    path: &str,
    replacements: &[super::Replacement],
) -> Result<(), EngineError> {
    let full_path = base_path.join(path);
    if let Err(e) = validate_path(base_path, &full_path) {
        error!(path = %path, error = %e, "path validation failed");
        return Err(e);
    }
    let raw_content = tokio::fs::read_to_string(&full_path).await.map_err(|e| {
        error!(path = %path, error = %e, "failed to read file for search-replace");
        EngineError::Io(format!("failed to read {path} for search-replace: {e}"))
    })?;

    let uses_crlf = raw_content.contains("\r\n");
    let mut content = raw_content.replace("\r\n", "\n");

    for (i, rep) in replacements.iter().enumerate() {
        let norm_search = rep.search.replace("\r\n", "\n");
        let norm_replace = rep.replace.replace("\r\n", "\n");
        let match_count = content.matches(&norm_search).count();
        if match_count == 1 {
            content = content.replacen(&norm_search, &norm_replace, 1);
            continue;
        }
        if match_count > 1 {
            let preview = &rep.search[..rep.search.len().min(120)];
            return Err(EngineError::Parse(format!(
                "search-replace #{} in {path}: search string matched {match_count} \
                 times (must be unique): {preview:?}",
                i + 1
            )));
        }
        if let Some(replacement) = fuzzy_search_replace(&content, &norm_search, &norm_replace) {
            info!(
                path = %path, replacement_index = i + 1,
                "search-replace: exact match failed, fuzzy whitespace match succeeded"
            );
            content = replacement;
        } else {
            let preview = &rep.search[..rep.search.len().min(120)];
            return Err(EngineError::Parse(format!(
                "search-replace #{} in {path}: search string not found \
                 (also tried fuzzy whitespace matching): {preview:?}",
                i + 1
            )));
        }
    }

    let final_content = if uses_crlf {
        content.replace('\n', "\r\n")
    } else {
        content
    };
    let written_bytes = final_content.len();
    tokio::fs::write(&full_path, &final_content)
        .await
        .map_err(|e| {
            error!(path = %path, error = %e, "failed to write after search-replace");
            EngineError::Io(e.to_string())
        })?;
    info!(
        path = %path,
        replacements = replacements.len(),
        bytes = written_bytes,
        "applied search-replace"
    );
    Ok(())
}

/// Compute line-level change stats for each file op before applying them.
/// Must be called before `apply_file_ops` so old file contents are still on disk.
pub fn compute_file_changes(base_path: &Path, ops: &[FileOp]) -> Vec<aura_core::FileChangeSummary> {
    ops.iter()
        .map(|op| match op {
            FileOp::Create { path, content } => aura_core::FileChangeSummary {
                op: "create".to_string(),
                path: path.clone(),
                lines_added: content.lines().count() as u32,
                lines_removed: 0,
            },
            FileOp::Modify { path, content } => {
                let old_lines = std::fs::read_to_string(base_path.join(path))
                    .map(|s| s.lines().count() as u32)
                    .unwrap_or(0);
                aura_core::FileChangeSummary {
                    op: "modify".to_string(),
                    path: path.clone(),
                    lines_added: content.lines().count() as u32,
                    lines_removed: old_lines,
                }
            }
            FileOp::Delete { path } => {
                let old_lines = std::fs::read_to_string(base_path.join(path))
                    .map(|s| s.lines().count() as u32)
                    .unwrap_or(0);
                aura_core::FileChangeSummary {
                    op: "delete".to_string(),
                    path: path.clone(),
                    lines_added: 0,
                    lines_removed: old_lines,
                }
            }
            FileOp::SearchReplace { path, replacements } => {
                let old_content = std::fs::read_to_string(base_path.join(path)).unwrap_or_default();
                let old_lines = old_content.lines().count() as u32;
                let mut new_content = old_content;
                for rep in replacements {
                    new_content = new_content.replacen(&rep.search, &rep.replace, 1);
                }
                let new_lines = new_content.lines().count() as u32;
                aura_core::FileChangeSummary {
                    op: "search_replace".to_string(),
                    path: path.clone(),
                    lines_added: new_lines,
                    lines_removed: old_lines,
                }
            }
        })
        .collect()
}
