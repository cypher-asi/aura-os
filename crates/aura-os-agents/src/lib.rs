mod error;
pub use error::AgentError;

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;

use aura_os_core::parse_dt;
use aura_os_core::*;
use aura_os_network::NetworkAgent;
use aura_os_storage::StorageClient;
use aura_os_store::{BatchOp, SettingsStore};

pub type RuntimeAgentStateMap = Arc<Mutex<HashMap<AgentInstanceId, RuntimeAgentState>>>;

/// Convert NetworkAgent to core Agent (no local store).
fn network_agent_to_core(net: &NetworkAgent) -> Agent {
    let agent_id = net.id.parse::<AgentId>().unwrap_or_else(|_| AgentId::new());
    let profile_id: Option<ProfileId> = net.profile_id.as_ref().and_then(|s| s.parse().ok());
    let org_id: Option<OrgId> = net.org_id.as_ref().and_then(|s| s.parse().ok());
    let created_at = parse_dt(&net.created_at);
    let updated_at = parse_dt(&net.updated_at);
    let machine_type = net
        .machine_type
        .clone()
        .unwrap_or_else(|| "local".to_string());
    let environment = if machine_type == "remote" {
        "swarm_microvm".to_string()
    } else {
        "local_host".to_string()
    };

    Agent {
        agent_id,
        user_id: net.user_id.clone(),
        org_id,
        name: net.name.clone(),
        role: net.role.clone().unwrap_or_default(),
        personality: net.personality.clone().unwrap_or_default(),
        system_prompt: net.system_prompt.clone().unwrap_or_default(),
        skills: net.skills.clone().unwrap_or_default(),
        icon: net.icon.clone(),
        machine_type,
        adapter_type: "aura_harness".to_string(),
        environment,
        auth_source: "aura_managed".to_string(),
        integration_id: None,
        default_model: None,
        vm_id: net.vm_id.clone(),
        network_agent_id: net.id.parse().ok(),
        profile_id,
        tags: Vec::new(),
        is_pinned: false,
        listing_status: Default::default(),
        expertise: Vec::new(),
        jobs: 0,
        revenue_usd: 0.0,
        reputation: 0.0,
        local_workspace_path: None,
        // Read-time safety net for legacy records whose `permissions`
        // column was never persisted: if this agent is the CEO by
        // name+role but the bundle isn't the canonical preset, promote
        // it in-memory so the harness tool manifest / sidekick toggles
        // behave correctly until `ensure_canonical_ceo_permissions_persisted`
        // patches the network record on the next bootstrap.
        permissions: net
            .permissions
            .clone()
            .normalized_for_identity(&net.name, net.role.as_deref()),
        intent_classifier: net.intent_classifier.clone(),
        created_at,
        updated_at,
    }
}

// ---------------------------------------------------------------------------
// AgentService – user-level agent templates
//
// Authoritative source is aura-network when available. A local shadow
// (prefix "agent:") is maintained so that reads still work when
// the network is unreachable (local-first).
// ---------------------------------------------------------------------------

pub struct AgentService {
    store: Arc<SettingsStore>,
    network_client: Option<Arc<aura_os_network::NetworkClient>>,
}

impl AgentService {
    fn agent_key(agent_id: &AgentId) -> String {
        format!("agent:{agent_id}")
    }

    fn agent_runtime_key(agent_id: &AgentId) -> String {
        format!("agent_runtime:{agent_id}")
    }

    /// Settings key for the org's canonical CEO `agent_id`.
    ///
    /// Populated by `setup_ceo_agent` on every bootstrap run so that
    /// read-time reconciliation can identify "this agent_id is still
    /// the CEO" even after the user renames it (the narrow name+role
    /// `"CEO"`/`"CEO"` identity heuristic in
    /// [`AgentPermissions::normalized_for_identity`] stops matching
    /// once the display name changes). Used by
    /// [`Self::reconcile_permissions_with_shadow`] as a last-resort
    /// repair when both the network response and local shadow come
    /// back with empty permissions — heals users whose shadow was
    /// already corrupted by the pre-fix PUT flow.
    const CEO_AGENT_ID_KEY: &'static str = "bootstrap:ceo_agent_id";

    pub fn new(
        store: Arc<SettingsStore>,
        network_client: Option<Arc<aura_os_network::NetworkClient>>,
    ) -> Self {
        Self {
            store,
            network_client,
        }
    }

    fn get_jwt(&self) -> Result<String, AgentError> {
        self.store.get_jwt().ok_or(AgentError::NoSession)
    }

    // -- local shadow ----------------------------------------------------------

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
    /// [`AgentPermissions::is_empty`]; callers that need to express
    /// that must first write a non-empty bundle (or call the
    /// capability-toggle flow which submits the explicit clear as a
    /// non-empty request payload).
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

    /// Batch-persist agent shadows, writing only those whose serialized
    /// bytes differ from what's already in the store.
    ///
    /// This is the fast path for hot routes like `GET /api/agents` that
    /// used to call [`save_agent_shadow`] in a per-agent loop — each call
    /// triggered a full `settings.json` rewrite in
    /// [`SettingsStore::persist_cf`], so listing N agents caused N full
    /// rewrites plus N held write-locks on the store. Here we:
    ///   * serialize each agent once,
    ///   * compare against the currently stored bytes (in-memory read),
    ///   * submit only the changed/new entries as a single
    ///     [`SettingsStore::write_batch`] — which triggers exactly one
    ///     `persist_cf` for the whole set.
    ///
    /// Returns the number of rows actually written (0 means everything
    /// was already up to date, which means no disk I/O was performed).
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
        // whatever is stored in the shadow so network round-trips don't
        // wipe user-set values like `local_workspace_path`.
        if agent.local_workspace_path.is_none() {
            if let Ok(bytes) = self.store.get_setting(&Self::agent_key(&agent.agent_id)) {
                if let Ok(shadow) = serde_json::from_slice::<Agent>(&bytes) {
                    agent.local_workspace_path = shadow.local_workspace_path;
                }
            }
        }
        Ok(())
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
    /// Invoked from tool paths (`list_agents`, `get_agent`) so that the
    /// catalog the LLM just saw is mirrored locally. Downstream code
    /// like `send_agent_event_stream` falls back to `get_agent_local`
    /// when aura-network resolution fails; without this hydration, the
    /// fallback is always empty and a transient network hiccup surfaces
    /// as a user-visible 404. Failures to persist individual rows are
    /// swallowed intentionally — this is a cache, not the source of
    /// truth, and we don't want a flaky store to break the tool call.
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
            // [`Self::reconcile_permissions_with_shadow`] for the full
            // round-trip rationale. Without this, every hydration
            // wipes the toggles the user just saved.
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

    /// Record the org's canonical CEO `agent_id` for read-time repair.
    ///
    /// Called from `setup_ceo_agent` after every bootstrap so that
    /// [`Self::reconcile_permissions_with_shadow`] can still recognise
    /// this agent as the CEO even after the user renames it. Best-
    /// effort — failures are swallowed because the shadow remains a
    /// cache and the GET-side safety net
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
    /// (older deployments) or silently drops it from the response JSON
    /// on `GET /agents` / `GET /agents/:id`. When that happens,
    /// [`network_agent_to_core`] / `agent_from_network` produce an
    /// `Agent` whose `permissions` bundle is empty (`capabilities: []`,
    /// universe scope) — and every caller that then writes the agent
    /// through [`Self::save_agent_shadow`] clobbers the freshly-saved
    /// local bundle. That's the "toggles survive the session but
    /// vanish after an app restart" regression.
    ///
    /// This helper repairs the common case: if the freshly-fetched
    /// bundle is empty *and* the local shadow has a non-empty bundle,
    /// adopt the shadow's bundle before persisting or returning. The
    /// PUT side already applies the symmetric "trust what we just
    /// sent" rule when the PUT response fails to echo the submitted
    /// bundle, so both round-trips now treat the local shadow as the
    /// fallback source of truth for `permissions` whenever
    /// aura-network drops the column.
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

    // -- network ---------------------------------------------------------------

    /// Get agent from aura-network. Returns error if network is not configured or agent not found.
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
    /// Prefer this over `get_agent_async` on request-scoped code paths:
    /// it avoids reading `SettingsStore::get_jwt()` (a shared in-memory
    /// cache that can race when multiple users hit the server), ensures
    /// the target agent is resolved with the **caller's** credentials,
    /// and still updates the local shadow on success so subsequent
    /// offline / fallback reads work. A `NotFound` upstream is mapped
    /// to `AgentError::NotFound`; other network failures surface as
    /// `AgentError::Network` so callers can distinguish "agent doesn't
    /// exist" from "aura-network is flaky".
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

// ---------------------------------------------------------------------------
// AgentInstanceService – project-level agent instances (aura-storage)
//
// Merges three data sources when returning AgentInstance:
//   1. Execution state from aura-storage (status, model, tokens, timestamps)
//   2. Config from aura-network (agent template; name, role, personality, etc.) when available
//   3. Volatile runtime state from in-memory map (current_task_id, current_session_id)
// ---------------------------------------------------------------------------

pub struct AgentInstanceService {
    store: Arc<SettingsStore>,
    storage_client: Option<Arc<StorageClient>>,
    network_client: Option<Arc<aura_os_network::NetworkClient>>,
    runtime_state: RuntimeAgentStateMap,
}

impl AgentInstanceService {
    pub fn new(
        store: Arc<SettingsStore>,
        storage_client: Option<Arc<StorageClient>>,
        runtime_state: RuntimeAgentStateMap,
        network_client: Option<Arc<aura_os_network::NetworkClient>>,
    ) -> Self {
        Self {
            store,
            storage_client,
            network_client,
            runtime_state,
        }
    }

    fn require_storage(&self) -> Result<&Arc<StorageClient>, AgentError> {
        self.storage_client
            .as_ref()
            .ok_or_else(|| AgentError::Parse("aura-storage is not configured".into()))
    }

    fn get_jwt(&self) -> Result<String, AgentError> {
        self.store.get_jwt().ok_or(AgentError::NoSession)
    }

    /// Resolve agent config from aura-network only. Returns None if network is unavailable or agent not found.
    async fn resolve_agent_async(&self, agent_id_str: &str) -> Option<Agent> {
        let runtime_config_service = AgentService {
            store: self.store.clone(),
            network_client: self.network_client.clone(),
        };
        if let Some(client) = self.network_client.as_ref() {
            if let Ok(jwt) = self.get_jwt() {
                if let Ok(net) = client.get_agent(agent_id_str, &jwt).await {
                    let mut agent = network_agent_to_core(&net);
                    let _ = runtime_config_service.apply_runtime_config(&mut agent);
                    return Some(agent);
                }
            }
        }

        let agent_id = agent_id_str.parse::<AgentId>().ok()?;
        runtime_config_service.get_agent_local(&agent_id).ok()
    }

    async fn resolve_agent_for_project_agent(
        &self,
        spa: &aura_os_storage::StorageProjectAgent,
    ) -> Option<Agent> {
        let runtime_config_service = AgentService {
            store: self.store.clone(),
            network_client: self.network_client.clone(),
        };
        let agent_id = spa.agent_id.as_deref()?;

        if let Some(agent) = self.resolve_agent_async(agent_id).await {
            return Some(agent);
        }

        let parsed_agent_id = agent_id.parse::<AgentId>().ok()?;
        let runtime_config = runtime_config_service
            .load_agent_runtime_config(&parsed_agent_id)
            .ok()
            .flatten()?;

        synthesize_agent_from_project_agent(spa, &runtime_config)
    }

    async fn persisted_status(
        &self,
        agent_instance_id: &AgentInstanceId,
    ) -> Result<AgentStatus, AgentError> {
        let storage = self.require_storage()?;
        let jwt = self.get_jwt()?;
        let spa = storage
            .get_project_agent(&agent_instance_id.to_string(), &jwt)
            .await
            .map_err(|e| match &e {
                aura_os_storage::StorageError::Server { status: 404, .. } => AgentError::NotFound,
                _ => AgentError::Storage(e),
            })?;
        Ok(spa
            .status
            .as_deref()
            .map(parse_agent_status)
            .unwrap_or(AgentStatus::Idle))
    }

    pub async fn create_instance_from_agent(
        &self,
        project_id: &ProjectId,
        agent: &Agent,
    ) -> Result<AgentInstance, AgentError> {
        let storage = self.require_storage()?;
        let jwt = self.get_jwt()?;
        let req = aura_os_storage::CreateProjectAgentRequest {
            agent_id: agent.agent_id.to_string(),
            name: agent.name.clone(),
            org_id: None,
            role: Some(agent.role.clone()),
            personality: Some(agent.personality.clone()),
            system_prompt: Some(agent.system_prompt.clone()),
            skills: Some(agent.skills.clone()),
            icon: agent.icon.clone(),
            harness: None,
            permissions: Some(agent.permissions.clone()),
            intent_classifier: agent.intent_classifier.clone(),
        };
        let spa = storage
            .create_project_agent(&project_id.to_string(), &jwt, &req)
            .await?;
        Ok(merge_agent_instance(&spa, Some(agent), None))
    }

    pub async fn get_instance(
        &self,
        _project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
    ) -> Result<AgentInstance, AgentError> {
        let storage = self.require_storage()?;
        let jwt = self.get_jwt()?;
        let spa = storage
            .get_project_agent(&agent_instance_id.to_string(), &jwt)
            .await
            .map_err(|e| match &e {
                aura_os_storage::StorageError::Server { status: 404, .. } => AgentError::NotFound,
                _ => AgentError::Storage(e),
            })?;
        let agent = self.resolve_agent_for_project_agent(&spa).await;
        let runtime_map = self.runtime_state.lock().await;
        let runtime = runtime_map.get(agent_instance_id);
        Ok(merge_agent_instance(&spa, agent.as_ref(), runtime))
    }

    pub async fn list_instances(
        &self,
        project_id: &ProjectId,
    ) -> Result<Vec<AgentInstance>, AgentError> {
        let storage = self.require_storage()?;
        let jwt = self.get_jwt()?;
        let spas = storage
            .list_project_agents(&project_id.to_string(), &jwt)
            .await?;
        let runtime_map = self.runtime_state.lock().await;
        let mut instances = Vec::with_capacity(spas.len());
        for spa in &spas {
            let agent = self.resolve_agent_for_project_agent(spa).await;
            let aiid = spa.id.parse::<AgentInstanceId>().ok();
            let runtime = aiid.and_then(|id| runtime_map.get(&id));
            instances.push(merge_agent_instance(spa, agent.as_ref(), runtime));
        }
        Ok(instances)
    }

    pub async fn update_status(
        &self,
        agent_instance_id: &AgentInstanceId,
        new_status: AgentStatus,
    ) -> Result<(), AgentError> {
        let storage = self.require_storage()?;
        let jwt = self.get_jwt()?;
        let status_str = match new_status {
            AgentStatus::Idle => "idle",
            AgentStatus::Working => "working",
            AgentStatus::Blocked => "blocked",
            AgentStatus::Stopped => "stopped",
            AgentStatus::Error => "error",
            AgentStatus::Archived => "archived",
        };
        let req = aura_os_storage::UpdateProjectAgentRequest {
            status: status_str.to_string(),
        };
        storage
            .update_project_agent_status(&agent_instance_id.to_string(), &jwt, &req)
            .await?;
        Ok(())
    }

    pub async fn delete_instance(
        &self,
        agent_instance_id: &AgentInstanceId,
    ) -> Result<(), AgentError> {
        let storage = self.require_storage()?;
        let jwt = self.get_jwt()?;
        storage
            .delete_project_agent(&agent_instance_id.to_string(), &jwt)
            .await
            .map_err(|e| match &e {
                aura_os_storage::StorageError::Server { status: 404, .. } => AgentError::NotFound,
                _ => AgentError::Storage(e),
            })?;
        self.runtime_state.lock().await.remove(agent_instance_id);
        Ok(())
    }

    pub async fn start_working(
        &self,
        _project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
        task_id: &TaskId,
        session_id: &SessionId,
    ) -> Result<(), AgentError> {
        self.update_status(agent_instance_id, AgentStatus::Working)
            .await?;
        self.runtime_state.lock().await.insert(
            *agent_instance_id,
            RuntimeAgentState {
                current_task_id: Some(*task_id),
                current_session_id: Some(*session_id),
            },
        );
        Ok(())
    }

    pub async fn finish_working(
        &self,
        _project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
    ) -> Result<(), AgentError> {
        if self.persisted_status(agent_instance_id).await? != AgentStatus::Archived {
            self.update_status(agent_instance_id, AgentStatus::Idle)
                .await?;
        }
        self.runtime_state.lock().await.remove(agent_instance_id);
        Ok(())
    }

    pub fn validate_transition(
        current: AgentStatus,
        target: AgentStatus,
    ) -> Result<(), AgentError> {
        let legal = matches!(
            (current, target),
            (AgentStatus::Idle, AgentStatus::Working)
                | (AgentStatus::Working, AgentStatus::Idle)
                | (AgentStatus::Working, AgentStatus::Blocked)
                | (AgentStatus::Working, AgentStatus::Error)
                | (AgentStatus::Working, AgentStatus::Stopped)
                | (AgentStatus::Blocked, AgentStatus::Working)
                | (AgentStatus::Idle, AgentStatus::Stopped)
                | (AgentStatus::Stopped, AgentStatus::Idle)
                | (AgentStatus::Error, AgentStatus::Idle)
                | (_, AgentStatus::Archived)
        );
        if legal {
            Ok(())
        } else {
            Err(AgentError::IllegalTransition { current, target })
        }
    }
}

fn synthesize_agent_from_project_agent(
    spa: &aura_os_storage::StorageProjectAgent,
    config: &AgentRuntimeConfig,
) -> Option<Agent> {
    let agent_id = spa.agent_id.as_deref()?.parse::<AgentId>().ok()?;
    let auth_source = aura_os_core::effective_auth_source(
        &config.adapter_type,
        Some(config.auth_source.as_str()),
        config.integration_id.as_deref(),
    );
    let machine_type = if config.environment == "swarm_microvm" {
        "remote".to_string()
    } else {
        "local".to_string()
    };

    Some(Agent {
        agent_id,
        user_id: String::new(),
        org_id: spa.org_id.as_deref().and_then(|value| value.parse().ok()),
        name: spa.name.clone().unwrap_or_default(),
        role: spa.role.clone().unwrap_or_default(),
        personality: spa.personality.clone().unwrap_or_default(),
        system_prompt: spa.system_prompt.clone().unwrap_or_default(),
        skills: spa.skills.clone().unwrap_or_default(),
        icon: spa.icon.clone(),
        machine_type,
        adapter_type: config.adapter_type.clone(),
        environment: config.environment.clone(),
        auth_source,
        integration_id: config.integration_id.clone(),
        default_model: config.default_model.clone(),
        vm_id: None,
        network_agent_id: None,
        profile_id: None,
        tags: Vec::new(),
        is_pinned: false,
        listing_status: Default::default(),
        expertise: Vec::new(),
        jobs: 0,
        revenue_usd: 0.0,
        reputation: 0.0,
        local_workspace_path: None,
        permissions: AgentPermissions::empty(),
        intent_classifier: None,
        created_at: parse_dt(&spa.created_at),
        updated_at: parse_dt(&spa.updated_at),
    })
}

// ---------------------------------------------------------------------------
// StorageProjectAgent -> AgentInstance merge (three-source)
// ---------------------------------------------------------------------------

pub fn parse_agent_status(s: &str) -> AgentStatus {
    match s {
        "idle" => AgentStatus::Idle,
        "working" => AgentStatus::Working,
        "blocked" => AgentStatus::Blocked,
        "stopped" => AgentStatus::Stopped,
        "error" => AgentStatus::Error,
        "archived" => AgentStatus::Archived,
        _ => AgentStatus::Idle,
    }
}

/// Merge three sources into a single `AgentInstance`:
/// - `spa`: execution state from aura-storage (status, model, tokens, timestamps)
/// - `agent`: config from aura-network (agent template; name, role, personality, etc.) when available;
///   otherwise falls back to storage project-agent fields.
/// - `runtime`: volatile in-memory state (current_task_id, current_session_id)
pub fn merge_agent_instance(
    spa: &aura_os_storage::StorageProjectAgent,
    agent: Option<&Agent>,
    runtime: Option<&RuntimeAgentState>,
) -> AgentInstance {
    AgentInstance {
        agent_instance_id: spa.id.parse().unwrap_or_else(|_| AgentInstanceId::new()),
        project_id: spa
            .project_id
            .as_deref()
            .unwrap_or("")
            .parse()
            .unwrap_or_else(|_| ProjectId::new()),
        agent_id: agent
            .map(|a| a.agent_id)
            .or_else(|| spa.agent_id.as_deref().and_then(|s: &str| s.parse().ok()))
            .unwrap_or_default(),
        org_id: agent.and_then(|a| a.org_id),
        name: agent
            .map(|a| a.name.clone())
            .unwrap_or_else(|| spa.name.clone().unwrap_or_default()),
        role: agent
            .map(|a| a.role.clone())
            .unwrap_or_else(|| spa.role.clone().unwrap_or_default()),
        personality: agent
            .map(|a| a.personality.clone())
            .unwrap_or_else(|| spa.personality.clone().unwrap_or_default()),
        system_prompt: agent
            .map(|a| a.system_prompt.clone())
            .unwrap_or_else(|| spa.system_prompt.clone().unwrap_or_default()),
        skills: agent
            .map(|a| a.skills.clone())
            .unwrap_or_else(|| spa.skills.clone().unwrap_or_default()),
        icon: agent
            .and_then(|a| a.icon.clone())
            .or_else(|| spa.icon.clone()),
        machine_type: agent
            .map(|a| a.machine_type.clone())
            .unwrap_or_else(|| "local".to_string()),
        adapter_type: agent
            .map(|a| a.adapter_type.clone())
            .unwrap_or_else(|| "aura_harness".to_string()),
        environment: agent
            .map(|a| a.environment.clone())
            .unwrap_or_else(|| "local_host".to_string()),
        auth_source: agent
            .map(|a| {
                aura_os_core::effective_auth_source(
                    &a.adapter_type,
                    Some(a.auth_source.as_str()),
                    a.integration_id.as_deref(),
                )
            })
            .unwrap_or_else(|| "aura_managed".to_string()),
        integration_id: agent.and_then(|a| a.integration_id.clone()),
        default_model: agent.and_then(|a| a.default_model.clone()),
        workspace_path: None,
        status: spa
            .status
            .as_deref()
            .map(parse_agent_status)
            .unwrap_or(AgentStatus::Idle),
        current_task_id: runtime.and_then(|r| r.current_task_id),
        current_session_id: runtime.and_then(|r| r.current_session_id),
        total_input_tokens: spa.total_input_tokens.unwrap_or(0),
        total_output_tokens: spa.total_output_tokens.unwrap_or(0),
        model: spa.model.clone(),
        // Prefer the live parent Agent's permissions when available so
        // template edits propagate to fresh sessions. Fall back to the
        // snapshot persisted on the storage record so offline / 404
        // paths don't silently drop to an empty bundle.
        permissions: agent
            .map(|a| a.permissions.clone())
            .or_else(|| spa.permissions.clone())
            .unwrap_or_default(),
        intent_classifier: agent
            .and_then(|a| a.intent_classifier.clone())
            .or_else(|| spa.intent_classifier.clone()),
        created_at: parse_dt(&spa.created_at),
        updated_at: parse_dt(&spa.updated_at),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_os_storage::StorageProjectAgent;

    #[test]
    fn synthesize_agent_from_project_agent_preserves_remote_runtime() {
        let agent_id = AgentId::new();
        let org_id = OrgId::new();
        let spa = StorageProjectAgent {
            id: AgentInstanceId::new().to_string(),
            project_id: Some(ProjectId::new().to_string()),
            org_id: Some(org_id.to_string()),
            agent_id: Some(agent_id.to_string()),
            name: Some("Atlas".to_string()),
            role: Some("Engineer".to_string()),
            personality: Some(String::new()),
            system_prompt: Some("Help with the project.".to_string()),
            skills: Some(vec!["search".to_string()]),
            icon: None,
            harness: None,
            status: Some("idle".to_string()),
            model: None,
            total_input_tokens: None,
            total_output_tokens: None,
            permissions: None,
            intent_classifier: None,
            created_at: None,
            updated_at: None,
        };
        let runtime = AgentRuntimeConfig {
            adapter_type: "aura_harness".to_string(),
            environment: "swarm_microvm".to_string(),
            auth_source: "aura_managed".to_string(),
            integration_id: None,
            default_model: Some("claude-sonnet".to_string()),
        };

        let agent = synthesize_agent_from_project_agent(&spa, &runtime)
            .expect("runtime fallback should synthesize an agent");

        assert_eq!(agent.agent_id, agent_id);
        assert_eq!(agent.org_id, Some(org_id));
        assert_eq!(agent.name, "Atlas");
        assert_eq!(agent.machine_type, "remote");
        assert_eq!(agent.environment, "swarm_microvm");
        assert_eq!(agent.auth_source, "aura_managed");
        assert_eq!(agent.default_model.as_deref(), Some("claude-sonnet"));
    }

    fn minimal_network_agent(name: &str, role: Option<&str>) -> NetworkAgent {
        NetworkAgent {
            id: AgentId::new().to_string(),
            name: name.to_string(),
            role: role.map(str::to_string),
            personality: None,
            system_prompt: None,
            skills: None,
            icon: None,
            harness: None,
            machine_type: None,
            vm_id: None,
            user_id: "u1".to_string(),
            org_id: Some(OrgId::new().to_string()),
            profile_id: None,
            tags: None,
            listing_status: None,
            expertise: None,
            jobs: None,
            revenue_usd: None,
            reputation: None,
            permissions: AgentPermissions::empty(),
            intent_classifier: None,
            created_at: None,
            updated_at: None,
        }
    }

    #[test]
    fn network_agent_to_core_repairs_empty_ceo_permissions() {
        // Regression for the CEO-has-no-tools bug: this converter is
        // hit by the project-agent-instance chat path. When the
        // network record has empty permissions but the agent is
        // clearly the CEO (name + role both "CEO"), we must return
        // the canonical preset so `build_cross_agent_tools` takes the
        // CEO branch and emits the full manifest.
        let net = minimal_network_agent("CEO", Some("CEO"));
        let agent = network_agent_to_core(&net);
        assert!(
            agent.permissions.is_ceo_preset(),
            "CEO with empty network permissions must be promoted to the preset on read"
        );
    }

    #[test]
    fn network_agent_to_core_leaves_non_ceo_empty_permissions_alone() {
        // The safety net is intentionally narrow: a non-CEO agent with
        // empty permissions stays empty. Prevents other agents from
        // silently picking up the CEO capability bundle.
        let net = minimal_network_agent("Atlas", Some("Engineer"));
        let agent = network_agent_to_core(&net);
        assert!(!agent.permissions.is_ceo_preset());
        assert!(agent.permissions.capabilities.is_empty());
    }

    // -----------------------------------------------------------------
    // save_agent_shadows_if_changed — batched, diff-only flush. This is
    // the hot-path fix behind the slow `GET /api/agents` response; the
    // tests below pin the contract that previously caused N full
    // `settings.json` rewrites per list:
    //   1. unchanged inputs produce zero writes,
    //   2. changed inputs produce exactly one `persist_cf` call
    //      regardless of how many rows changed.
    // -----------------------------------------------------------------

    fn sample_agent(name: &str) -> Agent {
        let now = chrono::Utc::now();
        Agent {
            agent_id: AgentId::new(),
            user_id: "u1".into(),
            org_id: None,
            name: name.into(),
            role: "dev".into(),
            personality: String::new(),
            system_prompt: String::new(),
            skills: vec![],
            icon: None,
            machine_type: "local".into(),
            adapter_type: "aura_harness".into(),
            environment: "local_host".into(),
            auth_source: "aura_managed".into(),
            integration_id: None,
            default_model: None,
            vm_id: None,
            network_agent_id: None,
            profile_id: None,
            tags: vec![],
            is_pinned: false,
            listing_status: Default::default(),
            expertise: vec![],
            jobs: 0,
            revenue_usd: 0.0,
            reputation: 0.0,
            local_workspace_path: None,
            permissions: AgentPermissions::empty(),
            intent_classifier: None,
            created_at: now,
            updated_at: now,
        }
    }

    fn open_service() -> (AgentService, tempfile::TempDir) {
        let dir = tempfile::TempDir::new().unwrap();
        let store = Arc::new(SettingsStore::open(dir.path()).unwrap());
        (AgentService::new(store, None), dir)
    }

    #[test]
    fn save_agent_shadows_if_changed_writes_new_and_changed_rows_once() {
        let (service, dir) = open_service();
        let a = sample_agent("Atlas");
        let b = sample_agent("Beta");

        // First call: both rows are new, so both get batched into one
        // write.
        let written = service
            .save_agent_shadows_if_changed(&[&a, &b])
            .expect("initial batched save");
        assert_eq!(written, 2, "both new shadows should be queued");

        // Sanity-check that both rows actually round-trip.
        let a_round = service.get_agent_local(&a.agent_id).unwrap();
        let b_round = service.get_agent_local(&b.agent_id).unwrap();
        assert_eq!(a_round.name, "Atlas");
        assert_eq!(b_round.name, "Beta");

        // Second call with identical inputs must not touch the disk.
        // We assert that by snapshotting the `settings.json` mtime and
        // confirming it is unchanged afterwards — if
        // `save_agent_shadows_if_changed` had fallen back to
        // `save_agent_shadow`-per-row or unconditionally called
        // `write_batch`, `persist_cf` would rewrite the file and bump
        // the mtime.
        let settings_path = dir.path().join("settings.json");
        let mtime_before = std::fs::metadata(&settings_path)
            .unwrap()
            .modified()
            .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));

        let written = service
            .save_agent_shadows_if_changed(&[&a, &b])
            .expect("second batched save");
        assert_eq!(written, 0, "unchanged inputs must not trigger writes");

        let mtime_after = std::fs::metadata(&settings_path)
            .unwrap()
            .modified()
            .unwrap();
        assert_eq!(
            mtime_before, mtime_after,
            "settings.json must not be rewritten when nothing changed"
        );
    }

    #[test]
    fn save_agent_shadows_if_changed_only_writes_diffs() {
        let (service, _dir) = open_service();
        let a = sample_agent("Atlas");
        let mut b = sample_agent("Beta");

        service
            .save_agent_shadows_if_changed(&[&a, &b])
            .expect("seed both shadows");

        // Mutate only `b`.
        b.name = "Beta Prime".into();
        b.updated_at = chrono::Utc::now();
        let written = service
            .save_agent_shadows_if_changed(&[&a, &b])
            .expect("flush only the diff");
        assert_eq!(written, 1, "only the mutated row should be written");

        let b_round = service.get_agent_local(&b.agent_id).unwrap();
        assert_eq!(b_round.name, "Beta Prime");
    }

    #[test]
    fn save_agent_shadows_if_changed_noop_on_empty_input() {
        let (service, _dir) = open_service();
        let written = service.save_agent_shadows_if_changed(&[]).unwrap();
        assert_eq!(written, 0);
    }

    // -----------------------------------------------------------------
    // reconcile_permissions_with_shadow — GET-side counterpart to the
    // PUT-side reconciliation in `crud::update_agent`. Pins the
    // contract that an empty network response never clobbers a
    // non-empty shadow, while still letting a genuine "clear all
    // toggles" roundtrip flow through.
    // -----------------------------------------------------------------

    fn agent_with_permissions(name: &str, perms: AgentPermissions) -> Agent {
        let mut a = sample_agent(name);
        a.permissions = perms;
        a
    }

    #[test]
    fn reconcile_prefers_shadow_when_network_response_drops_permissions() {
        let (service, _dir) = open_service();
        let mut seeded = agent_with_permissions(
            "Atlas",
            AgentPermissions {
                scope: AgentScope::default(),
                capabilities: vec![Capability::SpawnAgent, Capability::ReadAgent],
            },
        );
        service
            .save_agent_shadow(&seeded)
            .expect("seed shadow with non-empty permissions");

        // Simulate a fresh network response for the same agent whose
        // `permissions` column came back empty.
        seeded.permissions = AgentPermissions::empty();
        service.reconcile_permissions_with_shadow(&mut seeded);

        assert!(
            !seeded.permissions.is_empty(),
            "empty network permissions must be rescued from the shadow"
        );
        assert!(seeded
            .permissions
            .capabilities
            .contains(&Capability::SpawnAgent));
        assert!(seeded
            .permissions
            .capabilities
            .contains(&Capability::ReadAgent));
    }

    #[test]
    fn reconcile_is_noop_when_network_response_has_permissions() {
        let (service, _dir) = open_service();
        let mut seeded = agent_with_permissions(
            "Atlas",
            AgentPermissions {
                scope: AgentScope::default(),
                capabilities: vec![Capability::SpawnAgent],
            },
        );
        service.save_agent_shadow(&seeded).unwrap();

        // Fresh response has a DIFFERENT non-empty bundle — the
        // network is authoritative in this case.
        seeded.permissions = AgentPermissions {
            scope: AgentScope::default(),
            capabilities: vec![Capability::PostToFeed],
        };
        service.reconcile_permissions_with_shadow(&mut seeded);

        assert_eq!(
            seeded.permissions.capabilities,
            vec![Capability::PostToFeed]
        );
    }

    #[test]
    fn reconcile_allows_intentional_clear_when_shadow_is_also_empty() {
        // When the user deliberately toggles everything off, both the
        // shadow and the next network fetch are empty. Reconciliation
        // must NOT synthesize permissions in that case.
        let (service, _dir) = open_service();
        let seeded = agent_with_permissions("Atlas", AgentPermissions::empty());
        service.save_agent_shadow(&seeded).unwrap();

        let mut fetched = seeded.clone();
        service.reconcile_permissions_with_shadow(&mut fetched);
        assert!(fetched.permissions.is_empty());
    }

    #[test]
    fn reconcile_is_noop_when_no_shadow_exists() {
        let (service, _dir) = open_service();
        let mut fresh = agent_with_permissions("Atlas", AgentPermissions::empty());
        service.reconcile_permissions_with_shadow(&mut fresh);
        assert!(fresh.permissions.is_empty());
    }

    // -----------------------------------------------------------------
    // save_agent_shadow empty-permissions guard. The single-row and
    // batched writers must both refuse to overwrite a non-empty stored
    // permissions bundle with an empty one, regardless of whether the
    // caller remembered to `reconcile_permissions_with_shadow` first.
    // -----------------------------------------------------------------

    #[test]
    fn save_agent_shadow_preserves_non_empty_permissions_when_input_is_empty() {
        let (service, _dir) = open_service();
        let seeded = agent_with_permissions(
            "Atlas",
            AgentPermissions {
                scope: AgentScope::default(),
                capabilities: vec![Capability::SpawnAgent, Capability::ReadAgent],
            },
        );
        service.save_agent_shadow(&seeded).unwrap();

        // Simulate a handler that forgot to reconcile and now writes
        // an empty-permissions projection (the classic
        // "aura-network PUT response dropped the column" scenario).
        let mut clobbered = seeded.clone();
        clobbered.name = "Atlas Prime".into();
        clobbered.permissions = AgentPermissions::empty();
        service.save_agent_shadow(&clobbered).unwrap();

        let reloaded = service.get_agent_local(&seeded.agent_id).unwrap();
        assert_eq!(
            reloaded.name, "Atlas Prime",
            "non-permissions fields still flow through"
        );
        assert!(
            !reloaded.permissions.is_empty(),
            "stored permissions must survive an empty-input write"
        );
        assert!(reloaded
            .permissions
            .capabilities
            .contains(&Capability::SpawnAgent));
    }

    #[test]
    fn save_agent_shadows_if_changed_preserves_non_empty_permissions_on_empty_input() {
        let (service, _dir) = open_service();
        let seeded = agent_with_permissions(
            "Atlas",
            AgentPermissions {
                scope: AgentScope::default(),
                capabilities: vec![Capability::SpawnAgent],
            },
        );
        service.save_agent_shadow(&seeded).unwrap();

        let mut clobbered = seeded.clone();
        clobbered.name = "Atlas Prime".into();
        clobbered.permissions = AgentPermissions::empty();
        service
            .save_agent_shadows_if_changed(&[&clobbered])
            .expect("batched save with empty-input guard");

        let reloaded = service.get_agent_local(&seeded.agent_id).unwrap();
        assert_eq!(reloaded.name, "Atlas Prime");
        assert!(!reloaded.permissions.is_empty());
        assert!(reloaded
            .permissions
            .capabilities
            .contains(&Capability::SpawnAgent));
    }

    #[test]
    fn save_agent_shadow_allows_intentional_clear_when_shadow_also_empty() {
        let (service, _dir) = open_service();
        let seeded = agent_with_permissions("Atlas", AgentPermissions::empty());
        service.save_agent_shadow(&seeded).unwrap();

        let mut cleared = seeded.clone();
        cleared.permissions = AgentPermissions::empty();
        service.save_agent_shadow(&cleared).unwrap();

        let reloaded = service.get_agent_local(&seeded.agent_id).unwrap();
        assert!(reloaded.permissions.is_empty());
    }

    // -----------------------------------------------------------------
    // CEO agent_id repair. When both the network response AND the
    // local shadow have empty permissions but the agent_id matches
    // the one stamped by `setup_ceo_agent`, reconciliation restores
    // the canonical CEO preset. This covers users who renamed the
    // CEO (e.g. to "Orion") and whose shadow was already corrupted
    // by the pre-fix PUT flow.
    // -----------------------------------------------------------------

    #[test]
    fn reconcile_restores_ceo_preset_by_agent_id_when_shadow_also_empty() {
        let (service, _dir) = open_service();
        let mut ceo = agent_with_permissions("Orion", AgentPermissions::empty());
        ceo.role = "CEO".into();
        service.remember_ceo_agent_id(&ceo.agent_id);

        // No shadow, empty network response — only the agent_id
        // stamp can rescue us.
        service.reconcile_permissions_with_shadow(&mut ceo);
        assert!(
            ceo.permissions.is_ceo_preset(),
            "bootstrapped CEO agent_id must restore the preset"
        );
    }

    #[test]
    fn reconcile_does_not_touch_other_agents_when_ceo_id_stamped() {
        let (service, _dir) = open_service();
        let ceo_id = AgentId::new();
        service.remember_ceo_agent_id(&ceo_id);

        // A different agent with empty permissions should remain
        // empty — we only repair the exact bootstrapped agent_id.
        let mut other = agent_with_permissions("Sidekick", AgentPermissions::empty());
        service.reconcile_permissions_with_shadow(&mut other);
        assert!(other.permissions.is_empty());
    }

    #[test]
    fn bootstrapped_ceo_agent_id_round_trips() {
        let (service, _dir) = open_service();
        assert!(service.bootstrapped_ceo_agent_id().is_none());

        let id = AgentId::new();
        service.remember_ceo_agent_id(&id);
        assert_eq!(service.bootstrapped_ceo_agent_id(), Some(id));
    }
}
