use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tokio::sync::{broadcast, Mutex};
use tracing::{info, warn};

use aura_os_agents::{AgentInstanceService, AgentService};
use aura_os_auth::AuthService;
use aura_os_billing::BillingClient;
use aura_os_harness::{local_harness_base_url, HarnessLink, LocalHarness, SwarmHarness};
use aura_os_integrations::IntegrationsClient;

use crate::agent_events::AgentEventListener;
use crate::harness_gateway::HarnessHttpGateway;
use crate::loop_log::LoopLogWriter;
use aura_os_network::{NetworkClient, OrbitClient};
use aura_os_orgs::OrgService;
use aura_os_projects::ProjectService;
use aura_os_sessions::SessionService;
use aura_os_storage::StorageClient;
use aura_os_store::{SettingsStore, StoreError};
use aura_os_tasks::TaskService;
use aura_os_terminal::TerminalManager;

use crate::state::AppState;

mod browser;
mod executor_janitor;
mod harness_autospawn;
mod health;
mod http;
mod services;

use browser::build_browser_manager;
use executor_janitor::spawn_executor_janitor;
pub(crate) use harness_autospawn::ensure_local_harness_running;
use health::spawn_health_checks;
use http::{build_local_http_client, resolve_local_server_base_url};
use services::{init_core_services, init_domain_services};

fn env_opt(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|s| !s.trim().is_empty())
}

pub fn build_app_state(store_path: &Path) -> Result<AppState, StoreError> {
    let data_dir = store_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| Path::new(".").to_path_buf());
    let browser_settings_root = data_dir.join("browser");
    let store = Arc::new(SettingsStore::open(store_path)?);
    let network_client = NetworkClient::from_env().map(Arc::new);
    let feedback_network_client = NetworkClient::from_env_key("AURA_NETWORK_FEEDBACK_URL")
        .map(Arc::new)
        .or_else(|| network_client.clone());
    match (&feedback_network_client, &network_client) {
        (Some(fb), Some(main)) if Arc::ptr_eq(fb, main) => {
            info!("feedback routes share the main aura-network client (AURA_NETWORK_FEEDBACK_URL not set)");
        }
        (Some(fb), _) => {
            info!(base_url = %fb.base_url(), "feedback routes using dedicated aura-network client");
        }
        _ => {}
    }
    let storage_client = StorageClient::from_env().map(Arc::new);
    let integrations_client = IntegrationsClient::from_env().map(Arc::new);
    let orbit_client = OrbitClient::from_env().map(Arc::new);
    if orbit_client.is_none() {
        info!("Orbit integration disabled (ORBIT_BASE_URL not set)");
    }
    let orbit_capacity_guard = Arc::new(crate::orbit_guard::OrbitCapacityGuard::from_env());
    info!(
        cooldown_secs = orbit_capacity_guard.cooldown().as_secs(),
        "Orbit capacity guard armed (trips on remote_storage_exhausted; tunable via AURA_ORBIT_ENOSPC_COOLDOWN_SECS)"
    );

    ensure_local_harness_running();

    let core = init_core_services(&store);
    let domain = init_domain_services(&store, &network_client, &storage_client);

    let (event_broadcast, _) = broadcast::channel::<serde_json::Value>(4096);
    let event_hub = aura_os_events::EventHub::new();
    let loop_registry = aura_os_loops::LoopRegistry::new(event_hub.clone());
    // Forward typed loop lifecycle + activity events from the hub into
    // the legacy websocket broadcast as JSON, so the existing frontend
    // can consume `loop_opened` / `loop_activity_changed` / `loop_ended`
    // frames without a protocol change.
    crate::loop_events_bridge::spawn_loop_events_bridge(event_hub.clone(), event_broadcast.clone());

    let validation_cache = {
        let cache = Arc::new(dashmap::DashMap::new());
        crate::state::spawn_cache_eviction(cache.clone());
        cache
    };

    let harness_base = local_harness_base_url();
    let automaton_client = Arc::new(aura_os_harness::AutomatonClient::new(&harness_base));
    let harness_http = Arc::new(HarnessHttpGateway::new(harness_base));

    // Dev-loop debug bundles are always captured so the Debug app and
    // `aura-run-analyze` CLI can inspect any past run without an
    // opt-in toggle. Override the base dir with `AURA_LOOP_LOGS_DIR`
    // for tooling that wants to point elsewhere.
    let loop_log_base = env_opt("AURA_LOOP_LOGS_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| data_dir.join("loop_logs"));
    if let Err(error) = std::fs::create_dir_all(&loop_log_base) {
        warn!(path = %loop_log_base.display(), %error, "failed to create loop_logs dir (will be created lazily)");
    }
    let loop_log = Arc::new(LoopLogWriter::new(loop_log_base));
    // Flip any bundles still stuck at `status: Running` from a
    // previously-crashed server process to `Interrupted`. Must run
    // before `loop_log` is cloned into AppState so no live run can
    // race with the sweep.
    loop_log.reconcile_orphan_runs();

    let router_url = std::env::var("AURA_ROUTER_URL")
        .unwrap_or_else(|_| "https://aura-router.onrender.com".to_string());
    let local_server_base_url = resolve_local_server_base_url();
    let http_client = build_local_http_client();
    let _local_server_base_url = local_server_base_url;

    let agent_event_listener = Arc::new(AgentEventListener::new(100));
    agent_event_listener.spawn(event_broadcast.subscribe());

    spawn_health_checks(&storage_client, &network_client, &integrations_client);
    spawn_executor_janitor(
        domain.project_service.clone(),
        domain.agent_instance_service.clone(),
    );
    if let Some(ref client) = network_client {
        super::network_bridge::spawn_network_ws_bridge(
            client.clone(),
            validation_cache.clone(),
            event_broadcast.clone(),
        );
    }

    let billing_base_url = std::env::var("Z_BILLING_URL")
        .unwrap_or_else(|_| "https://z-billing.onrender.com".to_string());
    super::billing_bridge::spawn_billing_ws_bridge(
        billing_base_url,
        validation_cache.clone(),
        event_broadcast.clone(),
    );

    Ok(AppState {
        data_dir,
        store,
        org_service: core.org_service,
        auth_service: core.auth_service,
        billing_client: core.billing_client,
        project_service: domain.project_service,
        task_service: domain.task_service,
        agent_service: domain.agent_service,
        agent_instance_service: domain.agent_instance_service,
        session_service: domain.session_service,
        local_harness: domain.local_harness,
        swarm_harness: domain.swarm_harness,
        chat_sessions: Arc::new(Mutex::new(HashMap::new())),
        credit_cache: Arc::new(Mutex::new(HashMap::new())),
        terminal_manager: Arc::new(TerminalManager::new()),
        browser_manager: build_browser_manager(browser_settings_root.clone()),
        network_client,
        feedback_network_client,
        storage_client,
        integrations_client,
        event_broadcast,
        event_hub,
        loop_registry,
        require_zero_pro: std::env::var("REQUIRE_ZERO_PRO")
            .map(|v| v != "false" && v != "0")
            .unwrap_or(true),
        automaton_client,
        harness_http,
        automaton_registry: Arc::new(Mutex::new(HashMap::new())),
        swarm_base_url: env_opt("SWARM_BASE_URL"),
        task_output_cache: Arc::new(Mutex::new(HashMap::new())),
        orbit_client,
        orbit_capacity_guard,
        validation_cache,
        agent_discovery_cache: Arc::new(dashmap::DashMap::new()),
        router_url,
        http_client,
        agent_event_listener,
        loop_log,
    })
}

#[cfg(test)]
mod tests;
