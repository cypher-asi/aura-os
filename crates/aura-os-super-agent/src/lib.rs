pub mod cron_store;
pub mod events;
pub mod executor;
pub mod prompt;
pub mod scheduler;
pub mod state;
pub mod stream;
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
    pub cron_store: Arc<cron_store::CronStore>,
    pub cron_executor: Arc<executor::CronJobExecutor>,
    pub process_store: Arc<aura_os_process::ProcessStore>,
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
        harness: Arc<dyn HarnessLink>,
        data_dir: std::path::PathBuf,
    ) -> Self {
        let cron_store = Arc::new(cron_store::CronStore::new(store.clone()));
        let cron_executor = Arc::new(executor::CronJobExecutor::new(
            cron_store.clone(),
            event_broadcast.clone(),
        ));

        let process_store = Arc::new(aura_os_process::ProcessStore::new(store.clone()));
        let process_executor = Arc::new(aura_os_process::ProcessExecutor::new(
            process_store.clone(),
            event_broadcast.clone(),
            harness,
            data_dir,
            store.clone(),
            agent_service.clone(),
        ));

        let mut tool_registry = ToolRegistry::with_tier1_tools();
        tool_registry.register_cron_tools(cron_store.clone(), cron_executor.clone());
        tool_registry.register_process_tools(process_store.clone(), process_executor.clone());

        let event_listener = SuperAgentEventListener::new(100);
        event_listener.spawn(event_broadcast.subscribe());
        info!(router_url = %router_url, "SuperAgentService initialized");
        Self {
            tool_registry,
            router_url,
            http_client: reqwest::Client::new(),
            event_listener,
            cron_store,
            cron_executor,
            process_store,
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
        }
    }

    pub fn spawn_scheduler(self: &Arc<Self>) {
        let sched = Arc::new(scheduler::CronScheduler::new(
            self.cron_store.clone(),
            self.cron_executor.clone(),
        ));
        sched.spawn();
        info!("Cron scheduler spawned");

        let process_sched = Arc::new(aura_os_process::ProcessScheduler::new(
            self.process_store.clone(),
            self.process_executor.clone(),
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
        }
    }
}
