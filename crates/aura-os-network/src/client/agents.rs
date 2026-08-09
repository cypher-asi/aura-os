use tracing::debug;

use crate::error::NetworkError;
use crate::types::*;

use super::NetworkClient;

const AGENT_ROSTER_PAGE_SIZE: usize = 100;

fn agent_roster_page_url(base_url: &str, org_id: Option<&str>, offset: usize) -> String {
    let mut url = format!("{base_url}/api/agents?");
    if let Some(org_id) = org_id {
        url.push_str("org_id=");
        url.push_str(org_id);
        url.push('&');
    }
    url.push_str(&format!("limit={AGENT_ROSTER_PAGE_SIZE}"));
    if offset > 0 {
        url.push_str(&format!("&offset={offset}"));
    }
    url
}

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
        self.list_agent_roster(jwt, None).await
    }

    pub async fn list_agents_by_org(
        &self,
        org_id: &str,
        jwt: &str,
    ) -> Result<Vec<NetworkAgent>, NetworkError> {
        self.list_agent_roster(jwt, Some(org_id)).await
    }

    /// Fetch the complete caller/org roster instead of accepting aura-network's
    /// default first 50 rows. The network orders non-marketplace rosters by
    /// ascending creation time, so a newly cloned agent otherwise disappears
    /// from Aura immediately after the post-clone refresh on larger fleets.
    async fn list_agent_roster(
        &self,
        jwt: &str,
        org_id: Option<&str>,
    ) -> Result<Vec<NetworkAgent>, NetworkError> {
        let mut agents = Vec::new();
        loop {
            let url = agent_roster_page_url(&self.base_url, org_id, agents.len());
            let page: Vec<NetworkAgent> = self.get_authed(&url, jwt).await?;
            let page_len = page.len();
            agents.extend(page);
            if page_len < AGENT_ROSTER_PAGE_SIZE {
                return Ok(agents);
            }
        }
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

#[cfg(test)]
mod tests {
    use super::{agent_roster_page_url, AGENT_ROSTER_PAGE_SIZE};

    #[test]
    fn roster_urls_request_full_pages_and_offsets() {
        assert_eq!(AGENT_ROSTER_PAGE_SIZE, 100);
        assert_eq!(
            agent_roster_page_url("https://network.test", None, 0),
            "https://network.test/api/agents?limit=100"
        );
        assert_eq!(
            agent_roster_page_url("https://network.test", Some("org-1"), 100),
            "https://network.test/api/agents?org_id=org-1&limit=100&offset=100"
        );
    }
}
