//! Local-workspace preflight gate exposed to the legacy phase7 test surface.

use aura_os_core::{HarnessMode, ProjectId};

use crate::handlers::projects_helpers::validate_workspace_is_initialised;

pub(crate) fn preflight_local_workspace_for_tests(
    project_path: &str,
    git_repo_url: Option<&str>,
) -> Result<(), String> {
    if project_path.trim().is_empty() {
        return Err("workspace path is empty".to_string());
    }
    let path = std::path::Path::new(project_path);
    match validate_workspace_is_initialised(path) {
        Ok(()) => Ok(()),
        Err(err) => {
            let bootstrap_pending = git_repo_url.is_some_and(|url| !url.trim().is_empty());
            if bootstrap_pending
                && matches!(
                    err,
                    crate::handlers::projects_helpers::WorkspacePreflightError::Empty
                        | crate::handlers::projects_helpers::WorkspacePreflightError::NotAGitRepo
                )
            {
                Ok(())
            } else {
                Err(err.remediation_hint(path))
            }
        }
    }
}

// Keeps the `HarnessMode` / `ProjectId` imports load-bearing for any
// future expansion of this module without flagging dead_code; the
// pre-split file used the same pattern.
#[allow(dead_code)]
fn _keep_harness_mode_import(_: HarnessMode, _: ProjectId) {}
