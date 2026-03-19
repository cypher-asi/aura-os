use std::sync::Arc;

use tracing::debug;

use crate::error::OrbitError;
use crate::types::{CreateRepoResponse, OrbitRepo};

/// HTTP client for Orbit REST API.
/// Uses JWT (Bearer) for auth; owner is always org_id or user_id (UUID).
#[derive(Clone)]
pub struct OrbitClient {
    http: Arc<reqwest::Client>,
}

impl OrbitClient {
    pub fn new() -> Self {
        Self {
            http: Arc::new(reqwest::Client::new()),
        }
    }

    /// Create a repository. Owner is Aura org_id or user_id (UUID).
    pub async fn create_repo(
        &self,
        base_url: &str,
        owner: &str,
        repo: &str,
        jwt: &str,
    ) -> Result<CreateRepoResponse, OrbitError> {
        let url = format!("{}/api/repos", base_url.trim_end_matches('/'));
        debug!(%url, owner, repo, "Orbit create_repo");

        let body = serde_json::json!({
            "owner": owner,
            "name": repo,
        });

        let resp = self
            .http
            .post(&url)
            .header("Authorization", format!("Bearer {}", jwt))
            .json(&body)
            .send()
            .await?;

        let status = resp.status();
        let body_text = resp.text().await?;

        if !status.is_success() {
            return Err(OrbitError::Api {
                status: status.as_u16(),
                body: body_text,
            });
        }

        serde_json::from_str(&body_text).map_err(|e| OrbitError::InvalidResponse(e.to_string()))
    }

    /// List repos the current user can access (owned by user or their orgs).
    /// Optional query string for search/filter.
    pub async fn list_repos(
        &self,
        base_url: &str,
        jwt: &str,
        q: Option<&str>,
    ) -> Result<Vec<OrbitRepo>, OrbitError> {
        let base = base_url.trim_end_matches('/');
        let url = format!("{}/api/repos", base);
        let mut req = self.http.get(&url).header("Authorization", format!("Bearer {}", jwt));
        if let Some(q) = q {
            if !q.is_empty() {
                req = req.query(&[("q", q)]);
            }
        }
        debug!(%url, "Orbit list_repos");

        let resp = req.send().await?;

        let status = resp.status();
        let body_text = resp.text().await?;

        if !status.is_success() {
            return Err(OrbitError::Api {
                status: status.as_u16(),
                body: body_text,
            });
        }

        serde_json::from_str(&body_text).map_err(|e| OrbitError::InvalidResponse(e.to_string()))
    }
}

impl Default for OrbitClient {
    fn default() -> Self {
        Self::new()
    }
}
