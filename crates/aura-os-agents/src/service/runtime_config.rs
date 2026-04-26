//! Runtime-config persistence for [`AgentService`].
//!
//! Stored under the key prefix `agent_runtime:<agent_id>`. Contains
//! adapter/environment/auth metadata that is local-only — it never
//! round-trips through aura-network.

use aura_os_core::{AgentId, AgentRuntimeConfig};

use super::AgentService;
use crate::errors::AgentError;

impl AgentService {
    pub fn save_agent_runtime_config(
        &self,
        agent_id: &AgentId,
        config: &AgentRuntimeConfig,
    ) -> Result<(), AgentError> {
        let payload = serde_json::to_vec(config).map_err(|e| AgentError::Parse(e.to_string()))?;
        self.store
            .put_setting(&Self::agent_runtime_key(agent_id), &payload)
            .map_err(AgentError::Store)
    }

    pub fn load_agent_runtime_config(
        &self,
        agent_id: &AgentId,
    ) -> Result<Option<AgentRuntimeConfig>, AgentError> {
        let bytes = match self.store.get_setting(&Self::agent_runtime_key(agent_id)) {
            Ok(bytes) => bytes,
            Err(aura_os_store::StoreError::NotFound(_)) => return Ok(None),
            Err(e) => return Err(AgentError::Store(e)),
        };
        let config =
            serde_json::from_slice(&bytes).map_err(|e| AgentError::Parse(e.to_string()))?;
        Ok(Some(config))
    }

    pub fn delete_agent_runtime_config(&self, agent_id: &AgentId) -> Result<(), AgentError> {
        match self
            .store
            .delete_setting(&Self::agent_runtime_key(agent_id))
        {
            Ok(()) | Err(aura_os_store::StoreError::NotFound(_)) => Ok(()),
            Err(e) => Err(AgentError::Store(e)),
        }
    }
}
