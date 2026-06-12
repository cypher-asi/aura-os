//! Path resolution and small shared constants for the appearance
//! handlers.
//!
//! The `.aura/` directory under each project's workspace is the
//! single on-disk home for both the JSON metadata file and the
//! image assets (banner, background image). Resolving it once here
//! keeps the metadata and image-asset modules from each rolling
//! their own copy of the local-vs-canonical fallback logic.

use std::path::PathBuf;
use std::str::FromStr;

use aura_os_core::ProjectId;

use crate::error::{ApiError, ApiResult};
use crate::handlers::projects_helpers::canonical_workspace_path;
use crate::state::AppState;

pub(super) const APPEARANCE_FILENAME: &str = "appearance.json";

/// Resolve the `.aura/` directory for a project. Prefers the project's
/// `local_workspace_path` when set so the file can be committed to the
/// user's repo; otherwise falls back to the canonical workspace under
/// `<data_dir>/workspaces/<project_id>/`.
pub(super) fn appearance_dir(state: &AppState, project_id: &ProjectId) -> PathBuf {
    let local = state
        .project_service
        .get_project(project_id)
        .ok()
        .and_then(|p| p.local_workspace_path.clone())
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .map(PathBuf::from);

    let base = local.unwrap_or_else(|| canonical_workspace_path(&state.data_dir, project_id));
    base.join(".aura")
}

pub(super) fn parse_project_id(raw: &str) -> ApiResult<ProjectId> {
    ProjectId::from_str(raw)
        .map_err(|e| ApiError::bad_request(format!("invalid project id '{raw}': {e}")))
}
