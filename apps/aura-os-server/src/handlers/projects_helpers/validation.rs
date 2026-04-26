//! Workspace preflight validation.
//!
//! Catches common failure shapes (missing path, no `.git`, empty repo)
//! before the dev loop spawns an automaton against a workspace.

/// Outcome of [`validate_workspace_is_initialised`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum WorkspacePreflightError {
    /// The workspace path does not exist at all.
    Missing,
    /// The path exists but is not a directory.
    NotADirectory,
    /// The directory exists but is effectively empty (no files other
    /// than `.git` metadata) -- a strong signal the repo was never
    /// cloned / bootstrapped.
    Empty,
    /// The directory has content but no `.git` marker (file or dir) at
    /// its root. The dev loop refuses to run here because commits /
    /// pushes would have no repository to land in.
    NotAGitRepo,
    /// Filesystem error while inspecting the directory.
    Io(String),
}

impl WorkspacePreflightError {
    pub(crate) fn remediation_hint(&self, path: &std::path::Path) -> String {
        let path = path.display();
        match self {
            WorkspacePreflightError::Missing => format!(
                "workspace at {path} does not exist; bootstrap the project (clone / create) before starting the dev loop"
            ),
            WorkspacePreflightError::NotADirectory => format!(
                "workspace at {path} is not a directory; remove the conflicting file and re-bootstrap the project"
            ),
            WorkspacePreflightError::Empty => format!(
                "workspace at {path} is empty; clone the project repository before starting the dev loop so the automaton has source to work with"
            ),
            WorkspacePreflightError::NotAGitRepo => format!(
                "workspace at {path} is not a git repository (no .git entry); initialise the repo or re-clone before starting the dev loop"
            ),
            WorkspacePreflightError::Io(err) => format!(
                "workspace at {path} is not accessible: {err}"
            ),
        }
    }
}

/// Preflight check run before an automaton is spawned against a
/// workspace. Rejects empty / uninitialised directories so the agent
/// does not flail producing `Untitled file` writes with no useful
/// diagnosis.
///
/// A workspace passes when all of the following hold:
/// 1. the path exists and is a directory,
/// 2. it contains a `.git` entry (either a directory or a worktree
///    file), and
/// 3. it contains at least one entry besides `.git`.
pub(crate) fn validate_workspace_is_initialised(
    workspace_root: &std::path::Path,
) -> Result<(), WorkspacePreflightError> {
    let metadata = match std::fs::symlink_metadata(workspace_root) {
        Ok(m) => m,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Err(WorkspacePreflightError::Missing);
        }
        Err(err) => return Err(WorkspacePreflightError::Io(err.to_string())),
    };
    if !metadata.is_dir() {
        return Err(WorkspacePreflightError::NotADirectory);
    }

    let mut has_git_marker = false;
    let mut has_non_git_entry = false;
    let entries = std::fs::read_dir(workspace_root)
        .map_err(|e| WorkspacePreflightError::Io(e.to_string()))?;
    for entry in entries {
        let entry = entry.map_err(|e| WorkspacePreflightError::Io(e.to_string()))?;
        let name = entry.file_name();
        if name == ".git" {
            has_git_marker = true;
        } else {
            has_non_git_entry = true;
        }
        if has_git_marker && has_non_git_entry {
            break;
        }
    }

    if !has_git_marker {
        return Err(WorkspacePreflightError::NotAGitRepo);
    }
    if !has_non_git_entry {
        return Err(WorkspacePreflightError::Empty);
    }
    Ok(())
}
