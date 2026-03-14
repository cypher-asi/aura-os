use std::net::TcpListener as StdTcpListener;
use std::path::PathBuf;

use axum::routing::post as axum_post;
use axum::Json;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy};
use tao::window::{Icon, WindowBuilder};
use tokio::net::TcpListener;
use tracing::{debug, info, warn};
use tracing_subscriber::EnvFilter;
use wry::{WebContext, WebViewBuilder};

const PREFERRED_PORT: u16 = 19847;

#[derive(Debug)]
enum UserEvent {
    Minimize,
    Maximize,
    Close,
    DragWindow,
}

fn ipc_handler(proxy: EventLoopProxy<UserEvent>) -> impl Fn(wry::http::Request<String>) + 'static {
    move |req: wry::http::Request<String>| {
        let msg = req.body().trim();
        let event = match msg {
            "minimize" => Some(UserEvent::Minimize),
            "maximize" => Some(UserEvent::Maximize),
            "close" => Some(UserEvent::Close),
            "drag" => Some(UserEvent::DragWindow),
            other => {
                warn!(message = other, "unknown IPC message");
                None
            }
        };
        if let Some(e) = event {
            debug!(command = msg, "IPC event");
            let _ = proxy.send_event(e);
        }
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
        PathBuf::from("../frontend/dist"),
    ];
    if let Some(dir) = exe_dir {
        candidates.push(dir.join("frontend/dist"));
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
struct OpenPathRequest {
    path: String,
}

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

    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<()>();

    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().expect("failed to create tokio runtime");
        rt.block_on(async move {
            let state = aura_server::build_app_state(&db_path, &data_dir);
            let app = aura_server::create_router_with_frontend(state, frontend_dir)
                .route("/api/pick-folder", axum_post(pick_folder))
                .route("/api/pick-file", axum_post(pick_file))
                .route("/api/open-path", axum_post(open_path))
                .route("/api/read-file", axum_post(read_file));
            let listener = TcpListener::from_std(std_listener).expect("failed to create listener");

            let _ = ready_tx.send(());
            axum::serve(listener, app).await.expect("server error");
        });
    });

    ready_rx
        .recv()
        .expect("server thread failed before becoming ready");
    info!("axum server ready");

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();

    let window_icon = {
        let png_bytes = include_bytes!("../assets/aura-icon.png");
        let img = image::load_from_memory(png_bytes).expect("failed to decode icon");
        let rgba = img.to_rgba8();
        let (w, h) = rgba.dimensions();
        Icon::from_rgba(rgba.into_raw(), w, h).expect("failed to create window icon")
    };

    let window = WindowBuilder::new()
        .with_title("AURA")
        .with_decorations(false)
        .with_window_icon(Some(window_icon))
        .with_inner_size(tao::dpi::LogicalSize::new(1280.0, 800.0))
        .build(&event_loop)
        .expect("failed to build window");
    info!("window created");

    let mut web_context = WebContext::new(Some(webview_data_dir));

    let _webview = {
        let builder = WebViewBuilder::new_with_web_context(&mut web_context)
            .with_url(&url)
            .with_ipc_handler(ipc_handler(proxy));

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

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;

        match event {
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                *control_flow = ControlFlow::Exit;
            }
            Event::UserEvent(user_event) => match user_event {
                UserEvent::Minimize => window.set_minimized(true),
                UserEvent::Maximize => window.set_maximized(!window.is_maximized()),
                UserEvent::Close => *control_flow = ControlFlow::Exit,
                UserEvent::DragWindow => {
                    let _ = window.drag_window();
                }
            },
            _ => {}
        }
    });
}
