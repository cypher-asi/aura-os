use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::process::Command;
use tracing::{debug, info};

const GIT_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitInfo {
    pub sha: String,
    pub message: String,
}

pub fn is_git_repo(project_root: &str) -> bool {
    Path::new(project_root).join(".git").exists()
}

async fn git_output(cmd: &mut Command) -> Result<std::process::Output, String> {
    tokio::time::timeout(GIT_TIMEOUT, cmd.output())
        .await
        .map_err(|_| "git command timed out".to_string())?
        .map_err(|e| format!("git command failed: {e}"))
}

pub async fn ensure_remote(project_root: &str, name: &str, url: &str) {
    let existing = git_output(
        Command::new("git")
            .args(["remote", "get-url", name])
            .current_dir(project_root),
    )
    .await;

    match existing {
        Ok(o) if o.status.success() => {
            let current = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if current != url {
                if let Err(e) = git_output(
                    Command::new("git")
                        .args(["remote", "set-url", name, url])
                        .current_dir(project_root),
                )
                .await
                {
                    tracing::warn!(remote = name, %url, error = %e, "failed to set-url git remote");
                } else {
                    debug!(remote = name, %url, "updated git remote URL");
                }
            }
        }
        _ => {
            if let Err(e) = git_output(
                Command::new("git")
                    .args(["remote", "add", name, url])
                    .current_dir(project_root),
            )
            .await
            {
                tracing::warn!(remote = name, %url, error = %e, "failed to add git remote");
            } else {
                debug!(remote = name, %url, "added git remote");
            }
        }
    }
}

/// Stage all changes and commit. Returns the commit SHA if a commit was created.
pub async fn git_commit(project_root: &str, message: &str) -> Result<Option<String>, String> {
    let add = git_output(
        Command::new("git")
            .args(["add", "-A"])
            .current_dir(project_root),
    )
    .await?;

    if !add.status.success() {
        return Err(format!(
            "git add -A failed: {}",
            String::from_utf8_lossy(&add.stderr)
        ));
    }

    let diff = git_output(
        Command::new("git")
            .args(["diff", "--cached", "--quiet"])
            .current_dir(project_root),
    )
    .await?;

    if diff.status.success() {
        debug!("nothing to commit");
        return Ok(None);
    }

    let commit = git_output(
        Command::new("git")
            .args(["commit", "-m", message])
            .current_dir(project_root),
    )
    .await?;

    if !commit.status.success() {
        return Err(format!(
            "git commit failed: {}",
            String::from_utf8_lossy(&commit.stderr)
        ));
    }

    let sha = git_output(
        Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(project_root),
    )
    .await?;

    let sha_str = String::from_utf8_lossy(&sha.stdout).trim().to_string();
    info!(%sha_str, "git commit created");
    Ok(Some(sha_str))
}

/// List commits that exist locally but haven't been pushed to `remote/branch`.
pub async fn list_unpushed_commits(
    project_root: &str,
    remote: &str,
    branch: &str,
) -> Vec<CommitInfo> {
    let range = format!("{remote}/{branch}..HEAD");
    let output = git_output(
        Command::new("git")
            .args(["log", &range, "--pretty=format:%H %s"])
            .current_dir(project_root),
    )
    .await;

    match output {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout)
            .lines()
            .filter_map(|line| {
                let (sha, msg) = line.split_once(' ')?;
                Some(CommitInfo {
                    sha: sha.to_string(),
                    message: msg.to_string(),
                })
            })
            .collect(),
        _ => Vec::new(),
    }
}

/// Push to the remote using a JWT-authenticated URL.
/// Returns the list of commits that were pushed.
pub async fn git_push(
    project_root: &str,
    remote_url: &str,
    branch: &str,
    jwt: &str,
) -> Result<Vec<CommitInfo>, String> {
    let unpushed = list_unpushed_commits(project_root, "orbit", branch).await;

    let auth_url = build_auth_url(remote_url, jwt)?;
    ensure_remote(project_root, "orbit", &auth_url).await;

    let push = git_output(
        Command::new("git")
            .args(["push", "orbit", &format!("HEAD:{branch}")])
            .current_dir(project_root),
    )
    .await?;

    if !push.status.success() {
        let stderr = String::from_utf8_lossy(&push.stderr);
        return Err(format!("git push failed: {stderr}"));
    }

    // Restore non-auth URL so credentials don't linger in git config
    ensure_remote(project_root, "orbit", remote_url).await;

    info!(branch, commits = unpushed.len(), "git push succeeded");
    Ok(unpushed)
}

fn build_auth_url(remote_url: &str, jwt: &str) -> Result<String, String> {
    let url = url::Url::parse(remote_url).map_err(|e| format!("invalid remote URL: {e}"))?;
    let host = url.host_str().ok_or("remote URL has no host")?;
    let scheme = url.scheme();
    let port_part = url.port().map(|p| format!(":{p}")).unwrap_or_default();
    let path = url.path();
    Ok(format!("{scheme}://x-token:{jwt}@{host}{port_part}{path}"))
}
