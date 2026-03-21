use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tokio::sync::{broadcast, mpsc, Mutex};
use tracing::info;

use aura_engine::EngineEvent;
use aura_network::NetworkClient;
use aura_orbit::OrbitClient;
use aura_storage::StorageClient;
use aura_terminal::TerminalManager;
use aura_agents::{AgentService, AgentInstanceService};
use aura_auth::AuthService;
use aura_chat::ChatService;
use aura_claude::ClaudeClient;
use aura_orgs::OrgService;
use aura_billing::{BillingClient, MeteredLlm, PricingService};
use aura_projects::ProjectService;
use aura_sessions::SessionService;
use aura_specs::SpecGenerationService;
use aura_tasks::{TaskExtractionService, TaskService};
use aura_settings::SettingsService;
use aura_store::RocksStore;

use crate::loop_log::LoopLogWriter;
use crate::state::{AppState, TaskOutputBuffers, TaskStepBuffers};

struct CoreServices {
    org_service: Arc<OrgService>,
    auth_service: Arc<AuthService>,
    settings_service: Arc<SettingsService>,
    pricing_service: Arc<PricingService>,
    billing_client: Arc<BillingClient>,
    llm: Arc<MeteredLlm>,
}

fn init_core_services(store: &Arc<RocksStore>) -> CoreServices {
    let org_service = Arc::new(OrgService::new(store.clone()));
    let auth_service = Arc::new(AuthService::new(store.clone()));
    let settings_service = Arc::new(SettingsService::new(store.clone()));
    let pricing_service = Arc::new(PricingService::new(store.clone()));
    let billing_client = Arc::new(BillingClient::new());
    let claude_client: Arc<dyn aura_claude::LlmProvider> = Arc::new(ClaudeClient::new());
    let llm = Arc::new(MeteredLlm::new(
        claude_client,
        billing_client.clone(),
        store.clone(),
    ));
    CoreServices { org_service, auth_service, settings_service, pricing_service, billing_client, llm }
}

struct DomainServices {
    project_service: Arc<ProjectService>,
    spec_gen_service: Arc<SpecGenerationService>,
    task_extraction_service: Arc<TaskExtractionService>,
    task_service: Arc<TaskService>,
    agent_service: Arc<AgentService>,
    agent_instance_service: Arc<AgentInstanceService>,
    session_service: Arc<SessionService>,
    chat_service: Arc<ChatService>,
    runtime_agent_state: crate::state::RuntimeAgentStateMap,
}

fn init_domain_services(
    store: &Arc<RocksStore>,
    network_client: &Option<Arc<NetworkClient>>,
    storage_client: &Option<Arc<StorageClient>>,
    core: &CoreServices,
) -> DomainServices {
    let project_service = Arc::new(ProjectService::new_with_network(network_client.clone(), store.clone()));
    let spec_gen_service = Arc::new(SpecGenerationService::new(
        store.clone(),
        project_service.clone(),
        core.settings_service.clone(),
        core.llm.clone(),
        storage_client.clone(),
    ));
    let task_extraction_service = Arc::new(TaskExtractionService::new(
        store.clone(),
        core.settings_service.clone(),
        core.llm.clone(),
        storage_client.clone(),
    ));
    let task_service = Arc::new(TaskService::new(store.clone(), storage_client.clone(), core.pricing_service.clone()));
    let agent_service = Arc::new(AgentService::new(
        store.clone(),
        network_client.clone(),
    ));
    let runtime_agent_state: crate::state::RuntimeAgentStateMap =
        Arc::new(Mutex::new(HashMap::new()));
    let agent_instance_service = Arc::new(AgentInstanceService::new(
        store.clone(),
        storage_client.clone(),
        runtime_agent_state.clone(),
        network_client.clone(),
    ));
    let llm_config = aura_core::LlmConfig::from_env();
    let session_service = Arc::new(
        SessionService::new(store.clone(), llm_config.context_rollover_threshold, llm_config.max_context_tokens)
            .with_storage_client(storage_client.clone()),
    );
    let chat_service = Arc::new(ChatService::new(
        store.clone(),
        core.settings_service.clone(),
        core.llm.clone(),
        spec_gen_service.clone(),
        project_service.clone(),
        task_service.clone(),
        storage_client.clone(),
    ));
    DomainServices {
        project_service, spec_gen_service, task_extraction_service,
        task_service, agent_service, agent_instance_service,
        session_service, chat_service, runtime_agent_state,
    }
}

fn spawn_health_checks(
    storage_client: &Option<Arc<StorageClient>>,
    network_client: &Option<Arc<NetworkClient>>,
) {
    if let Some(ref client) = storage_client {
        let health_client = client.clone();
        tokio::spawn(async move {
            match health_client.health_check().await {
                Ok(()) => info!("aura-storage is reachable"),
                Err(e) => tracing::warn!(
                    error = %e,
                    "aura-storage health check failed on startup (will retry on first request)"
                ),
            }
        });
    } else {
        info!("aura-storage integration disabled (AURA_STORAGE_URL not set)");
    }

    if let Some(ref client) = network_client {
        let health_client = client.clone();
        tokio::spawn(async move {
            match health_client.health_check().await {
                Ok(h) => info!(
                    status = %h.status,
                    version = h.version.as_deref().unwrap_or("unknown"),
                    "aura-network is reachable"
                ),
                Err(e) => tracing::warn!(
                    error = %e,
                    "aura-network health check failed on startup (will retry on first request)"
                ),
            }
        });
    } else {
        info!("aura-network integration disabled (AURA_NETWORK_URL not set)");
    }
}

pub fn build_app_state(db_path: &Path) -> AppState {
    let data_dir = db_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| Path::new(".").to_path_buf());
    let store = Arc::new(RocksStore::open(db_path).expect("failed to open RocksDB"));

    let network_client = NetworkClient::from_env().map(Arc::new);
    let storage_client = StorageClient::from_env().map(Arc::new);

    let core = init_core_services(&store);
    let domain = init_domain_services(&store, &network_client, &storage_client, &core);

    let (event_tx, event_rx) = mpsc::unbounded_channel::<EngineEvent>();
    let (event_broadcast, _) = broadcast::channel::<EngineEvent>(4096);
    let task_output_buffers: TaskOutputBuffers =
        Arc::new(std::sync::Mutex::new(HashMap::new()));
    let task_step_buffers: TaskStepBuffers =
        Arc::new(std::sync::Mutex::new(HashMap::new()));

    let loop_log_dir = std::env::var("AURA_LOOP_LOG_DIR")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| data_dir.join("loop-logs"));
    let loop_log = Arc::new(LoopLogWriter::new(loop_log_dir));

    super::spawn_event_rebroadcast(
        event_rx,
        event_broadcast.clone(),
        store.clone(),
        storage_client.clone(),
        task_output_buffers.clone(),
        task_step_buffers.clone(),
        loop_log,
    );

    let orbit_client = Arc::new(OrbitClient::new());
    let orbit_base_url = std::env::var("ORBIT_BASE_URL")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim_end_matches('/').to_string());
    let internal_service_token = std::env::var("INTERNAL_SERVICE_TOKEN")
        .ok()
        .filter(|s| !s.trim().is_empty());

    spawn_health_checks(&storage_client, &network_client);

    if let Some(ref client) = network_client {
        super::network_bridge::spawn_network_ws_bridge(
            client.clone(),
            store.clone(),
            event_broadcast.clone(),
        );
    }

    AppState {
        data_dir: data_dir.to_path_buf(),
        store,
        org_service: core.org_service,
        auth_service: core.auth_service,
        settings_service: core.settings_service,
        pricing_service: core.pricing_service,
        billing_client: core.billing_client,
        project_service: domain.project_service,
        spec_gen_service: domain.spec_gen_service,
        task_extraction_service: domain.task_extraction_service,
        task_service: domain.task_service,
        agent_service: domain.agent_service,
        agent_instance_service: domain.agent_instance_service,
        session_service: domain.session_service,
        chat_service: domain.chat_service,
        llm: core.llm,
        event_tx,
        event_broadcast,
        loop_registry: Arc::new(Mutex::new(HashMap::new())),
        write_coordinator: aura_engine::ProjectWriteCoordinator::new(),
        task_output_buffers,
        task_step_buffers,
        terminal_manager: Arc::new(TerminalManager::new()),
        network_client,
        storage_client,
        orbit_client,
        orbit_base_url,
        internal_service_token,
        runtime_agent_state: domain.runtime_agent_state,
    }
}
