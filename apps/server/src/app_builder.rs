use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use tokio::sync::{broadcast, Mutex};
use tracing::info;

use aura_os_agents::{AgentInstanceService, AgentService};
use aura_os_auth::AuthService;
use aura_os_billing::{BillingClient, PricingService};
use aura_os_link::SwarmClient;
use aura_os_network::NetworkClient;
use aura_os_orbit::OrbitClient;
use aura_os_orgs::OrgService;
use aura_os_projects::ProjectService;
use aura_os_sessions::SessionService;
use aura_os_settings::SettingsService;
use aura_os_storage::StorageClient;
use aura_os_store::{RocksStore, StoreError};
use aura_os_tasks::TaskService;
use aura_os_terminal::TerminalManager;

use crate::state::AppState;

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

fn env_opt(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|s| !s.trim().is_empty())
}

pub fn build_app_state(db_path: &Path) -> Result<AppState, StoreError> {
    let data_dir = db_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| Path::new(".").to_path_buf());
    let store = Arc::new(RocksStore::open(db_path)?);
    let network_client = NetworkClient::from_env().map(Arc::new);
    let storage_client = StorageClient::from_env().map(Arc::new);

    // Core services
    let org_service = Arc::new(OrgService::new(store.clone()));
    let auth_service = Arc::new(AuthService::new(store.clone()));
    let settings_service = Arc::new(SettingsService::new(store.clone()));
    let pricing_service = Arc::new(PricingService::new(store.clone()));
    let billing_client = Arc::new(BillingClient::new());

    // Domain services
    let project_service = Arc::new(ProjectService::new_with_network(
        network_client.clone(),
        store.clone(),
    ));
    let task_service = Arc::new(TaskService::new(store.clone(), storage_client.clone()));
    let agent_service = Arc::new(AgentService::new(store.clone(), network_client.clone()));
    let runtime_agent_state: aura_os_agents::RuntimeAgentStateMap =
        Arc::new(Mutex::new(HashMap::new()));
    let agent_instance_service = Arc::new(AgentInstanceService::new(
        store.clone(),
        storage_client.clone(),
        runtime_agent_state,
        network_client.clone(),
    ));
    let llm_config = aura_os_core::LlmConfig::from_env();
    let session_service = Arc::new(
        SessionService::new(
            store.clone(),
            llm_config.context_rollover_threshold,
            llm_config.max_context_tokens,
        )
        .with_storage_client(storage_client.clone()),
    );

    // Swarm client
    let swarm_client = Arc::new(SwarmClient::from_env());

    // Broadcast channel for network/social events
    let (event_broadcast, _) = broadcast::channel::<serde_json::Value>(4096);

    spawn_health_checks(&storage_client, &network_client);
    if let Some(ref client) = network_client {
        super::network_bridge::spawn_network_ws_bridge(
            client.clone(),
            store.clone(),
            event_broadcast.clone(),
        );
    }

    Ok(AppState {
        data_dir,
        store,
        org_service,
        auth_service,
        settings_service,
        pricing_service,
        billing_client,
        project_service,
        task_service,
        agent_service,
        agent_instance_service,
        session_service,
        swarm_client,
        automaton_registry: Arc::new(Mutex::new(HashMap::new())),
        terminal_manager: Arc::new(TerminalManager::new()),
        network_client,
        storage_client,
        orbit_client: Arc::new(OrbitClient::new()),
        orbit_base_url: env_opt("ORBIT_BASE_URL").map(|s| s.trim_end_matches('/').to_string()),
        internal_service_token: env_opt("INTERNAL_SERVICE_TOKEN"),
        event_broadcast,
        require_zero_pro: std::env::var("REQUIRE_ZERO_PRO")
            .map(|v| v != "false" && v != "0")
            .unwrap_or(true),
    })
}
