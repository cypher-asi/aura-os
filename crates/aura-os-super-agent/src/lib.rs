pub mod ceo;
pub mod events;
pub mod prompt;
pub mod state;
pub mod tier;
pub mod tools;

use std::sync::Arc;

use thiserror::Error;
use tokio::sync::broadcast;
use tracing::info;

use aura_os_agents::{AgentInstanceService, AgentService};
use aura_os_billing::BillingClient;
use aura_os_link::{AutomatonClient, HarnessLink};
use aura_os_network::{NetworkClient, OrbitClient};
use aura_os_orgs::OrgService;
use aura_os_projects::ProjectService;
use aura_os_sessions::SessionService;
use aura_os_storage::StorageClient;
use aura_os_store::RocksStore;
use aura_os_tasks::TaskService;

use events::SuperAgentEventListener;
use tools::{SuperAgentContext, ToolRegistry};

#[derive(Error, Debug)]
pub enum SuperAgentError {
    #[error("LLM request failed: {0}")]
    LlmError(String),
    #[error("Tool execution failed: {0}")]
    ToolError(String),
    #[error("Network error: {0}")]
    NetworkError(#[from] reqwest::Error),
    #[error("Internal error: {0}")]
    Internal(String),
}

pub struct SuperAgentService {
    pub tool_registry: ToolRegistry,
    pub router_url: String,
    pub http_client: reqwest::Client,
    pub event_listener: SuperAgentEventListener,
    pub process_executor: Arc<aura_os_process::ProcessExecutor>,
    project_service: Arc<ProjectService>,
    agent_service: Arc<AgentService>,
    agent_instance_service: Arc<AgentInstanceService>,
    task_service: Arc<TaskService>,
    session_service: Arc<SessionService>,
    org_service: Arc<OrgService>,
    billing_client: Arc<BillingClient>,
    automaton_client: Arc<AutomatonClient>,
    network_client: Option<Arc<NetworkClient>>,
    storage_client: Option<Arc<StorageClient>>,
    orbit_client: Option<Arc<OrbitClient>>,
    store: Arc<RocksStore>,
    event_broadcast: broadcast::Sender<serde_json::Value>,
    /// Base URL of the locally running aura-os-server. Tools that need
    /// server-side side-effects (e.g. mirroring specs to disk) should route
    /// through this URL instead of the remote `router_url` / storage.
    local_server_base_url: Option<String>,
}

impl SuperAgentService {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        router_url: String,
        project_service: Arc<ProjectService>,
        agent_service: Arc<AgentService>,
        agent_instance_service: Arc<AgentInstanceService>,
        task_service: Arc<TaskService>,
        session_service: Arc<SessionService>,
        org_service: Arc<OrgService>,
        billing_client: Arc<BillingClient>,
        automaton_client: Arc<AutomatonClient>,
        network_client: Option<Arc<NetworkClient>>,
        storage_client: Option<Arc<StorageClient>>,
        orbit_client: Option<Arc<OrbitClient>>,
        store: Arc<RocksStore>,
        event_broadcast: broadcast::Sender<serde_json::Value>,
        _harness: Arc<dyn HarnessLink>,
        data_dir: std::path::PathBuf,
    ) -> Self {
        let process_executor = Arc::new(aura_os_process::ProcessExecutor::new(
            event_broadcast.clone(),
            data_dir,
            store.clone(),
            agent_service.clone(),
            org_service.clone(),
            automaton_client.clone(),
            storage_client.clone(),
            task_service.clone(),
            router_url.clone(),
            reqwest::Client::new(),
        ));

        let mut tool_registry = ToolRegistry::with_tier1_tools();
        tool_registry.register_process_tools(process_executor.clone());

        let event_listener = SuperAgentEventListener::new(100);
        event_listener.spawn(event_broadcast.subscribe());
        info!(router_url = %router_url, "SuperAgentService initialized");
        Self {
            tool_registry,
            router_url,
            http_client: reqwest::Client::new(),
            event_listener,
            process_executor,
            project_service,
            agent_service,
            agent_instance_service,
            task_service,
            session_service,
            org_service,
            billing_client,
            automaton_client,
            network_client,
            storage_client,
            orbit_client,
            store,
            event_broadcast,
            local_server_base_url: None,
        }
    }

    /// Wire in the base URL of the local aura-os-server so tool calls that
    /// need local side-effects (disk mirrors, etc.) can route through it.
    pub fn with_local_server_base_url(mut self, url: impl Into<String>) -> Self {
        let raw: String = url.into();
        let trimmed = raw.trim().trim_end_matches('/').to_string();
        self.local_server_base_url = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        };
        self
    }

    pub fn set_local_server_base_url(&mut self, url: Option<String>) {
        self.local_server_base_url = url
            .map(|v| v.trim().trim_end_matches('/').to_string())
            .filter(|v| !v.is_empty());
    }

    pub fn spawn_scheduler(self: &Arc<Self>) {
        let Some(storage_client) = self.storage_client.clone() else {
            info!("Process scheduler disabled: aura-storage is not configured");
            return;
        };
        if !storage_client.has_internal_token() {
            info!("Process scheduler disabled: AURA_STORAGE_INTERNAL_TOKEN is not configured");
            return;
        }
        let process_sched = Arc::new(aura_os_process::ProcessScheduler::new(
            self.process_executor.clone(),
            Some(storage_client),
        ));
        process_sched.spawn();
        info!("Process scheduler spawned");
    }

    pub fn build_context(&self, user_id: &str, org_id: &str, jwt: &str) -> SuperAgentContext {
        SuperAgentContext {
            user_id: user_id.to_string(),
            org_id: org_id.to_string(),
            jwt: jwt.to_string(),
            project_service: self.project_service.clone(),
            agent_service: self.agent_service.clone(),
            agent_instance_service: self.agent_instance_service.clone(),
            task_service: self.task_service.clone(),
            session_service: self.session_service.clone(),
            org_service: self.org_service.clone(),
            billing_client: self.billing_client.clone(),
            automaton_client: self.automaton_client.clone(),
            network_client: self.network_client.clone(),
            storage_client: self.storage_client.clone(),
            orbit_client: self.orbit_client.clone(),
            store: self.store.clone(),
            event_broadcast: self.event_broadcast.clone(),
            local_server_base_url: self.local_server_base_url.clone(),
            local_http_client: self.http_client.clone(),
        }
    }
}
