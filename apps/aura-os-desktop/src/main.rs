#![allow(unexpected_cfgs)]

mod handlers;
mod updater;

use axum::routing::{get as axum_get, post as axum_post};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener as StdTcpListener, ToSocketAddrs};
use std::path::PathBuf;
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

use updater::{UpdateChannel, UpdateState};

const PREFERRED_PORT: u16 = 19847;
const DEFAULT_FRONTEND_BIND_HOST: &str = "127.0.0.1";
const DEFAULT_FRONTEND_PORT: u16 = 5173;
const HOST_STORAGE_KEY: &str = "aura-host-origin";
const FRONTEND_DEV_SERVER_POLL_INTERVAL: Duration = Duration::from_secs(1);
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

    let mut candidates = vec![
        PathBuf::from("interface/dist"),
        PathBuf::from("../../interface/dist"),
    ];
    if let Some(ref dir) = exe_dir {
        candidates.push(dir.join("interface/dist"));
        candidates.push(dir.join("dist"));
    }

    candidates
        .into_iter()
        .find(|p| p.join("index.html").exists())
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

fn init_data_dirs() -> (PathBuf, PathBuf, Option<PathBuf>) {
    let data_dir = default_data_dir();
    std::fs::create_dir_all(&data_dir).expect("failed to create data directory");
    info!(path = %data_dir.display(), "data directory ready");

    let db_path = data_dir.join("db");
    let webview_data_dir = data_dir.join("webview");
    let interface_dir = find_interface_dir();
    match interface_dir {
        Some(ref dir) => info!(path = %dir.display(), "serving interface"),
        None => warn!("no interface dist found; pages will not load"),
    }
    (db_path, webview_data_dir, interface_dir)
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

fn resolve_frontend_target(
    server_url: &str,
    frontend_dev_candidate: Option<&FrontendDevServerCandidate>,
) -> FrontendTarget {
    let frontend_dev_server_available =
        frontend_dev_candidate.is_some_and(|candidate| probe_vite_dev_server(&candidate.probe_url));
    let frontend_target = resolve_frontend_target_with_probe(
        server_url,
        frontend_dev_candidate,
        frontend_dev_server_available,
    );

    if let Some(candidate) = frontend_dev_candidate {
        if frontend_target.using_frontend_dev_server {
            info!(
                frontend = %candidate.probe_url,
                backend = %server_url,
                "using Vite frontend dev server"
            );
        }
    }

    frontend_target
}

fn should_poll_for_frontend_dev_server(
    using_frontend_dev_server: bool,
    frontend_dev_candidate: Option<&FrontendDevServerCandidate>,
) -> bool {
    frontend_dev_candidate.is_some() && !using_frontend_dev_server
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

fn bind_listener() -> (StdTcpListener, u16, String) {
    let configured_port = std::env::var("AURA_SERVER_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|port| *port > 0);

    let std_listener = if let Some(port) = configured_port {
        StdTcpListener::bind(format!("127.0.0.1:{port}"))
            .unwrap_or_else(|_| panic!("failed to bind configured AURA_SERVER_PORT={port}"))
    } else {
        StdTcpListener::bind(format!("127.0.0.1:{PREFERRED_PORT}"))
            .or_else(|_| StdTcpListener::bind("127.0.0.1:0"))
            .expect("failed to bind to an available port")
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
    db_path: PathBuf,
    interface_dir: Option<PathBuf>,
    ide_proxy: Arc<EventLoopProxy<UserEvent>>,
) -> std::sync::mpsc::Receiver<()> {
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<()>();

    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().expect("failed to create tokio runtime");
        rt.block_on(async move {
            let update_state = UpdateState::new(UpdateChannel::Stable);

            let app_state =
                aura_os_server::build_app_state(&db_path).expect("failed to open database");
            let app = aura_os_server::create_router_with_interface(app_state, interface_dir)
                .route("/api/pick-folder", axum_post(handlers::pick_folder))
                .route("/api/pick-file", axum_post(handlers::pick_file))
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
                    "/api/update-install",
                    axum_post(handlers::post_update_install),
                )
                .route(
                    "/api/update-channel",
                    axum_post(handlers::post_update_channel).with_state(update_state.clone()),
                );

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
        append_query_param, build_frontend_dev_server_candidate, build_frontend_dev_server_config,
        build_initialization_script, resolve_frontend_target_with_probe,
        should_poll_for_frontend_dev_server,
    };

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
    fn frontend_dev_server_poller_only_runs_when_needed() {
        let candidate =
            build_frontend_dev_server_candidate("http://127.0.0.1:19847", "http://127.0.0.1:5173");

        assert!(should_poll_for_frontend_dev_server(false, Some(&candidate)));
        assert!(!should_poll_for_frontend_dev_server(true, Some(&candidate)));
        assert!(!should_poll_for_frontend_dev_server(false, None));
    }

    #[test]
    fn build_initialization_script_persists_host_origin() {
        let script = build_initialization_script(Some("http://127.0.0.1:19847"));
        assert!(script.contains("aura-host-origin"));
        assert!(script.contains("http://127.0.0.1:19847"));
        assert!(script.contains("window.ipc.postMessage('ready')"));
    }
}

fn set_black_background(_window: &tao::window::Window) {
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
    set_black_background(&window);

    let id = window.id();
    info!("window created");
    (window, id)
}

const READY_SCRIPT: &str = "\
    if (document.readyState === 'loading') { \
        document.addEventListener('DOMContentLoaded', function() { window.ipc.postMessage('ready'); }); \
    } else { \
        window.ipc.postMessage('ready'); \
    }";

fn build_initialization_script(host_origin: Option<&str>) -> String {
    match host_origin {
        Some(origin) => {
            let host_literal = serde_json::to_string(origin)
                .expect("failed to serialize host origin for initialization script");
            format!(
                "try {{ window.localStorage.setItem('{HOST_STORAGE_KEY}', {host_literal}); }} catch {{}}; {READY_SCRIPT}"
            )
        }
        None => READY_SCRIPT.to_string(),
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
        .with_url(url)
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
        std::thread::sleep(std::time::Duration::from_millis(500));
        let _ = proxy.send_event(UserEvent::ShowWindow { window_id });
    });
}

fn handle_window_command(
    main_window: &tao::window::Window,
    ide_windows: &mut HashMap<WindowId, (tao::window::Window, wry::WebView)>,
    managed_frontend_dev_server: &mut Option<Child>,
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
) {
    let proxy_clone = proxy.clone();
    match aura_os_ide::open_ide_window(
        event_target,
        base_url,
        file_path,
        root_path,
        Some(icon_data.to_icon()),
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
    frontend_url: &mut String,
    using_frontend_dev_server: &mut bool,
    main_window_id: WindowId,
    proxy: &EventLoopProxy<UserEvent>,
    event_target: &tao::event_loop::EventLoopWindowTarget<UserEvent>,
    control_flow: &mut ControlFlow,
) {
    match user_event {
        UserEvent::WindowCommand { window_id, cmd } => {
            handle_window_command(
                main_window,
                ide_windows,
                managed_frontend_dev_server,
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
                frontend_url,
                &file_path,
                root_path.as_deref(),
                icon_data,
                proxy,
                ide_windows,
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
        UserEvent::AttachFrontendDevServer {
            frontend_url: next_frontend_url,
        } => {
            if *using_frontend_dev_server || *frontend_url == next_frontend_url {
                return;
            }

            info!(
                frontend = %next_frontend_url,
                "switching main webview to Vite frontend dev server"
            );

            match main_webview.load_url(&next_frontend_url) {
                Ok(()) => {
                    *using_frontend_dev_server = true;
                    *frontend_url = next_frontend_url;
                }
                Err(error) => {
                    warn!(
                        %error,
                        frontend = %next_frontend_url,
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
    proxy: EventLoopProxy<UserEvent>,
    initial_frontend_url: String,
    initial_using_frontend_dev_server: bool,
) {
    let main_window_id = window.id();
    let mut ide_windows: HashMap<WindowId, (tao::window::Window, wry::WebView)> = HashMap::new();
    let mut managed_frontend_dev_server = managed_frontend_dev_server;
    let mut frontend_url = initial_frontend_url;
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
                &mut frontend_url,
                &mut using_frontend_dev_server,
                main_window_id,
                &proxy,
                elwt,
                control_flow,
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
    aura_os_server::ensure_user_bins_on_path();
    init_logging();

    let (db_path, webview_data_dir, interface_dir) = init_data_dirs();
    let data_dir = db_path.parent().unwrap_or(&db_path);
    install_panic_hook(data_dir);
    install_native_crash_handler(data_dir);
    let (std_listener, server_port, url) = bind_listener();

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let ide_proxy: Arc<EventLoopProxy<UserEvent>> = Arc::new(proxy.clone());

    let ready_rx = spawn_server(std_listener, db_path, interface_dir, ide_proxy);
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
    let frontend_target = resolve_frontend_target(&url, frontend_dev_candidate.as_ref());
    let initial_frontend_url = frontend_target.url.clone();

    let icon_data = load_icon_data();
    let (window, main_window_id) = create_main_window(&event_loop, &icon_data);
    let mut web_context = WebContext::new(Some(webview_data_dir));
    let initialization_script = build_initialization_script(frontend_target.host_origin.as_deref());
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
        proxy,
        initial_frontend_url,
        frontend_target.using_frontend_dev_server,
    );
}
