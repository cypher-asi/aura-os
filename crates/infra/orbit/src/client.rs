use std::sync::Arc;
use std::time::Duration;

use tracing::debug;

use crate::error::OrbitError;
use crate::types::{CreateRepoResponse, OrbitCollaborator, OrbitRepo, OrbitRepoApiResponse};

/// Default timeout for Orbit API calls (e.g. create_repo can be slow if Orbit's DB is busy).
const ORBIT_REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

pub struct CreateRepoInternalParams<'a> {
    pub base_url: &'a str,
    pub internal_token: &'a str,
    pub org_id: &'a str,
    pub project_id: &'a str,
    pub owner_id: &'a str,
    pub repo: &'a str,
    pub description: Option<&'a str>,
}

/// HTTP client for Orbit REST API.
/// Uses JWT (Bearer) for auth; owner is always org_id or user_id (UUID).
#[derive(Clone)]
pub struct OrbitClient {
    http: Arc<reqwest::Client>,
}

impl OrbitClient {
    pub fn new() -> Self {
        let http = reqwest::Client::builder()
            .timeout(ORBIT_REQUEST_TIMEOUT)
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            http: Arc::new(http),
        }
    }

    /// Create a repository via JWT-authenticated endpoint.
    /// `org_id` and `project_id` link back to aura-network entities.
    pub async fn create_repo(
        &self,
        base_url: &str,
        org_id: &str,
        project_id: &str,
        repo: &str,
        description: Option<&str>,
        jwt: &str,
    ) -> Result<CreateRepoResponse, OrbitError> {
        let url = format!("{}/repos", base_url.trim_end_matches('/'));
        debug!(%url, org_id, project_id, repo, "Orbit create_repo");

        let mut body = serde_json::json!({
            "orgId": org_id,
            "projectId": project_id,
            "name": repo,
            "visibility": "private",
        });
        if let Some(desc) = description {
            body["description"] = serde_json::Value::String(desc.to_string());
        }

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

        let repo_resp: OrbitRepoApiResponse = serde_json::from_str(&body_text)
            .map_err(|e| OrbitError::InvalidResponse(e.to_string()))?;
        Ok(repo_resp.to_create_repo_response(base_url))
    }

    /// Create a repository using Orbit's internal service-to-service endpoint.
    pub async fn create_repo_internal(
        &self,
        params: &CreateRepoInternalParams<'_>,
    ) -> Result<CreateRepoResponse, OrbitError> {
        let CreateRepoInternalParams {
            base_url,
            internal_token,
            org_id,
            project_id,
            owner_id,
            repo,
            description,
        } = params;
        let url = format!("{}/internal/repos", base_url.trim_end_matches('/'));
        debug!(%url, org_id, project_id, owner_id, repo, "Orbit create_repo_internal");

        let body = serde_json::json!({
            "orgId": org_id,
            "projectId": project_id,
            "ownerId": owner_id,
            "name": repo,
            "description": description,
            "visibility": "private",
        });

        let resp = self
            .http
            .post(&url)
            .header("X-Internal-Token", *internal_token)
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

        let repo_resp: OrbitRepoApiResponse = serde_json::from_str(&body_text)
            .map_err(|e| OrbitError::InvalidResponse(e.to_string()))?;
        Ok(repo_resp.to_create_repo_response(base_url))
    }

    /// List collaborators for a repo. Owner is Aura org_id or user_id (UUID).
    /// Repo owner and users with owner role can add people.
    pub async fn list_collaborators(
        &self,
        base_url: &str,
        owner: &str,
        repo: &str,
        jwt: &str,
    ) -> Result<Vec<OrbitCollaborator>, OrbitError> {
        let base = base_url.trim_end_matches('/');
        let url = format!("{}/repos/{}/{}/collaborators", base, owner, repo);
        debug!(%url, "Orbit list_collaborators");

        let resp = self
            .http
            .get(&url)
            .header("Authorization", format!("Bearer {}", jwt))
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

    /// Add or update a collaborator. Owner is org_id (UUID). Collaborator is identified by
    /// orbit_username or user_id (UUID) depending on Orbit API. Role: owner, writer, reader.
    pub async fn add_collaborator(
        &self,
        base_url: &str,
        owner: &str,
        repo: &str,
        collaborator_id: &str,
        role: &str,
        jwt: &str,
    ) -> Result<(), OrbitError> {
        let base = base_url.trim_end_matches('/');
        let url = format!(
            "{}/repos/{}/{}/collaborators/{}",
            base,
            owner,
            repo,
            urlencoding::encode(collaborator_id),
        );
        debug!(%url, role, "Orbit add_collaborator");

        let body = serde_json::json!({ "role": role });

        let resp = self
            .http
            .put(&url)
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
        Ok(())
    }

    /// Remove a collaborator. Collaborator_id is orbit_username or user_id (UUID).
    pub async fn remove_collaborator(
        &self,
        base_url: &str,
        owner: &str,
        repo: &str,
        collaborator_id: &str,
        jwt: &str,
    ) -> Result<(), OrbitError> {
        let base = base_url.trim_end_matches('/');
        let url = format!(
            "{}/repos/{}/{}/collaborators/{}",
            base,
            owner,
            repo,
            urlencoding::encode(collaborator_id),
        );
        debug!(%url, "Orbit remove_collaborator");

        let resp = self
            .http
            .delete(&url)
            .header("Authorization", format!("Bearer {}", jwt))
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
        Ok(())
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
        let url = format!("{}/repos", base);
        let mut req = self
            .http
            .get(&url)
            .header("Authorization", format!("Bearer {}", jwt));
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

        let repos: Vec<OrbitRepoApiResponse> = serde_json::from_str(&body_text)
            .map_err(|e| OrbitError::InvalidResponse(e.to_string()))?;
        Ok(repos
            .into_iter()
            .map(|repo| repo.to_orbit_repo(base))
            .collect())
    }
}

impl Default for OrbitClient {
    fn default() -> Self {
        Self::new()
    }
}
