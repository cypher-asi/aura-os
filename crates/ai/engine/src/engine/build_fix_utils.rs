use std::collections::HashSet;
use std::path::Path;

use tracing::{info, warn};

use super::build_fix::BUILD_FIX_SNAPSHOT_BUDGET;
use super::build_fix_types::parse_error_references;
use super::error_signatures::parse_individual_error_signatures;
use super::verify_fix_common::build_codebase_snapshot;
use crate::file_ops::{self, FileOp, WorkspaceCache};

use aura_core::*;

pub(crate) struct FileSnapshot {
    pub path: String,
    pub content: Option<String>,
}

pub(crate) fn snapshot_modified_files(
    project_root: &Path,
    file_ops: &[FileOp],
) -> Vec<FileSnapshot> {
    let mut seen = std::collections::HashSet::new();
    let mut snapshots = Vec::new();
    for op in file_ops {
        let path = match op {
            FileOp::Create { path, .. } => path,
            FileOp::Modify { path, .. } => path,
            FileOp::SearchReplace { path, .. } => path,
            FileOp::Delete { path } => path,
        };
        if !seen.insert(path.clone()) {
            continue;
        }
        let full_path = project_root.join(path);
        let content = std::fs::read_to_string(&full_path).ok();
        snapshots.push(FileSnapshot {
            path: path.clone(),
            content,
        });
    }
    snapshots
}

pub(crate) async fn rollback_to_snapshot(project_root: &Path, snapshots: &[FileSnapshot]) {
    for snap in snapshots {
        let full_path = project_root.join(&snap.path);
        match &snap.content {
            Some(content) => {
                if let Err(e) = tokio::fs::write(&full_path, content).await {
                    warn!(path = %snap.path, error = %e, "failed to rollback file");
                }
            }
            None => {
                if let Err(e) = tokio::fs::remove_file(&full_path).await {
                    if e.kind() != std::io::ErrorKind::NotFound {
                        warn!(path = %snap.path, error = %e, "failed to delete file during rollback");
                    }
                }
            }
        }
    }
}

/// Rewrite known server-starting commands to their build/check equivalents.
///
/// When a build command times out, it's usually because the command starts a
/// long-running process. This function maps common run commands to their
/// compile-only counterparts.
pub(crate) fn auto_correct_build_command(cmd: &str) -> Option<String> {
    let trimmed = cmd.trim();
    if trimmed == "cargo run" || trimmed.starts_with("cargo run ") {
        let mut corrected = trimmed.replacen("cargo run", "cargo build", 1);
        if let Some(idx) = corrected.find(" -- ") {
            corrected.truncate(idx);
        } else if corrected.ends_with(" --") {
            corrected.truncate(corrected.len() - 3);
        }
        return Some(corrected);
    }
    if trimmed == "npm start" {
        return Some("npm run build".to_string());
    }
    if trimmed.contains("runserver") {
        return Some(trimmed.replace("runserver", "check"));
    }
    None
}

pub(crate) fn infer_default_build_command(project_root: &Path) -> Option<String> {
    if project_root.join("Cargo.toml").is_file() {
        return Some("cargo check --workspace --tests".to_string());
    }
    if project_root.join("package.json").is_file() {
        return Some("npm run build --if-present".to_string());
    }
    if project_root.join("pyproject.toml").is_file()
        || project_root.join("requirements.txt").is_file()
    {
        return Some("python -m compileall .".to_string());
    }
    None
}

/// Build a codebase snapshot for a build-fix prompt by reading error source
/// files fresh from disk and optionally supplementing with workspace context.
pub(super) async fn build_fix_snapshot(
    project: &Project,
    build_stderr: &str,
    task: &Task,
    workspace_cache: &WorkspaceCache,
) -> String {
    let error_refs = parse_error_references(build_stderr);
    let fresh_error_files = file_ops::resolve_error_source_files(
        Path::new(&project.linked_folder_path),
        &error_refs,
        BUILD_FIX_SNAPSHOT_BUDGET,
    );

    if !fresh_error_files.is_empty() {
        let remaining_budget = BUILD_FIX_SNAPSHOT_BUDGET.saturating_sub(fresh_error_files.len());
        let supplemental = if remaining_budget > 2_000 {
            build_codebase_snapshot(
                &project.linked_folder_path,
                &task.title,
                &task.description,
                remaining_budget,
                workspace_cache,
            )
            .await
        } else {
            String::new()
        };
        if supplemental.is_empty() {
            fresh_error_files
        } else {
            format!("{fresh_error_files}\n{supplemental}")
        }
    } else {
        build_codebase_snapshot(
            &project.linked_folder_path,
            &task.title,
            &task.description,
            BUILD_FIX_SNAPSHOT_BUDGET,
            workspace_cache,
        )
        .await
    }
}

/// Returns true if all current errors are pre-existing (present in baseline).
pub(super) fn all_errors_in_baseline(baseline: &HashSet<String>, stderr: &str) -> bool {
    if baseline.is_empty() {
        return false;
    }
    let current_errors = parse_individual_error_signatures(stderr);
    if current_errors.is_empty() {
        return false;
    }
    let new_errors: HashSet<_> = current_errors.difference(baseline).cloned().collect();
    if new_errors.is_empty() {
        info!(
            pre_existing = current_errors.len(),
            "all build errors are pre-existing (baseline), treating as passed"
        );
        return true;
    }
    false
}
