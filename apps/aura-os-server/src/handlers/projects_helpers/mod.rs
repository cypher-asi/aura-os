//! Helpers shared by the project-shaped HTTP handlers (`projects.rs`,
//! `specs.rs`, `tasks/extraction.rs`, …). Split into:
//!
//! * [`paths`] — sanitization, slugification, canonical workspace paths,
//!   and writing imported files to disk.
//! * [`validation`] — workspace preflight (`.git`, non-empty, …).
//! * [`metadata`] — local↔network shadow projections and request DTOs.
//! * [`session`] — workspace path / harness session resolution for
//!   project tools.

mod metadata;
mod paths;
mod session;
mod validation;

pub(crate) use metadata::{
    build_local_shadow, ensure_local_shadow, normalize_project_workspace, project_from_network,
    to_project_input, ListProjectsQuery,
};
pub(crate) use paths::{
    canonical_workspace_path, ensure_canonical_workspace_dir, slugify, write_imported_files,
};
pub(crate) use session::{
    project_tool_deadline, project_tool_session_config, resolve_agent_instance_workspace_path,
    resolve_project_tool_workspace_path,
};
pub(crate) use validation::{validate_workspace_is_initialised, WorkspacePreflightError};

#[cfg(test)]
mod tests {
    use super::{
        canonical_workspace_path, ensure_canonical_workspace_dir,
        validate_workspace_is_initialised, WorkspacePreflightError,
    };
    use aura_os_core::ProjectId;

    #[test]
    fn ensure_canonical_workspace_dir_creates_the_managed_workspace() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let project_id = ProjectId::new();

        let workspace_root =
            ensure_canonical_workspace_dir(temp_dir.path(), &project_id).expect("workspace dir");

        assert_eq!(
            workspace_root,
            canonical_workspace_path(temp_dir.path(), &project_id)
        );
        assert!(workspace_root.is_dir());
    }

    #[test]
    fn validate_workspace_is_initialised_rejects_missing_path() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let missing = temp_dir.path().join("does-not-exist");
        assert_eq!(
            validate_workspace_is_initialised(&missing),
            Err(WorkspacePreflightError::Missing)
        );
    }

    #[test]
    fn validate_workspace_is_initialised_rejects_files() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let file_path = temp_dir.path().join("not-a-dir");
        std::fs::write(&file_path, b"oops").expect("write file");
        assert_eq!(
            validate_workspace_is_initialised(&file_path),
            Err(WorkspacePreflightError::NotADirectory)
        );
    }

    #[test]
    fn validate_workspace_is_initialised_rejects_empty_dirs() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        assert_eq!(
            validate_workspace_is_initialised(temp_dir.path()),
            Err(WorkspacePreflightError::NotAGitRepo)
        );
    }

    #[test]
    fn validate_workspace_is_initialised_rejects_git_only_worktrees() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        std::fs::create_dir(temp_dir.path().join(".git")).expect("mkdir .git");
        assert_eq!(
            validate_workspace_is_initialised(temp_dir.path()),
            Err(WorkspacePreflightError::Empty)
        );
    }

    #[test]
    fn validate_workspace_is_initialised_rejects_content_without_git() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        std::fs::write(temp_dir.path().join("README.md"), b"hello").expect("write");
        assert_eq!(
            validate_workspace_is_initialised(temp_dir.path()),
            Err(WorkspacePreflightError::NotAGitRepo)
        );
    }

    #[test]
    fn validate_workspace_is_initialised_accepts_bootstrapped_repos() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        std::fs::create_dir(temp_dir.path().join(".git")).expect("mkdir .git");
        std::fs::write(temp_dir.path().join("Cargo.toml"), b"[workspace]\n").expect("write");
        assert_eq!(validate_workspace_is_initialised(temp_dir.path()), Ok(()));
    }

    #[test]
    fn validate_workspace_is_initialised_accepts_git_file_worktrees() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        std::fs::write(
            temp_dir.path().join(".git"),
            b"gitdir: /elsewhere/main/.git/worktrees/feature",
        )
        .expect("write gitdir file");
        std::fs::write(temp_dir.path().join("src.txt"), b"content").expect("write");
        assert_eq!(validate_workspace_is_initialised(temp_dir.path()), Ok(()));
    }

    #[test]
    fn remediation_hint_names_the_offending_path() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let hint = WorkspacePreflightError::Empty.remediation_hint(temp_dir.path());
        assert!(hint.contains(&temp_dir.path().display().to_string()));
        assert!(hint.contains("clone the project repository"));
    }
}
