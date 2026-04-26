//! Permission reconciliation and CEO repair for [`AgentService`].
//!
//! aura-network has historically round-tripped the `permissions`
//! column inconsistently. The helpers here are read-time guards that
//! keep the local shadow honest and rescue the canonical CEO bundle
//! when both sides drop the column.

use aura_os_core::{Agent, AgentId, AgentPermissions};

use super::AgentService;

impl AgentService {
    /// Record the org's canonical CEO `agent_id` for read-time repair.
    ///
    /// Called from `setup_ceo_agent` after every bootstrap so that
    /// [`Self::reconcile_permissions_with_shadow`] can still
    /// recognise this agent as the CEO even after the user renames
    /// it. Best-effort — failures are swallowed because the shadow
    /// remains a cache and the GET-side safety net
    /// ([`AgentPermissions::normalized_for_identity`]) still catches
    /// the common "name+role still CEO/CEO" case.
    pub fn remember_ceo_agent_id(&self, agent_id: &AgentId) {
        let value = agent_id.to_string().into_bytes();
        if let Err(err) = self.store.put_setting(Self::CEO_AGENT_ID_KEY, &value) {
            tracing::warn!(
                agent_id = %agent_id,
                error = %err,
                "failed to persist bootstrapped CEO agent_id"
            );
        }
    }

    /// Read the org's canonical CEO `agent_id`, if one has been
    /// persisted by a prior `setup_ceo_agent` run.
    pub fn bootstrapped_ceo_agent_id(&self) -> Option<AgentId> {
        let bytes = self.store.get_setting(Self::CEO_AGENT_ID_KEY).ok()?;
        let s = std::str::from_utf8(&bytes).ok()?;
        s.parse::<AgentId>().ok()
    }

    /// Read-time counterpart to the PUT-side reconciliation in
    /// `handlers::agents::crud::update_agent`.
    ///
    /// aura-network has historically round-tripped the `permissions`
    /// column inconsistently: the upstream either never persisted it
    /// (older deployments) or silently drops it from the response
    /// JSON on `GET /agents` / `GET /agents/:id`. When that happens,
    /// `network_agent_to_core` / `agent_from_network` produce an
    /// `Agent` whose `permissions` bundle is empty (`capabilities:
    /// []`, universe scope) — and every caller that then writes the
    /// agent through [`Self::save_agent_shadow`] clobbers the
    /// freshly-saved local bundle. That's the "toggles survive the
    /// session but vanish after an app restart" regression.
    ///
    /// This helper repairs the common case: if the freshly-fetched
    /// bundle is empty *and* the local shadow has a non-empty
    /// bundle, adopt the shadow's bundle before persisting or
    /// returning. The PUT side already applies the symmetric "trust
    /// what we just sent" rule when the PUT response fails to echo
    /// the submitted bundle, so both round-trips now treat the local
    /// shadow as the fallback source of truth for `permissions`
    /// whenever aura-network drops the column.
    ///
    /// There is also a last-resort repair for the CEO SuperAgent:
    /// when both the network response *and* the local shadow are
    /// empty (classic "already-corrupted by the pre-fix PUT flow"
    /// scenario) but the agent matches the `agent_id` stamped by
    /// `setup_ceo_agent` via [`Self::remember_ceo_agent_id`], restore
    /// the canonical [`AgentPermissions::ceo_preset`]. This lets
    /// users who renamed their CEO (e.g. to "Orion") recover the
    /// preset without re-running bootstrap.
    ///
    /// Deliberately scoped to `permissions` — every other column on
    /// the network response is still authoritative.
    pub fn reconcile_permissions_with_shadow(&self, agent: &mut Agent) {
        if !agent.permissions.is_empty() {
            return;
        }
        let shadow_permissions = match self.get_agent_local(&agent.agent_id) {
            Ok(s) if !s.permissions.is_empty() => Some(s.permissions),
            _ => None,
        };
        if let Some(shadow) = shadow_permissions {
            tracing::warn!(
                agent_id = %agent.agent_id,
                shadow_capabilities = shadow.capabilities.len(),
                "aura-network response did not include a `permissions` bundle; using last-known shadow value"
            );
            agent.permissions = shadow;
            return;
        }
        // Both sides are empty. Last-resort: if this is the
        // bootstrapped CEO for the org, restore the canonical preset.
        // The `normalized_for_identity` helper on the incoming
        // `NetworkAgent` already handles the "still named CEO"
        // sub-case, so reaching here means the user renamed (common
        // "Orion"-style tweak) *and* their shadow got wiped by the
        // pre-fix PUT flow.
        if let Some(ceo_id) = self.bootstrapped_ceo_agent_id() {
            if ceo_id == agent.agent_id {
                tracing::warn!(
                    agent_id = %agent.agent_id,
                    "restoring CEO preset from bootstrap-stamped agent_id (both network and shadow had empty permissions)"
                );
                agent.permissions = AgentPermissions::ceo_preset();
            }
        }
    }
}
