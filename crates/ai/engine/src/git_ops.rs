use std::path::Path;

use serde::{Deserialize, Serialize};
use tokio::process::Command;
use tracing::{debug, info};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitInfo {
    pub sha: String,
    pub message: String,
}

pub fn is_git_repo(project_root: &str) -> bool {
    Path::new(project_root).join(".git").exists()
}

pub async fn ensure_remote(project_root: &str, name: &str, url: &str) {
    let existing = Command::new("git")
        .args(["remote", "get-url", name])
        .current_dir(project_root)
        .output()
        .await;

    match existing {
        Ok(o) if o.status.success() => {
            let current = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if current != url {
                let _ = Command::new("git")
                    .args(["remote", "set-url", name, url])
                    .current_dir(project_root)
                    .output()
                    .await;
                debug!(remote = name, %url, "updated git remote URL");
            }
        }
        _ => {
            let _ = Command::new("git")
                .args(["remote", "add", name, url])
                .current_dir(project_root)
                .output()
                .await;
            debug!(remote = name, %url, "added git remote");
        }
    }
}

/// Stage all changes and commit. Returns the commit SHA if a commit was created.
pub async fn git_commit(project_root: &str, message: &str) -> Result<Option<String>, String> {
    let add = Command::new("git")
        .args(["add", "-A"])
        .current_dir(project_root)
        .output()
        .await
        .map_err(|e| format!("git add failed: {e}"))?;

    if !add.status.success() {
        return Err(format!(
            "git add -A failed: {}",
            String::from_utf8_lossy(&add.stderr)
        ));
    }

    let diff = Command::new("git")
        .args(["diff", "--cached", "--quiet"])
        .current_dir(project_root)
        .output()
        .await
        .map_err(|e| format!("git diff --cached failed: {e}"))?;

    if diff.status.success() {
        debug!("nothing to commit");
        return Ok(None);
    }

    let commit = Command::new("git")
        .args(["commit", "-m", message])
        .current_dir(project_root)
        .output()
        .await
        .map_err(|e| format!("git commit failed: {e}"))?;

    if !commit.status.success() {
        return Err(format!(
            "git commit failed: {}",
            String::from_utf8_lossy(&commit.stderr)
        ));
    }

    let sha = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(project_root)
        .output()
        .await
        .map_err(|e| format!("git rev-parse failed: {e}"))?;

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
    let output = Command::new("git")
        .args(["log", &range, "--pretty=format:%H %s"])
        .current_dir(project_root)
        .output()
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

    let push = Command::new("git")
        .args(["push", "orbit", &format!("HEAD:{branch}")])
        .current_dir(project_root)
        .output()
        .await
        .map_err(|e| format!("git push failed: {e}"))?;

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
    let port_part = url
        .port()
        .map(|p| format!(":{p}"))
        .unwrap_or_default();
    let path = url.path();
    Ok(format!("{scheme}://x-token:{jwt}@{host}{port_part}{path}"))
}
