//! Network-backed reads for [`AgentService`].
//!
//! These resolve an agent against aura-network and write the result
//! through to the local shadow so subsequent offline / fallback
//! reads work.

use aura_os_core::{Agent, AgentId};

use super::AgentService;
use crate::convert::network_agent_to_core;
use crate::errors::AgentError;

impl AgentService {
    /// Get agent from aura-network. Returns error if network is not
    /// configured or agent not found.
    pub async fn get_agent_async(
        &self,
        _user_id: &str,
        agent_id: &AgentId,
    ) -> Result<Agent, AgentError> {
        let client = self
            .network_client
            .as_ref()
            .ok_or_else(|| AgentError::Parse("aura-network is not configured".into()))?;
        let jwt = self.get_jwt()?;
        let net = client
            .get_agent(&agent_id.to_string(), &jwt)
            .await
            .map_err(|e| match &e {
                aura_os_network::NetworkError::Server { status: 404, .. } => AgentError::NotFound,
                _ => AgentError::Network(e),
            })?;
        let mut agent = network_agent_to_core(&net);
        let _ = self.apply_runtime_config(&mut agent);
        self.reconcile_permissions_with_shadow(&mut agent);
        let _ = self.save_agent_shadow(&agent);
        Ok(agent)
    }

    /// Get agent from aura-network using an explicit JWT.
    ///
    /// Prefer this over `get_agent_async` on request-scoped code
    /// paths: it avoids reading `SettingsStore::get_jwt()` (a shared
    /// in-memory cache that can race when multiple users hit the
    /// server), ensures the target agent is resolved with the
    /// **caller's** credentials, and still updates the local shadow
    /// on success so subsequent offline / fallback reads work. A
    /// `NotFound` upstream is mapped to `AgentError::NotFound`; other
    /// network failures surface as `AgentError::Network` so callers
    /// can distinguish "agent doesn't exist" from "aura-network is
    /// flaky".
    pub async fn get_agent_with_jwt(
        &self,
        jwt: &str,
        agent_id: &AgentId,
    ) -> Result<Agent, AgentError> {
        let client = self
            .network_client
            .as_ref()
            .ok_or_else(|| AgentError::Parse("aura-network is not configured".into()))?;
        let net = client
            .get_agent(&agent_id.to_string(), jwt)
            .await
            .map_err(|e| match &e {
                aura_os_network::NetworkError::Server { status: 404, .. } => AgentError::NotFound,
                _ => AgentError::Network(e),
            })?;
        let mut agent = network_agent_to_core(&net);
        let _ = self.apply_runtime_config(&mut agent);
        self.reconcile_permissions_with_shadow(&mut agent);
        let _ = self.save_agent_shadow(&agent);
        Ok(agent)
    }
}
