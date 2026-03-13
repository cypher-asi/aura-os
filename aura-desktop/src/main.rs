use std::net::TcpListener as StdTcpListener;
use std::path::PathBuf;

use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy};
use tao::window::WindowBuilder;
use tokio::net::TcpListener;
use wry::WebViewBuilder;

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
            _ => None,
        };
        if let Some(e) = event {
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

fn main() {
    let data_dir = default_data_dir();
    std::fs::create_dir_all(&data_dir).expect("failed to create data directory");

    let db_path = data_dir.join("db");
    let frontend_dir = find_frontend_dir();

    // Bind to port 0 to let the OS pick an available port, then hand
    // the listener to the background Axum server.
    let std_listener =
        StdTcpListener::bind("127.0.0.1:0").expect("failed to bind to an available port");
    std_listener
        .set_nonblocking(true)
        .expect("failed to set non-blocking");
    let port = std_listener.local_addr().unwrap().port();
    let url = format!("http://127.0.0.1:{port}");

    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<()>();

    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().expect("failed to create tokio runtime");
        rt.block_on(async move {
            let state = aura_server::build_app_state(&db_path, &data_dir);
            let app = aura_server::create_router_with_frontend(state, frontend_dir);
            let listener = TcpListener::from_std(std_listener).expect("failed to create listener");

            let _ = ready_tx.send(());
            axum::serve(listener, app).await.expect("server error");
        });
    });

    ready_rx
        .recv()
        .expect("server thread failed before becoming ready");

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();

    let window = WindowBuilder::new()
        .with_title("AURA")
        .with_decorations(false)
        .with_inner_size(tao::dpi::LogicalSize::new(1280.0, 800.0))
        .build(&event_loop)
        .expect("failed to build window");

    let _webview = {
        let builder = WebViewBuilder::new()
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
