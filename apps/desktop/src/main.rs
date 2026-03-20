mod updater;

use std::collections::HashMap;
use std::net::TcpListener as StdTcpListener;
use std::path::PathBuf;
use std::sync::Arc;
use axum::extract::State as AxumState;
use axum::routing::{get as axum_get, post as axum_post};
use axum::Json;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy};
use tao::window::{Icon, WindowBuilder, WindowId};
use tokio::net::TcpListener;
use tracing::{debug, info, warn};
use tracing_subscriber::EnvFilter;
use wry::{WebContext, WebViewBuilder};

use updater::{UpdateChannel, UpdateState};

const PREFERRED_PORT: u16 = 19847;

#[derive(Debug)]
enum WinCmd {
    Minimize,
    Maximize,
    Close,
    Drag,
}

#[derive(Debug)]
enum UserEvent {
    WindowCommand { window_id: WindowId, cmd: WinCmd },
    OpenIdeWindow { file_path: String, root_path: Option<String> },
    ShowWindow { window_id: WindowId },
}

fn ipc_handler(proxy: EventLoopProxy<UserEvent>, window_id: WindowId) -> impl Fn(wry::http::Request<String>) + 'static {
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
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("aura")
}

fn find_frontend_dir() -> Option<PathBuf> {
    // Prefer the path baked in at compile time by build.rs
    let compile_time = PathBuf::from(env!("FRONTEND_DIST_DIR"));
    if compile_time.join("index.html").exists() {
        return Some(compile_time);
    }

    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()));

    let mut candidates = vec![
        PathBuf::from("frontend/dist"),
        PathBuf::from("../../frontend/dist"),
    ];
    if let Some(ref dir) = exe_dir {
        candidates.push(dir.join("frontend/dist"));
        // cargo-packager places resources next to the executable
        candidates.push(dir.join("dist"));
    }

    candidates
        .into_iter()
        .find(|p| p.join("index.html").exists())
}

async fn pick_folder() -> Json<serde_json::Value> {
    let handle = rfd::AsyncFileDialog::new()
        .set_title("Select folder")
        .pick_folder()
        .await;
    let path = handle.map(|h| h.path().to_string_lossy().into_owned());
    Json(serde_json::json!(path))
}

async fn pick_file() -> Json<serde_json::Value> {
    let handle = rfd::AsyncFileDialog::new()
        .set_title("Select file")
        .pick_file()
        .await;
    let path = handle.map(|h| h.path().to_string_lossy().into_owned());
    Json(serde_json::json!(path))
}

#[derive(serde::Deserialize)]
struct ReadFileRequest {
    path: String,
}

async fn read_file(Json(req): Json<ReadFileRequest>) -> Json<serde_json::Value> {
    let target = std::path::Path::new(&req.path);
    if !target.exists() {
        warn!(path = %req.path, "read_file: path does not exist");
        return Json(serde_json::json!({ "ok": false, "error": "path not found" }));
    }
    if !target.is_file() {
        warn!(path = %req.path, "read_file: path is not a file");
        return Json(serde_json::json!({ "ok": false, "error": "path is not a file" }));
    }
    match std::fs::read_to_string(&req.path) {
        Ok(content) => {
            debug!(path = %req.path, bytes = content.len(), "read file");
            Json(serde_json::json!({ "ok": true, "content": content, "path": req.path }))
        }
        Err(e) => {
            warn!(path = %req.path, error = %e, "failed to read file");
            Json(serde_json::json!({ "ok": false, "error": e.to_string() }))
        }
    }
}

#[derive(serde::Deserialize)]
struct WriteFileRequest {
    path: String,
    content: String,
}

async fn write_file(Json(req): Json<WriteFileRequest>) -> Json<serde_json::Value> {
    let target = std::path::Path::new(&req.path);
    if let Some(parent) = target.parent() {
        if !parent.exists() {
            warn!(path = %req.path, "write_file: parent directory does not exist");
            return Json(serde_json::json!({ "ok": false, "error": "parent directory not found" }));
        }
    }
    match std::fs::write(&req.path, &req.content) {
        Ok(_) => {
            debug!(path = %req.path, bytes = req.content.len(), "wrote file");
            Json(serde_json::json!({ "ok": true, "path": req.path }))
        }
        Err(e) => {
            warn!(path = %req.path, error = %e, "failed to write file");
            Json(serde_json::json!({ "ok": false, "error": e.to_string() }))
        }
    }
}

#[derive(serde::Deserialize)]
struct OpenPathRequest {
    path: String,
}

// ---------------------------------------------------------------------------
// List directory (recursive file tree)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Open IDE window
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize)]
struct OpenIdeRequest {
    path: String,
    root: Option<String>,
}

async fn open_ide(
    AxumState(proxy): AxumState<Arc<EventLoopProxy<UserEvent>>>,
    Json(req): Json<OpenIdeRequest>,
) -> Json<serde_json::Value> {
    info!(path = %req.path, "requesting IDE window");
    let _ = proxy.send_event(UserEvent::OpenIdeWindow { file_path: req.path, root_path: req.root });
    Json(serde_json::json!({ "ok": true }))
}

// ---------------------------------------------------------------------------
// Update routes
// ---------------------------------------------------------------------------

async fn get_update_status(
    AxumState(state): AxumState<UpdateState>,
) -> Json<serde_json::Value> {
    let status = state.status.read().await;
    let channel = state.channel.read().await;
    Json(serde_json::json!({
        "update": *status,
        "channel": *channel,
        "current_version": env!("CARGO_PKG_VERSION"),
    }))
}

async fn post_update_install() -> Json<serde_json::Value> {
    match updater::install_and_restart() {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => {
            warn!(error = %e, "install_and_restart failed");
            Json(serde_json::json!({ "ok": false, "error": e }))
        }
    }
}

#[derive(serde::Deserialize)]
struct SetChannelRequest {
    channel: UpdateChannel,
}

async fn post_update_channel(
    AxumState(state): AxumState<UpdateState>,
    Json(req): Json<SetChannelRequest>,
) -> Json<serde_json::Value> {
    let old = {
        let mut ch = state.channel.write().await;
        let old = *ch;
        *ch = req.channel;
        old
    };
    info!(from = %old, to = %req.channel, "update channel changed");
    updater::trigger_recheck(state);
    Json(serde_json::json!({ "ok": true, "channel": req.channel }))
}

// ---------------------------------------------------------------------------
// File / path helpers
// ---------------------------------------------------------------------------

async fn open_path(Json(req): Json<OpenPathRequest>) -> Json<serde_json::Value> {
    let target = std::path::Path::new(&req.path);
    if !target.exists() {
        warn!(path = %req.path, "open_path: path does not exist");
        return Json(serde_json::json!({ "ok": false, "error": "path not found" }));
    }
    match open::that(&req.path) {
        Ok(_) => {
            debug!(path = %req.path, "opened path in OS");
            Json(serde_json::json!({ "ok": true }))
        }
        Err(e) => {
            warn!(path = %req.path, error = %e, "failed to open path");
            Json(serde_json::json!({ "ok": false, "error": e.to_string() }))
        }
    }
}

fn main() {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| {
                EnvFilter::new("aura_desktop=debug,aura_server=debug,aura_engine=debug,tower_http=debug,info")
            }),
        )
        .init();

    let data_dir = default_data_dir();
    std::fs::create_dir_all(&data_dir).expect("failed to create data directory");
    info!(path = %data_dir.display(), "data directory ready");

    let db_path = data_dir.join("db");
    let webview_data_dir = data_dir.join("webview");
    let frontend_dir = find_frontend_dir();
    match frontend_dir {
        Some(ref dir) => info!(path = %dir.display(), "serving frontend"),
        None => warn!("no frontend dist found; pages will not load"),
    }

    // Try the preferred fixed port so the WebView origin stays consistent
    // across restarts (localStorage is scoped per-origin including port).
    // Fall back to an OS-assigned port if the preferred one is occupied.
    let std_listener = StdTcpListener::bind(format!("127.0.0.1:{PREFERRED_PORT}"))
        .or_else(|_| StdTcpListener::bind("127.0.0.1:0"))
        .expect("failed to bind to an available port");
    std_listener
        .set_nonblocking(true)
        .expect("failed to set non-blocking");
    let port = std_listener.local_addr().unwrap().port();
    let url = format!("http://127.0.0.1:{port}");
    info!(%url, "server binding ready");

    // Create event loop early so we can hand a proxy to the Axum server thread
    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let ide_proxy: Arc<EventLoopProxy<UserEvent>> = Arc::new(proxy.clone());

    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<()>();

    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().expect("failed to create tokio runtime");
        rt.block_on(async move {
            let update_state = UpdateState::new(UpdateChannel::Stable);

            let app_state = aura_server::build_app_state(&db_path);
            let app = aura_server::create_router_with_frontend(app_state, frontend_dir)
                .route("/api/pick-folder", axum_post(pick_folder))
                .route("/api/pick-file", axum_post(pick_file))
                .route("/api/open-path", axum_post(open_path))
                .route("/api/read-file", axum_post(read_file))
                .route("/api/write-file", axum_post(write_file))
                .route(
                    "/api/open-ide",
                    axum_post(open_ide).with_state(ide_proxy),
                )
                .route(
                    "/api/update-status",
                    axum_get(get_update_status).with_state(update_state.clone()),
                )
                .route("/api/update-install", axum_post(post_update_install))
                .route(
                    "/api/update-channel",
                    axum_post(post_update_channel).with_state(update_state.clone()),
                );

            updater::spawn_update_loop(update_state);

            let listener = TcpListener::from_std(std_listener).expect("failed to create listener");

            let _ = ready_tx.send(());
            axum::serve(listener, app).await.expect("server error");
        });
    });

    ready_rx
        .recv()
        .expect("server thread failed before becoming ready");
    info!("axum server ready");

    let icon_data = {
        let png_bytes = include_bytes!("../assets/aura-icon.png");
        let img = image::load_from_memory(png_bytes).expect("failed to decode icon");
        let rgba = img.to_rgba8();
        let (w, h) = rgba.dimensions();
        IconData { rgba: rgba.into_raw(), width: w, height: h }
    };

    let window = WindowBuilder::new()
        .with_title("AURA")
        .with_decorations(false)
        .with_visible(false)
        .with_window_icon(Some(icon_data.to_icon()))
        .with_inner_size(tao::dpi::LogicalSize::new(1280.0, 800.0))
        .build(&event_loop)
        .expect("failed to build window");
    let main_window_id = window.id();
    info!("window created");

    let mut web_context = WebContext::new(Some(webview_data_dir));

    const READY_SCRIPT: &str = "\
        if (document.readyState === 'loading') { \
            document.addEventListener('DOMContentLoaded', function() { window.ipc.postMessage('ready'); }); \
        } else { \
            window.ipc.postMessage('ready'); \
        }";

    let _main_webview = {
        let builder = WebViewBuilder::new_with_web_context(&mut web_context)
            .with_background_color((0, 0, 0, 255))
            .with_url(&url)
            .with_initialization_script(READY_SCRIPT)
            .with_ipc_handler(ipc_handler(proxy.clone(), main_window_id))
            .with_new_window_req_handler(|uri, _features| {
                let _ = open::that(&uri);
                wry::NewWindowResponse::Deny
            });

        #[cfg(not(target_os = "linux"))]
        let webview = builder.build(&window).expect("failed to build webview");

        #[cfg(target_os = "linux")]
        let webview = {
            use wry::WebViewBuilderExtUnix;
            builder
                .build_gtk(window.gtk_window())
                .expect("failed to build webview")
        };

        webview
    };

    {
        let fallback_proxy = proxy.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(500));
            let _ = fallback_proxy.send_event(UserEvent::ShowWindow { window_id: main_window_id });
        });
    }

    let mut ide_windows: HashMap<WindowId, (tao::window::Window, wry::WebView)> = HashMap::new();
    let base_url = url;

    event_loop.run(move |event, elwt, control_flow| {
        *control_flow = ControlFlow::Wait;

        match event {
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                window_id,
                ..
            } => {
                if window_id == main_window_id {
                    *control_flow = ControlFlow::Exit;
                } else {
                    ide_windows.remove(&window_id);
                }
            }
            Event::UserEvent(user_event) => match user_event {
                UserEvent::WindowCommand { window_id, cmd } => {
                    if window_id == main_window_id {
                        match cmd {
                            WinCmd::Minimize => window.set_minimized(true),
                            WinCmd::Maximize => window.set_maximized(!window.is_maximized()),
                            WinCmd::Close => *control_flow = ControlFlow::Exit,
                            WinCmd::Drag => { let _ = window.drag_window(); }
                        }
                    } else if let Some((ide_win, _)) = ide_windows.get(&window_id) {
                        match cmd {
                            WinCmd::Minimize => ide_win.set_minimized(true),
                            WinCmd::Maximize => ide_win.set_maximized(!ide_win.is_maximized()),
                            WinCmd::Close => { ide_windows.remove(&window_id); }
                            WinCmd::Drag => { let _ = ide_win.drag_window(); }
                        }
                    }
                }
                UserEvent::OpenIdeWindow { file_path, root_path } => {
                    let p = proxy.clone();
                    let (win, wv) = aura_ide::open_ide_window(
                        elwt,
                        &base_url,
                        &file_path,
                        root_path.as_deref(),
                        Some(icon_data.to_icon()),
                        move |wid| Box::new(ipc_handler(p, wid)),
                    );
                    let ide_wid = win.id();
                    ide_windows.insert(ide_wid, (win, wv));
                    let fallback_proxy = proxy.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(500));
                        let _ = fallback_proxy.send_event(UserEvent::ShowWindow { window_id: ide_wid });
                    });
                }
                UserEvent::ShowWindow { window_id } => {
                    if window_id == main_window_id {
                        window.set_visible(true);
                    } else if let Some((ide_win, _)) = ide_windows.get(&window_id) {
                        ide_win.set_visible(true);
                    }
                }
            },
            _ => {}
        }
    });
}
