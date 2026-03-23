#![warn(missing_docs)]

mod error;
pub use error::AgentError;

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;

use aura_os_core::parse_dt;
use aura_os_core::*;
use aura_os_network::NetworkAgent;
use aura_os_storage::StorageClient;
use aura_os_store::RocksStore;

pub type RuntimeAgentStateMap = Arc<Mutex<HashMap<AgentInstanceId, RuntimeAgentState>>>;

/// Convert NetworkAgent to core Agent (no local store).
fn network_agent_to_core(net: &NetworkAgent) -> Agent {
    let agent_id = net.id.parse::<AgentId>().unwrap_or_else(|_| AgentId::new());
    let profile_id: Option<ProfileId> = net.profile_id.as_ref().and_then(|s| s.parse().ok());
    let created_at = parse_dt(&net.created_at);
    let updated_at = parse_dt(&net.updated_at);

    Agent {
        agent_id,
        user_id: net.user_id.clone(),
        name: net.name.clone(),
        role: net.role.clone().unwrap_or_default(),
        personality: net.personality.clone().unwrap_or_default(),
        system_prompt: net.system_prompt.clone().unwrap_or_default(),
        skills: net.skills.clone().unwrap_or_default(),
        icon: net.icon.clone(),
        network_agent_id: net.id.parse().ok(),
        profile_id,
        created_at,
        updated_at,
    }
}

// ---------------------------------------------------------------------------
// AgentService – user-level agent templates (aura-network only)
// ---------------------------------------------------------------------------

pub struct AgentService {
    store: Arc<RocksStore>,
    network_client: Option<Arc<aura_os_network::NetworkClient>>,
}

impl AgentService {
    pub fn new(
        store: Arc<RocksStore>,
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

    /// Get agent from aura-network only. Returns error if network is not configured or agent not found.
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
        Ok(network_agent_to_core(&net))
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
    store: Arc<RocksStore>,
    storage_client: Option<Arc<StorageClient>>,
    network_client: Option<Arc<aura_os_network::NetworkClient>>,
    runtime_state: RuntimeAgentStateMap,
}

impl AgentInstanceService {
    pub fn new(
        store: Arc<RocksStore>,
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
        let client = self.network_client.as_ref()?;
        let jwt = self.get_jwt().ok()?;
        let net = client.get_agent(agent_id_str, &jwt).await.ok()?;
        Some(network_agent_to_core(&net))
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
            role: Some(agent.role.clone()),
            personality: Some(agent.personality.clone()),
            system_prompt: Some(agent.system_prompt.clone()),
            skills: Some(agent.skills.clone()),
            icon: agent.icon.clone(),
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
        let agent = match spa.agent_id.as_deref() {
            Some(aid) => self.resolve_agent_async(aid).await,
            None => None,
        };
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
            let agent = match spa.agent_id.as_deref() {
                Some(aid) => self.resolve_agent_async(aid).await,
                None => None,
            };
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
        self.update_status(agent_instance_id, AgentStatus::Idle)
            .await?;
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
        );
        if legal {
            Ok(())
        } else {
            Err(AgentError::IllegalTransition { current, target })
        }
    }
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
        created_at: parse_dt(&spa.created_at),
        updated_at: parse_dt(&spa.updated_at),
    }
}
