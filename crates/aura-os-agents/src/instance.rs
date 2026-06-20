//! Project-level agent instances backed by `aura-storage`.
//!
//! Merges three data sources when returning [`AgentInstance`]:
//!   1. Execution state from aura-storage (status, model, tokens, timestamps)
//!   2. Config from aura-network (agent template; name, role, personality, etc.) when available
//!   3. Volatile runtime state from in-memory map (current_task_id, current_session_id)

use std::collections::{HashMap, HashSet};
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

/// Settings key holding the storage-independent ledger of
/// system-minted (`Loop` / `Executor`) instance IDs. See
/// [`AgentInstanceService::record_system_instance`].
const SYSTEM_INSTANCE_LEDGER_KEY: &str = "dev_loop/system_instances";

/// Ledger payload: `instance_id -> (project_id, instance_role wire str)`.
/// Stored as plain std types so the crate needs no direct `serde`
/// dependency (the impls come transitively via `serde_json`).
type SystemInstanceLedger = HashMap<String, (String, String)>;

pub struct AgentInstanceService {
    store: Arc<SettingsStore>,
    storage_client: Option<Arc<StorageClient>>,
    network_client: Option<Arc<aura_os_network::NetworkClient>>,
    runtime_state: RuntimeAgentStateMap,
    /// Serializes read-modify-write cycles on the system-instance
    /// ledger so concurrent task runs don't clobber each other's
    /// entries.
    system_ledger_lock: tokio::sync::Mutex<()>,
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
            system_ledger_lock: tokio::sync::Mutex::new(()),
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

    /// Load the system-instance ledger from local settings. A missing
    /// key (first run) or a corrupt blob degrades to an empty ledger
    /// rather than erroring, so a flaky local store never blocks a run.
    fn load_system_instance_ledger(&self) -> SystemInstanceLedger {
        match self.store.get_setting(SYSTEM_INSTANCE_LEDGER_KEY) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|error| {
                tracing::warn!(%error, "system-instance ledger is corrupt; treating as empty");
                SystemInstanceLedger::new()
            }),
            Err(aura_os_store::StoreError::NotFound(_)) => SystemInstanceLedger::new(),
            Err(error) => {
                tracing::warn!(%error, "failed to read system-instance ledger; treating as empty");
                SystemInstanceLedger::new()
            }
        }
    }

    fn save_system_instance_ledger(&self, ledger: &SystemInstanceLedger) {
        match serde_json::to_vec(ledger) {
            Ok(bytes) => {
                if let Err(error) = self.store.put_setting(SYSTEM_INSTANCE_LEDGER_KEY, &bytes) {
                    tracing::warn!(%error, "failed to persist system-instance ledger");
                }
            }
            Err(error) => {
                tracing::warn!(%error, "failed to serialize system-instance ledger");
            }
        }
    }

    /// Record a system-minted (`Loop` / `Executor`) binding so cleanup
    /// and the projects-sidebar filter can identify it even when
    /// `aura-storage` strips the `instance_role` / `source` columns on
    /// `list_project_agents` responses. `Chat` rows are never recorded.
    /// Best-effort: ledger failures only warn so they can't fail a run.
    pub async fn record_system_instance(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
        role: AgentInstanceRole,
    ) {
        if role == AgentInstanceRole::Chat {
            return;
        }
        let _guard = self.system_ledger_lock.lock().await;
        let mut ledger = self.load_system_instance_ledger();
        ledger.insert(
            agent_instance_id.to_string(),
            (project_id.to_string(), role.as_wire_str().to_string()),
        );
        self.save_system_instance_ledger(&ledger);
    }

    /// Drop a binding from the system-instance ledger once its storage
    /// row has been deleted (or confirmed gone). No-op for IDs that
    /// were never recorded.
    async fn forget_system_instance(&self, agent_instance_id: &AgentInstanceId) {
        let key = agent_instance_id.to_string();
        let _guard = self.system_ledger_lock.lock().await;
        let mut ledger = self.load_system_instance_ledger();
        if ledger.remove(&key).is_some() {
            self.save_system_instance_ledger(&ledger);
        }
    }

    /// IDs of every ledger-tracked system instance for a project,
    /// regardless of role. Used to hide infrastructure rows from the
    /// project sidebar even when storage stripped their provenance.
    pub fn system_instance_ids(&self, project_id: &ProjectId) -> HashSet<AgentInstanceId> {
        let target = project_id.to_string();
        self.load_system_instance_ledger()
            .into_iter()
            .filter(|(_, (pid, _))| *pid == target)
            .filter_map(|(id, _)| id.parse::<AgentInstanceId>().ok())
            .collect()
    }

    /// IDs of ledger-tracked `Executor` instances for a project. These
    /// are the ephemeral rows minted per ad-hoc task run that the
    /// startup janitor must reclaim by ID (storage-independent).
    fn ledger_executor_ids(&self, project_id: &ProjectId) -> Vec<AgentInstanceId> {
        let target = project_id.to_string();
        let executor_wire = AgentInstanceRole::Executor.as_wire_str();
        self.load_system_instance_ledger()
            .into_iter()
            .filter(|(_, (pid, role))| *pid == target && role == executor_wire)
            .filter_map(|(id, _)| id.parse::<AgentInstanceId>().ok())
            .collect()
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
    ///
    /// Drains the local ledger first, deleting each tracked ephemeral
    /// executor by ID. This reclaims orphans even when `aura-storage`
    /// stripped the `instance_role` column on read (which would
    /// otherwise hide them from the role-based scan below). The scan is
    /// kept as a secondary pass for rows that storage *does* echo but
    /// that predate the ledger.
    pub async fn purge_executor_instances_in_project(
        &self,
        project_id: &ProjectId,
    ) -> Result<usize, AgentError> {
        let mut purged = 0usize;
        for ledger_id in self.ledger_executor_ids(project_id) {
            match self.delete_instance(&ledger_id).await {
                Ok(()) | Err(AgentError::NotFound) => purged += 1,
                Err(error) => {
                    tracing::warn!(
                        agent_instance_id = %ledger_id,
                        project_id = %project_id,
                        %error,
                        "purge_executor_instances: failed to delete ledger-tracked executor row"
                    );
                }
            }
        }

        let instances = self.list_instances(project_id).await?;
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
        // Internal `AgentInstanceService` helpers are reached only
        // from system-initiated paths (`ensure_default_loop_instance`,
        // `spawn_ephemeral_executor`, `create_instance_from_agent`).
        // User-driven creation goes through
        // `handlers::agents::instances::create_agent_instance` and
        // stamps an explicit `source` there.
        //
        // Loop and Executor rows always get `source = "system"` so the
        // projects sidebar's `isUserFacingAgentInstance` filter hides
        // them even when storage strips the `instance_role` column on
        // `list_project_agents` responses (without this defense the
        // role-defaulted-to-Chat rows leaked through and stacked up as
        // duplicate sidebar entries on every `POST /tasks/:id/run`).
        let source = match role {
            AgentInstanceRole::Loop | AgentInstanceRole::Executor => Some(
                aura_os_core::AgentInstanceSource::System
                    .as_wire_str()
                    .to_string(),
            ),
            AgentInstanceRole::Chat => None,
        };
        let req = aura_os_storage::CreateProjectAgentRequest {
            agent_id: agent.agent_id.to_string(),
            name: agent.name.clone(),
            org_id: agent.org_id.as_ref().map(ToString::to_string),
            role: Some(agent.role.clone()),
            personality: Some(agent.personality.clone()),
            system_prompt: Some(agent.system_prompt.clone()),
            skills: Some(agent.skills.clone()),
            icon: agent.icon.clone(),
            harness: None,
            instance_role: Some(role.as_wire_str().to_string()),
            source,
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
        // Record Loop / Executor rows in the local ledger so the
        // sidebar filter and the startup janitor can still identify
        // them after storage drops the `instance_role` / `source`
        // columns on subsequent `list_project_agents` reads.
        self.record_system_instance(project_id, &instance.agent_instance_id, role)
            .await;
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
        let outcome = storage
            .delete_project_agent(&agent_instance_id.to_string(), &jwt)
            .await
            .map_err(|e| match &e {
                aura_os_storage::StorageError::Server { status: 404, .. } => AgentError::NotFound,
                _ => AgentError::Storage(e),
            });
        self.runtime_state.lock().await.remove(agent_instance_id);
        // Drop the ledger entry once the row is gone (deleted now, or
        // already absent). A hard storage error keeps the entry so a
        // later janitor sweep retries.
        if matches!(outcome, Ok(()) | Err(AgentError::NotFound)) {
            self.forget_system_instance(agent_instance_id).await;
        }
        outcome
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
                | (AgentStatus::Archived, AgentStatus::Idle)
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
mod tests;
