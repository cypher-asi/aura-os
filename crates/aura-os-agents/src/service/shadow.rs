//! Shadow-store operations for [`AgentService`].
//!
//! The shadow lives under the `"agent:"` key prefix in the local
//! settings store and acts as a write-through cache of the
//! aura-network agents catalog. Reads fall back to the shadow when
//! the network is unreachable; writes always patch the shadow so
//! subsequent offline reads see the freshest data.

use aura_os_core::{Agent, AgentId};
use aura_os_network::NetworkAgent;
use aura_os_store::BatchOp;

use super::AgentService;
use crate::convert::network_agent_to_core;
use crate::errors::AgentError;

impl AgentService {
    /// Belt-and-suspenders guard: if the incoming `agent.permissions`
    /// bundle is empty and the existing shadow row has a non-empty
    /// bundle, clone the stored `permissions` into the outgoing agent
    /// so we never overwrite last-known-good toggles with an empty
    /// projection.
    ///
    /// This is the second line of defence for the same class of bug
    /// that [`Self::reconcile_permissions_with_shadow`] addresses on
    /// the read side: aura-network PUT/GET responses that silently
    /// drop the `permissions` column would otherwise corrupt the
    /// shadow on the next save. Every read path already reconciles
    /// before saving, but any new call site (or any forgotten call
    /// site) that routes through [`Self::save_agent_shadow`] /
    /// [`Self::save_agent_shadows_if_changed`] is now also covered.
    ///
    /// Scope is strictly the `permissions` column — every other
    /// field on the incoming `Agent` is persisted as-is. A genuinely
    /// intended "clear all capabilities" write would have universe
    /// scope and an empty capability list, which matches
    /// [`aura_os_core::AgentPermissions::is_empty`]; callers that
    /// need to express that must first write a non-empty bundle (or
    /// call the capability-toggle flow which submits the explicit
    /// clear as a non-empty request payload).
    fn preserve_shadow_permissions_if_empty(&self, agent: &mut Agent) {
        if !agent.permissions.is_empty() {
            return;
        }
        let shadow = match self.get_agent_local(&agent.agent_id) {
            Ok(s) => s,
            Err(_) => return,
        };
        if shadow.permissions.is_empty() {
            return;
        }
        tracing::warn!(
            agent_id = %agent.agent_id,
            shadow_capabilities = shadow.permissions.capabilities.len(),
            "save_agent_shadow: refusing to overwrite non-empty stored permissions with empty bundle; preserving shadow value"
        );
        agent.permissions = shadow.permissions;
    }

    /// Persist an agent to the local shadow store.
    pub fn save_agent_shadow(&self, agent: &Agent) -> Result<(), AgentError> {
        let mut patched = agent.clone();
        self.preserve_shadow_permissions_if_empty(&mut patched);
        let payload = serde_json::to_vec(&patched).map_err(|e| AgentError::Parse(e.to_string()))?;
        self.store
            .put_setting(&Self::agent_key(&patched.agent_id), &payload)
            .map_err(AgentError::Store)
    }

    /// Batch-persist agent shadows, writing only those whose
    /// serialized bytes differ from what's already in the store.
    ///
    /// This is the fast path for hot routes like `GET /api/agents`
    /// that used to call [`save_agent_shadow`] in a per-agent loop —
    /// each call triggered a full `settings.json` rewrite in
    /// `SettingsStore::persist_cf`, so listing N agents caused N full
    /// rewrites plus N held write-locks on the store. Here we:
    ///   * serialize each agent once,
    ///   * compare against the currently stored bytes (in-memory read),
    ///   * submit only the changed/new entries as a single
    ///     `SettingsStore::write_batch` — which triggers exactly one
    ///     `persist_cf` for the whole set.
    ///
    /// Returns the number of rows actually written (0 means
    /// everything was already up to date, which means no disk I/O
    /// was performed).
    pub fn save_agent_shadows_if_changed(&self, agents: &[&Agent]) -> Result<usize, AgentError> {
        if agents.is_empty() {
            return Ok(0);
        }
        let mut ops = Vec::new();
        for agent in agents {
            // Mirror the single-row `save_agent_shadow` guard — never
            // let an empty-permissions projection clobber a non-empty
            // shadow row, even on the hot batched GET-list path.
            let mut patched = (*agent).clone();
            self.preserve_shadow_permissions_if_empty(&mut patched);
            let payload =
                serde_json::to_vec(&patched).map_err(|e| AgentError::Parse(e.to_string()))?;
            let key = Self::agent_key(&patched.agent_id);
            let unchanged = matches!(
                self.store.get_setting(&key),
                Ok(existing) if existing == payload
            );
            if unchanged {
                continue;
            }
            ops.push(BatchOp::Put {
                cf: aura_os_store::ColumnFamilyName::Settings
                    .as_str()
                    .to_string(),
                key,
                value: payload,
            });
        }
        if ops.is_empty() {
            return Ok(0);
        }
        let count = ops.len();
        self.store.write_batch(ops).map_err(AgentError::Store)?;
        Ok(count)
    }

    /// Remove an agent from the local shadow store.
    pub fn delete_agent_shadow(&self, agent_id: &AgentId) -> Result<(), AgentError> {
        self.store
            .delete_setting(&Self::agent_key(agent_id))
            .map_err(AgentError::Store)
    }

    /// Convert a batch of network-shape agents to core agents and
    /// persist them to the local shadow store.
    ///
    /// Invoked from tool paths (`list_agents`, `get_agent`) so that
    /// the catalog the LLM just saw is mirrored locally. Downstream
    /// code like `send_agent_event_stream` falls back to
    /// `get_agent_local` when aura-network resolution fails; without
    /// this hydration, the fallback is always empty and a transient
    /// network hiccup surfaces as a user-visible 404. Failures to
    /// persist individual rows are swallowed intentionally — this is
    /// a cache, not the source of truth, and we don't want a flaky
    /// store to break the tool call.
    pub fn hydrate_shadow_from_network(&self, agents: &[NetworkAgent]) {
        if agents.is_empty() {
            return;
        }
        let mut owned: Vec<Agent> = Vec::with_capacity(agents.len());
        for net in agents {
            let mut agent = network_agent_to_core(net);
            let _ = self.apply_runtime_config(&mut agent);
            // Prefer the local shadow's `permissions` when the
            // network response came back empty — see
            // [`Self::reconcile_permissions_with_shadow`] for the
            // full round-trip rationale. Without this, every
            // hydration wipes the toggles the user just saved.
            self.reconcile_permissions_with_shadow(&mut agent);
            owned.push(agent);
        }
        let refs: Vec<&Agent> = owned.iter().collect();
        let _ = self.save_agent_shadows_if_changed(&refs);
    }

    fn list_local_agents(&self) -> Result<Vec<Agent>, AgentError> {
        let entries = self
            .store
            .list_settings_with_prefix("agent:")
            .map_err(AgentError::Store)?;
        let mut agents = Vec::new();
        for (_key, value) in entries {
            if let Ok(mut agent) = serde_json::from_slice::<Agent>(&value) {
                let _ = self.apply_runtime_config(&mut agent);
                agents.push(agent);
            }
        }
        Ok(agents)
    }

    /// List all agents from the local shadow store.
    pub fn list_agents(&self) -> Result<Vec<Agent>, AgentError> {
        self.list_local_agents()
    }

    /// Get a single agent from the local shadow store.
    pub fn get_agent_local(&self, agent_id: &AgentId) -> Result<Agent, AgentError> {
        let bytes = self
            .store
            .get_setting(&Self::agent_key(agent_id))
            .map_err(|e| match e {
                aura_os_store::StoreError::NotFound(_) => AgentError::NotFound,
                other => AgentError::Store(other),
            })?;
        let mut agent: Agent =
            serde_json::from_slice(&bytes).map_err(|e| AgentError::Parse(e.to_string()))?;
        let _ = self.apply_runtime_config(&mut agent);
        Ok(agent)
    }
}
