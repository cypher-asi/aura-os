//! Project-level agent instances backed by `aura-storage`.
//!
//! Merges three data sources when returning [`AgentInstance`]:
//!   1. Execution state from aura-storage (status, model, tokens, timestamps)
//!   2. Config from aura-network (agent template; name, role, personality, etc.) when available
//!   3. Volatile runtime state from in-memory map (current_task_id, current_session_id)

use std::sync::Arc;

use aura_os_core::{
    Agent, AgentId, AgentInstance, AgentInstanceId, AgentInstanceRole, AgentStatus, JwtProvider,
    ProjectId, RuntimeAgentState, SessionId, TaskId,
};
use aura_os_storage::StorageClient;
use aura_os_store::SettingsStore;

use crate::convert::{
    network_agent_to_core, parse_agent_status, synthesize_agent_from_project_agent,
};
use crate::errors::AgentError;
use crate::merge::merge_agent_instance;
use crate::service::AgentService;
use crate::RuntimeAgentStateMap;

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

    fn agent_service(&self) -> AgentService {
        AgentService::new(self.store.clone(), self.network_client.clone())
    }

    /// Resolve agent config from aura-network only. Returns None if
    /// network is unavailable or agent not found.
    async fn resolve_agent_async(&self, agent_id_str: &str) -> Option<Agent> {
        let agent_service = self.agent_service();
        if let Some(client) = self.network_client.as_ref() {
            if let Ok(jwt) = self.get_jwt() {
                if let Ok(net) = client.get_agent(agent_id_str, &jwt).await {
                    let mut agent = network_agent_to_core(&net);
                    let _ = agent_service.apply_runtime_config(&mut agent);
                    return Some(agent);
                }
            }
        }

        let agent_id = agent_id_str.parse::<AgentId>().ok()?;
        agent_service.get_agent_local(&agent_id).ok()
    }

    async fn resolve_agent_for_project_agent(
        &self,
        spa: &aura_os_storage::StorageProjectAgent,
    ) -> Option<Agent> {
        let agent_service = self.agent_service();
        let agent_id = spa.agent_id.as_deref()?;

        if let Some(agent) = self.resolve_agent_async(agent_id).await {
            return Some(agent);
        }

        let parsed_agent_id = agent_id.parse::<AgentId>().ok()?;
        let runtime_config = agent_service
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
        self.create_instance_from_agent_with_role(project_id, agent, AgentInstanceRole::Chat)
            .await
    }

    /// Pick an existing project-agent instance to use as the
    /// template for a fresh ad-hoc task run.
    pub async fn pick_run_template(
        &self,
        project_id: &ProjectId,
    ) -> Result<AgentInstance, AgentError> {
        let instances = self.list_instances(project_id).await?;
        pick_run_template_from_instances(&instances)
            .cloned()
            .ok_or(AgentError::NotFound)
    }

    /// Resolve or lazily create the project's canonical `Loop`
    /// instance for automation-loop dispatch.
    pub async fn ensure_default_loop_instance(
        &self,
        project_id: &ProjectId,
    ) -> Result<AgentInstance, AgentError> {
        let instances = self.list_instances(project_id).await?;
        if let Some(existing) = instances
            .iter()
            .find(|i| i.instance_role == AgentInstanceRole::Loop)
        {
            return Ok(existing.clone());
        }
        let template = pick_loop_template_from_instances(&instances)
            .cloned()
            .ok_or(AgentError::NotFound)?;
        let agent_id_str = template.agent_id.to_string();
        let agent = self
            .resolve_agent_async(&agent_id_str)
            .await
            .ok_or_else(|| {
                AgentError::Parse(
                    "could not resolve agent template for default loop instance".into(),
                )
            })?;
        self.create_instance_from_agent_with_role(project_id, &agent, AgentInstanceRole::Loop)
            .await
    }

    /// Allocate a fresh ephemeral `Executor` instance for an ad-hoc
    /// task run.
    pub async fn spawn_ephemeral_executor(
        &self,
        project_id: &ProjectId,
        template: &AgentInstance,
    ) -> Result<AgentInstance, AgentError> {
        let agent_id_str = template.agent_id.to_string();
        let agent = self
            .resolve_agent_async(&agent_id_str)
            .await
            .ok_or_else(|| {
                AgentError::Parse("could not resolve agent template for ephemeral executor".into())
            })?;
        self.create_instance_from_agent_with_role(project_id, &agent, AgentInstanceRole::Executor)
            .await
    }

    /// Sweep orphaned `Executor`-role rows that survived a previous
    /// run. Best-effort: row-level delete failures are logged and
    /// skipped so one transient storage error does not poison the
    /// whole sweep.
    pub async fn purge_executor_instances_in_project(
        &self,
        project_id: &ProjectId,
    ) -> Result<usize, AgentError> {
        let instances = self.list_instances(project_id).await?;
        let mut purged = 0usize;
        for inst in instances
            .iter()
            .filter(|i| i.instance_role == AgentInstanceRole::Executor)
        {
            match self.delete_instance(&inst.agent_instance_id).await {
                Ok(()) => purged += 1,
                Err(AgentError::NotFound) => {
                    purged += 1;
                }
                Err(error) => {
                    tracing::warn!(
                        agent_instance_id = %inst.agent_instance_id,
                        project_id = %project_id,
                        %error,
                        "purge_executor_instances: failed to delete orphan executor row"
                    );
                }
            }
        }
        Ok(purged)
    }

    /// Create a project-agent binding pinned to a specific functional
    /// role (chat target, automation loop target, or ephemeral
    /// executor).
    pub async fn create_instance_from_agent_with_role(
        &self,
        project_id: &ProjectId,
        agent: &Agent,
        role: AgentInstanceRole,
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
            instance_role: Some(role.as_wire_str().to_string()),
            permissions: Some(agent.permissions.clone()),
            intent_classifier: agent.intent_classifier.clone(),
        };
        let spa = storage
            .create_project_agent(&project_id.to_string(), &jwt, &req)
            .await?;
        let mut instance = merge_agent_instance(&spa, Some(agent), None);
        // Older storage backends may not echo unknown columns yet; keep
        // the explicit role requested by this caller.
        instance.instance_role = role;
        Ok(instance)
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

/// Selection order for picking a project's default ad-hoc task run
/// template: `Loop`, then `Chat`, then any non-`Executor`, then the
/// first row as a last resort.
pub fn pick_run_template_from_instances(instances: &[AgentInstance]) -> Option<&AgentInstance> {
    instances
        .iter()
        .find(|i| i.instance_role == AgentInstanceRole::Loop)
        .or_else(|| {
            instances
                .iter()
                .find(|i| i.instance_role == AgentInstanceRole::Chat)
        })
        .or_else(|| {
            instances
                .iter()
                .find(|i| i.instance_role != AgentInstanceRole::Executor)
        })
        .or_else(|| instances.first())
}

/// Selection order for promoting an existing instance to the
/// project's default `Loop` binding.
pub fn pick_loop_template_from_instances(instances: &[AgentInstance]) -> Option<&AgentInstance> {
    instances
        .iter()
        .find(|i| i.instance_role == AgentInstanceRole::Chat)
        .or_else(|| {
            instances
                .iter()
                .find(|i| i.instance_role != AgentInstanceRole::Executor)
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_instance_with_role(role: AgentInstanceRole) -> AgentInstance {
        AgentInstance {
            agent_instance_id: AgentInstanceId::new(),
            project_id: ProjectId::new(),
            agent_id: AgentId::new(),
            org_id: None,
            name: "Atlas".to_string(),
            role: "Engineer".to_string(),
            personality: String::new(),
            system_prompt: String::new(),
            skills: Vec::new(),
            icon: None,
            machine_type: "local".to_string(),
            adapter_type: "aura_harness".to_string(),
            environment: "local_host".to_string(),
            auth_source: "aura_managed".to_string(),
            integration_id: None,
            default_model: None,
            workspace_path: None,
            status: AgentStatus::Idle,
            current_task_id: None,
            current_session_id: None,
            instance_role: role,
            total_input_tokens: 0,
            total_output_tokens: 0,
            model: None,
            permissions: Default::default(),
            intent_classifier: None,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        }
    }

    #[test]
    fn pick_run_template_prefers_loop_over_chat_over_other() {
        let chat = make_instance_with_role(AgentInstanceRole::Chat);
        let loop_inst = make_instance_with_role(AgentInstanceRole::Loop);
        let executor = make_instance_with_role(AgentInstanceRole::Executor);

        let all = [chat.clone(), loop_inst.clone(), executor.clone()];
        let pick = pick_run_template_from_instances(&all).expect("at least one instance available");
        assert_eq!(pick.agent_instance_id, loop_inst.agent_instance_id);

        let chat_and_exec = [chat.clone(), executor.clone()];
        let pick =
            pick_run_template_from_instances(&chat_and_exec).expect("chat fallback available");
        assert_eq!(pick.agent_instance_id, chat.agent_instance_id);

        let only_executor = make_instance_with_role(AgentInstanceRole::Executor);
        let executor_only = [only_executor.clone()];
        let pick =
            pick_run_template_from_instances(&executor_only).expect("executor-only fallback");
        assert_eq!(pick.agent_instance_id, only_executor.agent_instance_id);
    }

    #[test]
    fn pick_run_template_returns_none_for_empty_slice() {
        assert!(pick_run_template_from_instances(&[]).is_none());
    }

    #[test]
    fn pick_loop_template_prefers_chat_and_skips_executor() {
        let chat = make_instance_with_role(AgentInstanceRole::Chat);
        let executor = make_instance_with_role(AgentInstanceRole::Executor);

        let chat_and_exec = [chat.clone(), executor.clone()];
        let pick = pick_loop_template_from_instances(&chat_and_exec)
            .expect("chat available as loop template");
        assert_eq!(pick.agent_instance_id, chat.agent_instance_id);

        let executor_only = [make_instance_with_role(AgentInstanceRole::Executor)];
        assert!(pick_loop_template_from_instances(&executor_only).is_none());
    }

    #[test]
    fn pick_loop_template_returns_none_for_empty_slice() {
        assert!(pick_loop_template_from_instances(&[]).is_none());
    }
}
