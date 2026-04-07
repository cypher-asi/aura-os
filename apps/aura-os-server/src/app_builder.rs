use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tokio::sync::{broadcast, Mutex};
use tracing::{info, warn};

use aura_os_agents::{AgentInstanceService, AgentService};
use aura_os_auth::AuthService;
use aura_os_billing::BillingClient;
use aura_os_link::{HarnessLink, LocalHarness, SwarmHarness};
use aura_os_network::{NetworkClient, OrbitClient};
use aura_os_orgs::OrgService;
use aura_os_projects::ProjectService;
use aura_os_sessions::SessionService;
use aura_os_storage::StorageClient;
use aura_os_store::{RocksStore, StoreError};
use aura_os_super_agent::SuperAgentService;
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

struct CoreServices {
    org_service: Arc<OrgService>,
    auth_service: Arc<AuthService>,
    billing_client: Arc<BillingClient>,
}

fn init_core_services(store: &Arc<RocksStore>) -> CoreServices {
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

/// One-shot migration: link orphan processes (no project_id) to a matching
/// project by name. Specifically links "Competitive Intel" -> "Competition".
/// Safe to run every startup; no-ops when all processes already have a project.
/// Spawned as a background task so it can fetch projects from the network.
fn migrate_orphan_processes(
    process_store: &Arc<aura_os_process::ProcessStore>,
    project_service: &Arc<ProjectService>,
    network_client: &Option<Arc<NetworkClient>>,
    store: &Arc<RocksStore>,
) {
    let processes = match process_store.list_processes() {
        Ok(ps) => ps,
        Err(e) => {
            warn!(error = %e, "migrate_orphan_processes: failed to list processes");
            return;
        }
    };

    let orphans: Vec<_> = processes
        .into_iter()
        .filter(|p| p.project_id.is_none())
        .collect();
    if orphans.is_empty() {
        return;
    }

    info!(
        orphan_count = orphans.len(),
        "migrate_orphan_processes: found orphan processes, spawning migration task"
    );

    let ps = process_store.clone();
    let proj_svc = project_service.clone();
    let net = network_client.clone();
    let rocks = store.clone();

    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;

        let mut projects = proj_svc.list_projects().unwrap_or_default();

        if projects.is_empty() {
            if let Some(ref client) = net {
                if let Some(jwt) = rocks.get_jwt() {
                    if let Ok(orgs) = client.list_orgs(&jwt).await {
                        for org in &orgs {
                            if let Ok(net_projects) =
                                client.list_projects_by_org(&org.id, &jwt).await
                            {
                                for np in &net_projects {
                                    if let Ok(pid) = np.id.parse::<aura_os_core::ProjectId>() {
                                        let local = proj_svc.get_project(&pid).ok();
                                        let project = aura_os_core::Project {
                                            project_id: pid,
                                            org_id: org.id.parse().unwrap_or_default(),
                                            name: np.name.clone(),
                                            description: np.description.clone().unwrap_or_default(),
                                            requirements_doc_path: None,
                                            current_status: aura_os_core::ProjectStatus::Planning,
                                            build_command: None,
                                            test_command: None,
                                            specs_summary: None,
                                            specs_title: None,
                                            created_at: local
                                                .as_ref()
                                                .map(|l| l.created_at)
                                                .unwrap_or_else(chrono::Utc::now),
                                            updated_at: chrono::Utc::now(),
                                            git_repo_url: np.git_repo_url.clone(),
                                            git_branch: np.git_branch.clone(),
                                            orbit_base_url: None,
                                            orbit_owner: None,
                                            orbit_repo: None,
                                        };
                                        let _ = proj_svc.save_project_shadow(&project);
                                        projects.push(project);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        if projects.is_empty() {
            warn!("migrate_orphan_processes: no projects available (local or remote)");
            return;
        }

        let name_map: std::collections::HashMap<&str, &aura_os_core::Project> =
            [("Competitive Intel", "Competition")]
                .into_iter()
                .filter_map(|(process_name, project_name)| {
                    projects
                        .iter()
                        .find(|p| p.name == project_name)
                        .map(|proj| (process_name, proj))
                })
                .collect();

        for orphan in &orphans {
            if let Some(project) = name_map.get(orphan.name.as_str()) {
                let mut updated = orphan.clone();
                updated.project_id = Some(project.project_id);
                updated.updated_at = chrono::Utc::now();
                match ps.save_process(&updated) {
                    Ok(()) => info!(
                        process = %orphan.name,
                        project = %project.name,
                        process_id = %orphan.process_id,
                        project_id = %project.project_id,
                        "Migrated orphan process to project"
                    ),
                    Err(e) => warn!(
                        process = %orphan.name,
                        error = %e,
                        "Failed to migrate orphan process"
                    ),
                }
            }
        }
    });
}

pub fn build_app_state(db_path: &Path) -> Result<AppState, StoreError> {
    let data_dir = db_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| Path::new(".").to_path_buf());
    let store = Arc::new(RocksStore::open(db_path)?);
    let network_client = NetworkClient::from_env().map(Arc::new);
    let storage_client = StorageClient::from_env().map(Arc::new);
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

    let automaton_client = Arc::new(aura_os_link::AutomatonClient::new(
        &std::env::var("LOCAL_HARNESS_URL").unwrap_or_else(|_| "http://localhost:8080".to_string()),
    ));

    let router_url = std::env::var("AURA_ROUTER_URL")
        .unwrap_or_else(|_| "https://aura-router.onrender.com".to_string());
    let super_agent_service = Arc::new(SuperAgentService::new(
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
        data_dir.clone(),
    ));

    migrate_orphan_processes(
        &super_agent_service.process_store,
        &domain.project_service,
        &network_client,
        &store,
    );

    // Spawn cron scheduler
    {
        let scheduler = Arc::new(aura_os_super_agent::scheduler::CronScheduler::new(
            super_agent_service.cron_store.clone(),
            super_agent_service.cron_executor.clone(),
        ));
        scheduler.spawn();
    }

    spawn_health_checks(&storage_client, &network_client);
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
        automaton_client,
        automaton_registry: Arc::new(Mutex::new(HashMap::new())),
        swarm_base_url: env_opt("SWARM_BASE_URL"),
        task_output_cache: Arc::new(Mutex::new(HashMap::new())),
        orbit_client,
        validation_cache,
        super_agent_service,
        super_agent_messages: Arc::new(Mutex::new(HashMap::new())),
    })
}
