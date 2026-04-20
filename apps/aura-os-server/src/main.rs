use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;

use tokio::net::TcpListener;
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

fn default_data_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("AURA_DATA_DIR") {
        let dir = dir.trim();
        if !dir.is_empty() {
            return PathBuf::from(dir);
        }
    }
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("aura")
}

/// One-shot migration: the local settings store used to live in `<data>/db/`
/// (when it was briefly backed by RocksDB). It's now plain JSON under
/// `<data>/store/`. If the old path exists and the new one doesn't, rename.
fn migrate_legacy_db_dir(data_dir: &std::path::Path, store_path: &std::path::Path) {
    let legacy = data_dir.join("db");
    if legacy.exists() && !store_path.exists() {
        match std::fs::rename(&legacy, store_path) {
            Ok(()) => info!(
                from = %legacy.display(),
                to = %store_path.display(),
                "migrated legacy db/ directory to store/"
            ),
            Err(err) => warn!(
                error = %err,
                from = %legacy.display(),
                to = %store_path.display(),
                "failed to migrate legacy db/ directory; continuing with fresh store/"
            ),
        }
    }
}

fn find_interface_dir() -> Option<PathBuf> {
    let candidates = [
        PathBuf::from("interface/dist"),
        PathBuf::from("../../interface/dist"),
    ];
    candidates
        .into_iter()
        .find(|p| p.join("index.html").exists())
}

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();
    aura_os_server::ensure_user_bins_on_path();

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| {
            EnvFilter::new("aura_os_server=debug,aura_services=debug,tower_http=debug,info")
        }))
        .init();

    let data_dir = default_data_dir();
    std::fs::create_dir_all(&data_dir).expect("failed to create data directory");

    let store_path = data_dir.join("store");
    migrate_legacy_db_dir(&data_dir, &store_path);
    let state =
        aura_os_server::build_app_state(&store_path).expect("failed to open local settings store");

    validate_control_plane_base_url_config();

    let interface_dir = find_interface_dir();
    if let Some(ref dir) = interface_dir {
        info!(path = %dir.display(), "Serving interface");
    } else {
        warn!("No interface dist found; API-only mode (connect interface dev server to port 3100)");
    }

    let app = aura_os_server::create_router_with_interface(state, interface_dir);

    let port: u16 = std::env::var("AURA_SERVER_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3100);
    let host: IpAddr = std::env::var("AURA_SERVER_HOST")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(IpAddr::from([127, 0, 0, 1]));
    let addr = SocketAddr::from((host, port));
    info!(%addr, "Aura server listening");

    let listener = TcpListener::bind(addr).await.expect("failed to bind");
    axum::serve(listener, app).await.expect("server error");
}

/// Boot-time sanity check: if the deployment looks like it'll route
/// harness sessions off-box (a `SWARM_BASE_URL` is configured, or
/// `LOCAL_HARNESS_URL` resolves to a non-loopback host) and neither
/// `AURA_SERVER_BASE_URL` nor `VITE_API_URL` is set, log a hard
/// `warn!` naming the env vars so the operator sees the real misconfig
/// at deploy time rather than on the first cross-agent tool call hours
/// later.
///
/// When `AURA_STRICT_CONFIG=1` is set the process also exits with
/// status 1 — Render / CI can opt into fail-fast without breaking
/// local-dev setups that rely on the loopback fallback.
fn validate_control_plane_base_url_config() {
    if !remote_harness_is_likely() {
        return;
    }
    match aura_os_integrations::control_plane_api_base_url_or_error(true) {
        Ok(_) => {}
        Err(aura_os_integrations::ControlPlaneBaseUrlError::MissingForRemoteHarness {
            fallback_url,
        }) => {
            warn!(
                fallback_url = %fallback_url,
                "AURA_SERVER_BASE_URL (and VITE_API_URL fallback) are unset but the harness target appears to be off-box; \
                 cross-agent tool callbacks will attempt to reach `{fallback_url}` and fail. \
                 Set AURA_SERVER_BASE_URL (or reuse VITE_API_URL) to the server's public URL."
            );
            if std::env::var("AURA_STRICT_CONFIG").as_deref() == Ok("1") {
                warn!("AURA_STRICT_CONFIG=1 set; exiting due to control-plane base URL misconfig");
                std::process::exit(1);
            }
        }
    }
}

/// Heuristic mirror of
/// [`aura_os_server::handlers::agents::harness_target::harness_target_is_remote`]
/// without having access to a live agent's `machine_type`. Returns
/// `true` when the process-level configuration suggests harness
/// sessions will reach a non-loopback target. Intentionally kept crude
/// — false positives cost a log line at boot, false negatives would
/// mask the misconfig the guardrail is trying to surface.
fn remote_harness_is_likely() -> bool {
    let swarm_set = std::env::var("SWARM_BASE_URL")
        .ok()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    if swarm_set {
        return true;
    }
    let Ok(raw) = std::env::var("LOCAL_HARNESS_URL") else {
        return false;
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return false;
    }
    let Ok(parsed) = url::Url::parse(trimmed) else {
        return false;
    };
    match parsed.host_str() {
        Some(host) => {
            let normalized = host.trim_start_matches('[').trim_end_matches(']');
            !matches!(normalized, "127.0.0.1" | "::1")
                && !normalized.eq_ignore_ascii_case("localhost")
        }
        None => false,
    }
}
