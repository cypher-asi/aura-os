use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tokio::sync::{broadcast, Mutex};
use tracing::{info, warn};

use aura_os_agents::{AgentInstanceService, AgentService};
use aura_os_auth::AuthService;
use aura_os_billing::BillingClient;
use aura_os_integrations::IntegrationsClient;
use aura_os_link::{local_harness_base_url, HarnessLink, LocalHarness, SwarmHarness};

use crate::harness_gateway::HarnessHttpGateway;
use aura_os_network::{NetworkClient, OrbitClient};
use aura_os_orgs::OrgService;
use aura_os_projects::ProjectService;
use aura_os_sessions::SessionService;
use aura_os_storage::StorageClient;
use aura_os_store::{SettingsStore, StoreError};
use aura_os_agent_runtime::AgentRuntimeService;
use aura_os_tasks::TaskService;
use aura_os_terminal::TerminalManager;

use crate::state::AppState;

fn resolve_local_server_base_url() -> String {
    aura_os_integrations::control_plane_api_base_url()
}

fn spawn_health_checks(
    storage_client: &Option<Arc<StorageClient>>,
    network_client: &Option<Arc<NetworkClient>>,
    integrations_client: &Option<Arc<IntegrationsClient>>,
) {
    if let Some(ref client) = storage_client {
        if client.has_internal_token() {
            info!(
                "aura-storage internal token configured; remote process proxy and scheduler sync are enabled"
            );
        } else {
            info!(
                "aura-storage is configured without AURA_STORAGE_INTERNAL_TOKEN; process CRUD remains available, but scheduled execution requires the internal token"
            );
        }
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

    if let Some(ref client) = integrations_client {
        let health_client = client.clone();
        tokio::spawn(async move {
            match health_client.health_check().await {
                Ok(()) => info!("aura-integrations is reachable and serving as the canonical integration backend"),
                Err(e) => tracing::warn!(
                    error = %e,
                    "aura-integrations health check failed on startup (will retry on first request)"
                ),
            }
        });
    } else {
        info!(
            "aura-integrations is not configured; Aura OS will use compatibility-only local integration storage"
        );
    }
}

fn env_opt(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|s| !s.trim().is_empty())
}

/// Build the [`aura_os_browser::BrowserManager`] using the real Chromium
/// CDP backend when the `cdp` feature is enabled, falling back to the
/// stub backend otherwise. The CDP backend launches Chromium lazily on
/// first use, so a missing executable only surfaces on first spawn.
fn build_browser_manager(settings_root: PathBuf) -> Arc<aura_os_browser::BrowserManager> {
    let config = aura_os_browser::BrowserConfig::default().with_settings_root(settings_root);

    #[cfg(feature = "browser-cdp")]
    {
        let cdp_config = aura_os_browser::CdpBackendConfig::from_env();
        info!(
            sandbox_disabled = cdp_config.disable_sandbox,
            "browser: initialising CDP backend (Chromium launched lazily)"
        );
        return Arc::new(aura_os_browser::BrowserManager::with_backend(
            config,
            Arc::new(aura_os_browser::CdpBackend::with_config(cdp_config)),
        ));
    }
    #[allow(unreachable_code)]
    {
        info!("browser: using stub backend (enable the `browser-cdp` feature for real rendering)");
        Arc::new(aura_os_browser::BrowserManager::new(config))
    }
}

struct CoreServices {
    org_service: Arc<OrgService>,
    auth_service: Arc<AuthService>,
    billing_client: Arc<BillingClient>,
}

fn init_core_services(store: &Arc<SettingsStore>) -> CoreServices {
    CoreServices {
        org_service: Arc::new(OrgService::new(store.clone())),
        auth_service: Arc::new(AuthService::new()),
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
    store: &Arc<SettingsStore>,
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

    let harness_url = local_harness_base_url();

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

    ensure_local_harness_running();

    let core = init_core_services(&store);
    let domain = init_domain_services(&store, &network_client, &storage_client);

    let (event_broadcast, _) = broadcast::channel::<serde_json::Value>(4096);

    let validation_cache = {
        let cache = Arc::new(dashmap::DashMap::new());
        crate::state::spawn_cache_eviction(cache.clone());
        cache
    };

    let harness_base = local_harness_base_url();
    let automaton_client = Arc::new(aura_os_link::AutomatonClient::new(&harness_base));
    let harness_http = Arc::new(HarnessHttpGateway::new(harness_base));

    let router_url = std::env::var("AURA_ROUTER_URL")
        .unwrap_or_else(|_| "https://aura-router.onrender.com".to_string());
    let local_server_base_url = resolve_local_server_base_url();
    // Build the tool registry + process executor outside the runtime so
    // Tier D's slim `aura-os-agent-runtime` doesn't need to pull in
    // tool-implementation deps. Tools live in `aura-os-agent-tools`; the
    // `ProcessExecutor` is owned by the server because it depends on the
    // data directory + storage client.
    let process_executor = Arc::new(aura_os_process::ProcessExecutor::new(
        event_broadcast.clone(),
        data_dir.clone(),
        store.clone(),
        domain.agent_service.clone(),
        core.org_service.clone(),
        automaton_client.clone(),
        storage_client.clone(),
        domain.task_service.clone(),
        router_url.clone(),
        reqwest::Client::new(),
    ));
    let tool_registry = {
        let mut registry = aura_os_agent_tools::build_registry();
        aura_os_agent_tools::register_process_tools(&mut registry, process_executor.clone());
        Arc::new(registry)
    };
    let agent_runtime = Arc::new(
        AgentRuntimeService::new(
            tool_registry,
            process_executor,
            router_url,
            domain.project_service.clone(),
            domain.agent_service.clone(),
            domain.agent_instance_service.clone(),
            domain.task_service.clone(),
            domain.session_service.clone(),
            core.org_service.clone(),
            core.billing_client.clone(),
            automaton_client.clone(),
            network_client.clone(),
            storage_client.clone(),
            orbit_client.clone(),
            store.clone(),
            event_broadcast.clone(),
            domain.local_harness.clone(),
        )
        .with_local_server_base_url(local_server_base_url),
    );

    // Spawn scheduled process execution.
    agent_runtime.spawn_scheduler();

    spawn_health_checks(&storage_client, &network_client, &integrations_client);
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

    // Emit the active cross-agent tool policy mode once at startup
    // so operators can confirm the env flag landed before any traffic
    // hits the dispatcher.
    crate::handlers::agent_tools::log_active_policy_mode();

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
        credit_cache: Arc::new(Mutex::new(HashMap::new())),
        terminal_manager: Arc::new(TerminalManager::new()),
        browser_manager: build_browser_manager(browser_settings_root.clone()),
        network_client,
        feedback_network_client,
        storage_client,
        integrations_client,
        event_broadcast,
        require_zero_pro: std::env::var("REQUIRE_ZERO_PRO")
            .map(|v| v != "false" && v != "0")
            .unwrap_or(true),
        automaton_client,
        harness_http,
        automaton_registry: Arc::new(Mutex::new(HashMap::new())),
        swarm_base_url: env_opt("SWARM_BASE_URL"),
        task_output_cache: Arc::new(Mutex::new(HashMap::new())),
        orbit_client,
        validation_cache,
        agent_runtime,
        permissions_cache: aura_os_agent_runtime::policy::PermissionsCache::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::resolve_local_server_base_url;
    use std::sync::Mutex;

    struct EnvGuard {
        key: &'static str,
        prev: Option<String>,
    }

    impl EnvGuard {
        fn set(key: &'static str, value: &str) -> Self {
            let prev = std::env::var(key).ok();
            std::env::set_var(key, value);
            Self { key, prev }
        }

        fn unset(key: &'static str) -> Self {
            let prev = std::env::var(key).ok();
            std::env::remove_var(key);
            Self { key, prev }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            match &self.prev {
                Some(value) => std::env::set_var(self.key, value),
                None => std::env::remove_var(self.key),
            }
        }
    }

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: Mutex<()> = Mutex::new(());
        &LOCK
    }

    #[test]
    fn resolve_local_server_base_url_uses_canonical_explicit_base_url() {
        let _lock = env_lock().lock().unwrap_or_else(|e| e.into_inner());
        let _base = EnvGuard::set("AURA_SERVER_BASE_URL", " https://aura.example.com/ ");
        let _vite = EnvGuard::unset("VITE_API_URL");
        let _host = EnvGuard::set("AURA_SERVER_HOST", "10.0.0.5");
        let _port = EnvGuard::set("AURA_SERVER_PORT", "9000");

        assert_eq!(resolve_local_server_base_url(), "https://aura.example.com");
    }

    #[test]
    fn resolve_local_server_base_url_uses_vite_api_url_when_base_url_unset() {
        let _lock = env_lock().lock().unwrap_or_else(|e| e.into_inner());
        let _base = EnvGuard::unset("AURA_SERVER_BASE_URL");
        let _vite = EnvGuard::set("VITE_API_URL", " https://aura.example.com/ ");
        let _host = EnvGuard::set("AURA_SERVER_HOST", "0.0.0.0");
        let _port = EnvGuard::set("AURA_SERVER_PORT", "3100");

        assert_eq!(resolve_local_server_base_url(), "https://aura.example.com");
    }

    #[test]
    fn resolve_local_server_base_url_normalizes_host_port_fallback() {
        let _lock = env_lock().lock().unwrap_or_else(|e| e.into_inner());
        let _base = EnvGuard::unset("AURA_SERVER_BASE_URL");
        let _vite = EnvGuard::unset("VITE_API_URL");
        let _host = EnvGuard::set("AURA_SERVER_HOST", "0.0.0.0");
        let _port = EnvGuard::set("AURA_SERVER_PORT", "3100");

        assert_eq!(resolve_local_server_base_url(), "http://127.0.0.1:3100");
    }
}
