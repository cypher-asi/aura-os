//! Per-session worktree isolation and recoverable filesystem checkpoints.
//!
//! Project chat normally points every session at the same project directory.
//! That is convenient for a single chat, but two sessions can overwrite each
//! other's files. Safe workspaces give an opted-in storage session its own Git
//! worktree and capture the complete (non-ignored) filesystem before each turn.
//! Checkpoints live in a shadow Git repository, so neither snapshots nor
//! restores modify the project's branches, index, or commit history.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::Ordering;
use std::thread;
use std::time::{Duration, SystemTime};

use aura_os_core::{AgentInstanceId, ProjectId, SessionId};
use axum::extract::{Path as AxumPath, State};
use axum::Json;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::error::{map_storage_error, ApiError, ApiResult};
use crate::state::{AppState, AuthJwt, ChatSessionKey};

const SAFE_WORKSPACES_DIR: &str = "safe-workspaces";
const WORKTREE_DIR: &str = "repo";
const METADATA_FILE: &str = "workspace.json";
const CHECKPOINT_STORE_DIR: &str = "checkpoints.git";
const CHECKPOINT_INDEX_FILE: &str = "checkpoint.index";
const CHECKPOINT_REF: &str = "refs/aura/session";
const MAX_CHECKPOINTS_RETURNED: usize = 20;
const MAX_SNAPSHOT_FILES: usize = 50_000;
const MAX_DIFF_BYTES: usize = 200_000;
const MAX_UNTRACKED_COPY_BYTES: u64 = 10 * 1024 * 1024;
const LOCK_ATTEMPTS: usize = 200;
const LOCK_RETRY_DELAY: Duration = Duration::from_millis(25);
const STALE_LOCK_AGE: Duration = Duration::from_secs(120);

#[derive(Debug, Error)]
enum SafeWorkspaceError {
    #[error("safe workspace requires a local Git repository: {0}")]
    Unsupported(String),
    #[error("safe workspace is busy; try again in a moment")]
    Busy,
    #[error("safe workspace changes conflict with the current project: {0}")]
    Conflict(String),
    #[error("safe workspace metadata is invalid: {0}")]
    InvalidMetadata(String),
    #[error("Git command failed: {0}")]
    Git(String),
    #[error("filesystem operation failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("workspace metadata could not be encoded: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceMetadata {
    version: u8,
    project_id: String,
    session_id: String,
    source_repo: PathBuf,
    source_subpath: PathBuf,
    workspace_root: PathBuf,
    workspace_path: PathBuf,
    base_commit: String,
    created_at: String,
    /// Latest isolated checkpoint successfully applied back to the source
    /// project. The next handoff diffs from here instead of replaying changes
    /// that were already applied.
    #[serde(default)]
    applied_checkpoint: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SafeWorkspaceCheckpoint {
    id: String,
    short_id: String,
    created_at: String,
    reason: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SafeWorkspaceStatus {
    enabled: bool,
    workspace_path: Option<String>,
    source_path: Option<String>,
    base_commit: Option<String>,
    created_at: Option<String>,
    checkpoints: Vec<SafeWorkspaceCheckpoint>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SafeWorkspaceDiff {
    checkpoint_id: String,
    stat: String,
    diff: String,
    truncated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SafeWorkspaceRestoreResult {
    restored_to: String,
    undo_checkpoint_id: String,
    workspace_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SafeWorkspaceApplyResult {
    applied: bool,
    checkpoint_id: String,
    stat: String,
    source_path: String,
}

struct WorkspaceLock {
    path: PathBuf,
}

impl WorkspaceLock {
    fn acquire(root: &Path) -> Result<Self, SafeWorkspaceError> {
        fs::create_dir_all(root)?;
        let path = root.join(".lock");
        for _ in 0..LOCK_ATTEMPTS {
            match OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(mut file) => {
                    let _ = writeln!(file, "{}", std::process::id());
                    return Ok(Self { path });
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    let stale = fs::metadata(&path)
                        .and_then(|metadata| metadata.modified())
                        .ok()
                        .and_then(|modified| SystemTime::now().duration_since(modified).ok())
                        .is_some_and(|age| age > STALE_LOCK_AGE);
                    if stale {
                        let _ = fs::remove_file(&path);
                        continue;
                    }
                    thread::sleep(LOCK_RETRY_DELAY);
                }
                Err(error) => return Err(error.into()),
            }
        }
        Err(SafeWorkspaceError::Busy)
    }
}

impl Drop for WorkspaceLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn session_root(data_dir: &Path, project_id: &str, session_id: &str) -> PathBuf {
    data_dir
        .join(SAFE_WORKSPACES_DIR)
        .join(project_id)
        .join(session_id)
}

/// Find an existing workspace beneath Aura's canonical data directory.
///
/// Axum route IDs have already been parsed as UUID-backed types, but this
/// containment check is intentionally independent of that invariant. It also
/// prevents a locally replaced symlink from redirecting a request outside the
/// managed workspace tree.
fn find_existing_session_root(
    data_dir: &Path,
    project_id: &ProjectId,
    session_id: &SessionId,
) -> Result<Option<PathBuf>, SafeWorkspaceError> {
    let canonical_data_dir = data_dir.canonicalize()?;
    let safe_workspaces = match canonical_data_dir.join(SAFE_WORKSPACES_DIR).canonicalize() {
        Ok(path) => path,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    if !safe_workspaces.starts_with(&canonical_data_dir) {
        return Err(SafeWorkspaceError::InvalidMetadata(
            "managed workspace directory escaped Aura's data directory".to_string(),
        ));
    }

    let requested_root = safe_workspaces
        .join(project_id.to_string())
        .join(session_id.to_string());
    let root = match requested_root.canonicalize() {
        Ok(path) => path,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    if !root.starts_with(&safe_workspaces) {
        return Err(SafeWorkspaceError::InvalidMetadata(
            "managed session directory escaped the safe workspace tree".to_string(),
        ));
    }

    let canonical_project_id = root
        .parent()
        .and_then(Path::file_name)
        .and_then(|value| value.to_str())
        .and_then(|value| value.parse::<ProjectId>().ok());
    let canonical_session_id = root
        .file_name()
        .and_then(|value| value.to_str())
        .and_then(|value| value.parse::<SessionId>().ok());
    if canonical_project_id != Some(*project_id) || canonical_session_id != Some(*session_id) {
        return Ok(None);
    }

    match fs::symlink_metadata(root.join(METADATA_FILE)) {
        Ok(metadata) if metadata.file_type().is_file() => Ok(Some(root)),
        Ok(_) => Ok(None),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn command_error(output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    } else {
        stderr
    }
}

fn run_git(cwd: &Path, args: &[&str]) -> Result<Output, SafeWorkspaceError> {
    let output = Command::new("git").current_dir(cwd).args(args).output()?;
    if output.status.success() {
        Ok(output)
    } else {
        Err(SafeWorkspaceError::Git(command_error(&output)))
    }
}

fn run_git_with_input(
    cwd: &Path,
    args: &[&str],
    input: &[u8],
) -> Result<Output, SafeWorkspaceError> {
    let mut child = Command::new("git")
        .current_dir(cwd)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    child
        .stdin
        .take()
        .ok_or_else(|| SafeWorkspaceError::Git("could not open git stdin".to_string()))?
        .write_all(input)?;
    let output = child.wait_with_output()?;
    if output.status.success() {
        Ok(output)
    } else {
        Err(SafeWorkspaceError::Git(command_error(&output)))
    }
}

fn shadow_command(metadata: &WorkspaceMetadata) -> Command {
    let root = metadata
        .workspace_root
        .parent()
        .expect("managed worktree always has a session root");
    let mut command = Command::new("git");
    command
        .current_dir(&metadata.workspace_root)
        .env("GIT_DIR", root.join(CHECKPOINT_STORE_DIR))
        .env("GIT_WORK_TREE", &metadata.workspace_root)
        .env("GIT_INDEX_FILE", root.join(CHECKPOINT_INDEX_FILE))
        .env("GIT_AUTHOR_NAME", "Aura Safe Workspace")
        .env("GIT_AUTHOR_EMAIL", "safe-workspace@aura.local")
        .env("GIT_COMMITTER_NAME", "Aura Safe Workspace")
        .env("GIT_COMMITTER_EMAIL", "safe-workspace@aura.local");
    command
}

fn run_shadow(
    metadata: &WorkspaceMetadata,
    args: &[&str],
    allowed_failure: bool,
) -> Result<Output, SafeWorkspaceError> {
    let output = shadow_command(metadata).args(args).output()?;
    if output.status.success() || allowed_failure {
        Ok(output)
    } else {
        Err(SafeWorkspaceError::Git(command_error(&output)))
    }
}

fn stdout_trimmed(output: Output) -> String {
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn validate_relative_path(path: &Path) -> bool {
    !path.as_os_str().is_empty()
        && path
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
}

fn copy_untracked_files(
    source_repo: &Path,
    workspace_root: &Path,
) -> Result<(), SafeWorkspaceError> {
    let output = run_git(
        source_repo,
        &["ls-files", "--others", "--exclude-standard", "-z"],
    )?;
    for raw_path in output.stdout.split(|byte| *byte == 0) {
        if raw_path.is_empty() {
            continue;
        }
        let relative = PathBuf::from(String::from_utf8_lossy(raw_path).as_ref());
        if !validate_relative_path(&relative) {
            continue;
        }
        let source = source_repo.join(&relative);
        let metadata = match fs::symlink_metadata(&source) {
            Ok(metadata) if metadata.file_type().is_file() => metadata,
            _ => continue,
        };
        if metadata.len() > MAX_UNTRACKED_COPY_BYTES {
            continue;
        }
        let destination = workspace_root.join(&relative);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(&source, &destination)?;
        fs::set_permissions(&destination, metadata.permissions())?;
    }
    Ok(())
}

fn initialize_shadow_store(metadata: &WorkspaceMetadata) -> Result<(), SafeWorkspaceError> {
    let root = metadata
        .workspace_root
        .parent()
        .ok_or_else(|| SafeWorkspaceError::InvalidMetadata("missing session root".to_string()))?;
    let store = root.join(CHECKPOINT_STORE_DIR);
    if !store.join("HEAD").exists() {
        fs::create_dir_all(&store)?;
        let output = Command::new("git")
            .args(["init", "--bare", store.to_string_lossy().as_ref()])
            .output()?;
        if !output.status.success() {
            return Err(SafeWorkspaceError::Git(command_error(&output)));
        }
        let info = store.join("info");
        fs::create_dir_all(&info)?;
        fs::write(
            info.join("exclude"),
            ".git\nnode_modules/\ntarget/\ndist/\nbuild/\n.next/\ncoverage/\n*.log\n.env\n.env.*\n",
        )?;
    }
    Ok(())
}

fn checkpoint_tip(metadata: &WorkspaceMetadata) -> Result<Option<String>, SafeWorkspaceError> {
    let output = run_shadow(
        metadata,
        &[
            "rev-parse",
            "--verify",
            &format!("{CHECKPOINT_REF}^{{commit}}"),
        ],
        true,
    )?;
    Ok(output.status.success().then(|| stdout_trimmed(output)))
}

fn take_checkpoint(
    metadata: &WorkspaceMetadata,
    reason: &str,
) -> Result<String, SafeWorkspaceError> {
    initialize_shadow_store(metadata)?;

    let count_output = run_git(
        &metadata.workspace_root,
        &[
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
        ],
    )?;
    let file_count = count_output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|path| !path.is_empty())
        .count();
    if file_count > MAX_SNAPSHOT_FILES {
        return Err(SafeWorkspaceError::Unsupported(format!(
            "workspace has {file_count} files; checkpoint limit is {MAX_SNAPSHOT_FILES}"
        )));
    }

    let parent = checkpoint_tip(metadata)?;
    let index_path = metadata
        .workspace_root
        .parent()
        .expect("managed worktree always has a session root")
        .join(CHECKPOINT_INDEX_FILE);
    if let Some(parent) = parent.as_deref() {
        run_shadow(metadata, &["read-tree", parent], false)?;
    } else if index_path.exists() {
        fs::remove_file(&index_path)?;
    }

    run_shadow(metadata, &["add", "-A", "--", "."], false)?;
    let tree = stdout_trimmed(run_shadow(metadata, &["write-tree"], false)?);

    if let Some(parent) = parent.as_deref() {
        let parent_tree = stdout_trimmed(run_shadow(
            metadata,
            &["rev-parse", &format!("{parent}^{{tree}}")],
            false,
        )?);
        if parent_tree == tree {
            return Ok(parent.to_string());
        }
    }

    let mut args = vec!["commit-tree", tree.as_str(), "-m", reason, "--no-gpg-sign"];
    if let Some(parent) = parent.as_deref() {
        args.splice(2..2, ["-p", parent]);
    }
    let commit = stdout_trimmed(run_shadow(metadata, &args, false)?);
    let mut update_args = vec!["update-ref", CHECKPOINT_REF, commit.as_str()];
    if let Some(parent) = parent.as_deref() {
        update_args.push(parent);
    }
    run_shadow(metadata, &update_args, false)?;
    Ok(commit)
}

fn read_metadata(root: &Path) -> Result<WorkspaceMetadata, SafeWorkspaceError> {
    let mut bytes = Vec::new();
    File::open(root.join(METADATA_FILE))?.read_to_end(&mut bytes)?;
    let metadata: WorkspaceMetadata = serde_json::from_slice(&bytes)?;
    let expected_root = root.join(WORKTREE_DIR);
    if metadata.version != 1 || metadata.workspace_root != expected_root {
        return Err(SafeWorkspaceError::InvalidMetadata(
            "managed path does not match its session directory".to_string(),
        ));
    }
    Ok(metadata)
}

fn write_metadata(root: &Path, metadata: &WorkspaceMetadata) -> Result<(), SafeWorkspaceError> {
    let encoded = serde_json::to_vec_pretty(metadata)?;
    let temporary = root.join(format!("{METADATA_FILE}.tmp"));
    fs::write(&temporary, encoded)?;
    fs::rename(temporary, root.join(METADATA_FILE))?;
    Ok(())
}

fn remove_managed_entry(path: &Path) -> Result<(), SafeWorkspaceError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    if metadata.file_type().is_dir() {
        fs::remove_dir_all(path)?;
    } else {
        fs::remove_file(path)?;
    }
    Ok(())
}

/// A failed first-time setup can leave a registered worktree or partial
/// shadow repository without metadata. No chat turn can have received that
/// path yet, so it is safe to discard only these managed entries and retry.
fn clean_incomplete_workspace(
    source_repo: &Path,
    root: &Path,
    workspace_root: &Path,
) -> Result<(), SafeWorkspaceError> {
    if workspace_root.exists() {
        let workspace_arg = workspace_root.to_string_lossy().to_string();
        let _ = Command::new("git")
            .current_dir(source_repo)
            .args(["worktree", "remove", "--force", &workspace_arg])
            .output()?;
        remove_managed_entry(workspace_root)?;
    }
    run_git(source_repo, &["worktree", "prune"])?;
    remove_managed_entry(&root.join(CHECKPOINT_STORE_DIR))?;
    remove_managed_entry(&root.join(CHECKPOINT_INDEX_FILE))?;
    remove_managed_entry(&root.join(format!("{METADATA_FILE}.tmp")))?;
    Ok(())
}

fn prepare_workspace_blocking(
    data_dir: &Path,
    project_id: &str,
    session_id: &str,
    source_path: &Path,
) -> Result<WorkspaceMetadata, SafeWorkspaceError> {
    let root = session_root(data_dir, project_id, session_id);
    let _lock = WorkspaceLock::acquire(&root)?;
    if root.join(METADATA_FILE).exists() {
        let metadata = read_metadata(&root)?;
        if metadata.project_id != project_id || metadata.session_id != session_id {
            return Err(SafeWorkspaceError::InvalidMetadata(
                "project or session id mismatch".to_string(),
            ));
        }
        if !metadata.workspace_path.is_dir() {
            return Err(SafeWorkspaceError::InvalidMetadata(
                "managed worktree no longer exists".to_string(),
            ));
        }
        return Ok(metadata);
    }

    let source_path = source_path.canonicalize().map_err(|error| {
        SafeWorkspaceError::Unsupported(format!("{} ({error})", source_path.display()))
    })?;
    let source_repo = PathBuf::from(stdout_trimmed(run_git(
        &source_path,
        &["rev-parse", "--show-toplevel"],
    )?))
    .canonicalize()?;
    let source_subpath = source_path
        .strip_prefix(&source_repo)
        .map_err(|_| {
            SafeWorkspaceError::Unsupported("workspace is outside its Git root".to_string())
        })?
        .to_path_buf();
    if root.starts_with(&source_repo) {
        return Err(SafeWorkspaceError::Unsupported(
            "Aura's data directory cannot be inside the project repository".to_string(),
        ));
    }

    let base_commit = stdout_trimmed(run_git(&source_repo, &["rev-parse", "HEAD"])?);
    let workspace_root = root.join(WORKTREE_DIR);
    clean_incomplete_workspace(&source_repo, &root, &workspace_root)?;
    let workspace_arg = workspace_root.to_string_lossy().to_string();
    run_git(
        &source_repo,
        &["worktree", "add", "--detach", &workspace_arg, &base_commit],
    )?;

    let patch = run_git(
        &source_repo,
        &["diff", "--binary", "--full-index", "HEAD", "--", "."],
    )?
    .stdout;
    if !patch.is_empty() {
        run_git_with_input(
            &workspace_root,
            &["apply", "--whitespace=nowarn", "-"],
            &patch,
        )?;
    }
    copy_untracked_files(&source_repo, &workspace_root)?;

    let workspace_path = workspace_root.join(&source_subpath);
    let metadata = WorkspaceMetadata {
        version: 1,
        project_id: project_id.to_string(),
        session_id: session_id.to_string(),
        source_repo,
        source_subpath,
        workspace_root,
        workspace_path,
        base_commit,
        created_at: Utc::now().to_rfc3339(),
        applied_checkpoint: None,
    };
    take_checkpoint(&metadata, "workspace baseline")?;
    write_metadata(&root, &metadata)?;
    Ok(metadata)
}

fn list_checkpoints_blocking(
    metadata: &WorkspaceMetadata,
) -> Result<Vec<SafeWorkspaceCheckpoint>, SafeWorkspaceError> {
    initialize_shadow_store(metadata)?;
    let limit = MAX_CHECKPOINTS_RETURNED.to_string();
    let output = run_shadow(
        metadata,
        &[
            "log",
            CHECKPOINT_REF,
            "--format=%H%x1f%h%x1f%aI%x1f%s",
            "-n",
            &limit,
        ],
        true,
    )?;
    if !output.status.success() {
        return Ok(Vec::new());
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(4, '\u{1f}');
            Some(SafeWorkspaceCheckpoint {
                id: parts.next()?.to_string(),
                short_id: parts.next()?.to_string(),
                created_at: parts.next()?.to_string(),
                reason: parts.next()?.to_string(),
            })
        })
        .collect())
}

fn validate_checkpoint_id(
    metadata: &WorkspaceMetadata,
    checkpoint_id: &str,
) -> Result<String, SafeWorkspaceError> {
    if !(4..=64).contains(&checkpoint_id.len())
        || !checkpoint_id.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(SafeWorkspaceError::Unsupported(
            "checkpoint id must be a hexadecimal Git object id".to_string(),
        ));
    }
    let resolved = run_shadow(
        metadata,
        &[
            "rev-parse",
            "--verify",
            &format!("{checkpoint_id}^{{commit}}"),
        ],
        false,
    )?;
    let resolved = stdout_trimmed(resolved);
    let ancestor = run_shadow(
        metadata,
        &["merge-base", "--is-ancestor", &resolved, CHECKPOINT_REF],
        true,
    )?;
    if !ancestor.status.success() {
        return Err(SafeWorkspaceError::Unsupported(
            "checkpoint does not belong to this session".to_string(),
        ));
    }
    Ok(resolved)
}

fn checkpoint_diff_blocking(
    metadata: &WorkspaceMetadata,
    checkpoint_id: &str,
) -> Result<SafeWorkspaceDiff, SafeWorkspaceError> {
    let checkpoint_id = validate_checkpoint_id(metadata, checkpoint_id)?;
    run_shadow(metadata, &["add", "-A", "--", "."], false)?;
    let stat = stdout_trimmed(run_shadow(
        metadata,
        &["diff", "--cached", "--stat", &checkpoint_id],
        false,
    )?);
    let output = run_shadow(
        metadata,
        &["diff", "--cached", "--no-color", "--binary", &checkpoint_id],
        false,
    )?;
    if let Some(tip) = checkpoint_tip(metadata)? {
        run_shadow(metadata, &["read-tree", &tip], false)?;
    }
    let truncated = output.stdout.len() > MAX_DIFF_BYTES;
    let diff = String::from_utf8_lossy(&output.stdout[..output.stdout.len().min(MAX_DIFF_BYTES)])
        .to_string();
    Ok(SafeWorkspaceDiff {
        checkpoint_id,
        stat,
        diff,
        truncated,
    })
}

fn restore_checkpoint_blocking(
    root: &Path,
    checkpoint_id: &str,
) -> Result<SafeWorkspaceRestoreResult, SafeWorkspaceError> {
    let _lock = WorkspaceLock::acquire(root)?;
    let metadata = read_metadata(root)?;
    let checkpoint_id = validate_checkpoint_id(&metadata, checkpoint_id)?;
    let undo_checkpoint_id = take_checkpoint(
        &metadata,
        &format!(
            "pre-rollback snapshot (restoring to {})",
            &checkpoint_id[..8]
        ),
    )?;
    run_shadow(
        &metadata,
        &["read-tree", "--reset", "-u", &checkpoint_id],
        false,
    )?;
    Ok(SafeWorkspaceRestoreResult {
        restored_to: checkpoint_id,
        undo_checkpoint_id,
        workspace_path: metadata.workspace_path.to_string_lossy().to_string(),
    })
}

fn first_checkpoint(metadata: &WorkspaceMetadata) -> Result<String, SafeWorkspaceError> {
    let output = run_shadow(
        metadata,
        &["rev-list", "--max-parents=0", CHECKPOINT_REF],
        false,
    )?;
    stdout_trimmed(output)
        .lines()
        .last()
        .map(str::to_string)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| SafeWorkspaceError::InvalidMetadata("baseline checkpoint missing".into()))
}

fn apply_to_source_blocking(root: &Path) -> Result<SafeWorkspaceApplyResult, SafeWorkspaceError> {
    let _lock = WorkspaceLock::acquire(root)?;
    let mut metadata = read_metadata(root)?;
    let checkpoint_id = take_checkpoint(&metadata, "before applying changes to project")?;
    let baseline = match metadata.applied_checkpoint.as_deref() {
        Some(id) => validate_checkpoint_id(&metadata, id)?,
        None => first_checkpoint(&metadata)?,
    };
    let stat = stdout_trimmed(run_shadow(
        &metadata,
        &["diff", "--stat", &baseline, &checkpoint_id],
        false,
    )?);
    let patch = run_shadow(
        &metadata,
        &[
            "diff",
            "--binary",
            "--full-index",
            &baseline,
            &checkpoint_id,
        ],
        false,
    )?
    .stdout;

    if patch.is_empty() {
        return Ok(SafeWorkspaceApplyResult {
            applied: false,
            checkpoint_id,
            stat,
            source_path: metadata
                .source_repo
                .join(&metadata.source_subpath)
                .to_string_lossy()
                .to_string(),
        });
    }

    if let Err(error) = run_git_with_input(
        &metadata.source_repo,
        &["apply", "--check", "--whitespace=nowarn", "-"],
        &patch,
    ) {
        return Err(SafeWorkspaceError::Conflict(error.to_string()));
    }
    if let Err(error) = run_git_with_input(
        &metadata.source_repo,
        &["apply", "--whitespace=nowarn", "-"],
        &patch,
    ) {
        return Err(SafeWorkspaceError::Conflict(error.to_string()));
    }

    metadata.applied_checkpoint = Some(checkpoint_id.clone());
    write_metadata(root, &metadata)?;
    Ok(SafeWorkspaceApplyResult {
        applied: true,
        checkpoint_id,
        stat,
        source_path: metadata
            .source_repo
            .join(&metadata.source_subpath)
            .to_string_lossy()
            .to_string(),
    })
}

fn map_workspace_error(error: SafeWorkspaceError) -> (axum::http::StatusCode, Json<ApiError>) {
    match error {
        SafeWorkspaceError::Unsupported(message) | SafeWorkspaceError::InvalidMetadata(message) => {
            ApiError::bad_request(message)
        }
        SafeWorkspaceError::Busy | SafeWorkspaceError::Conflict(_) => {
            ApiError::conflict(error.to_string())
        }
        SafeWorkspaceError::Git(message) => {
            ApiError::internal(format!("safe workspace: {message}"))
        }
        SafeWorkspaceError::Io(message) => ApiError::internal(format!("safe workspace: {message}")),
        SafeWorkspaceError::Json(message) => {
            ApiError::internal(format!("safe workspace metadata: {message}"))
        }
    }
}

/// Resolve/create the isolated path and capture the filesystem immediately
/// before a chat turn can mutate it.
pub(crate) async fn prepare_safe_turn_workspace(
    state: &AppState,
    project_id: &ProjectId,
    session_id: &SessionId,
    source_path: &str,
) -> ApiResult<String> {
    let data_dir = state.data_dir.clone();
    let project_id = project_id.to_string();
    let session_id = session_id.to_string();
    let source_path = PathBuf::from(source_path);
    tokio::task::spawn_blocking(move || {
        let metadata =
            prepare_workspace_blocking(&data_dir, &project_id, &session_id, &source_path)?;
        let root = session_root(&data_dir, &project_id, &session_id);
        let _lock = WorkspaceLock::acquire(&root)?;
        take_checkpoint(&metadata, "before chat turn")?;
        Ok::<_, SafeWorkspaceError>(metadata.workspace_path.to_string_lossy().to_string())
    })
    .await
    .map_err(|error| ApiError::internal(format!("safe workspace task failed: {error}")))?
    .map_err(map_workspace_error)
}

#[derive(Clone, Copy)]
struct AuthorizedSafeWorkspace {
    project_id: ProjectId,
    session_id: SessionId,
}

async fn authorize_session(
    state: &AppState,
    jwt: &str,
    project_id: &ProjectId,
    agent_instance_id: &AgentInstanceId,
    session_id: &SessionId,
) -> ApiResult<AuthorizedSafeWorkspace> {
    let session = state
        .require_storage_client()?
        .get_session(&session_id.to_string(), jwt)
        .await
        .map_err(map_storage_error)?;

    // Derive filesystem keys from the storage-authorized session rather than
    // directly from route parameters. Besides making the trust boundary
    // explicit, parsing these values as UUID-backed IDs guarantees that each
    // directory component has a fixed, traversal-free representation.
    let stored_project_id = session
        .project_id
        .as_deref()
        .and_then(|value| value.parse::<ProjectId>().ok());
    let stored_agent_instance_id = session
        .project_agent_id
        .as_deref()
        .and_then(|value| value.parse::<AgentInstanceId>().ok());
    let stored_session_id = session.id.parse::<SessionId>().ok();
    let (Some(stored_project_id), Some(stored_agent_instance_id), Some(stored_session_id)) = (
        stored_project_id,
        stored_agent_instance_id,
        stored_session_id,
    ) else {
        return Err(ApiError::not_found("safe workspace not found"));
    };
    if stored_project_id != *project_id
        || stored_agent_instance_id != *agent_instance_id
        || stored_session_id != *session_id
    {
        return Err(ApiError::not_found("safe workspace not found"));
    }

    Ok(AuthorizedSafeWorkspace {
        project_id: stored_project_id,
        session_id: stored_session_id,
    })
}

fn matching_session_keys(state: &AppState, session_id: &SessionId) -> Vec<ChatSessionKey> {
    let suffix = format!("::{session_id}");
    let embedded = format!("::{session_id}::");
    state
        .chat_sessions
        .iter()
        .filter_map(|entry| {
            let key = &entry.key().session_key;
            (key.ends_with(&suffix) || key.contains(&embedded)).then(|| entry.key().clone())
        })
        .collect()
}

fn acquire_session_idle_guards(
    state: &AppState,
    session_id: &SessionId,
    action: &str,
) -> ApiResult<Vec<tokio::sync::OwnedMutexGuard<()>>> {
    let mut guards = Vec::new();
    for key in matching_session_keys(state, session_id) {
        let Some(entry) = state.chat_sessions.get(&key) else {
            continue;
        };
        let pending = entry.turn_pending_count.load(Ordering::Acquire);
        let slot = entry.turn_slot.clone();
        drop(entry);
        if pending > 0 {
            return Err(ApiError::conflict(format!(
                "wait for the active chat turn to finish before {action}"
            )));
        }
        let guard = slot.try_lock_owned().map_err(|_| {
            ApiError::conflict(format!(
                "wait for the active chat turn to finish before {action}"
            ))
        })?;
        guards.push(guard);
    }
    Ok(guards)
}

pub(crate) async fn get_safe_workspace_status(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AxumPath((project_id, agent_instance_id, session_id)): AxumPath<(
        ProjectId,
        AgentInstanceId,
        SessionId,
    )>,
) -> ApiResult<Json<SafeWorkspaceStatus>> {
    let authorized =
        authorize_session(&state, &jwt, &project_id, &agent_instance_id, &session_id).await?;
    let Some(root) = find_existing_session_root(
        &state.data_dir,
        &authorized.project_id,
        &authorized.session_id,
    )
    .map_err(map_workspace_error)?
    else {
        return Ok(Json(SafeWorkspaceStatus {
            enabled: false,
            workspace_path: None,
            source_path: None,
            base_commit: None,
            created_at: None,
            checkpoints: Vec::new(),
        }));
    };
    let status = tokio::task::spawn_blocking(move || {
        let metadata = read_metadata(&root)?;
        let checkpoints = list_checkpoints_blocking(&metadata)?;
        Ok::<_, SafeWorkspaceError>(SafeWorkspaceStatus {
            enabled: true,
            workspace_path: Some(metadata.workspace_path.to_string_lossy().to_string()),
            source_path: Some(
                metadata
                    .source_repo
                    .join(&metadata.source_subpath)
                    .to_string_lossy()
                    .to_string(),
            ),
            base_commit: Some(metadata.base_commit),
            created_at: Some(metadata.created_at),
            checkpoints,
        })
    })
    .await
    .map_err(|error| ApiError::internal(format!("safe workspace task failed: {error}")))?
    .map_err(map_workspace_error)?;
    Ok(Json(status))
}

pub(crate) async fn get_safe_workspace_checkpoint_diff(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AxumPath((project_id, agent_instance_id, session_id, checkpoint_id)): AxumPath<(
        ProjectId,
        AgentInstanceId,
        SessionId,
        String,
    )>,
) -> ApiResult<Json<SafeWorkspaceDiff>> {
    let authorized =
        authorize_session(&state, &jwt, &project_id, &agent_instance_id, &session_id).await?;
    let _turn_guards = acquire_session_idle_guards(&state, &session_id, "previewing files")?;
    let Some(root) = find_existing_session_root(
        &state.data_dir,
        &authorized.project_id,
        &authorized.session_id,
    )
    .map_err(map_workspace_error)?
    else {
        return Err(ApiError::not_found("safe workspace not found"));
    };
    let diff = tokio::task::spawn_blocking(move || {
        let _lock = WorkspaceLock::acquire(&root)?;
        let metadata = read_metadata(&root)?;
        checkpoint_diff_blocking(&metadata, &checkpoint_id)
    })
    .await
    .map_err(|error| ApiError::internal(format!("safe workspace task failed: {error}")))?
    .map_err(map_workspace_error)?;
    Ok(Json(diff))
}

pub(crate) async fn restore_safe_workspace_checkpoint(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AxumPath((project_id, agent_instance_id, session_id, checkpoint_id)): AxumPath<(
        ProjectId,
        AgentInstanceId,
        SessionId,
        String,
    )>,
) -> ApiResult<Json<SafeWorkspaceRestoreResult>> {
    let authorized =
        authorize_session(&state, &jwt, &project_id, &agent_instance_id, &session_id).await?;
    let _turn_guards = acquire_session_idle_guards(&state, &session_id, "restoring files")?;
    let Some(root) = find_existing_session_root(
        &state.data_dir,
        &authorized.project_id,
        &authorized.session_id,
    )
    .map_err(map_workspace_error)?
    else {
        return Err(ApiError::not_found("safe workspace not found"));
    };
    let result =
        tokio::task::spawn_blocking(move || restore_checkpoint_blocking(&root, &checkpoint_id))
            .await
            .map_err(|error| ApiError::internal(format!("safe workspace task failed: {error}")))?
            .map_err(map_workspace_error)?;

    for key in matching_session_keys(&state, &session_id) {
        state.chat_sessions.remove(&key);
    }
    Ok(Json(result))
}

pub(crate) async fn apply_safe_workspace_to_project(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AxumPath((project_id, agent_instance_id, session_id)): AxumPath<(
        ProjectId,
        AgentInstanceId,
        SessionId,
    )>,
) -> ApiResult<Json<SafeWorkspaceApplyResult>> {
    let authorized =
        authorize_session(&state, &jwt, &project_id, &agent_instance_id, &session_id).await?;
    let _turn_guards =
        acquire_session_idle_guards(&state, &session_id, "applying changes to the project")?;
    let Some(root) = find_existing_session_root(
        &state.data_dir,
        &authorized.project_id,
        &authorized.session_id,
    )
    .map_err(map_workspace_error)?
    else {
        return Err(ApiError::not_found("safe workspace not found"));
    };
    let result = tokio::task::spawn_blocking(move || apply_to_source_blocking(&root))
        .await
        .map_err(|error| ApiError::internal(format!("safe workspace task failed: {error}")))?
        .map_err(map_workspace_error)?;
    Ok(Json(result))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn git(cwd: &Path, args: &[&str]) {
        let output = run_git(cwd, args).expect("git command should succeed");
        assert!(output.status.success());
    }

    fn fixture() -> (tempfile::TempDir, tempfile::TempDir, WorkspaceMetadata) {
        let source = tempfile::tempdir().expect("source tempdir");
        git(source.path(), &["init"]);
        git(source.path(), &["config", "user.name", "Aura Test"]);
        git(
            source.path(),
            &["config", "user.email", "aura@test.invalid"],
        );
        fs::write(source.path().join("tracked.txt"), "baseline\n").expect("write fixture");
        git(source.path(), &["add", "tracked.txt"]);
        git(source.path(), &["commit", "-m", "baseline"]);
        fs::write(source.path().join("tracked.txt"), "dirty source\n").expect("dirty fixture");
        fs::write(source.path().join("untracked.txt"), "copied\n").expect("untracked fixture");

        let data = tempfile::tempdir().expect("data tempdir");
        let metadata =
            prepare_workspace_blocking(data.path(), "project-id", "session-id", source.path())
                .expect("prepare safe workspace");
        (source, data, metadata)
    }

    #[test]
    fn existing_session_root_is_selected_from_server_directory_entries() {
        let data = tempfile::tempdir().expect("data tempdir");
        let project_id = ProjectId::new();
        let session_id = SessionId::new();
        let root = session_root(
            data.path(),
            &project_id.to_string(),
            &session_id.to_string(),
        );
        fs::create_dir_all(&root).expect("create workspace root");

        assert_eq!(
            find_existing_session_root(data.path(), &project_id, &session_id).unwrap(),
            None,
            "an incomplete workspace must not be exposed"
        );

        fs::write(root.join(METADATA_FILE), b"{}").expect("write metadata marker");
        let canonical_root = root.canonicalize().expect("canonical workspace root");
        assert_eq!(
            find_existing_session_root(data.path(), &project_id, &session_id).unwrap(),
            Some(canonical_root)
        );
        assert_eq!(
            find_existing_session_root(data.path(), &project_id, &SessionId::new()).unwrap(),
            None
        );
    }

    #[cfg(unix)]
    #[test]
    fn existing_session_root_rejects_a_symlink_escape() {
        use std::os::unix::fs::symlink;

        let data = tempfile::tempdir().expect("data tempdir");
        let outside = tempfile::tempdir().expect("outside tempdir");
        let project_id = ProjectId::new();
        let session_id = SessionId::new();
        let project_root = data
            .path()
            .join(SAFE_WORKSPACES_DIR)
            .join(project_id.to_string());
        fs::create_dir_all(&project_root).expect("create project root");
        fs::write(outside.path().join(METADATA_FILE), b"{}").expect("write outside marker");
        symlink(outside.path(), project_root.join(session_id.to_string()))
            .expect("link escaped workspace");

        let result = find_existing_session_root(data.path(), &project_id, &session_id);
        assert!(matches!(
            result,
            Err(SafeWorkspaceError::InvalidMetadata(_))
        ));
    }

    #[test]
    fn worktree_starts_from_dirty_source_without_mutating_source() {
        let (source, _data, metadata) = fixture();
        assert_eq!(
            fs::read_to_string(metadata.workspace_root.join("tracked.txt")).unwrap(),
            "dirty source\n"
        );
        assert_eq!(
            fs::read_to_string(metadata.workspace_root.join("untracked.txt")).unwrap(),
            "copied\n"
        );
        assert_eq!(
            fs::read_to_string(source.path().join("tracked.txt")).unwrap(),
            "dirty source\n"
        );
    }

    #[test]
    fn incomplete_setup_is_cleaned_before_retry() {
        let source = tempfile::tempdir().expect("source tempdir");
        git(source.path(), &["init"]);
        git(source.path(), &["config", "user.name", "Aura Test"]);
        git(
            source.path(),
            &["config", "user.email", "aura@test.invalid"],
        );
        fs::write(source.path().join("tracked.txt"), "baseline\n").unwrap();
        git(source.path(), &["add", "tracked.txt"]);
        git(source.path(), &["commit", "-m", "baseline"]);

        let data = tempfile::tempdir().expect("data tempdir");
        let root = session_root(data.path(), "project-id", "session-id");
        fs::create_dir_all(root.join(WORKTREE_DIR)).unwrap();
        fs::write(root.join(WORKTREE_DIR).join("orphan.txt"), "partial\n").unwrap();
        fs::create_dir_all(root.join(CHECKPOINT_STORE_DIR)).unwrap();
        fs::write(root.join(CHECKPOINT_STORE_DIR).join("partial"), "stale\n").unwrap();

        let metadata =
            prepare_workspace_blocking(data.path(), "project-id", "session-id", source.path())
                .expect("retry should recover");
        assert!(metadata.workspace_root.join("tracked.txt").exists());
        assert!(!metadata.workspace_root.join("orphan.txt").exists());
        assert!(root.join(METADATA_FILE).exists());
    }

    #[test]
    fn restore_is_exact_and_creates_an_undo_checkpoint() {
        let (_source, data, metadata) = fixture();
        let baseline = list_checkpoints_blocking(&metadata)
            .expect("list checkpoints")
            .first()
            .expect("baseline checkpoint")
            .id
            .clone();

        fs::write(metadata.workspace_root.join("tracked.txt"), "after turn\n").unwrap();
        fs::write(metadata.workspace_root.join("created.txt"), "new\n").unwrap();
        let turn_checkpoint = take_checkpoint(&metadata, "before second turn").unwrap();
        fs::write(metadata.workspace_root.join("tracked.txt"), "bad change\n").unwrap();
        fs::write(metadata.workspace_root.join("bad-only.txt"), "remove me\n").unwrap();
        fs::remove_file(metadata.workspace_root.join("untracked.txt")).unwrap();

        let root = session_root(data.path(), "project-id", "session-id");
        let restored = restore_checkpoint_blocking(&root, &turn_checkpoint).unwrap();
        assert_ne!(restored.undo_checkpoint_id, baseline);
        assert_eq!(
            fs::read_to_string(metadata.workspace_root.join("tracked.txt")).unwrap(),
            "after turn\n"
        );
        assert!(metadata.workspace_root.join("created.txt").exists());
        assert!(metadata.workspace_root.join("untracked.txt").exists());
        assert!(!metadata.workspace_root.join("bad-only.txt").exists());
    }

    #[test]
    fn diff_previews_changes_after_a_checkpoint() {
        let (_source, _data, metadata) = fixture();
        let baseline = list_checkpoints_blocking(&metadata).unwrap()[0].id.clone();
        fs::write(metadata.workspace_root.join("tracked.txt"), "preview me\n").unwrap();
        let diff = checkpoint_diff_blocking(&metadata, &baseline).unwrap();
        assert!(diff.stat.contains("tracked.txt"));
        assert!(diff.diff.contains("preview me"));
        assert!(!diff.truncated);
    }

    #[test]
    fn apply_hands_off_only_new_isolated_changes() {
        let (source, data, metadata) = fixture();
        fs::write(
            metadata.workspace_root.join("tracked.txt"),
            "first isolated edit\n",
        )
        .unwrap();
        let root = session_root(data.path(), "project-id", "session-id");
        let first = apply_to_source_blocking(&root).expect("first apply");
        assert!(first.applied);
        assert_eq!(
            fs::read_to_string(source.path().join("tracked.txt")).unwrap(),
            "first isolated edit\n"
        );

        fs::write(
            metadata.workspace_root.join("tracked.txt"),
            "second isolated edit\n",
        )
        .unwrap();
        let second = apply_to_source_blocking(&root).expect("incremental apply");
        assert!(second.applied);
        assert_eq!(
            fs::read_to_string(source.path().join("tracked.txt")).unwrap(),
            "second isolated edit\n"
        );
    }
}
