use tracing::debug;

use crate::error::NetworkError;
use crate::types::*;

use super::NetworkClient;

/// Query parameters for the marketplace view of `GET /api/agents`.
///
/// Mirrors the contract documented in
/// `docs/migrations/2026-04-17-marketplace-agent-fields.md`. Used by
/// `NetworkClient::list_marketplace_agents` to fetch agents listed by other
/// users (i.e. the public marketplace), distinct from the caller-scoped
/// `list_agents` endpoint that returns only the JWT user's own agents.
#[derive(Debug, Default, Clone, Copy)]
pub struct ListMarketplaceAgentsParams<'a> {
    /// `"trending"` | `"latest"` | `"revenue"` | `"reputation"`. `None`
    /// lets the server apply its default.
    pub sort: Option<&'a str>,
    /// Optional expertise slug filter. Empty / `None` means no filter.
    pub expertise: Option<&'a str>,
    /// Page size; server caps this at 100.
    pub limit: Option<u32>,
    /// Page offset.
    pub offset: Option<u32>,
}

impl NetworkClient {
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

    /// List hireable agents from the marketplace.
    ///
    /// Hits `GET /api/agents?listing_status=hireable[&sort=...&expertise=...&limit=...&offset=...]`,
    /// which the network treats as the public marketplace view (cross-user)
    /// rather than the caller-scoped roster returned by [`Self::list_agents`].
    pub async fn list_marketplace_agents(
        &self,
        jwt: &str,
        params: &ListMarketplaceAgentsParams<'_>,
    ) -> Result<Vec<NetworkAgent>, NetworkError> {
        let mut url = format!("{}/api/agents?listing_status=hireable", self.base_url);
        if let Some(sort) = params.sort.filter(|s| !s.is_empty()) {
            url.push_str("&sort=");
            url.push_str(sort);
        }
        if let Some(expertise) = params.expertise.filter(|s| !s.is_empty()) {
            url.push_str("&expertise=");
            url.push_str(expertise);
        }
        if let Some(limit) = params.limit {
            url.push_str(&format!("&limit={limit}"));
        }
        if let Some(offset) = params.offset {
            url.push_str(&format!("&offset={offset}"));
        }
        debug!(%url, "list_marketplace_agents");
        self.get_authed(&url, jwt).await
    }

    pub async fn get_agent(&self, agent_id: &str, jwt: &str) -> Result<NetworkAgent, NetworkError> {
        self.get_authed(&format!("{}/api/agents/{}", self.base_url, agent_id), jwt)
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
        self.delete_authed(&format!("{}/api/agents/{}", self.base_url, agent_id), jwt)
            .await
    }
}
