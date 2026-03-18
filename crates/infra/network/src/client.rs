use std::env;

use reqwest::Client;
use tracing::{debug, error, info, warn};

use crate::error::NetworkError;
use crate::types::*;

/// HTTP client for the aura-network shared backend service.
///
/// Wraps `reqwest` with typed methods for each aura-network API group.
/// All requests that need auth accept a JWT token parameter which is
/// forwarded as `Authorization: Bearer <jwt>`.
#[derive(Clone)]
pub struct NetworkClient {
    http: Client,
    base_url: String,
}

impl NetworkClient {
    /// Create a new `NetworkClient`, reading `AURA_NETWORK_URL` from env.
    /// Returns `None` if the env var is not set or empty (network integration disabled).
    pub fn from_env() -> Option<Self> {
        let base_url = env::var("AURA_NETWORK_URL")
            .ok()
            .filter(|s| !s.is_empty())?;

        let base_url = base_url.trim_end_matches('/').to_string();
        info!(%base_url, "aura-network client configured");

        Some(Self {
            http: Client::new(),
            base_url,
        })
    }

    /// Create a `NetworkClient` with an explicit base URL (for testing).
    #[cfg(test)]
    pub fn with_base_url(base_url: &str) -> Self {
        Self {
            http: Client::new(),
            base_url: base_url.trim_end_matches('/').to_string(),
        }
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// Returns the WebSocket URL for the aura-network events stream.
    pub fn ws_events_url(&self, jwt: &str) -> String {
        let ws_base = self
            .base_url
            .replacen("https://", "wss://", 1)
            .replacen("http://", "ws://", 1);
        format!("{}/ws/events?token={}", ws_base, jwt)
    }

    // -----------------------------------------------------------------------
    // Health
    // -----------------------------------------------------------------------

    /// Check if aura-network is reachable. Returns `Ok(())` on success.
    pub async fn health_check(&self) -> Result<HealthResponse, NetworkError> {
        let url = format!("{}/health", self.base_url);
        debug!(%url, "Checking aura-network health");

        let start = std::time::Instant::now();
        let resp = self.http.get(&url).send().await.map_err(|e| {
            error!(error = %e, "aura-network health check request failed");
            NetworkError::Request(e)
        })?;

        let status = resp.status();
        let elapsed_ms = start.elapsed().as_millis();

        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            warn!(status = status.as_u16(), elapsed_ms, %body, "aura-network health check failed");
            return Err(NetworkError::HealthCheckFailed(format!(
                "status {}: {}",
                status.as_u16(),
                body
            )));
        }

        let health: HealthResponse = resp
            .json()
            .await
            .map_err(|e| NetworkError::Deserialize(e.to_string()))?;

        info!(
            status = %health.status,
            version = health.version.as_deref().unwrap_or("unknown"),
            elapsed_ms,
            "aura-network health check OK"
        );

        Ok(health)
    }

    // -----------------------------------------------------------------------
    // Users (Phase 3)
    // -----------------------------------------------------------------------

    pub async fn get_current_user(&self, jwt: &str) -> Result<NetworkUser, NetworkError> {
        self.get_authed(&format!("{}/api/users/me", self.base_url), jwt)
            .await
    }

    pub async fn get_user(&self, user_id: &str, jwt: &str) -> Result<NetworkUser, NetworkError> {
        self.get_authed(
            &format!("{}/api/users/{}", self.base_url, user_id),
            jwt,
        )
        .await
    }

    pub async fn update_current_user(
        &self,
        jwt: &str,
        req: &UpdateUserRequest,
    ) -> Result<NetworkUser, NetworkError> {
        self.put_authed(&format!("{}/api/users/me", self.base_url), jwt, req)
            .await
    }

    pub async fn get_user_profile(
        &self,
        user_id: &str,
        jwt: &str,
    ) -> Result<NetworkProfile, NetworkError> {
        self.get_authed(
            &format!("{}/api/users/{}/profile", self.base_url, user_id),
            jwt,
        )
        .await
    }

    // -----------------------------------------------------------------------
    // Profiles (Phase 3)
    // -----------------------------------------------------------------------

    pub async fn get_profile(
        &self,
        profile_id: &str,
        jwt: &str,
    ) -> Result<NetworkProfile, NetworkError> {
        self.get_authed(
            &format!("{}/api/profiles/{}", self.base_url, profile_id),
            jwt,
        )
        .await
    }

    // -----------------------------------------------------------------------
    // Organizations (Phase 4)
    // -----------------------------------------------------------------------

    pub async fn create_org(
        &self,
        jwt: &str,
        req: &CreateOrgRequest,
    ) -> Result<NetworkOrg, NetworkError> {
        self.post_authed(&format!("{}/api/orgs", self.base_url), jwt, req)
            .await
    }

    pub async fn list_orgs(&self, jwt: &str) -> Result<Vec<NetworkOrg>, NetworkError> {
        self.get_authed(&format!("{}/api/orgs", self.base_url), jwt)
            .await
    }

    pub async fn get_org(&self, org_id: &str, jwt: &str) -> Result<NetworkOrg, NetworkError> {
        self.get_authed(
            &format!("{}/api/orgs/{}", self.base_url, org_id),
            jwt,
        )
        .await
    }

    pub async fn update_org(
        &self,
        org_id: &str,
        jwt: &str,
        req: &UpdateOrgRequest,
    ) -> Result<NetworkOrg, NetworkError> {
        self.put_authed(
            &format!("{}/api/orgs/{}", self.base_url, org_id),
            jwt,
            req,
        )
        .await
    }

    // -----------------------------------------------------------------------
    // Org Members (Phase 4)
    // -----------------------------------------------------------------------

    pub async fn list_org_members(
        &self,
        org_id: &str,
        jwt: &str,
    ) -> Result<Vec<NetworkOrgMember>, NetworkError> {
        self.get_authed(
            &format!("{}/api/orgs/{}/members", self.base_url, org_id),
            jwt,
        )
        .await
    }

    pub async fn update_org_member(
        &self,
        org_id: &str,
        user_id: &str,
        jwt: &str,
        req: &UpdateMemberRequest,
    ) -> Result<NetworkOrgMember, NetworkError> {
        self.put_authed(
            &format!(
                "{}/api/orgs/{}/members/{}",
                self.base_url, org_id, user_id
            ),
            jwt,
            req,
        )
        .await
    }

    pub async fn remove_org_member(
        &self,
        org_id: &str,
        user_id: &str,
        jwt: &str,
    ) -> Result<(), NetworkError> {
        self.delete_authed(
            &format!(
                "{}/api/orgs/{}/members/{}",
                self.base_url, org_id, user_id
            ),
            jwt,
        )
        .await
    }

    // -----------------------------------------------------------------------
    // Org Invites (Phase 4)
    // -----------------------------------------------------------------------

    pub async fn create_invite(
        &self,
        org_id: &str,
        jwt: &str,
        req: &CreateInviteRequest,
    ) -> Result<NetworkOrgInvite, NetworkError> {
        self.post_authed(
            &format!("{}/api/orgs/{}/invites", self.base_url, org_id),
            jwt,
            req,
        )
        .await
    }

    pub async fn list_invites(
        &self,
        org_id: &str,
        jwt: &str,
    ) -> Result<Vec<NetworkOrgInvite>, NetworkError> {
        self.get_authed(
            &format!("{}/api/orgs/{}/invites", self.base_url, org_id),
            jwt,
        )
        .await
    }

    pub async fn revoke_invite(
        &self,
        org_id: &str,
        invite_id: &str,
        jwt: &str,
    ) -> Result<(), NetworkError> {
        let url = format!(
            "{}/api/orgs/{}/invites/{}",
            self.base_url, org_id, invite_id
        );
        self.delete_authed(&url, jwt).await
    }

    pub async fn accept_invite(
        &self,
        token: &str,
        jwt: &str,
    ) -> Result<NetworkOrgMember, NetworkError> {
        self.post_authed(
            &format!("{}/api/invites/{}/accept", self.base_url, token),
            jwt,
            &serde_json::json!({}),
        )
        .await
    }

    // -----------------------------------------------------------------------
    // Agents (Phase 5)
    // -----------------------------------------------------------------------

    pub async fn create_agent(
        &self,
        jwt: &str,
        req: &CreateAgentRequest,
    ) -> Result<NetworkAgent, NetworkError> {
        self.post_authed(&format!("{}/api/agents", self.base_url), jwt, req)
            .await
    }

    pub async fn list_agents(&self, jwt: &str) -> Result<Vec<NetworkAgent>, NetworkError> {
        self.get_authed(&format!("{}/api/agents", self.base_url), jwt)
            .await
    }

    pub async fn list_agents_by_org(
        &self,
        org_id: &str,
        jwt: &str,
    ) -> Result<Vec<NetworkAgent>, NetworkError> {
        self.get_authed(
            &format!("{}/api/agents?org_id={}", self.base_url, org_id),
            jwt,
        )
        .await
    }

    pub async fn get_agent(
        &self,
        agent_id: &str,
        jwt: &str,
    ) -> Result<NetworkAgent, NetworkError> {
        self.get_authed(
            &format!("{}/api/agents/{}", self.base_url, agent_id),
            jwt,
        )
        .await
    }

    pub async fn update_agent(
        &self,
        agent_id: &str,
        jwt: &str,
        req: &UpdateAgentRequest,
    ) -> Result<NetworkAgent, NetworkError> {
        self.put_authed(
            &format!("{}/api/agents/{}", self.base_url, agent_id),
            jwt,
            req,
        )
        .await
    }

    pub async fn delete_agent(&self, agent_id: &str, jwt: &str) -> Result<(), NetworkError> {
        self.delete_authed(
            &format!("{}/api/agents/{}", self.base_url, agent_id),
            jwt,
        )
        .await
    }

    // -----------------------------------------------------------------------
    // Projects (Phase 6)
    // -----------------------------------------------------------------------

    pub async fn create_project(
        &self,
        jwt: &str,
        req: &CreateProjectRequest,
    ) -> Result<NetworkProject, NetworkError> {
        self.post_authed(&format!("{}/api/projects", self.base_url), jwt, req)
            .await
    }

    pub async fn list_projects_by_org(
        &self,
        org_id: &str,
        jwt: &str,
    ) -> Result<Vec<NetworkProject>, NetworkError> {
        self.get_authed(
            &format!("{}/api/projects?org_id={}", self.base_url, org_id),
            jwt,
        )
        .await
    }

    pub async fn get_project(
        &self,
        project_id: &str,
        jwt: &str,
    ) -> Result<NetworkProject, NetworkError> {
        self.get_authed(
            &format!("{}/api/projects/{}", self.base_url, project_id),
            jwt,
        )
        .await
    }

    pub async fn update_project(
        &self,
        project_id: &str,
        jwt: &str,
        req: &UpdateProjectRequest,
    ) -> Result<NetworkProject, NetworkError> {
        self.put_authed(
            &format!("{}/api/projects/{}", self.base_url, project_id),
            jwt,
            req,
        )
        .await
    }

    pub async fn delete_project(&self, project_id: &str, jwt: &str) -> Result<(), NetworkError> {
        self.delete_authed(
            &format!("{}/api/projects/{}", self.base_url, project_id),
            jwt,
        )
        .await
    }

    // -----------------------------------------------------------------------
    // Follows (Phase 7)
    // -----------------------------------------------------------------------

    pub async fn follow_profile(
        &self,
        jwt: &str,
        req: &FollowRequest,
    ) -> Result<NetworkFollow, NetworkError> {
        self.post_authed(&format!("{}/api/follows", self.base_url), jwt, req)
            .await
    }

    pub async fn list_follows(&self, jwt: &str) -> Result<Vec<NetworkFollow>, NetworkError> {
        self.get_authed(&format!("{}/api/follows", self.base_url), jwt)
            .await
    }

    pub async fn unfollow_profile(
        &self,
        profile_id: &str,
        jwt: &str,
    ) -> Result<(), NetworkError> {
        self.delete_authed(
            &format!("{}/api/follows/{}", self.base_url, profile_id),
            jwt,
        )
        .await
    }

    // -----------------------------------------------------------------------
    // Feed (Phase 8)
    // -----------------------------------------------------------------------

    pub async fn get_feed(
        &self,
        filter: Option<&str>,
        jwt: &str,
    ) -> Result<Vec<NetworkFeedEvent>, NetworkError> {
        let url = match filter {
            Some(f) => format!("{}/api/feed?filter={}", self.base_url, f),
            None => format!("{}/api/feed", self.base_url),
        };
        self.get_authed(&url, jwt).await
    }

    // -----------------------------------------------------------------------
    // Comments (Phase 8)
    // -----------------------------------------------------------------------

    pub async fn list_comments(
        &self,
        event_id: &str,
        jwt: &str,
    ) -> Result<Vec<NetworkComment>, NetworkError> {
        self.get_authed(
            &format!(
                "{}/api/activity/{}/comments",
                self.base_url, event_id
            ),
            jwt,
        )
        .await
    }

    pub async fn add_comment(
        &self,
        event_id: &str,
        content: &str,
        jwt: &str,
    ) -> Result<NetworkComment, NetworkError> {
        self.post_authed(
            &format!(
                "{}/api/activity/{}/comments",
                self.base_url, event_id
            ),
            jwt,
            &serde_json::json!({ "content": content }),
        )
        .await
    }

    pub async fn delete_comment(&self, comment_id: &str, jwt: &str) -> Result<(), NetworkError> {
        self.delete_authed(
            &format!("{}/api/comments/{}", self.base_url, comment_id),
            jwt,
        )
        .await
    }

    // -----------------------------------------------------------------------
    // Leaderboard (Phase 9)
    // -----------------------------------------------------------------------

    pub async fn get_leaderboard(
        &self,
        period: &str,
        org_id: Option<&str>,
        jwt: &str,
    ) -> Result<Vec<LeaderboardEntry>, NetworkError> {
        let mut url = format!("{}/api/leaderboard?period={}", self.base_url, period);
        if let Some(oid) = org_id {
            url.push_str(&format!("&org_id={}", oid));
        }
        self.get_authed(&url, jwt).await
    }

    // -----------------------------------------------------------------------
    // Usage (Phase 9)
    // -----------------------------------------------------------------------

    pub async fn get_personal_usage(
        &self,
        period: &str,
        jwt: &str,
    ) -> Result<UsageStats, NetworkError> {
        self.get_authed(
            &format!(
                "{}/api/users/me/usage?period={}",
                self.base_url, period
            ),
            jwt,
        )
        .await
    }

    pub async fn get_org_usage(
        &self,
        org_id: &str,
        period: &str,
        jwt: &str,
    ) -> Result<UsageStats, NetworkError> {
        self.get_authed(
            &format!(
                "{}/api/orgs/{}/usage?period={}",
                self.base_url, org_id, period
            ),
            jwt,
        )
        .await
    }

    pub async fn get_org_usage_members(
        &self,
        org_id: &str,
        jwt: &str,
    ) -> Result<Vec<MemberUsageStats>, NetworkError> {
        self.get_authed(
            &format!(
                "{}/api/orgs/{}/usage/members",
                self.base_url, org_id
            ),
            jwt,
        )
        .await
    }

    // -----------------------------------------------------------------------
    // Internal HTTP helpers
    // -----------------------------------------------------------------------

    async fn get_authed<T: serde::de::DeserializeOwned>(
        &self,
        url: &str,
        jwt: &str,
    ) -> Result<T, NetworkError> {
        let resp = self
            .http
            .get(url)
            .bearer_auth(jwt)
            .send()
            .await?;

        self.handle_response(resp).await
    }

    async fn post_authed<T: serde::de::DeserializeOwned, B: serde::Serialize>(
        &self,
        url: &str,
        jwt: &str,
        body: &B,
    ) -> Result<T, NetworkError> {
        let resp = self
            .http
            .post(url)
            .bearer_auth(jwt)
            .json(body)
            .send()
            .await?;

        self.handle_response(resp).await
    }

    async fn put_authed<T: serde::de::DeserializeOwned, B: serde::Serialize>(
        &self,
        url: &str,
        jwt: &str,
        body: &B,
    ) -> Result<T, NetworkError> {
        let resp = self
            .http
            .put(url)
            .bearer_auth(jwt)
            .json(body)
            .send()
            .await?;

        self.handle_response(resp).await
    }

    async fn delete_authed(&self, url: &str, jwt: &str) -> Result<(), NetworkError> {
        let resp = self
            .http
            .delete(url)
            .bearer_auth(jwt)
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(NetworkError::Server {
                status: status.as_u16(),
                body,
            });
        }
        Ok(())
    }

    async fn handle_response<T: serde::de::DeserializeOwned>(
        &self,
        resp: reqwest::Response,
    ) -> Result<T, NetworkError> {
        let url = resp.url().to_string();
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(NetworkError::Server {
                status: status.as_u16(),
                body,
            });
        }
        let body = resp.text().await.map_err(|e| NetworkError::Deserialize(e.to_string()))?;
        serde_json::from_str::<T>(&body).map_err(|e| {
            warn!(%url, error = %e, body_preview = &body[..body.len().min(500)], "Deserialization failed");
            NetworkError::Deserialize(e.to_string())
        })
    }
}
