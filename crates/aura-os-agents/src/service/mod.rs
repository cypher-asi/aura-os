//! User-level agent templates.
//!
//! Authoritative source is aura-network when available. A local
//! shadow (key prefix `"agent:"`) is maintained so that reads still
//! work when the network is unreachable (local-first).

mod network;
mod permissions;
mod runtime_config;
mod self_improvement;
mod shadow;

#[cfg(test)]
mod tests;

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use aura_os_core::{Agent, AgentId, JwtProvider};
use aura_os_store::SettingsStore;

use crate::errors::AgentError;

pub use self_improvement::{
    AgentImprovementEvidence, AgentImprovementKind, AgentImprovementProposal,
    AgentImprovementProvenance, AgentImprovementSource, AgentImprovementStatus,
    AgentLearningReviewResult, AgentSelfImprovementConfig, AgentSelfImprovementMode,
};

pub struct AgentService {
    pub(super) store: Arc<SettingsStore>,
    pub(super) network_client: Option<Arc<aura_os_network::NetworkClient>>,
    /// Per-process dedup set for `reconcile_permissions_with_shadow`'s
    /// upstream heal flow.
    ///
    /// Whenever an aura-network GET returns an empty `permissions`
    /// bundle and we fall back to the local shadow, we schedule a
    /// best-effort PUT to push the shadow value back upstream so the
    /// next GET round-trips cleanly. Without this set we'd issue a
    /// fresh heal PUT on every list/get refresh (sidebar polling is
    /// frequent), which (a) spams aura-network with no-op writes when
    /// the upstream genuinely can't persist the column, and (b)
    /// generates a wall of WARN logs every poll cycle. The set tracks
    /// "we already attempted to heal this `agent_id` in this process"
    /// so the warn-log + PUT pair runs at most once per agent per
    /// boot. The shadow-adoption itself still runs every time — only
    /// the noise and the outbound PUT are throttled.
    pub(super) permission_heal_attempted: Mutex<HashSet<AgentId>>,
}

impl AgentService {
    /// Settings key for the org's canonical CEO `agent_id`.
    ///
    /// Populated by `setup_ceo_agent` on every bootstrap run so that
    /// read-time reconciliation can identify "this agent_id is still
    /// the CEO" even after the user renames it (the narrow name+role
    /// `"CEO"`/`"CEO"` identity heuristic in
    /// [`aura_os_core::AgentPermissions::normalized_for_identity`]
    /// stops matching once the display name changes). Used by
    /// [`Self::reconcile_permissions_with_shadow`] as a last-resort
    /// repair when both the network response and local shadow come
    /// back with empty permissions — heals users whose shadow was
    /// already corrupted by the pre-fix PUT flow.
    pub(super) const CEO_AGENT_ID_KEY: &'static str = "bootstrap:ceo_agent_id";

    /// Persisted sentinel: presence means we have empirically observed
    /// that aura-network drops the `permissions` column on its PUT
    /// response (and therefore almost certainly on GET too — the heal
    /// PUT is the most reliable detector). When set, the read-time
    /// reconciliation in
    /// [`Self::reconcile_permissions_with_shadow`] silently adopts the
    /// shadow without scheduling another heal PUT and without emitting
    /// per-agent WARNs; a single boot-time INFO summarizes the state
    /// instead. The sentinel is cleared automatically the moment we
    /// observe a non-empty `permissions` bundle from upstream, so a
    /// future fix to aura-network self-heals without any manual reset.
    pub(super) const PERMISSIONS_UPSTREAM_DROPS_KEY: &'static str =
        "permissions:upstream_drops_column";

    pub fn new(
        store: Arc<SettingsStore>,
        network_client: Option<Arc<aura_os_network::NetworkClient>>,
    ) -> Self {
        Self {
            store,
            network_client,
            permission_heal_attempted: Mutex::new(HashSet::new()),
        }
    }

    pub(super) fn agent_key(agent_id: &AgentId) -> String {
        format!("agent:{agent_id}")
    }

    pub(super) fn agent_runtime_key(agent_id: &AgentId) -> String {
        format!("agent_runtime:{agent_id}")
    }

    pub(super) fn get_jwt(&self) -> Result<String, AgentError> {
        self.store.get_jwt().ok_or(AgentError::NoSession)
    }

    /// Apply any locally-persisted runtime config to `agent` and
    /// preserve local-only fields like `local_workspace_path` that
    /// never ride on the network record.
    pub fn apply_runtime_config(&self, agent: &mut Agent) -> Result<(), AgentError> {
        if let Some(config) = self.load_agent_runtime_config(&agent.agent_id)? {
            agent.adapter_type = config.adapter_type;
            agent.environment = config.environment;
            agent.auth_source = aura_os_core::effective_auth_source(
                &agent.adapter_type,
                Some(config.auth_source.as_str()),
                config.integration_id.as_deref(),
            );
            agent.integration_id = config.integration_id;
            agent.default_model = config.default_model;
            agent.machine_type = if agent.environment == "swarm_microvm" {
                "remote".to_string()
            } else {
                "local".to_string()
            };
        }
        // Local-only fields never ride on the network record; preserve
        // whatever is stored in the shadow so network round-trips
        // don't wipe user-set values like `local_workspace_path`.
        if agent.local_workspace_path.is_none() {
            if let Ok(bytes) = self.store.get_setting(&Self::agent_key(&agent.agent_id)) {
                if let Ok(shadow) = serde_json::from_slice::<Agent>(&bytes) {
                    agent.local_workspace_path = shadow.local_workspace_path;
                }
            }
        }
        Ok(())
    }
}
