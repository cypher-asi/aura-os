use crate::error::NetworkError;
use crate::types::*;

use super::NetworkClient;

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
