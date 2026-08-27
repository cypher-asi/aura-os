//! Project-scoped source-control operations.
//!
//! The HTTP contract is deliberately provider-neutral: Git status, diffs,
//! staging, and commits are local repository capabilities, while an active
//! review is optional metadata tagged with its provider. GitHub detection is
//! currently best-effort and can be extended with additional adapters without
//! changing the workbench response shape.

use std::path::{Component, Path as FsPath, PathBuf};
use std::process::{Command, Output};
use std::time::Duration;

use aura_os_core::{AgentInstanceId, ProjectId};
use axum::extract::{Path, Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use tracing::debug;

use crate::error::{map_network_error, ApiError, ApiResult};
use crate::handlers::projects_helpers::resolve_server_local_workspace_path;
use crate::state::{AppState, AuthJwt};

const MAX_STATUS_FILES: usize = 2_000;
const MAX_DIFF_BYTES: usize = 512 * 1024;
const MAX_PATHS_PER_MUTATION: usize = 500;
const MAX_COMMIT_MESSAGE_BYTES: usize = 8 * 1024;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum DiffArea {
    Staged,
    Worktree,
}

#[derive(Debug, Deserialize, Default)]
pub(crate) struct SourceControlQuery {
    agent_instance_id: Option<AgentInstanceId>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SourceControlDiffQuery {
    agent_instance_id: Option<AgentInstanceId>,
    path: String,
    area: DiffArea,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SourceControlPathsRequest {
    agent_instance_id: Option<AgentInstanceId>,
    paths: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SourceControlCommitRequest {
    agent_instance_id: Option<AgentInstanceId>,
    message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub(crate) struct SourceControlFile {
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    original_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    staged_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    worktree_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub(crate) struct SourceControlPullRequest {
    provider: String,
    number: u64,
    title: String,
    state: String,
    url: String,
    head_branch: String,
    base_branch: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub(crate) struct SourceControlStatusResponse {
    available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    unavailable_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    files: Vec<SourceControlFile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pull_request: Option<SourceControlPullRequest>,
}

impl SourceControlStatusResponse {
    fn unavailable(reason: impl Into<String>) -> Self {
        Self {
            available: false,
            unavailable_reason: Some(reason.into()),
            branch: None,
            upstream: None,
            ahead: 0,
            behind: 0,
            files: Vec::new(),
            pull_request: None,
        }
    }
}

#[derive(Debug, Serialize)]
pub(crate) struct SourceControlDiffResponse {
    path: String,
    area: DiffArea,
    diff: String,
    truncated: bool,
    binary: bool,
}

#[derive(Debug, Serialize)]
pub(crate) struct SourceControlMutationResponse {
    ok: bool,
}

#[derive(Debug, Serialize)]
pub(crate) struct SourceControlCommitResponse {
    ok: bool,
    commit: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct GithubRemote {
    base_owner: String,
    base_repo: String,
    head_owner: String,
    branch: String,
}

struct RepositoryInspection {
    root: PathBuf,
    status: SourceControlStatusResponse,
    github_remote: Option<GithubRemote>,
}

#[derive(Debug, Deserialize)]
struct GithubPullRequestResponse {
    number: u64,
    title: String,
    state: String,
    html_url: String,
    head: GithubRefResponse,
    base: GithubRefResponse,
}

#[derive(Debug, Deserialize)]
struct GithubRefResponse {
    #[serde(rename = "ref")]
    branch: String,
}

fn git_command(workspace: &FsPath) -> Command {
    let mut command = Command::new("git");
    command
        .current_dir(workspace)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C");
    command
}

fn run_git(workspace: &FsPath, args: &[&str]) -> Result<Output, String> {
    git_command(workspace)
        .args(args)
        .output()
        .map_err(|error| format!("running git: {error}"))
}

fn git_stdout(workspace: &FsPath, args: &[&str]) -> Result<String, String> {
    let output = run_git(workspace, args)?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("git {} failed", args.join(" "))
        } else {
            stderr
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn repository_root(workspace: &FsPath) -> Result<PathBuf, String> {
    let root = git_stdout(workspace, &["rev-parse", "--show-toplevel"])?;
    if root.is_empty() {
        return Err("Git did not report a repository root.".to_string());
    }
    Ok(PathBuf::from(root))
}

fn meaningful_status(value: char) -> Option<String> {
    (value != '.').then(|| value.to_string())
}

fn parse_status_porcelain(output: &[u8]) -> SourceControlStatusResponse {
    let text = String::from_utf8_lossy(output);
    let mut branch = None;
    let mut upstream = None;
    let mut ahead = 0;
    let mut behind = 0;
    let mut files = Vec::new();
    let mut records = text.split('\0').peekable();

    while let Some(record) = records.next() {
        if record.is_empty() {
            continue;
        }
        if let Some(value) = record.strip_prefix("# branch.head ") {
            branch = Some(value.to_string());
            continue;
        }
        if let Some(value) = record.strip_prefix("# branch.upstream ") {
            upstream = Some(value.to_string());
            continue;
        }
        if let Some(value) = record.strip_prefix("# branch.ab ") {
            for field in value.split_whitespace() {
                if let Some(value) = field.strip_prefix('+') {
                    ahead = value.parse().unwrap_or(0);
                } else if let Some(value) = field.strip_prefix('-') {
                    behind = value.parse().unwrap_or(0);
                }
            }
            continue;
        }

        let (xy, path, original_path) = if record.starts_with("1 ") {
            let fields: Vec<_> = record.splitn(9, ' ').collect();
            if fields.len() < 9 {
                continue;
            }
            (fields[1], fields[8], None)
        } else if record.starts_with("2 ") {
            let fields: Vec<_> = record.splitn(10, ' ').collect();
            if fields.len() < 10 {
                continue;
            }
            let original = records.next().filter(|value| !value.is_empty());
            (fields[1], fields[9], original)
        } else if record.starts_with("u ") {
            let fields: Vec<_> = record.splitn(11, ' ').collect();
            if fields.len() < 11 {
                continue;
            }
            (fields[1], fields[10], None)
        } else if let Some(path) = record.strip_prefix("? ") {
            files.push(SourceControlFile {
                path: path.to_string(),
                original_path: None,
                staged_status: None,
                worktree_status: Some("?".to_string()),
            });
            continue;
        } else {
            continue;
        };

        let mut statuses = xy.chars();
        let staged_status = statuses.next().and_then(meaningful_status);
        let worktree_status = statuses.next().and_then(meaningful_status);
        files.push(SourceControlFile {
            path: path.to_string(),
            original_path: original_path.map(str::to_string),
            staged_status,
            worktree_status,
        });
        if files.len() >= MAX_STATUS_FILES {
            break;
        }
    }

    files.sort_by(|left, right| left.path.cmp(&right.path));
    SourceControlStatusResponse {
        available: true,
        unavailable_reason: None,
        branch,
        upstream,
        ahead,
        behind,
        files,
        pull_request: None,
    }
}

fn parse_github_remote(value: &str) -> Option<(String, String)> {
    let trimmed = value.trim().trim_end_matches('/');
    let path = if let Some(path) = trimmed.strip_prefix("git@github.com:") {
        path
    } else if let Some(path) = trimmed.strip_prefix("ssh://git@github.com/") {
        path
    } else if let Some(path) = trimmed.strip_prefix("https://github.com/") {
        path
    } else if let Some(path) = trimmed.strip_prefix("http://github.com/") {
        path
    } else {
        return None;
    };
    let path = path.strip_suffix(".git").unwrap_or(path);
    let (owner, repo) = path.split_once('/')?;
    if owner.is_empty() || repo.is_empty() || repo.contains('/') {
        return None;
    }
    Some((owner.to_string(), repo.to_string()))
}

fn inspect_repository(workspace: &FsPath) -> Result<RepositoryInspection, String> {
    let root = repository_root(workspace)?;
    let output = run_git(
        &root,
        &[
            "status",
            "--porcelain=v2",
            "--branch",
            "-z",
            "--untracked-files=all",
        ],
    )?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    let status = parse_status_porcelain(&output.stdout);
    let branch = status.branch.clone().filter(|value| value != "(detached)");
    let origin = git_stdout(&root, &["config", "--get", "remote.origin.url"])
        .ok()
        .and_then(|value| parse_github_remote(&value));
    let upstream_remote = git_stdout(&root, &["config", "--get", "remote.upstream.url"])
        .ok()
        .and_then(|value| parse_github_remote(&value));
    let github_remote = match (origin, branch) {
        (Some((head_owner, head_repo)), Some(branch)) => {
            let (base_owner, base_repo) =
                upstream_remote.unwrap_or_else(|| (head_owner.clone(), head_repo));
            Some(GithubRemote {
                base_owner,
                base_repo,
                head_owner,
                branch,
            })
        }
        _ => None,
    };
    Ok(RepositoryInspection {
        root,
        status,
        github_remote,
    })
}

fn validated_paths(paths: Vec<String>) -> Result<Vec<String>, String> {
    if paths.is_empty() {
        return Err("Select at least one changed file.".to_string());
    }
    if paths.len() > MAX_PATHS_PER_MUTATION {
        return Err(format!(
            "A source-control action may include at most {MAX_PATHS_PER_MUTATION} files."
        ));
    }
    paths
        .into_iter()
        .map(|path| {
            let trimmed = path.trim();
            if trimmed.is_empty() {
                return Err("Changed file paths must not be empty.".to_string());
            }
            let candidate = FsPath::new(trimmed);
            if candidate.is_absolute()
                || candidate.components().any(|component| {
                    matches!(
                        component,
                        Component::ParentDir | Component::RootDir | Component::Prefix(_)
                    )
                })
            {
                return Err(format!("Unsafe repository path: {trimmed}"));
            }
            Ok(trimmed.to_string())
        })
        .collect()
}

fn bounded_diff(mut diff: String) -> (String, bool) {
    if diff.len() <= MAX_DIFF_BYTES {
        return (diff, false);
    }
    let mut boundary = MAX_DIFF_BYTES;
    while boundary > 0 && !diff.is_char_boundary(boundary) {
        boundary -= 1;
    }
    diff.truncate(boundary);
    diff.push_str("\n\n… diff truncated by Aura …\n");
    (diff, true)
}

fn untracked_file_diff(root: &FsPath, relative_path: &str) -> Result<(String, bool), String> {
    let root = root
        .canonicalize()
        .map_err(|error| format!("resolving repository root: {error}"))?;
    let path = root.join(relative_path);
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("reading untracked file: {error}"))?;
    if !canonical.starts_with(&root) {
        return Err("Changed file resolves outside the repository.".to_string());
    }
    let bytes =
        std::fs::read(&canonical).map_err(|error| format!("reading untracked file: {error}"))?;
    if bytes.contains(&0) {
        return Ok((format!("Binary file added: {relative_path}\n"), true));
    }
    let contents = match String::from_utf8(bytes) {
        Ok(contents) => contents,
        Err(_) => return Ok((format!("Binary file added: {relative_path}\n"), true)),
    };
    let line_count = contents.lines().count();
    let mut diff = format!(
        "diff --git a/{relative_path} b/{relative_path}\nnew file mode 100644\n--- /dev/null\n+++ b/{relative_path}\n@@ -0,0 +1,{line_count} @@\n"
    );
    for line in contents.split_inclusive('\n') {
        diff.push('+');
        diff.push_str(line);
    }
    if !contents.is_empty() && !contents.ends_with('\n') {
        diff.push_str("\n\\ No newline at end of file\n");
    }
    Ok((diff, false))
}

fn repository_diff(
    root: &FsPath,
    relative_path: &str,
    area: DiffArea,
) -> Result<(String, bool, bool), String> {
    let is_untracked = if area == DiffArea::Worktree {
        let output = run_git(root, &["ls-files", "--error-unmatch", "--", relative_path])?;
        !output.status.success() && root.join(relative_path).exists()
    } else {
        false
    };
    let (diff, binary) = if is_untracked {
        untracked_file_diff(root, relative_path)?
    } else {
        let mut args = vec!["diff", "--no-ext-diff", "--no-color", "--unified=3"];
        if area == DiffArea::Staged {
            args.push("--cached");
        }
        args.extend(["--", relative_path]);
        let output = run_git(root, &args)?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        let diff = String::from_utf8_lossy(&output.stdout).into_owned();
        let binary = diff.contains("Binary files ") || diff.contains("GIT binary patch");
        (diff, binary)
    };
    let (diff, truncated) = bounded_diff(diff);
    Ok((diff, truncated, binary))
}

fn update_index(root: &FsPath, paths: &[String], stage: bool) -> Result<(), String> {
    let path_refs: Vec<_> = paths.iter().map(String::as_str).collect();
    let mut args = if stage {
        vec!["add", "--"]
    } else {
        let has_head = run_git(root, &["rev-parse", "--verify", "HEAD"])
            .map(|output| output.status.success())
            .unwrap_or(false);
        if has_head {
            vec!["restore", "--staged", "--"]
        } else {
            vec!["rm", "--cached", "-r", "--"]
        }
    };
    args.extend(path_refs);
    let output = run_git(root, &args)?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

async fn ensure_project_access(
    state: &AppState,
    project_id: &ProjectId,
    jwt: &str,
) -> ApiResult<()> {
    if let Some(client) = &state.network_client {
        client
            .get_project(&project_id.to_string(), jwt)
            .await
            .map_err(map_network_error)?;
        return Ok(());
    }
    state
        .project_service
        .get_project(project_id)
        .map(|_| ())
        .map_err(|error| match error {
            aura_os_projects::ProjectError::NotFound(_) => ApiError::not_found("project not found"),
            _ => ApiError::internal(format!("fetching project: {error}")),
        })
}

async fn project_workspace(
    state: &AppState,
    project_id: &ProjectId,
    agent_instance_id: Option<AgentInstanceId>,
    jwt: &str,
) -> ApiResult<Option<PathBuf>> {
    ensure_project_access(state, project_id, jwt).await?;
    Ok(
        resolve_server_local_workspace_path(state, project_id, agent_instance_id)
            .await
            .map(PathBuf::from),
    )
}

async fn inspect_project_repository(
    state: &AppState,
    project_id: &ProjectId,
    agent_instance_id: Option<AgentInstanceId>,
    jwt: &str,
) -> ApiResult<Result<RepositoryInspection, String>> {
    let Some(workspace) = project_workspace(state, project_id, agent_instance_id, jwt).await?
    else {
        return Ok(Err(
            "This project does not expose a local workspace.".to_string()
        ));
    };
    tokio::task::spawn_blocking(move || inspect_repository(&workspace))
        .await
        .map_err(|error| ApiError::internal(format!("inspecting source control: {error}")))
}

async fn detect_github_pull_request(remote: &GithubRemote) -> Option<SourceControlPullRequest> {
    let url = format!(
        "https://api.github.com/repos/{}/{}/pulls",
        remote.base_owner, remote.base_repo
    );
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(4))
        .build()
        .ok()?;
    let response = client
        .get(url)
        .header(reqwest::header::USER_AGENT, "aura-os-source-control")
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .query(&[
            ("head", format!("{}:{}", remote.head_owner, remote.branch)),
            ("state", "open".to_string()),
            ("per_page", "1".to_string()),
        ])
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        debug!(status = %response.status(), "GitHub pull-request lookup unavailable");
        return None;
    }
    let pull = response
        .json::<Vec<GithubPullRequestResponse>>()
        .await
        .ok()?
        .into_iter()
        .next()?;
    Some(SourceControlPullRequest {
        provider: "github".to_string(),
        number: pull.number,
        title: pull.title,
        state: pull.state,
        url: pull.html_url,
        head_branch: pull.head.branch,
        base_branch: pull.base.branch,
    })
}

pub(crate) async fn get_status(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<ProjectId>,
    Query(query): Query<SourceControlQuery>,
) -> ApiResult<Json<SourceControlStatusResponse>> {
    let inspection =
        match inspect_project_repository(&state, &project_id, query.agent_instance_id, &jwt).await?
        {
            Ok(inspection) => inspection,
            Err(reason) => return Ok(Json(SourceControlStatusResponse::unavailable(reason))),
        };
    let mut status = inspection.status;
    if let Some(remote) = inspection.github_remote.as_ref() {
        status.pull_request = detect_github_pull_request(remote).await;
    }
    Ok(Json(status))
}

pub(crate) async fn get_diff(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<ProjectId>,
    Query(query): Query<SourceControlDiffQuery>,
) -> ApiResult<Json<SourceControlDiffResponse>> {
    let relative_path = validated_paths(vec![query.path])
        .map_err(ApiError::bad_request)?
        .into_iter()
        .next()
        .expect("validated one source-control path");
    let inspection = inspect_project_repository(&state, &project_id, query.agent_instance_id, &jwt)
        .await?
        .map_err(ApiError::bad_request)?;
    let root = inspection.root;
    let area = query.area;
    let path_for_task = relative_path.clone();
    let (diff, truncated, binary) =
        tokio::task::spawn_blocking(move || repository_diff(&root, &path_for_task, area))
            .await
            .map_err(|error| ApiError::internal(format!("reading source-control diff: {error}")))?
            .map_err(ApiError::bad_request)?;
    Ok(Json(SourceControlDiffResponse {
        path: relative_path,
        area,
        diff,
        truncated,
        binary,
    }))
}

async fn mutate_paths(
    state: &AppState,
    project_id: &ProjectId,
    jwt: &str,
    request: SourceControlPathsRequest,
    staged: bool,
) -> ApiResult<Json<SourceControlMutationResponse>> {
    let paths = validated_paths(request.paths).map_err(ApiError::bad_request)?;
    let inspection = inspect_project_repository(state, project_id, request.agent_instance_id, jwt)
        .await?
        .map_err(ApiError::bad_request)?;
    let root = inspection.root;
    tokio::task::spawn_blocking(move || update_index(&root, &paths, staged))
        .await
        .map_err(|error| ApiError::internal(format!("updating Git index: {error}")))?
        .map_err(ApiError::bad_request)?;
    Ok(Json(SourceControlMutationResponse { ok: true }))
}

pub(crate) async fn stage_paths(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<ProjectId>,
    Json(request): Json<SourceControlPathsRequest>,
) -> ApiResult<Json<SourceControlMutationResponse>> {
    mutate_paths(&state, &project_id, &jwt, request, true).await
}

pub(crate) async fn unstage_paths(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<ProjectId>,
    Json(request): Json<SourceControlPathsRequest>,
) -> ApiResult<Json<SourceControlMutationResponse>> {
    mutate_paths(&state, &project_id, &jwt, request, false).await
}

pub(crate) async fn commit(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<ProjectId>,
    Json(request): Json<SourceControlCommitRequest>,
) -> ApiResult<Json<SourceControlCommitResponse>> {
    let message = request.message.trim().to_string();
    if message.is_empty() {
        return Err(ApiError::bad_request("Commit message must not be empty."));
    }
    if message.len() > MAX_COMMIT_MESSAGE_BYTES {
        return Err(ApiError::bad_request(format!(
            "Commit message must be at most {MAX_COMMIT_MESSAGE_BYTES} bytes."
        )));
    }
    let inspection =
        inspect_project_repository(&state, &project_id, request.agent_instance_id, &jwt)
            .await?
            .map_err(ApiError::bad_request)?;
    let root = inspection.root;
    let commit = tokio::task::spawn_blocking(move || {
        let output = run_git(&root, &["commit", "-m", &message])?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        git_stdout(&root, &["rev-parse", "--short=12", "HEAD"])
    })
    .await
    .map_err(|error| ApiError::internal(format!("creating Git commit: {error}")))?
    .map_err(ApiError::bad_request)?;
    Ok(Json(SourceControlCommitResponse { ok: true, commit }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_branch_and_both_index_states() {
        let status = parse_status_porcelain(
            b"# branch.oid abc\x00# branch.head feature\x00# branch.upstream origin/feature\x00# branch.ab +2 -1\x001 MM N... 100644 100644 100644 abc def src/lib.rs\x00? notes.txt\x00",
        );
        assert_eq!(status.branch.as_deref(), Some("feature"));
        assert_eq!(status.upstream.as_deref(), Some("origin/feature"));
        assert_eq!((status.ahead, status.behind), (2, 1));
        assert_eq!(status.files.len(), 2);
        assert_eq!(status.files[0].path, "notes.txt");
        assert_eq!(status.files[0].worktree_status.as_deref(), Some("?"));
        assert_eq!(status.files[1].staged_status.as_deref(), Some("M"));
        assert_eq!(status.files[1].worktree_status.as_deref(), Some("M"));
    }

    #[test]
    fn parses_rename_original_path() {
        let status = parse_status_porcelain(
            b"# branch.head main\x002 R. N... 100644 100644 100644 abc def R100 src/new.rs\x00src/old.rs\x00",
        );
        assert_eq!(status.files.len(), 1);
        assert_eq!(status.files[0].path, "src/new.rs");
        assert_eq!(status.files[0].original_path.as_deref(), Some("src/old.rs"));
        assert_eq!(status.files[0].staged_status.as_deref(), Some("R"));
    }

    #[test]
    fn rejects_paths_outside_repository() {
        assert!(validated_paths(vec!["../secret".to_string()]).is_err());
        assert!(validated_paths(vec!["/etc/passwd".to_string()]).is_err());
        assert!(validated_paths(vec!["src/lib.rs".to_string()]).is_ok());
    }

    #[test]
    fn parses_supported_github_remotes() {
        assert_eq!(
            parse_github_remote("git@github.com:cypher-asi/aura-os.git"),
            Some(("cypher-asi".to_string(), "aura-os".to_string()))
        );
        assert_eq!(
            parse_github_remote("https://github.com/cypher-asi/aura-os.git"),
            Some(("cypher-asi".to_string(), "aura-os".to_string()))
        );
        assert_eq!(parse_github_remote("https://gitlab.com/org/repo"), None);
    }

    #[test]
    fn builds_diff_for_untracked_text_file() {
        let temp = tempfile::tempdir().expect("temp dir");
        std::fs::write(temp.path().join("hello.txt"), "hello\nworld\n").expect("write file");
        let (diff, binary) = untracked_file_diff(temp.path(), "hello.txt").expect("diff");
        assert!(!binary);
        assert!(diff.contains("+++ b/hello.txt"));
        assert!(diff.contains("+hello\n+world"));
    }

    #[test]
    fn stages_and_unstages_a_modified_file() {
        let temp = tempfile::tempdir().expect("temp dir");
        let root = temp.path();
        git_stdout(root, &["init"]).expect("initialize repository");
        git_stdout(root, &["config", "user.name", "Aura Test"]).expect("configure user");
        git_stdout(root, &["config", "user.email", "aura@example.com"]).expect("configure email");
        std::fs::write(root.join("hello.txt"), "first\n").expect("write initial file");
        update_index(root, &["hello.txt".to_string()], true).expect("stage initial file");
        git_stdout(root, &["commit", "-m", "initial"]).expect("create initial commit");

        std::fs::write(root.join("hello.txt"), "second\n").expect("modify file");
        let before = inspect_repository(root).expect("inspect worktree");
        assert_eq!(before.status.files[0].worktree_status.as_deref(), Some("M"));
        let (diff, _, _) =
            repository_diff(root, "hello.txt", DiffArea::Worktree).expect("read worktree diff");
        assert!(diff.contains("+second"));

        update_index(root, &["hello.txt".to_string()], true).expect("stage modification");
        let staged = inspect_repository(root).expect("inspect staged change");
        assert_eq!(staged.status.files[0].staged_status.as_deref(), Some("M"));
        assert_eq!(staged.status.files[0].worktree_status, None);

        update_index(root, &["hello.txt".to_string()], false).expect("unstage modification");
        let unstaged = inspect_repository(root).expect("inspect unstaged change");
        assert_eq!(unstaged.status.files[0].staged_status, None);
        assert_eq!(
            unstaged.status.files[0].worktree_status.as_deref(),
            Some("M")
        );
    }
}
