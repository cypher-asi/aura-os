#![cfg_attr(
    all(target_os = "windows", not(debug_assertions)),
    windows_subsystem = "windows"
)]
#![allow(unexpected_cfgs)]

mod handlers;
mod route_state;
mod updater;

use aura_os_store::SettingsStore;
use axum::routing::{get as axum_get, post as axum_post};
use axum::Router;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener as StdTcpListener, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::time::Duration;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy};
use tao::window::{Icon, WindowBuilder, WindowId};
use tokio::net::TcpListener;
use tracing::{debug, info, warn};
use tracing_subscriber::EnvFilter;
use wry::{WebContext, WebViewBuilder};

use route_state::{normalize_restore_route, RouteState};
use updater::UpdateState;

const PREFERRED_PORT: u16 = 19847;
const PREFERRED_LOCAL_HARNESS_PORT: u16 = 19080;
const DEFAULT_FRONTEND_BIND_HOST: &str = "127.0.0.1";
const DEFAULT_FRONTEND_PORT: u16 = 5173;
const HOST_STORAGE_KEY: &str = "aura-host-origin";
const SESSION_STORAGE_KEY: &str = "aura-session";
const JWT_STORAGE_KEY: &str = "aura-jwt";
const INITIAL_BLANK_PAGE_URL: &str = "about:blank";
const FRONTEND_DEV_SERVER_POLL_INTERVAL: Duration = Duration::from_secs(1);
/// How long `main()` will block before creating the main webview waiting for
/// the Vite dev server to become reachable. The goal is to avoid loading the
/// axum-bundled frontend first and then hot-swapping to Vite via
/// `main_webview.load_url` once it comes up — that swap is a full document
/// teardown that the user perceives as "shell → black flash → shell again,
/// then app loads". By polling up front we make sure the very first URL we
/// navigate the webview to is already Vite, so the reveal is single-paint.
///
/// Only applies in debug builds (gated by `should_try_frontend_dev_server`).
/// The fallback reveal timer (`WINDOW_SHOW_FALLBACK_DELAY`) still bounds the
/// worst case if something upstream is much slower than expected, so a high
/// timeout here is safe. Overridable via
/// `AURA_DESKTOP_FRONTEND_DEV_READY_TIMEOUT_MS` (set to `0` to skip the wait).
const FRONTEND_DEV_SERVER_READY_TIMEOUT: Duration = Duration::from_secs(8);
const FRONTEND_DEV_SERVER_READY_POLL_INTERVAL: Duration = Duration::from_millis(100);
// Emergency-only rescue timer. The primary trigger to show the window is the
// IPC `ready` signal from the frontend (scheduled in `main.tsx` after React's
// first committed paint). The old 3 s value was short enough to routinely
// race the frontend's first paint and make the webview visible while React
// was still rendering `null`, which was the root cause of the login-screen
// flash chased across multiple commits. 15 s only kicks in if the frontend
// catastrophically fails to signal ready (JS bundle crash, network pipe
// stall, etc.), in which case showing a blank window is the desired
// behavior so the user isn't staring at an invisible process.
const WINDOW_SHOW_FALLBACK_DELAY: Duration = Duration::from_secs(15);
const VITE_CLI_RELATIVE_PATH: &str = "node_modules/vite/bin/vite.js";

#[derive(Debug)]
enum WinCmd {
    Minimize,
    Maximize,
    Close,
    Drag,
}

#[derive(Debug)]
pub(crate) enum UserEvent {
    WindowCommand {
        window_id: WindowId,
        cmd: WinCmd,
    },
    OpenIdeWindow {
        file_path: String,
        root_path: Option<String>,
    },
    ShowWindow {
        window_id: WindowId,
    },
    AttachFrontendDevServer {
        frontend_url: String,
    },
    InstallUpdate {
        state: UpdateState,
    },
    /// Stop managed sidecars and exit the event loop so a pending platform
    /// installer can overwrite this process's files. Posted by the updater
    /// immediately before calling `std::process::exit`.
    ShutdownForUpdate,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct FrontendDevServerCandidate {
    probe_url: String,
    frontend_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct FrontendTarget {
    url: String,
    host_origin: Option<String>,
    using_frontend_dev_server: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct FrontendDevServerConfig {
    frontend_url: String,
    bind_host: String,
    port: u16,
    can_spawn_local: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct BootstrappedAuthLiterals {
    session_literal: String,
    jwt_literal: String,
}

impl FrontendTarget {
    fn server(server_url: &str) -> Self {
        Self {
            url: server_url.to_string(),
            host_origin: None,
            using_frontend_dev_server: false,
        }
    }

    fn dev_server(server_url: &str, frontend_url: String) -> Self {
        Self {
            url: frontend_url,
            host_origin: Some(server_url.to_string()),
            using_frontend_dev_server: true,
        }
    }
}

fn ipc_handler(
    proxy: EventLoopProxy<UserEvent>,
    window_id: WindowId,
) -> impl Fn(wry::http::Request<String>) + 'static {
    move |req: wry::http::Request<String>| {
        let msg = req.body().trim();
        if msg == "ready" {
            debug!("IPC ready signal");
            let _ = proxy.send_event(UserEvent::ShowWindow { window_id });
            return;
        }
        let cmd = match msg {
            "minimize" => Some(WinCmd::Minimize),
            "maximize" => Some(WinCmd::Maximize),
            "close" => Some(WinCmd::Close),
            "drag" => Some(WinCmd::Drag),
            other => {
                warn!(message = other, "unknown IPC message");
                None
            }
        };
        if let Some(c) = cmd {
            debug!(command = msg, "IPC event");
            let _ = proxy.send_event(UserEvent::WindowCommand { window_id, cmd: c });
        }
    }
}

struct IconData {
    rgba: Vec<u8>,
    width: u32,
    height: u32,
}

impl IconData {
    fn to_icon(&self) -> Icon {
        Icon::from_rgba(self.rgba.clone(), self.width, self.height)
            .expect("failed to create icon from stored data")
    }
}

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

fn find_interface_dir() -> Option<PathBuf> {
    let compile_time = PathBuf::from(env!("INTERFACE_DIST_DIR"));
    if compile_time.join("index.html").exists() {
        return Some(compile_time);
    }

    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()));

    interface_dir_candidates(exe_dir.as_deref())
        .into_iter()
        .find(|p| p.join("index.html").exists())
}

fn interface_dir_candidates(exe_dir: Option<&Path>) -> Vec<PathBuf> {
    let mut candidates = vec![
        PathBuf::from("interface/dist"),
        PathBuf::from("../../interface/dist"),
    ];
    if let Some(dir) = exe_dir {
        candidates.push(dir.join("interface/dist"));
        candidates.push(dir.join("dist"));
        if let Some(contents_dir) = dir.parent() {
            candidates.push(contents_dir.join("Resources/dist"));
            candidates.push(contents_dir.join("Resources/interface/dist"));
        }
    }

    candidates
}

fn init_logging() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| {
            EnvFilter::new(
                "aura_os_desktop=debug,aura_os_server=debug,aura_engine=debug,tower_http=debug,info",
            )
        }))
        .init();
}

fn set_env_default(name: &str, value: &'static str) {
    if std::env::var_os(name).is_none() && !value.trim().is_empty() {
        std::env::set_var(name, value);
    }
}

fn apply_desktop_runtime_defaults() {
    set_env_default(
        "AURA_NETWORK_URL",
        env!("AURA_DESKTOP_DEFAULT_AURA_NETWORK_URL"),
    );
    set_env_default(
        "AURA_STORAGE_URL",
        env!("AURA_DESKTOP_DEFAULT_AURA_STORAGE_URL"),
    );
    set_env_default(
        "AURA_INTEGRATIONS_URL",
        env!("AURA_DESKTOP_DEFAULT_AURA_INTEGRATIONS_URL"),
    );
    set_env_default(
        "AURA_ROUTER_URL",
        env!("AURA_DESKTOP_DEFAULT_AURA_ROUTER_URL"),
    );
    set_env_default("Z_BILLING_URL", env!("AURA_DESKTOP_DEFAULT_Z_BILLING_URL"));
    set_env_default(
        "ORBIT_BASE_URL",
        env!("AURA_DESKTOP_DEFAULT_ORBIT_BASE_URL"),
    );
    set_env_default(
        "SWARM_BASE_URL",
        env!("AURA_DESKTOP_DEFAULT_SWARM_BASE_URL"),
    );
    set_env_default(
        "REQUIRE_ZERO_PRO",
        env!("AURA_DESKTOP_DEFAULT_REQUIRE_ZERO_PRO"),
    );
    set_env_default(
        "AURA_DISABLE_LOCAL_HARNESS_AUTOSPAWN",
        env!("AURA_DESKTOP_DEFAULT_DISABLE_LOCAL_HARNESS_AUTOSPAWN"),
    );
}

fn init_data_dirs() -> (PathBuf, PathBuf, Option<PathBuf>) {
    let data_dir = default_data_dir();
    std::fs::create_dir_all(&data_dir).expect("failed to create data directory");
    info!(path = %data_dir.display(), "data directory ready");

    let store_path = data_dir.join("store");
    migrate_legacy_db_dir(&data_dir, &store_path);
    let webview_data_dir = data_dir.join("webview");
    let interface_dir = find_interface_dir();
    match interface_dir {
        Some(ref dir) => info!(path = %dir.display(), "serving interface"),
        None => warn!("no interface dist found; pages will not load"),
    }
    (store_path, webview_data_dir, interface_dir)
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

fn harness_binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "aura-node.exe"
    } else {
        "aura-node"
    }
}

fn harness_resource_candidates() -> Vec<PathBuf> {
    let binary_name = harness_binary_name();
    let mut candidates = vec![
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources/sidecar")
            .join(binary_name),
        PathBuf::from("apps/aura-os-desktop/resources/sidecar").join(binary_name),
        PathBuf::from("resources/sidecar").join(binary_name),
    ];

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            candidates.push(exe_dir.join(binary_name));
            candidates.push(exe_dir.join("sidecar").join(binary_name));
            candidates.push(exe_dir.join("resources/sidecar").join(binary_name));
            if let Some(contents_dir) = exe_dir.parent() {
                candidates.push(contents_dir.join("Resources/sidecar").join(binary_name));
                candidates.push(
                    contents_dir
                        .join("Resources/resources/sidecar")
                        .join(binary_name),
                );
            }
        }
    }

    candidates
}

fn configured_harness_binary() -> Option<PathBuf> {
    if let Some(explicit) = env_string("AURA_HARNESS_BIN") {
        let path = PathBuf::from(explicit);
        if path.exists() {
            return Some(path);
        }
        warn!(path = %path.display(), "configured AURA_HARNESS_BIN does not exist");
    }
    None
}

fn find_bundled_harness_binary() -> Option<PathBuf> {
    harness_resource_candidates()
        .into_iter()
        .find(|path| path.is_file())
}

fn staged_harness_binary_name(source: &Path) -> String {
    let metadata = source.metadata().ok();
    let byte_len = metadata.as_ref().map(std::fs::Metadata::len).unwrap_or(0);
    let modified_secs = metadata
        .and_then(|value| value.modified().ok())
        .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|value| value.as_secs())
        .unwrap_or(0);
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("aura-node");
    let suffix = format!(
        "{stem}-{}-{byte_len}-{modified_secs}",
        env!("CARGO_PKG_VERSION")
    );
    match source.extension().and_then(|value| value.to_str()) {
        Some(ext) if !ext.is_empty() => format!("{suffix}.{ext}"),
        _ => suffix,
    }
}

fn stage_bundled_harness_binary(source: &Path, data_dir: &Path) -> Result<PathBuf, String> {
    let staged_dir = data_dir.join("runtime/sidecar");
    std::fs::create_dir_all(&staged_dir).map_err(|error| {
        format!(
            "failed to create staged harness directory {}: {error}",
            staged_dir.display()
        )
    })?;

    let staged_binary = staged_dir.join(staged_harness_binary_name(source));
    if staged_binary.is_file() {
        return Ok(staged_binary);
    }

    let temp_name = format!(
        ".{}.tmp-{}-{}",
        staged_binary
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("aura-node"),
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|value| value.as_nanos())
            .unwrap_or(0)
    );
    let temp_binary = staged_dir.join(temp_name);

    std::fs::copy(source, &temp_binary).map_err(|error| {
        format!(
            "failed to copy bundled harness {} to {}: {error}",
            source.display(),
            temp_binary.display()
        )
    })?;

    let source_permissions =
        source
            .metadata()
            .map(|value| value.permissions())
            .map_err(|error| {
                format!(
                    "failed to read bundled harness permissions {}: {error}",
                    source.display()
                )
            })?;
    if let Err(error) = std::fs::set_permissions(&temp_binary, source_permissions) {
        let _ = std::fs::remove_file(&temp_binary);
        return Err(format!(
            "failed to preserve bundled harness permissions on {}: {error}",
            temp_binary.display()
        ));
    }

    if let Err(error) = std::fs::rename(&temp_binary, &staged_binary) {
        if staged_binary.exists() {
            let _ = std::fs::remove_file(&temp_binary);
            return Ok(staged_binary);
        }
        let _ = std::fs::remove_file(&temp_binary);
        return Err(format!(
            "failed to move staged harness into place {} -> {}: {error}",
            temp_binary.display(),
            staged_binary.display()
        ));
    }

    Ok(staged_binary)
}

fn resolve_managed_harness_binary(data_dir: &Path) -> Option<PathBuf> {
    if let Some(explicit) = configured_harness_binary() {
        return Some(explicit);
    }

    let bundled = find_bundled_harness_binary()?;
    match stage_bundled_harness_binary(&bundled, data_dir) {
        Ok(staged) => {
            info!(
                source = %bundled.display(),
                staged = %staged.display(),
                "staged bundled local harness sidecar for runtime launch"
            );
            Some(staged)
        }
        Err(error) => {
            warn!(
                error = %error,
                source = %bundled.display(),
                "failed to stage bundled local harness sidecar; falling back to packaged resource"
            );
            Some(bundled)
        }
    }
}

fn parse_host_port(url: &str) -> Option<(String, u16)> {
    let uri: axum::http::Uri = url.parse().ok()?;
    let host = uri.host()?.to_string();
    let port = uri.port_u16().unwrap_or_else(|| {
        if uri.scheme_str() == Some("https") {
            443
        } else {
            80
        }
    });
    Some((host, port))
}

fn is_local_bind_host(host: &str) -> bool {
    matches!(host, "127.0.0.1" | "localhost" | "::1")
}

fn probe_http_ok(base_url: &str, path: &str) -> bool {
    let probe_url = format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    );
    let Ok(uri) = probe_url.parse::<axum::http::Uri>() else {
        return false;
    };
    let Some(host) = uri.host() else {
        return false;
    };
    let port = uri.port_u16().unwrap_or_else(|| {
        if uri.scheme_str() == Some("https") {
            443
        } else {
            80
        }
    });
    let Some(addr) = format!("{host}:{port}")
        .to_socket_addrs()
        .ok()
        .and_then(|mut addrs| addrs.next())
    else {
        return false;
    };
    let request_path = uri
        .path_and_query()
        .map(|value| value.as_str())
        .unwrap_or("/");

    let Ok(mut stream) = std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(300))
    else {
        return false;
    };

    let _ = stream.set_read_timeout(Some(Duration::from_millis(300)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(300)));

    if write!(
        stream,
        "GET {request_path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n"
    )
    .is_err()
    {
        return false;
    }

    let mut buf = [0_u8; 256];
    let Ok(n) = stream.read(&mut buf) else {
        return false;
    };
    if n == 0 {
        return false;
    }

    let response = String::from_utf8_lossy(&buf[..n]);
    response.starts_with("HTTP/1.1 200") || response.starts_with("HTTP/1.0 200")
}

/// Parsed CLI arguments for the desktop binary.
///
/// We intentionally avoid `clap` here: the desktop process is also launched
/// by installers / updaters that may pass platform-specific argv we don't
/// control, so unknown args must be tolerated rather than rejected.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct DesktopCliArgs {
    external_harness: bool,
}

fn parse_cli_args_from<I, S>(iter: I) -> DesktopCliArgs
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut args = DesktopCliArgs::default();
    for arg in iter {
        match arg.as_ref() {
            "--external-harness" => args.external_harness = true,
            _ => {}
        }
    }
    args
}

fn parse_cli_args() -> DesktopCliArgs {
    parse_cli_args_from(std::env::args().skip(1))
}

/// Validate that an external harness is actually reachable before we let the
/// desktop shell boot with bundled-sidecar autospawn disabled. If the env
/// isn't set or the harness isn't up, exit fast with a clear message instead
/// of silently coming up and surfacing as a 20-second tool-callback timeout
/// the first time an agent tries to act.
fn enforce_external_harness_or_exit() {
    let Some(url) = env_string("LOCAL_HARNESS_URL").map(|v| v.trim_end_matches('/').to_string())
    else {
        eprintln!(
            "--external-harness requires LOCAL_HARNESS_URL to be set to the URL of the running \
             external harness (e.g. http://127.0.0.1:3404)."
        );
        std::process::exit(2);
    };

    if !probe_http_ok(&url, "/health") {
        eprintln!(
            "--external-harness was passed but LOCAL_HARNESS_URL ({url}) is not reachable at \
             /health. Start the external harness first, then rerun."
        );
        std::process::exit(2);
    }

    std::env::set_var("AURA_DESKTOP_EXTERNAL_HARNESS", "1");
    info!(
        url = %url,
        "using external harness; bundled local harness sidecar autospawn disabled"
    );
}

fn maybe_spawn_local_harness_sidecar(data_dir: &Path) -> Option<Child> {
    let explicit_harness_url =
        env_string("LOCAL_HARNESS_URL").map(|value| value.trim_end_matches('/').to_string());
    let harness_binary = resolve_managed_harness_binary(data_dir);
    let harness_url = explicit_harness_url
        .clone()
        .unwrap_or_else(|| format!("http://127.0.0.1:{PREFERRED_LOCAL_HARNESS_PORT}"));

    if let Some(ref configured_url) = explicit_harness_url {
        if probe_http_ok(configured_url, "/health") {
            info!(url = %configured_url, "local harness already reachable");
            return None;
        }
    }

    let Some(harness_binary) = harness_binary else {
        if explicit_harness_url.is_some() {
            info!(url = %harness_url, "no managed local harness sidecar found; relying on configured external harness");
        } else {
            info!("no bundled local harness sidecar found; local harness support stays disabled");
        }
        return None;
    };

    std::env::set_var("LOCAL_HARNESS_URL", &harness_url);
    std::env::set_var("AURA_HARNESS_BIN", &harness_binary);

    if probe_http_ok(&harness_url, "/health") {
        info!(url = %harness_url, binary = %harness_binary.display(), "local harness already reachable");
        return None;
    }

    let Some((host, port)) = parse_host_port(&harness_url) else {
        warn!(url = %harness_url, "invalid LOCAL_HARNESS_URL for sidecar launch");
        return None;
    };
    if !is_local_bind_host(&host) {
        info!(url = %harness_url, "configured LOCAL_HARNESS_URL is not local; skipping bundled sidecar launch");
        return None;
    }

    let listen_addr = format!("{host}:{port}");
    let harness_data_dir = data_dir.join("harness");
    if let Err(error) = std::fs::create_dir_all(&harness_data_dir) {
        warn!(%error, path = %harness_data_dir.display(), "failed to create harness data directory");
        return None;
    }

    let mut command = Command::new(&harness_binary);
    command
        .env("AURA_LISTEN_ADDR", &listen_addr)
        .env("AURA_DATA_DIR", &harness_data_dir)
        .env("ENABLE_FS_TOOLS", "true")
        .env("ENABLE_CMD_TOOLS", "true");
    configure_background_child(&mut command, &harness_data_dir.join("sidecar.log"));

    if let Some(orbit_url) = env_string("ORBIT_URL").or_else(|| env_string("ORBIT_BASE_URL")) {
        command.env("ORBIT_URL", orbit_url);
    }

    match command.spawn() {
        Ok(child) => {
            let pid = child.id();
            let deadline = std::time::Instant::now() + Duration::from_secs(10);
            while std::time::Instant::now() < deadline {
                if probe_http_ok(&harness_url, "/health") {
                    info!(pid, url = %harness_url, binary = %harness_binary.display(), "started managed local harness sidecar");
                    return Some(child);
                }
                std::thread::sleep(Duration::from_millis(250));
            }
            warn!(pid, url = %harness_url, binary = %harness_binary.display(), "managed local harness sidecar did not become healthy before timeout");
            Some(child)
        }
        Err(error) => {
            warn!(%error, binary = %harness_binary.display(), "failed to start managed local harness sidecar");
            None
        }
    }
}

/// Configure a `Command` so it runs fully in the background: no console
/// window on Windows (the desktop app is a GUI-subsystem process and would
/// otherwise get a fresh console allocated for the console-subsystem child,
/// which is what used to pop up as a visible terminal next to the app) and
/// stdout/stderr redirected to a log file under the data directory rather
/// than inherited from a non-existent parent console.
fn configure_background_child(command: &mut Command, log_path: &Path) {
    command.stdin(Stdio::null());

    let log_file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path);

    match log_file.and_then(|file| file.try_clone().map(|clone| (file, clone))) {
        Ok((stdout_file, stderr_file)) => {
            command
                .stdout(Stdio::from(stdout_file))
                .stderr(Stdio::from(stderr_file));
        }
        Err(error) => {
            warn!(
                %error,
                path = %log_path.display(),
                "failed to open sidecar log file; discarding stdout/stderr"
            );
            command.stdout(Stdio::null()).stderr(Stdio::null());
        }
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

fn stop_managed_local_harness(managed_local_harness: &mut Option<Child>) {
    let Some(mut child) = managed_local_harness.take() else {
        return;
    };

    match child.try_wait() {
        Ok(Some(_)) => {}
        Ok(None) => {
            if let Err(error) = child.kill() {
                warn!(%error, pid = child.id(), "failed to stop bundled local harness sidecar");
            }
            let _ = child.wait();
        }
        Err(error) => {
            warn!(%error, pid = child.id(), "failed to query bundled local harness sidecar");
        }
    }
}

fn ci_mode_enabled() -> bool {
    std::env::var("AURA_DESKTOP_CI")
        .ok()
        .is_some_and(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
}

fn env_flag_enabled(name: &str) -> bool {
    std::env::var(name)
        .ok()
        .is_some_and(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
}

fn env_string(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn load_bootstrapped_auth_literals(store_path: &Path) -> Option<BootstrappedAuthLiterals> {
    let store = match SettingsStore::open(store_path) {
        Ok(store) => store,
        Err(error) => {
            warn!(
                %error,
                path = %store_path.display(),
                "failed to open settings store for desktop auth bootstrap"
            );
            return None;
        }
    };
    let session = store.get_cached_zero_auth_session()?;
    let session_literal = match serde_json::to_string(&session) {
        Ok(value) => value,
        Err(error) => {
            warn!(%error, "failed to serialize cached desktop auth session");
            return None;
        }
    };
    let jwt_literal = match serde_json::to_string(&session.access_token) {
        Ok(value) => value,
        Err(error) => {
            warn!(%error, "failed to serialize cached desktop auth token");
            return None;
        }
    };
    Some(BootstrappedAuthLiterals {
        session_literal,
        jwt_literal,
    })
}

fn build_frontend_dev_server_config(
    frontend_dev_url_override: Option<&str>,
    bind_host_override: Option<&str>,
    connect_host_override: Option<&str>,
    port_override: Option<u16>,
    ci_mode: bool,
) -> FrontendDevServerConfig {
    let bind_host = bind_host_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_FRONTEND_BIND_HOST)
        .to_string();
    let port = port_override.unwrap_or(DEFAULT_FRONTEND_PORT);

    if let Some(frontend_dev_url) = frontend_dev_url_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return FrontendDevServerConfig {
            frontend_url: frontend_dev_url.to_string(),
            bind_host,
            port,
            can_spawn_local: false,
        };
    }

    let connect_host = connect_host_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(bind_host.as_str());
    let connect_host = if connect_host == "0.0.0.0" {
        DEFAULT_FRONTEND_BIND_HOST
    } else {
        connect_host
    };

    FrontendDevServerConfig {
        frontend_url: format!("http://{connect_host}:{port}"),
        bind_host,
        port,
        can_spawn_local: !ci_mode,
    }
}

fn should_try_frontend_dev_server() -> bool {
    cfg!(debug_assertions) && !env_flag_enabled("AURA_DESKTOP_DISABLE_FRONTEND_DEV_SERVER")
}

fn build_frontend_dev_server_candidate(
    server_url: &str,
    frontend_dev_url: &str,
) -> FrontendDevServerCandidate {
    FrontendDevServerCandidate {
        probe_url: frontend_dev_url.to_string(),
        frontend_url: append_query_param(frontend_dev_url, "host", server_url),
    }
}

fn configured_frontend_dev_server_config() -> Option<FrontendDevServerConfig> {
    if !should_try_frontend_dev_server() {
        return None;
    }

    let frontend_dev_url = env_string("AURA_DESKTOP_FRONTEND_DEV_URL");
    let frontend_bind_host = env_string("AURA_FRONTEND_HOST");
    let frontend_connect_host = env_string("AURA_DESKTOP_FRONTEND_CONNECT_HOST");
    let frontend_port = env_string("AURA_FRONTEND_PORT")
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|port| *port > 0);

    Some(build_frontend_dev_server_config(
        frontend_dev_url.as_deref(),
        frontend_bind_host.as_deref(),
        frontend_connect_host.as_deref(),
        frontend_port,
        ci_mode_enabled(),
    ))
}

fn append_query_param(url: &str, key: &str, value: &str) -> String {
    let separator = if url.contains('?') { '&' } else { '?' };
    format!("{}{separator}{key}={value}", url.trim_end_matches('/'))
}

fn apply_restore_route(base_url: &str, restore_route: Option<&str>) -> String {
    let Some(route) = restore_route.and_then(normalize_restore_route) else {
        return base_url.to_string();
    };

    let (route_without_hash, route_hash) = match route.split_once('#') {
        Some((value, fragment)) => (value, Some(fragment)),
        None => (route.as_str(), None),
    };
    let (route_path, route_query) = match route_without_hash.split_once('?') {
        Some((value, query)) => (value, Some(query)),
        None => (route_without_hash, None),
    };
    let (base_without_hash, base_hash) = match base_url.split_once('#') {
        Some((value, fragment)) => (value, Some(fragment)),
        None => (base_url, None),
    };
    let (base_without_query, base_query) = match base_without_hash.split_once('?') {
        Some((value, query)) => (value, Some(query)),
        None => (base_without_hash, None),
    };

    let mut url = format!("{}{}", base_without_query.trim_end_matches('/'), route_path);
    let mut query_parts = Vec::new();
    if let Some(query) = route_query.filter(|value| !value.is_empty()) {
        query_parts.push(query);
    }
    if let Some(query) = base_query.filter(|value| !value.is_empty()) {
        query_parts.push(query);
    }

    if !query_parts.is_empty() {
        url.push('?');
        url.push_str(&query_parts.join("&"));
    }

    if let Some(fragment) = route_hash
        .filter(|value| !value.is_empty())
        .or(base_hash.filter(|value| !value.is_empty()))
    {
        url.push('#');
        url.push_str(fragment);
    }

    url
}

fn probe_vite_dev_server(base_url: &str) -> bool {
    let probe_url = format!("{}/@vite/client", base_url.trim_end_matches('/'));
    let Ok(uri) = probe_url.parse::<axum::http::Uri>() else {
        return false;
    };
    let Some(host) = uri.host() else {
        return false;
    };
    let port = uri.port_u16().unwrap_or_else(|| {
        if uri.scheme_str() == Some("https") {
            443
        } else {
            80
        }
    });
    let Some(addr) = format!("{host}:{port}")
        .to_socket_addrs()
        .ok()
        .and_then(|mut addrs| addrs.next())
    else {
        return false;
    };
    let path = uri
        .path_and_query()
        .map(|value| value.as_str())
        .unwrap_or("/@vite/client");

    let Ok(mut stream) = std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(250))
    else {
        return false;
    };

    let _ = stream.set_read_timeout(Some(Duration::from_millis(250)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(250)));

    if write!(
        stream,
        "GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n"
    )
    .is_err()
    {
        return false;
    }

    let mut buf = [0_u8; 256];
    let Ok(n) = stream.read(&mut buf) else {
        return false;
    };
    if n == 0 {
        return false;
    }

    let response = String::from_utf8_lossy(&buf[..n]);
    response.starts_with("HTTP/1.1 200") || response.starts_with("HTTP/1.0 200")
}

fn resolve_frontend_target_with_probe(
    server_url: &str,
    frontend_dev_candidate: Option<&FrontendDevServerCandidate>,
    frontend_dev_server_available: bool,
) -> FrontendTarget {
    match (frontend_dev_candidate, frontend_dev_server_available) {
        (Some(candidate), true) => {
            FrontendTarget::dev_server(server_url, candidate.frontend_url.clone())
        }
        _ => FrontendTarget::server(server_url),
    }
}

fn should_poll_for_frontend_dev_server(
    using_frontend_dev_server: bool,
    frontend_dev_candidate: Option<&FrontendDevServerCandidate>,
) -> bool {
    frontend_dev_candidate.is_some() && !using_frontend_dev_server
}

fn configured_frontend_dev_server_ready_timeout() -> Duration {
    match env_string("AURA_DESKTOP_FRONTEND_DEV_READY_TIMEOUT_MS")
        .and_then(|value| value.parse::<u64>().ok())
    {
        Some(ms) => Duration::from_millis(ms),
        None => FRONTEND_DEV_SERVER_READY_TIMEOUT,
    }
}

/// Polls `probe` at `interval` until it returns `true` or `timeout` elapses.
/// Returns whether the probe ever returned `true`. Factored out so tests can
/// inject a deterministic probe without touching the network.
///
/// `timeout == 0` skips the wait entirely and returns the result of a single
/// synchronous probe (the caller's existing one-shot behavior).
fn wait_for_frontend_dev_server_with_probe<F: FnMut() -> bool>(
    mut probe: F,
    timeout: Duration,
    interval: Duration,
) -> bool {
    if timeout.is_zero() {
        return probe();
    }
    let deadline = std::time::Instant::now() + timeout;
    loop {
        if probe() {
            return true;
        }
        let now = std::time::Instant::now();
        if now >= deadline {
            return false;
        }
        let remaining = deadline - now;
        std::thread::sleep(interval.min(remaining));
    }
}

/// Block the current thread (up to `timeout`) until the Vite dev server at
/// `candidate.probe_url` responds. Called before `create_main_webview` so the
/// webview's first navigation can go straight to Vite and avoid the visible
/// "axum bundle first, then reload into Vite" flash.
fn wait_for_frontend_dev_server(candidate: &FrontendDevServerCandidate, timeout: Duration) -> bool {
    if timeout.is_zero() {
        return probe_vite_dev_server(&candidate.probe_url);
    }
    info!(
        frontend = %candidate.probe_url,
        timeout_ms = timeout.as_millis() as u64,
        "waiting for Vite frontend dev server before creating webview"
    );
    let started_at = std::time::Instant::now();
    let probe_url = candidate.probe_url.clone();
    let ready = wait_for_frontend_dev_server_with_probe(
        || probe_vite_dev_server(&probe_url),
        timeout,
        FRONTEND_DEV_SERVER_READY_POLL_INTERVAL,
    );
    let elapsed_ms = started_at.elapsed().as_millis() as u64;
    if ready {
        info!(
            frontend = %candidate.probe_url,
            elapsed_ms,
            "Vite frontend dev server reachable before webview creation"
        );
    } else {
        warn!(
            frontend = %candidate.probe_url,
            elapsed_ms,
            "Vite frontend dev server not reachable before timeout; falling back to bundled frontend (a reload swap may flash when it does come up)"
        );
    }
    ready
}

fn spawn_frontend_dev_server_poller(
    proxy: EventLoopProxy<UserEvent>,
    frontend_dev_candidate: FrontendDevServerCandidate,
) {
    info!(
        frontend = %frontend_dev_candidate.probe_url,
        "waiting for Vite frontend dev server"
    );

    std::thread::spawn(move || loop {
        if probe_vite_dev_server(&frontend_dev_candidate.probe_url) {
            info!(
                frontend = %frontend_dev_candidate.probe_url,
                "Vite frontend dev server became available"
            );
            let _ = proxy.send_event(UserEvent::AttachFrontendDevServer {
                frontend_url: frontend_dev_candidate.frontend_url.clone(),
            });
            break;
        }

        std::thread::sleep(FRONTEND_DEV_SERVER_POLL_INTERVAL);
    });
}

fn find_interface_project_dir() -> Option<PathBuf> {
    let compile_time = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../interface");
    if compile_time.join("package.json").exists() {
        return Some(compile_time);
    }

    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|dir| dir.to_path_buf()));

    let mut candidates = vec![PathBuf::from("interface"), PathBuf::from("../../interface")];
    if let Some(ref dir) = exe_dir {
        candidates.push(dir.join("interface"));
        candidates.push(dir.join("../../interface"));
    }

    candidates
        .into_iter()
        .find(|path| path.join("package.json").exists())
}

fn maybe_spawn_frontend_dev_server(
    server_port: u16,
    frontend_dev_server_config: Option<&FrontendDevServerConfig>,
    frontend_dev_candidate: Option<&FrontendDevServerCandidate>,
) -> Option<Child> {
    let (Some(frontend_dev_server_config), Some(frontend_dev_candidate)) =
        (frontend_dev_server_config, frontend_dev_candidate)
    else {
        return None;
    };

    if !frontend_dev_server_config.can_spawn_local
        || probe_vite_dev_server(&frontend_dev_candidate.probe_url)
    {
        return None;
    }

    let Some(interface_dir) = find_interface_project_dir() else {
        warn!("interface project directory not found; continuing with bundled frontend");
        return None;
    };
    let vite_cli = interface_dir.join(VITE_CLI_RELATIVE_PATH);
    if !vite_cli.exists() {
        warn!(
            path = %vite_cli.display(),
            "Vite CLI not found; continuing with bundled frontend"
        );
        return None;
    }

    let mut command = Command::new("node");
    command
        .arg(&vite_cli)
        .arg("--host")
        .arg(&frontend_dev_server_config.bind_host)
        .arg("--port")
        .arg(frontend_dev_server_config.port.to_string())
        .arg("--strictPort")
        .current_dir(&interface_dir)
        .env("AURA_SERVER_PORT", server_port.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    match command.spawn() {
        Ok(child) => {
            info!(
                frontend = %frontend_dev_candidate.probe_url,
                pid = child.id(),
                "started managed Vite frontend dev server"
            );
            Some(child)
        }
        Err(error) => {
            warn!(
                %error,
                frontend = %frontend_dev_candidate.probe_url,
                "failed to start managed Vite frontend dev server"
            );
            None
        }
    }
}

fn stop_managed_frontend_dev_server(frontend_dev_server: &mut Option<Child>) {
    let Some(mut child) = frontend_dev_server.take() else {
        return;
    };

    match child.try_wait() {
        Ok(Some(_)) => {}
        Ok(None) => {
            if let Err(error) = child.kill() {
                warn!(
                    %error,
                    pid = child.id(),
                    "failed to stop managed Vite frontend dev server"
                );
            }
            let _ = child.wait();
        }
        Err(error) => {
            warn!(
                %error,
                pid = child.id(),
                "failed to query managed Vite frontend dev server"
            );
        }
    }
}

/// Parse an explicit control-plane override URL just far enough to
/// decide whether it points at loopback on a port **different from**
/// the one we actually bound. Used by the desktop startup self-heal
/// to strip stale `AURA_SERVER_BASE_URL` / `VITE_API_URL` values that
/// would otherwise make
/// `aura_os_integrations::control_plane_api_base_url()` pin every
/// `send_to_agent` callback to a port nothing listens on (classic
/// symptom: "operation timed out" on 127.0.0.1:19847 even though the
/// embedded server bound an ephemeral port because 19847 was taken).
///
/// Returns `false` when:
///   * the URL can't be parsed as `http[s]://host[:port][/...]`,
///   * the host is not a recognised loopback literal (`127.0.0.1`,
///     `::1`, `localhost`), or
///   * no explicit port is present, or
///   * the explicit port already equals `bound_port`.
///
/// We deliberately don't strip non-loopback overrides — prod
/// deployments legitimately set these to a public URL.
fn url_is_loopback_with_port_other_than(url: &str, bound_port: u16) -> bool {
    match parse_loopback_port(url) {
        Some(port) => port != bound_port,
        None => false,
    }
}

/// Companion to [`url_is_loopback_with_port_other_than`] used by the
/// startup diagnostics log: returns `true` if `url` is a non-loopback
/// URL (prod override — mismatch is not our concern) **or** a loopback
/// URL whose port matches `bound_port`. Any surviving `false` after
/// the self-heal ran indicates a loopback override the self-heal
/// missed and is logged at error level.
fn url_loopback_port_matches(url: &str, bound_port: u16) -> bool {
    match parse_loopback_port(url) {
        Some(port) => port == bound_port,
        None => true,
    }
}

/// Extract the explicit port from a loopback-hosted URL, if any.
/// Returns `None` for any non-loopback host and for loopback URLs
/// without an explicit port (we can't compare against `bound_port`
/// in that case, so the caller defaults to "match").
fn parse_loopback_port(url: &str) -> Option<u16> {
    let trimmed = url.trim();
    // Scheme is case-insensitive per RFC 3986 — users legitimately
    // type `HTTP://...` in env files and we don't want the log to be
    // misleadingly quiet for those.
    let scheme_prefix_len = if trimmed.len() >= 7 && trimmed[..7].eq_ignore_ascii_case("http://") {
        7
    } else if trimmed.len() >= 8 && trimmed[..8].eq_ignore_ascii_case("https://") {
        8
    } else {
        return None;
    };
    let without_scheme = &trimmed[scheme_prefix_len..];
    let authority = without_scheme
        .split_once('/')
        .map(|(a, _)| a)
        .unwrap_or(without_scheme);
    let authority = authority
        .split_once('?')
        .map(|(a, _)| a)
        .unwrap_or(authority);
    let authority = authority
        .split_once('#')
        .map(|(a, _)| a)
        .unwrap_or(authority);
    let (host, port_str) = if let Some(stripped) = authority.strip_prefix('[') {
        // IPv6 literal: `[::1]:port`.
        let (host, rest) = stripped.split_once(']')?;
        let port_str = rest.strip_prefix(':')?;
        (host.to_string(), port_str)
    } else {
        let (host, port_str) = authority.split_once(':')?;
        (host.to_string(), port_str)
    };
    if !host_is_loopback(&host) {
        return None;
    }
    port_str.parse::<u16>().ok()
}

fn host_is_loopback(host: &str) -> bool {
    let normalized = host.trim().trim_start_matches('[').trim_end_matches(']');
    matches!(normalized, "127.0.0.1" | "::1") || normalized.eq_ignore_ascii_case("localhost")
}

fn bind_listener() -> (StdTcpListener, u16, String) {
    let configured_port = std::env::var("AURA_SERVER_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|port| *port > 0);

    let bind_fallback_listener = || {
        StdTcpListener::bind(format!("127.0.0.1:{PREFERRED_PORT}"))
            .or_else(|_| StdTcpListener::bind("127.0.0.1:0"))
            .expect("failed to bind to an available port")
    };

    let std_listener = if let Some(port) = configured_port {
        match StdTcpListener::bind(format!("127.0.0.1:{port}")) {
            Ok(listener) => listener,
            Err(error) if ci_mode_enabled() => {
                panic!("failed to bind configured AURA_SERVER_PORT={port}: {error}")
            }
            Err(error) => {
                warn!(
                    %error,
                    configured_port = port,
                    fallback_port = PREFERRED_PORT,
                    "configured AURA_SERVER_PORT unavailable; falling back to an available port"
                );
                bind_fallback_listener()
            }
        }
    } else {
        bind_fallback_listener()
    };
    std_listener
        .set_nonblocking(true)
        .expect("failed to set non-blocking");
    let port = std_listener
        .local_addr()
        .expect("listener must have local address")
        .port();
    let url = format!("http://127.0.0.1:{port}");
    info!(%url, "server binding ready");
    (std_listener, port, url)
}

fn spawn_server(
    std_listener: StdTcpListener,
    store_path: PathBuf,
    interface_dir: Option<PathBuf>,
    ide_proxy: Arc<EventLoopProxy<UserEvent>>,
    route_state: RouteState,
) -> std::sync::mpsc::Receiver<()> {
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<()>();

    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().expect("failed to create tokio runtime");
        rt.block_on(async move {
            let updater_data_dir = store_path
                .parent()
                .map(std::path::Path::to_path_buf)
                .unwrap_or_else(|| store_path.clone());
            let update_state = UpdateState::load(&updater_data_dir);
            {
                let shutdown_proxy = Arc::clone(&ide_proxy);
                update_state.set_shutdown_hook(move || {
                    if let Err(error) = shutdown_proxy.send_event(UserEvent::ShutdownForUpdate) {
                        warn!(%error, "failed to post ShutdownForUpdate event");
                    }
                });
            }
            let update_install_state = handlers::UpdateInstallRouteState {
                proxy: ide_proxy.clone(),
                update_state: update_state.clone(),
            };

            let app_state = aura_os_server::build_app_state(&store_path)
                .expect("failed to open local settings store");
            let desktop_routes = Router::new()
                .route("/api/pick-folder", axum_post(handlers::pick_folder))
                .route("/api/pick-file", axum_post(handlers::pick_file))
                .route(
                    "/api/last-route",
                    axum_post(handlers::post_last_route).with_state(route_state.clone()),
                )
                .route("/api/open-path", axum_post(handlers::open_path))
                .route("/api/write-file", axum_post(handlers::write_file))
                .route(
                    "/api/open-ide",
                    axum_post(handlers::open_ide).with_state(ide_proxy),
                )
                .route(
                    "/api/update-status",
                    axum_get(handlers::get_update_status).with_state(update_state.clone()),
                )
                .route(
                    "/api/runtime-config",
                    axum_get(handlers::get_runtime_config),
                )
                .route(
                    "/api/update-install",
                    axum_post(handlers::post_update_install).with_state(update_install_state),
                )
                .route(
                    "/api/update-check",
                    axum_post(handlers::post_update_check).with_state(update_state.clone()),
                )
                .route(
                    "/api/update-channel",
                    axum_post(handlers::post_update_channel).with_state(update_state.clone()),
                )
                .layer(aura_os_server::build_local_api_cors_layer());

            let app = aura_os_server::create_router_with_interface(app_state, interface_dir)
                .merge(desktop_routes);

            updater::spawn_update_loop(update_state);

            let listener = TcpListener::from_std(std_listener).expect("failed to create listener");

            let _ = ready_tx.send(());
            axum::serve(listener, app).await.expect("server error");
        });
    });

    ready_rx
}

fn set_square_corners(_window: &tao::window::Window) {
    #[cfg(target_os = "windows")]
    {
        use tao::platform::windows::WindowExtWindows;
        use windows::Win32::Foundation::HWND;
        use windows::Win32::Graphics::Dwm::{
            DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWM_WINDOW_CORNER_PREFERENCE,
        };

        let hwnd = HWND(_window.hwnd() as *mut std::ffi::c_void);
        let preference = DWM_WINDOW_CORNER_PREFERENCE(1); // DWMWCP_DONOTROUND
        let _ = unsafe {
            DwmSetWindowAttribute(
                hwnd,
                DWMWA_WINDOW_CORNER_PREFERENCE,
                &preference as *const _ as *const _,
                std::mem::size_of::<DWM_WINDOW_CORNER_PREFERENCE>() as u32,
            )
        };
    }

    #[cfg(target_os = "macos")]
    {
        use objc::{sel, sel_impl};
        use tao::platform::macos::WindowExtMacOS;

        unsafe {
            let ns_window = _window.ns_window() as *mut objc::runtime::Object;
            let content_view: *mut objc::runtime::Object = objc::msg_send![ns_window, contentView];
            let _: () = objc::msg_send![content_view, setWantsLayer: true];
            let layer: *mut objc::runtime::Object = objc::msg_send![content_view, layer];
            let _: () = objc::msg_send![layer, setCornerRadius: 0.0_f64];
            let _: () = objc::msg_send![layer, setMasksToBounds: true];
        }
    }

    // Linux: frameless windows don't have app-controllable corner rounding.
    // Any rounding from the compositor (e.g. Mutter, KWin) cannot be overridden.
}

#[cfg(test)]
mod tests {
    use super::{
        append_query_param, apply_restore_route, build_frontend_dev_server_candidate,
        build_frontend_dev_server_config, build_initialization_script, harness_binary_name,
        interface_dir_candidates, is_local_bind_host, parse_cli_args_from, parse_host_port,
        resolve_frontend_target_with_probe, should_poll_for_frontend_dev_server,
        stage_bundled_harness_binary, wait_for_frontend_dev_server_with_probe,
        BootstrappedAuthLiterals,
    };
    use std::cell::Cell;
    use std::path::{Path, PathBuf};
    use std::time::{Duration, Instant};

    #[test]
    fn parse_cli_args_defaults_to_no_external_harness() {
        let args = parse_cli_args_from(Vec::<String>::new());
        assert!(!args.external_harness);
    }

    #[test]
    fn parse_cli_args_detects_external_harness_flag() {
        let args = parse_cli_args_from(["--external-harness"]);
        assert!(args.external_harness);
    }

    #[test]
    fn parse_cli_args_tolerates_unknown_flags() {
        let args = parse_cli_args_from(["--some-installer-arg", "--external-harness", "ignored"]);
        assert!(args.external_harness);
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn square_corners_uses_donotround_preference() {
        use windows::Win32::Graphics::Dwm::DWM_WINDOW_CORNER_PREFERENCE;

        let pref = DWM_WINDOW_CORNER_PREFERENCE(1);
        assert_eq!(pref.0, 1, "DWMWCP_DONOTROUND must be 1");
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn dwm_corner_preference_size_is_four_bytes() {
        use windows::Win32::Graphics::Dwm::DWM_WINDOW_CORNER_PREFERENCE;

        assert_eq!(
            std::mem::size_of::<DWM_WINDOW_CORNER_PREFERENCE>(),
            4,
            "DWM_WINDOW_CORNER_PREFERENCE must be 4 bytes for DwmSetWindowAttribute"
        );
    }

    #[test]
    fn append_query_param_preserves_existing_query() {
        assert_eq!(
            append_query_param(
                "http://127.0.0.1:5173?foo=bar",
                "host",
                "http://127.0.0.1:19847",
            ),
            "http://127.0.0.1:5173?foo=bar&host=http://127.0.0.1:19847"
        );
    }

    #[test]
    fn build_frontend_dev_server_candidate_preserves_existing_query() {
        let candidate = build_frontend_dev_server_candidate(
            "http://127.0.0.1:19847",
            "http://127.0.0.1:5173?foo=bar",
        );

        assert_eq!(candidate.probe_url, "http://127.0.0.1:5173?foo=bar");
        assert_eq!(
            candidate.frontend_url,
            "http://127.0.0.1:5173?foo=bar&host=http://127.0.0.1:19847"
        );
    }

    #[test]
    fn apply_restore_route_preserves_route_query_and_base_query() {
        assert_eq!(
            apply_restore_route(
                "http://127.0.0.1:5173?host=http://127.0.0.1:19847",
                Some("/projects/demo?session=abc#panel"),
            ),
            "http://127.0.0.1:5173/projects/demo?session=abc&host=http://127.0.0.1:19847#panel"
        );
    }

    #[test]
    fn apply_restore_route_strips_host_from_saved_route() {
        assert_eq!(
            apply_restore_route(
                "http://127.0.0.1:5173?host=http://127.0.0.1:19847",
                Some("/projects/demo?session=abc&host=http://127.0.0.1:19847"),
            ),
            "http://127.0.0.1:5173/projects/demo?session=abc&host=http://127.0.0.1:19847"
        );
    }

    #[test]
    fn build_frontend_dev_server_config_uses_local_defaults() {
        let config = build_frontend_dev_server_config(None, None, None, None, false);

        assert_eq!(config.frontend_url, "http://127.0.0.1:5173");
        assert_eq!(config.bind_host, "127.0.0.1");
        assert_eq!(config.port, 5173);
        assert!(config.can_spawn_local);
    }

    #[test]
    fn build_frontend_dev_server_config_normalizes_wildcard_bind_host() {
        let config =
            build_frontend_dev_server_config(None, Some("0.0.0.0"), None, Some(5173), false);

        assert_eq!(config.frontend_url, "http://127.0.0.1:5173");
        assert_eq!(config.bind_host, "0.0.0.0");
        assert!(config.can_spawn_local);
    }

    #[test]
    fn build_frontend_dev_server_config_disables_spawn_for_explicit_url() {
        let config = build_frontend_dev_server_config(
            Some("http://192.168.1.42:5179"),
            Some("127.0.0.1"),
            Some("127.0.0.1"),
            Some(5173),
            false,
        );

        assert_eq!(config.frontend_url, "http://192.168.1.42:5179");
        assert!(!config.can_spawn_local);
    }

    #[test]
    fn resolve_frontend_target_prefers_vite_when_available() {
        let server_url = "http://127.0.0.1:19847";
        let candidate = build_frontend_dev_server_candidate(server_url, "http://127.0.0.1:5173");

        let target = resolve_frontend_target_with_probe(server_url, Some(&candidate), true);

        assert_eq!(
            target.url,
            "http://127.0.0.1:5173?host=http://127.0.0.1:19847"
        );
        assert_eq!(target.host_origin.as_deref(), Some(server_url));
        assert!(target.using_frontend_dev_server);
    }

    #[test]
    fn resolve_frontend_target_falls_back_when_vite_unavailable() {
        let server_url = "http://127.0.0.1:19847";
        let candidate = build_frontend_dev_server_candidate(server_url, "http://127.0.0.1:5173");

        let target = resolve_frontend_target_with_probe(server_url, Some(&candidate), false);

        assert_eq!(target.url, server_url);
        assert_eq!(target.host_origin, None);
        assert!(!target.using_frontend_dev_server);
    }

    #[test]
    fn wait_for_frontend_dev_server_returns_early_when_probe_succeeds() {
        let calls = Cell::new(0_u32);
        let started_at = Instant::now();

        let ready = wait_for_frontend_dev_server_with_probe(
            || {
                let count = calls.get() + 1;
                calls.set(count);
                count >= 3
            },
            Duration::from_secs(5),
            Duration::from_millis(5),
        );

        assert!(ready, "probe eventually succeeded, wait must return true");
        assert_eq!(
            calls.get(),
            3,
            "wait must stop calling the probe as soon as it returns true"
        );
        assert!(
            started_at.elapsed() < Duration::from_secs(1),
            "early-success path must not consume the full timeout"
        );
    }

    #[test]
    fn wait_for_frontend_dev_server_returns_false_after_timeout() {
        let calls = Cell::new(0_u32);
        let timeout = Duration::from_millis(60);
        let started_at = Instant::now();

        let ready = wait_for_frontend_dev_server_with_probe(
            || {
                calls.set(calls.get() + 1);
                false
            },
            timeout,
            Duration::from_millis(10),
        );

        assert!(!ready, "probe never succeeded, wait must return false");
        assert!(
            calls.get() >= 1,
            "wait must probe at least once before timing out"
        );
        assert!(
            started_at.elapsed() >= timeout,
            "wait must honor the full timeout before giving up"
        );
    }

    #[test]
    fn wait_for_frontend_dev_server_with_zero_timeout_probes_once() {
        let calls = Cell::new(0_u32);

        let ready = wait_for_frontend_dev_server_with_probe(
            || {
                calls.set(calls.get() + 1);
                true
            },
            Duration::ZERO,
            Duration::from_millis(10),
        );

        assert!(ready);
        assert_eq!(
            calls.get(),
            1,
            "zero-timeout wait must not loop — it's a single synchronous probe"
        );
    }

    #[test]
    fn frontend_dev_server_poller_only_runs_when_needed() {
        let candidate =
            build_frontend_dev_server_candidate("http://127.0.0.1:19847", "http://127.0.0.1:5173");

        assert!(should_poll_for_frontend_dev_server(false, Some(&candidate)));
        assert!(!should_poll_for_frontend_dev_server(true, Some(&candidate)));
        assert!(!should_poll_for_frontend_dev_server(false, None));
    }

    #[test]
    fn desktop_runtime_defaults_include_hosted_services() {
        assert_eq!(
            env!("AURA_DESKTOP_DEFAULT_AURA_NETWORK_URL"),
            "https://aura-network.onrender.com"
        );
        assert_eq!(
            env!("AURA_DESKTOP_DEFAULT_AURA_STORAGE_URL"),
            "https://aura-storage.onrender.com"
        );
        assert_eq!(
            env!("AURA_DESKTOP_DEFAULT_AURA_INTEGRATIONS_URL"),
            "https://aura-integrations.onrender.com"
        );
        assert_eq!(
            env!("AURA_DESKTOP_DEFAULT_AURA_ROUTER_URL"),
            "https://aura-router.onrender.com"
        );
        assert_eq!(
            env!("AURA_DESKTOP_DEFAULT_Z_BILLING_URL"),
            "https://z-billing.onrender.com"
        );
        assert_eq!(
            env!("AURA_DESKTOP_DEFAULT_ORBIT_BASE_URL"),
            "https://orbit-sfvu.onrender.com"
        );
        assert_eq!(
            env!("AURA_DESKTOP_DEFAULT_SWARM_BASE_URL"),
            "http://ab6d2375031e74ce1976fdf62ea951a4-e757483aaffba396.elb.us-east-2.amazonaws.com"
        );
        assert_eq!(env!("AURA_DESKTOP_DEFAULT_REQUIRE_ZERO_PRO"), "true");
        assert_eq!(
            env!("AURA_DESKTOP_DEFAULT_DISABLE_LOCAL_HARNESS_AUTOSPAWN"),
            "true"
        );
    }

    #[test]
    fn interface_dir_candidates_include_macos_bundle_resources() {
        let exe_dir = Path::new("/tmp/Aura.app/Contents/MacOS");
        let candidates = interface_dir_candidates(Some(exe_dir));

        assert!(candidates.contains(&PathBuf::from("/tmp/Aura.app/Contents/Resources/dist")));
        assert!(candidates.contains(&PathBuf::from(
            "/tmp/Aura.app/Contents/Resources/interface/dist"
        )));
    }

    #[test]
    fn build_initialization_script_persists_host_origin() {
        let script = build_initialization_script(Some("http://127.0.0.1:19847"), None);
        assert!(script.contains("aura-host-origin"));
        assert!(script.contains("http://127.0.0.1:19847"));
        assert!(!script.contains("window.ipc.postMessage('ready')"));
    }

    #[test]
    fn build_initialization_script_bootstraps_cached_auth() {
        let auth = BootstrappedAuthLiterals {
            session_literal:
                "{\"user_id\":\"u1\",\"display_name\":\"Test\",\"access_token\":\"jwt\"}"
                    .to_string(),
            jwt_literal: "\"jwt\"".to_string(),
        };
        let script = build_initialization_script(Some("http://127.0.0.1:19847"), Some(&auth));
        assert!(script.contains("aura-session"));
        assert!(script.contains("aura-jwt"));
        assert!(script.contains("\"jwt\""));
    }

    #[test]
    fn build_initialization_script_injects_boot_auth_global_when_logged_in() {
        let auth = BootstrappedAuthLiterals {
            session_literal:
                "{\"user_id\":\"u1\",\"display_name\":\"Test\",\"access_token\":\"jwt\"}"
                    .to_string(),
            jwt_literal: "\"jwt\"".to_string(),
        };
        let script = build_initialization_script(Some("http://127.0.0.1:19847"), Some(&auth));
        assert!(script.contains("__AURA_BOOT_AUTH__"));
        assert!(script.contains("isLoggedIn: true"));
        assert!(script.contains("\"user_id\":\"u1\""));
        assert!(script.contains("Object.freeze"));
    }

    #[test]
    fn build_initialization_script_injects_boot_auth_global_when_logged_out() {
        let script = build_initialization_script(Some("http://127.0.0.1:19847"), None);
        assert!(script.contains("__AURA_BOOT_AUTH__"));
        assert!(script.contains("isLoggedIn: false"));
        assert!(script.contains("session: null"));
        assert!(script.contains("jwt: null"));
    }

    #[test]
    fn parse_host_port_extracts_local_harness_bind_target() {
        assert_eq!(
            parse_host_port("http://127.0.0.1:19080"),
            Some(("127.0.0.1".to_string(), 19080))
        );
        assert_eq!(
            parse_host_port("https://localhost"),
            Some(("localhost".to_string(), 443))
        );
    }

    #[test]
    fn is_local_bind_host_only_accepts_loopback_targets() {
        assert!(is_local_bind_host("127.0.0.1"));
        assert!(is_local_bind_host("localhost"));
        assert!(is_local_bind_host("::1"));
        assert!(!is_local_bind_host("0.0.0.0"));
        assert!(!is_local_bind_host("harness.example.com"));
    }

    fn unique_test_dir(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "aura-os-desktop-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|value| value.as_nanos())
                .unwrap_or(0)
        ))
    }

    #[test]
    fn stage_bundled_harness_binary_copies_into_runtime_dir() {
        let root = unique_test_dir("stage-sidecar");
        let source_dir = root.join("install/resources/sidecar");
        let data_dir = root.join("data");
        std::fs::create_dir_all(&source_dir).unwrap();
        std::fs::create_dir_all(&data_dir).unwrap();

        let source = source_dir.join(harness_binary_name());
        std::fs::write(&source, b"fake-sidecar-binary").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&source).unwrap().permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&source, perms).unwrap();
        }

        let staged = stage_bundled_harness_binary(&source, &data_dir).unwrap();
        assert_ne!(staged, source);
        assert!(staged.starts_with(data_dir.join("runtime/sidecar")));
        assert_eq!(std::fs::read(&staged).unwrap(), b"fake-sidecar-binary");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_ne!(
                std::fs::metadata(&staged).unwrap().permissions().mode() & 0o111,
                0
            );
        }

        let staged_again = stage_bundled_harness_binary(&source, &data_dir).unwrap();
        assert_eq!(staged_again, staged);

        std::fs::remove_dir_all(&root).unwrap();
    }
}

/// Sets the main window class background brush to `BLACK_BRUSH` so that
/// growing the window (right / bottom drag-resize) paints a black bar at
/// the newly-exposed edge before the WebView2 swap chain catches up with
/// the new size, rather than the OS-default white.
///
/// Trade-off vs. `NULL_BRUSH` (hollow brush, "don't erase"):
/// - `NULL_BRUSH` assumes the WebView2 child HWND already covers the whole
///   client area and its previous frame can stay on screen. In practice,
///   during a live drag-resize the WebView2 child lags the OS-level resize
///   by a few frames, and the uncovered strip is filled by DWM composition
///   — which renders as bright white. That flash is very jarring against
///   the app's dark theme.
/// - `BLACK_BRUSH` makes the OS fill the same uncovered strip with black
///   during `WM_ERASEBKGND`. A thin black sliver can briefly "chase" the
///   cursor on the leading edge of a drag-resize, but it blends into the
///   dark theme and into the WebView's own background color
///   (`with_background_color((0, 0, 0, 255))` in `create_main_webview`).
///
/// Between a visible white flash and a visible black flash we explicitly
/// choose black.
///
/// Startup behavior is preserved: the main window is created with
/// `with_visible(false)` and stays hidden until the frontend posts `ready`,
/// so users never see the pre-webview erase color anyway.
fn disable_window_background_erase(_window: &tao::window::Window) {
    #[cfg(target_os = "windows")]
    {
        use tao::platform::windows::WindowExtWindows;
        use windows::Win32::Foundation::HWND;
        use windows::Win32::Graphics::Gdi::{GetStockObject, BLACK_BRUSH};
        use windows::Win32::UI::WindowsAndMessaging::{SetClassLongPtrW, GCL_HBRBACKGROUND};

        let hwnd = HWND(_window.hwnd() as *mut std::ffi::c_void);
        unsafe {
            let black = GetStockObject(BLACK_BRUSH);
            SetClassLongPtrW(hwnd, GCL_HBRBACKGROUND, black.0 as isize);
        }
    }
}

fn create_main_window(
    event_loop: &tao::event_loop::EventLoop<UserEvent>,
    icon_data: &IconData,
) -> (tao::window::Window, WindowId) {
    let window = WindowBuilder::new()
        .with_title("AURA")
        .with_decorations(false)
        .with_visible(false)
        .with_window_icon(Some(icon_data.to_icon()))
        .with_inner_size(tao::dpi::LogicalSize::new(1280.0, 800.0))
        .build(event_loop)
        .expect("failed to build window");

    set_square_corners(&window);
    disable_window_background_erase(&window);

    let id = window.id();
    info!("window created");
    (window, id)
}

fn build_initialization_script(
    host_origin: Option<&str>,
    bootstrapped_auth: Option<&BootstrappedAuthLiterals>,
) -> String {
    let mut statements = Vec::new();

    if let Some(origin) = host_origin {
        let host_literal = serde_json::to_string(origin)
            .expect("failed to serialize host origin for initialization script");
        statements.push(format!(
            "window.localStorage.setItem('{HOST_STORAGE_KEY}', {host_literal});"
        ));
    }

    // Inject an explicit, frozen boot-auth global read by the frontend at
    // module load (before any localStorage parsing). This is the canonical
    // "is the user logged in?" signal on desktop: it comes straight from the
    // on-disk SettingsStore via `load_bootstrapped_auth_literals`, so it is
    // authoritative even if the webview's localStorage is stale or has not
    // yet been hydrated from IndexedDB. See
    // `interface/src/lib/auth-token.ts::readBootInjectedAuth()`.
    let (boot_auth_is_logged_in, boot_auth_session, boot_auth_jwt) = match bootstrapped_auth {
        Some(auth) => (
            "true",
            auth.session_literal.as_str(),
            auth.jwt_literal.as_str(),
        ),
        None => ("false", "null", "null"),
    };
    statements.push(format!(
        "Object.defineProperty(window, '__AURA_BOOT_AUTH__', {{ \
            value: Object.freeze({{ isLoggedIn: {boot_auth_is_logged_in}, session: {boot_auth_session}, jwt: {boot_auth_jwt} }}), \
            configurable: false, \
            writable: false, \
            enumerable: false \
        }});"
    ));

    // Mirror the boot auth into localStorage too — the rest of the frontend
    // (API clients reading JWT on demand, IndexedDB hydration, etc.) still
    // treats localStorage as the canonical session mirror post-boot.
    if let Some(auth) = bootstrapped_auth {
        statements.push(format!(
            "window.localStorage.setItem('{SESSION_STORAGE_KEY}', {});",
            auth.session_literal
        ));
        statements.push(format!(
            "window.localStorage.setItem('{JWT_STORAGE_KEY}', {});",
            auth.jwt_literal
        ));
    }

    if statements.is_empty() {
        String::new()
    } else {
        format!("try {{ {} }} catch {{}};", statements.join(" "))
    }
}

fn create_main_webview(
    window: &tao::window::Window,
    web_context: &mut WebContext,
    url: &str,
    initialization_script: &str,
    proxy: EventLoopProxy<UserEvent>,
    main_window_id: WindowId,
) -> wry::WebView {
    let builder = WebViewBuilder::new_with_web_context(web_context)
        .with_background_color((0, 0, 0, 255))
        // Start from a fresh blank document before navigating to the real app
        // URL. This prevents WebView2 from briefly painting stale previous-run
        // content (for example a cached `/login` page) while the new navigation
        // is still spinning up. The real app URL is loaded immediately after
        // the webview is built, and the desktop window remains hidden until the
        // frontend posts `ready`, so users only ever see the current session's
        // first committed frame.
        .with_url(INITIAL_BLANK_PAGE_URL)
        .with_initialization_script(initialization_script)
        .with_ipc_handler(ipc_handler(proxy, main_window_id))
        .with_new_window_req_handler(|uri, _features| {
            let _ = open::that(&uri);
            wry::NewWindowResponse::Deny
        });

    #[cfg(not(target_os = "linux"))]
    let webview = builder.build(window).expect("failed to build webview");

    #[cfg(target_os = "linux")]
    let webview = {
        use tao::platform::unix::WindowExtUnix;
        use wry::WebViewBuilderExtUnix;
        builder
            .build_gtk(window.gtk_window())
            .expect("failed to build webview")
    };

    webview
        .load_url(url)
        .expect("failed to load initial main webview url");

    webview
}

fn load_icon_data() -> IconData {
    let png_bytes = include_bytes!("../assets/aura-icon.png");
    let img = image::load_from_memory(png_bytes).expect("failed to decode icon");
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    IconData {
        rgba: rgba.into_raw(),
        width: w,
        height: h,
    }
}

fn spawn_fallback_show_timer(proxy: EventLoopProxy<UserEvent>, window_id: WindowId) {
    if ci_mode_enabled() {
        return;
    }
    std::thread::spawn(move || {
        std::thread::sleep(WINDOW_SHOW_FALLBACK_DELAY);
        let _ = proxy.send_event(UserEvent::ShowWindow { window_id });
    });
}

fn handle_window_command(
    main_window: &tao::window::Window,
    ide_windows: &mut HashMap<WindowId, (tao::window::Window, wry::WebView)>,
    managed_frontend_dev_server: &mut Option<Child>,
    managed_local_harness: &mut Option<Child>,
    window_id: WindowId,
    main_window_id: WindowId,
    cmd: WinCmd,
    control_flow: &mut ControlFlow,
) {
    if window_id == main_window_id {
        match cmd {
            WinCmd::Minimize => main_window.set_minimized(true),
            WinCmd::Maximize => main_window.set_maximized(!main_window.is_maximized()),
            WinCmd::Close => {
                stop_managed_frontend_dev_server(managed_frontend_dev_server);
                stop_managed_local_harness(managed_local_harness);
                *control_flow = ControlFlow::Exit;
            }
            WinCmd::Drag => {
                let _ = main_window.drag_window();
            }
        }
        return;
    }
    if matches!(cmd, WinCmd::Close) {
        ide_windows.remove(&window_id);
        return;
    }
    if let Some((ide_win, _)) = ide_windows.get(&window_id) {
        match cmd {
            WinCmd::Minimize => ide_win.set_minimized(true),
            WinCmd::Maximize => ide_win.set_maximized(!ide_win.is_maximized()),
            WinCmd::Drag => {
                let _ = ide_win.drag_window();
            }
            WinCmd::Close => unreachable!(),
        }
    }
}

fn open_ide_window_with_fallback(
    event_target: &tao::event_loop::EventLoopWindowTarget<UserEvent>,
    base_url: &str,
    file_path: &str,
    root_path: Option<&str>,
    icon_data: &IconData,
    proxy: &EventLoopProxy<UserEvent>,
    ide_windows: &mut HashMap<WindowId, (tao::window::Window, wry::WebView)>,
    host_origin: Option<&str>,
    store_path: &Path,
) {
    // Rebuild the same auth/host bootstrap the main webview receives so the IDE
    // webview can talk to the API. The IDE window uses an isolated WebContext,
    // so without this script `window.__AURA_BOOT_AUTH__` and the
    // `aura-jwt` / `aura-session` localStorage mirrors are missing and every
    // request fails the server's auth guard with "missing authorization
    // token". Load fresh literals from disk each time so a user who logs in
    // after desktop startup still gets an authenticated IDE window.
    let bootstrapped = load_bootstrapped_auth_literals(store_path);
    let init_script = build_initialization_script(host_origin, bootstrapped.as_ref());

    let proxy_clone = proxy.clone();
    match aura_os_ide::open_ide_window(
        event_target,
        base_url,
        file_path,
        root_path,
        Some(icon_data.to_icon()),
        &init_script,
        move |wid| Box::new(ipc_handler(proxy_clone, wid)),
    ) {
        Ok((win, wv)) => {
            let ide_wid = win.id();
            ide_windows.insert(ide_wid, (win, wv));
            spawn_fallback_show_timer(proxy.clone(), ide_wid);
        }
        Err(e) => {
            tracing::error!(error = %e, "failed to open IDE window");
        }
    }
}

fn handle_user_event(
    user_event: UserEvent,
    main_window: &tao::window::Window,
    main_webview: &wry::WebView,
    icon_data: &IconData,
    ide_windows: &mut HashMap<WindowId, (tao::window::Window, wry::WebView)>,
    managed_frontend_dev_server: &mut Option<Child>,
    managed_local_harness: &mut Option<Child>,
    frontend_base_url: &mut String,
    using_frontend_dev_server: &mut bool,
    main_window_id: WindowId,
    proxy: &EventLoopProxy<UserEvent>,
    event_target: &tao::event_loop::EventLoopWindowTarget<UserEvent>,
    route_state: &RouteState,
    control_flow: &mut ControlFlow,
    host_origin: Option<&str>,
    store_path: &Path,
) {
    match user_event {
        UserEvent::WindowCommand { window_id, cmd } => {
            handle_window_command(
                main_window,
                ide_windows,
                managed_frontend_dev_server,
                managed_local_harness,
                window_id,
                main_window_id,
                cmd,
                control_flow,
            );
        }
        UserEvent::OpenIdeWindow {
            file_path,
            root_path,
        } => {
            open_ide_window_with_fallback(
                event_target,
                frontend_base_url,
                &file_path,
                root_path.as_deref(),
                icon_data,
                proxy,
                ide_windows,
                host_origin,
                store_path,
            );
        }
        UserEvent::ShowWindow { window_id } => {
            if ci_mode_enabled() {
                return;
            }
            if window_id == main_window_id {
                main_window.set_visible(true);
            } else if let Some((ide_win, _)) = ide_windows.get(&window_id) {
                ide_win.set_visible(true);
            }
        }
        UserEvent::InstallUpdate { state } => {
            // Stop the managed sidecar before launching the installer so the
            // update does not have to replace an in-use helper binary.
            stop_managed_local_harness(managed_local_harness);
            if let Err(error) = updater::start_install(state) {
                warn!(error = %error, "failed to start updater install");
            }
        }
        UserEvent::ShutdownForUpdate => {
            info!("updater requested shutdown; stopping sidecars and exiting event loop");
            stop_managed_frontend_dev_server(managed_frontend_dev_server);
            stop_managed_local_harness(managed_local_harness);
            *control_flow = ControlFlow::Exit;
        }
        UserEvent::AttachFrontendDevServer {
            frontend_url: next_frontend_url,
        } => {
            if *using_frontend_dev_server || *frontend_base_url == next_frontend_url {
                return;
            }

            let next_main_url =
                apply_restore_route(&next_frontend_url, route_state.current_route().as_deref());

            info!(
                frontend = %next_main_url,
                "switching main webview to Vite frontend dev server"
            );

            match main_webview.load_url(&next_main_url) {
                Ok(()) => {
                    *using_frontend_dev_server = true;
                    *frontend_base_url = next_frontend_url;
                }
                Err(error) => {
                    warn!(
                        %error,
                        frontend = %next_main_url,
                        "failed to switch main webview to Vite frontend dev server"
                    );
                }
            }
        }
    }
}

fn run_event_loop(
    event_loop: tao::event_loop::EventLoop<UserEvent>,
    window: tao::window::Window,
    main_webview: wry::WebView,
    icon_data: IconData,
    managed_frontend_dev_server: Option<Child>,
    managed_local_harness: Option<Child>,
    proxy: EventLoopProxy<UserEvent>,
    initial_frontend_base_url: String,
    initial_using_frontend_dev_server: bool,
    route_state: RouteState,
    host_origin: Option<String>,
    store_path: PathBuf,
) {
    let main_window_id = window.id();
    let mut ide_windows: HashMap<WindowId, (tao::window::Window, wry::WebView)> = HashMap::new();
    let mut managed_frontend_dev_server = managed_frontend_dev_server;
    let mut managed_local_harness = managed_local_harness;
    let mut frontend_base_url = initial_frontend_base_url;
    let mut using_frontend_dev_server = initial_using_frontend_dev_server;

    event_loop.run(move |event, elwt, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                window_id,
                ..
            } => {
                if window_id == main_window_id {
                    stop_managed_frontend_dev_server(&mut managed_frontend_dev_server);
                    stop_managed_local_harness(&mut managed_local_harness);
                    *control_flow = ControlFlow::Exit;
                } else {
                    ide_windows.remove(&window_id);
                }
            }
            Event::UserEvent(user_event) => handle_user_event(
                user_event,
                &window,
                &main_webview,
                &icon_data,
                &mut ide_windows,
                &mut managed_frontend_dev_server,
                &mut managed_local_harness,
                &mut frontend_base_url,
                &mut using_frontend_dev_server,
                main_window_id,
                &proxy,
                elwt,
                &route_state,
                control_flow,
                host_origin.as_deref(),
                &store_path,
            ),
            _ => {}
        }
    });
}

fn install_panic_hook(data_dir: &std::path::Path) {
    let crash_log = data_dir.join("crash.log");
    std::panic::set_hook(Box::new(move |info| {
        let backtrace = std::backtrace::Backtrace::force_capture();
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let msg = format!("PANIC at unix_ts={ts}\n{info}\n\nBacktrace:\n{backtrace}\n");
        eprintln!("{msg}");
        let _ = std::fs::write(&crash_log, &msg);
    }));
}

#[cfg(target_os = "windows")]
fn install_native_crash_handler(data_dir: &std::path::Path) {
    use std::sync::OnceLock;
    static CRASH_LOG_PATH: OnceLock<PathBuf> = OnceLock::new();
    CRASH_LOG_PATH.get_or_init(|| data_dir.join("native-crash.log"));

    unsafe extern "system" fn handler(
        info: *const windows::Win32::System::Diagnostics::Debug::EXCEPTION_POINTERS,
    ) -> i32 {
        let code = if !info.is_null() && !(*info).ExceptionRecord.is_null() {
            (*(*info).ExceptionRecord).ExceptionCode.0
        } else {
            0
        };
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let msg = format!(
            "NATIVE CRASH at unix_ts={ts}\nException code: 0x{code:08X}\n\
             This is likely a WebView2/wry crash.\n\
             Check Windows Event Viewer > Application for more details.\n"
        );
        eprintln!("{msg}");
        if let Some(path) = CRASH_LOG_PATH.get() {
            let _ = std::fs::write(path, &msg);
        }
        // EXCEPTION_CONTINUE_SEARCH — let the default handler terminate the process
        0
    }

    unsafe {
        windows::Win32::System::Diagnostics::Debug::SetUnhandledExceptionFilter(Some(handler));
    }
}

#[cfg(not(target_os = "windows"))]
fn install_native_crash_handler(_data_dir: &std::path::Path) {}

fn main() {
    if std::env::var("RUST_BACKTRACE").is_err() {
        std::env::set_var("RUST_BACKTRACE", "1");
    }

    dotenvy::dotenv().ok();
    apply_desktop_runtime_defaults();
    aura_os_server::ensure_user_bins_on_path();
    init_logging();

    let (store_path, webview_data_dir, interface_dir) = init_data_dirs();
    let data_dir = store_path.parent().unwrap_or(&store_path);
    let route_state = RouteState::load(data_dir);
    install_panic_hook(data_dir);
    install_native_crash_handler(data_dir);
    let cli = parse_cli_args();
    let managed_local_harness = if cli.external_harness {
        enforce_external_harness_or_exit();
        None
    } else {
        maybe_spawn_local_harness_sidecar(data_dir)
    };
    let bootstrapped_auth = load_bootstrapped_auth_literals(&store_path);
    let (std_listener, server_port, url) = bind_listener();

    // Snapshot pre-sync env so the startup diagnostics line can show
    // exactly what was in the environment before we touched it — the
    // production `send_to_agent` timeout on 19847 is driven by a
    // stale explicit override pinning the URL to a port we no longer
    // listen on, and without this log there is no way to correlate
    // which env var caused it post-hoc.
    let pre_sync_server_base_url = std::env::var("AURA_SERVER_BASE_URL").ok();
    let pre_sync_vite_api_url = std::env::var("VITE_API_URL").ok();
    let pre_sync_server_host = std::env::var("AURA_SERVER_HOST").ok();
    let pre_sync_server_port = std::env::var("AURA_SERVER_PORT").ok();

    // Self-heal stale loopback overrides. When the installer / a
    // previous desktop run / a leftover shell var pins
    // `AURA_SERVER_BASE_URL` or `VITE_API_URL` to
    // `http://127.0.0.1:19847` but the current bind landed on an
    // ephemeral port (because 19847 was already taken), those
    // explicit values win inside
    // `aura_os_integrations::control_plane_api_base_url()` and every
    // loopback callback (send_to_agent, list_agents, spec fetches)
    // silently POSTs into a closed port — which on Windows surfaces
    // as a ~21s "operation timed out" instead of an immediate
    // connection refused. Strip the stale value so the fallback
    // derived from the real bound port takes over. Non-loopback
    // overrides (prod deployments pointing at a public URL) are
    // untouched.
    if let Some(existing) = pre_sync_server_base_url.as_deref() {
        if url_is_loopback_with_port_other_than(existing, server_port) {
            warn!(
                existing = %existing,
                bound_port = server_port,
                "stripping stale loopback AURA_SERVER_BASE_URL so embedded server URL matches bound port"
            );
            std::env::remove_var("AURA_SERVER_BASE_URL");
        }
    }
    if let Some(existing) = pre_sync_vite_api_url.as_deref() {
        if url_is_loopback_with_port_other_than(existing, server_port) {
            warn!(
                existing = %existing,
                bound_port = server_port,
                "stripping stale loopback VITE_API_URL so embedded server URL matches bound port"
            );
            std::env::remove_var("VITE_API_URL");
        }
    }

    // Sync the actually-bound loopback address back into the process
    // env before `spawn_server` runs `build_app_state`. Without this,
    // `aura_os_integrations::control_plane_api_base_url_fallback` reads
    // an unset `AURA_SERVER_PORT` and stamps the hardcoded
    // `http://127.0.0.1:3100` default onto
    // `AgentRuntimeService.local_server_base_url` — but the embedded
    // server binds to `PREFERRED_PORT` (19847) or an OS-chosen port,
    // so every agent-runtime loopback callback
    // (`send_to_agent`, `list_agents`, spec fetches, etc.) hits a
    // closed port and surfaces as `external tool callback unreachable`.
    // Explicit `AURA_SERVER_BASE_URL` (or `VITE_API_URL`) overrides
    // still win because `control_plane_api_base_url` checks those
    // first — hence the stale-loopback self-heal above.
    std::env::set_var("AURA_SERVER_HOST", "127.0.0.1");
    std::env::set_var("AURA_SERVER_PORT", server_port.to_string());

    // Single structured line that correlates the actually-bound port
    // with the URL every loopback callback will derive. Emitted
    // immediately after the self-heal + env sync so logs show the
    // final post-resolution state. Any surviving mismatch here is
    // almost certainly a non-loopback override pointing at the wrong
    // port — log it at error level so we don't silently eat another
    // 21s timeout round-trip in production.
    let resolved_base_url = aura_os_integrations::control_plane_api_base_url();
    let resolved_port_matches = url_loopback_port_matches(&resolved_base_url, server_port);
    if resolved_port_matches {
        info!(
            bound_port = server_port,
            resolved_base_url = %resolved_base_url,
            aura_server_base_url_pre_sync = ?pre_sync_server_base_url,
            vite_api_url_pre_sync = ?pre_sync_vite_api_url,
            aura_server_host_pre_sync = ?pre_sync_server_host,
            aura_server_port_pre_sync = ?pre_sync_server_port,
            "control plane URL resolved"
        );
    } else {
        tracing::error!(
            bound_port = server_port,
            resolved_base_url = %resolved_base_url,
            aura_server_base_url = ?std::env::var("AURA_SERVER_BASE_URL").ok(),
            vite_api_url = ?std::env::var("VITE_API_URL").ok(),
            aura_server_host = ?std::env::var("AURA_SERVER_HOST").ok(),
            aura_server_port = ?std::env::var("AURA_SERVER_PORT").ok(),
            "control_plane_url_mismatch: resolved base URL does not match bound port; \
             send_to_agent and other loopback tool callbacks will fail"
        );
    }

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let ide_proxy: Arc<EventLoopProxy<UserEvent>> = Arc::new(proxy.clone());

    let ready_rx = spawn_server(
        std_listener,
        store_path.clone(),
        interface_dir,
        ide_proxy,
        route_state.clone(),
    );
    ready_rx
        .recv()
        .expect("server thread failed before becoming ready");
    info!("axum server ready");
    let frontend_dev_server_config = configured_frontend_dev_server_config();
    let frontend_dev_candidate = frontend_dev_server_config
        .as_ref()
        .map(|config| build_frontend_dev_server_candidate(&url, &config.frontend_url));
    let managed_frontend_dev_server = maybe_spawn_frontend_dev_server(
        server_port,
        frontend_dev_server_config.as_ref(),
        frontend_dev_candidate.as_ref(),
    );
    // Block briefly for the Vite dev server before creating the webview so
    // the first (and ideally only) navigation is the Vite URL. Without this,
    // dev boots often navigate the webview to the axum-bundled frontend
    // first, then hot-swap to Vite via `load_url` once it comes up — the
    // swap tears the document down, exposing the black `<body>` background
    // for the duration of Vite's boot. Users perceive that as "shell → black
    // flash → shell again, then app loads".
    let frontend_dev_server_available = match frontend_dev_candidate.as_ref() {
        Some(candidate) => {
            wait_for_frontend_dev_server(candidate, configured_frontend_dev_server_ready_timeout())
        }
        None => false,
    };
    let frontend_target = resolve_frontend_target_with_probe(
        &url,
        frontend_dev_candidate.as_ref(),
        frontend_dev_server_available,
    );
    if let Some(candidate) = frontend_dev_candidate.as_ref() {
        if frontend_target.using_frontend_dev_server {
            info!(
                frontend = %candidate.probe_url,
                backend = %url,
                "using Vite frontend dev server"
            );
        }
    }
    let initial_frontend_base_url = frontend_target.url.clone();
    let initial_frontend_url = apply_restore_route(
        &initial_frontend_base_url,
        route_state.current_route().as_deref(),
    );

    let icon_data = load_icon_data();
    let (window, main_window_id) = create_main_window(&event_loop, &icon_data);
    let mut web_context = WebContext::new(Some(webview_data_dir));
    let initialization_script = build_initialization_script(
        frontend_target.host_origin.as_deref(),
        bootstrapped_auth.as_ref(),
    );
    let main_webview = create_main_webview(
        &window,
        &mut web_context,
        &initial_frontend_url,
        &initialization_script,
        proxy.clone(),
        main_window_id,
    );
    if should_poll_for_frontend_dev_server(
        frontend_target.using_frontend_dev_server,
        frontend_dev_candidate.as_ref(),
    ) {
        if let Some(candidate) = frontend_dev_candidate {
            spawn_frontend_dev_server_poller(proxy.clone(), candidate);
        }
    }
    spawn_fallback_show_timer(proxy.clone(), main_window_id);

    run_event_loop(
        event_loop,
        window,
        main_webview,
        icon_data,
        managed_frontend_dev_server,
        managed_local_harness,
        proxy,
        initial_frontend_base_url,
        frontend_target.using_frontend_dev_server,
        route_state,
        frontend_target.host_origin.clone(),
        store_path.clone(),
    );
}

#[cfg(test)]
mod loopback_port_tests {
    use super::{url_is_loopback_with_port_other_than, url_loopback_port_matches};

    #[test]
    fn stripped_when_loopback_port_differs() {
        assert!(url_is_loopback_with_port_other_than(
            "http://127.0.0.1:19847",
            52345
        ));
        assert!(url_is_loopback_with_port_other_than(
            "http://localhost:19847/",
            52345
        ));
        assert!(url_is_loopback_with_port_other_than(
            "http://[::1]:19847",
            52345
        ));
        assert!(url_is_loopback_with_port_other_than(
            "HTTP://LOCALHOST:19847",
            52345
        ));
    }

    #[test]
    fn kept_when_loopback_port_matches_bound_port() {
        assert!(!url_is_loopback_with_port_other_than(
            "http://127.0.0.1:19847",
            19847
        ));
        assert!(!url_is_loopback_with_port_other_than(
            "http://localhost:19847/api",
            19847
        ));
    }

    #[test]
    fn kept_for_non_loopback_hosts() {
        assert!(!url_is_loopback_with_port_other_than(
            "https://api.aura.dev:443",
            19847
        ));
        assert!(!url_is_loopback_with_port_other_than(
            "http://10.0.0.1:19847",
            19847
        ));
        assert!(!url_is_loopback_with_port_other_than(
            "https://render-app.onrender.com",
            19847
        ));
    }

    #[test]
    fn kept_when_port_missing_or_unparseable() {
        // No explicit port — we can't prove a mismatch, so don't strip.
        assert!(!url_is_loopback_with_port_other_than(
            "http://127.0.0.1",
            19847
        ));
        assert!(!url_is_loopback_with_port_other_than(
            "http://localhost/",
            19847
        ));
        // Garbage input — never strip.
        assert!(!url_is_loopback_with_port_other_than("not a url", 19847));
        assert!(!url_is_loopback_with_port_other_than("", 19847));
    }

    #[test]
    fn matches_helper_mirrors_the_strip_helper() {
        // Non-loopback override — not our concern; treated as "match".
        assert!(url_loopback_port_matches("https://api.aura.dev", 19847));
        // Loopback + correct port — match.
        assert!(url_loopback_port_matches("http://127.0.0.1:19847", 19847));
        // Loopback + wrong port — mismatch (would trigger the error log).
        assert!(!url_loopback_port_matches("http://127.0.0.1:3100", 19847));
    }
}
