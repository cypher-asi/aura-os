mod error;
pub use error::AgentError;

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;

use aura_os_core::parse_dt;
use aura_os_core::*;
use aura_os_network::NetworkAgent;
use aura_os_storage::StorageClient;
use aura_os_store::SettingsStore;

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

    /// Persist an agent to the local shadow store.
    pub fn save_agent_shadow(&self, agent: &Agent) -> Result<(), AgentError> {
        let payload = serde_json::to_vec(agent).map_err(|e| AgentError::Parse(e.to_string()))?;
        self.store
            .put_setting(&Self::agent_key(&agent.agent_id), &payload)
            .map_err(AgentError::Store)
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
}
