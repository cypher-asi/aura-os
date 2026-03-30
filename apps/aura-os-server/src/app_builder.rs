use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tokio::sync::{broadcast, Mutex};
use tracing::{info, warn};

use aura_os_agents::{AgentInstanceService, AgentService};
use aura_os_auth::AuthService;
use aura_os_billing::BillingClient;
use aura_os_link::{HarnessLink, LocalHarness, SwarmHarness};
use aura_os_network::NetworkClient;
use aura_os_orgs::OrgService;
use aura_os_projects::ProjectService;
use aura_os_sessions::SessionService;
use aura_os_storage::StorageClient;
use aura_os_store::{RocksStore, StoreError};
use aura_os_tasks::TaskService;
use aura_os_terminal::TerminalManager;

use crate::orbit_client::OrbitClient;
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

struct CoreServices {
    org_service: Arc<OrgService>,
    auth_service: Arc<AuthService>,
    billing_client: Arc<BillingClient>,
}

fn init_core_services(store: &Arc<RocksStore>) -> CoreServices {
    CoreServices {
        org_service: Arc::new(OrgService::new(store.clone())),
        auth_service: Arc::new(AuthService::new(store.clone())),
        billing_client: Arc::new(BillingClient::new()),
    }
}

struct DomainServices {
    project_service: Arc<ProjectService>,
    task_service: Arc<TaskService>,
    agent_service: Arc<AgentService>,
    agent_instance_service: Arc<AgentInstanceService>,
    session_service: Arc<SessionService>,
    local_harness: Arc<dyn HarnessLink>,
    swarm_harness: Arc<dyn HarnessLink>,
}

fn init_domain_services(
    store: &Arc<RocksStore>,
    network_client: &Option<Arc<NetworkClient>>,
    storage_client: &Option<Arc<StorageClient>>,
) -> DomainServices {
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
    let session_service = Arc::new(
        SessionService::new(store.clone(), 0.8, 200_000)
            .with_storage_client(storage_client.clone()),
    );
    let swarm_harness: Arc<dyn HarnessLink> = Arc::new(SwarmHarness::from_env());
    let local_harness: Arc<dyn HarnessLink> = Arc::new(LocalHarness::from_env());

    DomainServices {
        project_service,
        task_service,
        agent_service,
        agent_instance_service,
        session_service,
        local_harness,
        swarm_harness,
    }
}

/// Resolve the directory containing the aura-harness source.
///
/// Checks `AURA_HARNESS_DIR` env var first, then common sibling paths
/// relative to the workspace root (`../../aura-harness` when running from
/// `apps/aura-os-server`, and `../aura-harness` from the workspace root).
fn find_harness_dir() -> Option<PathBuf> {
    if let Some(dir) = env_opt("AURA_HARNESS_DIR") {
        let p = PathBuf::from(dir);
        if p.join("Cargo.toml").exists() {
            return Some(p);
        }
    }
    let candidates = [
        PathBuf::from("../aura-harness"),
        PathBuf::from("../../aura-harness"),
    ];
    candidates
        .into_iter()
        .find(|p| p.join("Cargo.toml").exists())
}

/// Parse host:port from a URL like `http://127.0.0.1:8080`.
fn parse_host_port(url: &str) -> Option<String> {
    url.strip_prefix("http://")
        .or_else(|| url.strip_prefix("https://"))
        .map(|s| s.trim_end_matches('/').to_string())
}

/// Try to auto-spawn the local aura-harness process if nothing is listening.
///
/// Spawns the child process and polls for readiness in a background thread
/// so it never blocks the caller.
fn maybe_spawn_local_harness() {
    if std::env::var("AURA_DISABLE_LOCAL_HARNESS_AUTOSPAWN")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
    {
        info!("Local harness autospawn disabled by env");
        return;
    }

    let harness_url =
        std::env::var("LOCAL_HARNESS_URL").unwrap_or_else(|_| "http://localhost:8080".to_string());

    let Some(host_port) = parse_host_port(&harness_url) else {
        return;
    };

    let addr: std::net::SocketAddr = host_port
        .parse()
        .unwrap_or_else(|_| std::net::SocketAddr::from(([127, 0, 0, 1], 8080)));

    if std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(200)).is_ok() {
        info!("Local harness already running at {harness_url}");
        return;
    }

    let Some(harness_dir) = find_harness_dir() else {
        warn!(
            "Local harness not running at {harness_url} and aura-harness directory not found. \
             Set AURA_HARNESS_DIR or start the harness manually."
        );
        return;
    };

    info!(
        dir = %harness_dir.display(),
        url = %harness_url,
        "Local harness not running — spawning from source"
    );

    let mut cmd = std::process::Command::new("cargo");
    cmd.args(["run", "--release", "--", "run", "--ui", "none"])
        .current_dir(&harness_dir)
        .env("BIND_ADDR", &host_port)
        .env("BIND_PORT", addr.port().to_string())
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());

    // Load the harness's own .env so the child gets its configured values
    // (service URLs, etc.) regardless of what the
    // parent process has in its environment.
    let harness_env_file = harness_dir.join(".env");
    if harness_env_file.exists() {
        if let Ok(contents) = std::fs::read_to_string(&harness_env_file) {
            for line in contents.lines() {
                let line = line.trim();
                if line.starts_with('#') || line.is_empty() {
                    continue;
                }
                if let Some((key, val)) = line.split_once('=') {
                    let key = key.trim();
                    let val = val.trim();
                    if !val.is_empty() {
                        cmd.env(key, val);
                    }
                }
            }
        }
    }

    match cmd.spawn() {
        Ok(mut child) => {
            info!(
                pid = child.id(),
                "aura-harness child process spawned (building in background)"
            );

            std::thread::spawn(move || {
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(120);
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(1000));
                    if let Ok(Some(status)) = child.try_wait() {
                        let _ = status;
                        break;
                    }
                    if std::time::Instant::now() > deadline {
                        tracing::warn!("Timed out waiting for local harness to become ready");
                        break;
                    }
                    if std::net::TcpStream::connect_timeout(
                        &addr,
                        std::time::Duration::from_millis(200),
                    )
                    .is_ok()
                    {
                        tracing::info!("Local harness is ready at {harness_url}");
                        break;
                    }
                }
            });
        }
        Err(e) => {
            warn!(error = %e, "Failed to spawn aura-harness child process");
        }
    }
}

pub(crate) fn ensure_local_harness_running() {
    maybe_spawn_local_harness();
}

pub fn build_app_state(db_path: &Path) -> Result<AppState, StoreError> {
    let data_dir = db_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| Path::new(".").to_path_buf());
    let store = Arc::new(RocksStore::open(db_path)?);
    let network_client = NetworkClient::from_env().map(Arc::new);
    let storage_client = StorageClient::from_env().map(Arc::new);
    let orbit_client = OrbitClient::from_env();
    if orbit_client.is_none() {
        info!("Orbit integration disabled (ORBIT_BASE_URL not set)");
    }

    ensure_local_harness_running();

    let core = init_core_services(&store);
    let domain = init_domain_services(&store, &network_client, &storage_client);

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
        harness_sessions: Arc::new(Mutex::new(HashMap::new())),
        chat_sessions: Arc::new(Mutex::new(HashMap::new())),
        credit_cache: Arc::new(Mutex::new(None)),
        terminal_manager: Arc::new(TerminalManager::new()),
        network_client,
        storage_client,
        event_broadcast,
        require_zero_pro: std::env::var("REQUIRE_ZERO_PRO")
            .map(|v| v != "false" && v != "0")
            .unwrap_or(true),
        automaton_client: Arc::new(aura_os_link::AutomatonClient::new(
            &std::env::var("LOCAL_HARNESS_URL")
                .unwrap_or_else(|_| "http://localhost:8080".to_string()),
        )),
        automaton_registry: Arc::new(Mutex::new(HashMap::new())),
        swarm_base_url: env_opt("SWARM_BASE_URL"),
        task_output_cache: Arc::new(Mutex::new(HashMap::new())),
        orbit_client,
    })
}
