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
use aura_os_link::AutomatonClient;
use aura_os_network::NetworkClient;
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
        store: Arc<RocksStore>,
        event_broadcast: broadcast::Sender<serde_json::Value>,
    ) -> Self {
        let tool_registry = ToolRegistry::with_tier1_tools();
        let event_listener = SuperAgentEventListener::new(100);
        event_listener.spawn(event_broadcast.subscribe());
        info!(router_url = %router_url, "SuperAgentService initialized");
        Self {
            tool_registry,
            router_url,
            http_client: reqwest::Client::new(),
            event_listener,
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
            store,
            event_broadcast,
        }
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
            store: self.store.clone(),
            event_broadcast: self.event_broadcast.clone(),
        }
    }
}
