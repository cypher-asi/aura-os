#![cfg_attr(
    all(target_os = "windows", not(debug_assertions)),
    windows_subsystem = "windows"
)]
#![allow(unexpected_cfgs)]

mod events;
mod frontend;
mod handlers;
mod harness;
mod init;
mod net;
mod route_state;
mod ui;
mod updater;

use std::sync::Arc;
use tao::event_loop::{EventLoopBuilder, EventLoopProxy};
use tracing::info;
use wry::WebContext;

use crate::events::UserEvent;
use crate::frontend::config::{
    configured_frontend_dev_server_config, configured_frontend_dev_server_ready_timeout,
    FrontendDevServerCandidate, FrontendTarget,
};
use crate::frontend::dev_server::{
    maybe_spawn_frontend_dev_server, spawn_frontend_dev_server_poller, wait_for_frontend_dev_server,
};
use crate::frontend::routing::{
    apply_restore_route, build_frontend_dev_server_candidate, resolve_frontend_target_with_probe,
    should_poll_for_frontend_dev_server,
};
use crate::harness::external::enforce_external_harness_or_exit;
use crate::harness::sidecar::maybe_spawn_local_harness_sidecar;
use crate::init::cli::{parse_cli_args, DesktopCliArgs};
use crate::init::crash::{install_native_crash_handler, install_panic_hook};
use crate::init::env::apply_desktop_runtime_defaults;
use crate::init::init_script::{build_initialization_script, load_bootstrapped_auth_literals};
use crate::init::logging::init_logging;
use crate::init::paths::init_data_dirs;
use crate::init::single_instance::acquire_single_instance_or_exit;
use crate::net::loopback::{url_is_loopback_with_port_other_than, url_loopback_port_matches};
use crate::net::server::{bind_listener, spawn_server};
use crate::route_state::RouteState;
use crate::ui::icon::{load_icon_data, IconData};
use crate::ui::main_window::{create_main_webview, create_main_window};
use crate::ui::menu::install_macos_app_menu;
use crate::ui::runtime::{run_event_loop, spawn_fallback_show_timer, LoopContext, LoopState};

/// Aggregated artefacts from the data-directory + harness phase of startup.
struct PreBindStartup {
    store_path: std::path::PathBuf,
    webview_data_dir: std::path::PathBuf,
    interface_dir: Option<std::path::PathBuf>,
    route_state: RouteState,
    managed_local_harness: Option<std::process::Child>,
}

/// Aggregated artefacts produced once the embedded server is up and the
/// frontend dev-server (if any) has been resolved.
struct ServerStartup {
    frontend_dev_candidate: Option<FrontendDevServerCandidate>,
    frontend_target: FrontendTarget,
    managed_frontend_dev_server: Option<std::process::Child>,
}

fn main() {
    if std::env::var("RUST_BACKTRACE").is_err() {
        std::env::set_var("RUST_BACKTRACE", "1");
    }

    dotenvy::dotenv().ok();
    apply_desktop_runtime_defaults();
    aura_os_server::ensure_user_bins_on_path();
    init_logging();
    let _single_instance = acquire_single_instance_or_exit();

    let cli = parse_cli_args();
    let pre_bind = prepare_pre_bind(cli);
    let bootstrapped_auth = load_bootstrapped_auth_literals(&pre_bind.store_path);

    let (std_listener, server_port, server_url) = bind_listener();
    self_heal_loopback_overrides(server_port);

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let ide_proxy: Arc<EventLoopProxy<UserEvent>> = Arc::new(proxy.clone());

    let ready_rx = spawn_server(
        std_listener,
        pre_bind.store_path.clone(),
        pre_bind.interface_dir.clone(),
        ide_proxy,
        pre_bind.route_state.clone(),
    );
    ready_rx
        .recv()
        .expect("server thread failed before becoming ready");
    info!("axum server ready");

    let server = resolve_frontend(&server_url, server_port);
    let icon_data = load_icon_data();
    install_macos_app_menu();
    let (window, main_window_id) = create_main_window(&event_loop, &icon_data);
    let mut web_context = WebContext::new(Some(pre_bind.webview_data_dir));
    let initialization_script = build_initialization_script(
        server.frontend_target.host_origin.as_deref(),
        bootstrapped_auth.as_ref(),
    );

    let initial_frontend_base_url = server.frontend_target.url.clone();
    let initial_frontend_url = apply_restore_route(
        &initial_frontend_base_url,
        pre_bind.route_state.current_route().as_deref(),
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
        server.frontend_target.using_frontend_dev_server,
        server.frontend_dev_candidate.as_ref(),
    ) {
        if let Some(candidate) = server.frontend_dev_candidate {
            spawn_frontend_dev_server_poller(proxy.clone(), candidate);
        }
    }
    spawn_fallback_show_timer(proxy.clone(), main_window_id);

    let host_origin = server.frontend_target.host_origin.clone();
    let store_path = pre_bind.store_path;
    let state = build_loop_state(BuildLoopStateInput {
        window,
        main_webview,
        web_context,
        managed_frontend_dev_server: server.managed_frontend_dev_server,
        managed_local_harness: pre_bind.managed_local_harness,
        initial_frontend_base_url,
        initial_using_frontend_dev_server: server.frontend_target.using_frontend_dev_server,
        icon_data,
        main_window_id,
        proxy,
        route_state: pre_bind.route_state,
        host_origin,
        store_path,
    });

    run_event_loop(event_loop, state);
}

fn prepare_pre_bind(cli: DesktopCliArgs) -> PreBindStartup {
    let (store_path, webview_data_dir, interface_dir) = init_data_dirs();
    let data_dir = store_path
        .parent()
        .map(std::path::Path::to_path_buf)
        .unwrap_or_else(|| store_path.clone());
    let route_state = RouteState::load(&data_dir);
    install_panic_hook(&data_dir);
    install_native_crash_handler(&data_dir);
    let managed_local_harness = if cli.external_harness {
        enforce_external_harness_or_exit();
        None
    } else {
        maybe_spawn_local_harness_sidecar(&data_dir)
    };
    PreBindStartup {
        store_path,
        webview_data_dir,
        interface_dir,
        route_state,
        managed_local_harness,
    }
}

fn resolve_frontend(server_url: &str, server_port: u16) -> ServerStartup {
    let frontend_dev_server_config = configured_frontend_dev_server_config();
    let frontend_dev_candidate = frontend_dev_server_config
        .as_ref()
        .map(|config| build_frontend_dev_server_candidate(server_url, &config.frontend_url));
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
        server_url,
        frontend_dev_candidate.as_ref(),
        frontend_dev_server_available,
    );
    if let Some(candidate) = frontend_dev_candidate.as_ref() {
        if frontend_target.using_frontend_dev_server {
            info!(
                frontend = %candidate.probe_url,
                backend = %server_url,
                "using Vite frontend dev server"
            );
        }
    }
    ServerStartup {
        frontend_dev_candidate,
        frontend_target,
        managed_frontend_dev_server,
    }
}

/// Snapshot pre-sync env, strip stale loopback overrides, and re-pin the
/// `AURA_SERVER_HOST/PORT` pair so `aura_os_integrations::control_plane_api_base_url()`
/// derives a URL that matches the actually-bound port.
fn self_heal_loopback_overrides(server_port: u16) {
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
    strip_stale_loopback_override("AURA_SERVER_BASE_URL", server_port);
    strip_stale_loopback_override("VITE_API_URL", server_port);

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

    log_resolved_control_plane_url(
        server_port,
        pre_sync_server_base_url,
        pre_sync_vite_api_url,
        pre_sync_server_host,
        pre_sync_server_port,
    );
}

fn strip_stale_loopback_override(name: &str, bound_port: u16) {
    if let Ok(existing) = std::env::var(name) {
        if url_is_loopback_with_port_other_than(&existing, bound_port) {
            tracing::warn!(
                env = name,
                existing = %existing,
                bound_port,
                "stripping stale loopback override so embedded server URL matches bound port"
            );
            std::env::remove_var(name);
        }
    }
}

fn log_resolved_control_plane_url(
    server_port: u16,
    pre_sync_server_base_url: Option<String>,
    pre_sync_vite_api_url: Option<String>,
    pre_sync_server_host: Option<String>,
    pre_sync_server_port: Option<String>,
) {
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
        tracing::info!(
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
}

struct BuildLoopStateInput {
    window: tao::window::Window,
    main_webview: wry::WebView,
    web_context: WebContext,
    managed_frontend_dev_server: Option<std::process::Child>,
    managed_local_harness: Option<std::process::Child>,
    initial_frontend_base_url: String,
    initial_using_frontend_dev_server: bool,
    icon_data: IconData,
    main_window_id: tao::window::WindowId,
    proxy: EventLoopProxy<UserEvent>,
    route_state: RouteState,
    host_origin: Option<String>,
    store_path: std::path::PathBuf,
}

fn build_loop_state(input: BuildLoopStateInput) -> LoopState {
    LoopState {
        main_window: input.window,
        main_webview: input.main_webview,
        ide_windows: std::collections::HashMap::new(),
        secondary_main_windows: std::collections::HashMap::new(),
        managed_frontend_dev_server: input.managed_frontend_dev_server,
        managed_local_harness: input.managed_local_harness,
        frontend_base_url: input.initial_frontend_base_url,
        using_frontend_dev_server: input.initial_using_frontend_dev_server,
        web_context: input.web_context,
        ctx: LoopContext {
            icon_data: input.icon_data,
            main_window_id: input.main_window_id,
            proxy: input.proxy,
            route_state: input.route_state,
            host_origin: input.host_origin,
            store_path: input.store_path,
        },
    }
}
