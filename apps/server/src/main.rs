use std::net::SocketAddr;
use std::path::PathBuf;

use tokio::net::TcpListener;
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

fn default_data_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("aura")
}

fn find_frontend_dir() -> Option<PathBuf> {
    let candidates = [
        PathBuf::from("frontend/dist"),
        PathBuf::from("../../frontend/dist"),
    ];
    candidates
        .into_iter()
        .find(|p| p.join("index.html").exists())
}

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("aura_server=debug,aura_services=debug,tower_http=debug,info")),
        )
        .init();

    let data_dir = default_data_dir();
    std::fs::create_dir_all(&data_dir).expect("failed to create data directory");

    let db_path = data_dir.join("db");
    let state = aura_server::build_app_state(&db_path);

    let frontend_dir = find_frontend_dir();
    if let Some(ref dir) = frontend_dir {
        info!("Serving frontend from {}", dir.display());
    } else {
        warn!("No frontend dist found; API-only mode (connect frontend dev server to port 3100)");
    }

    let app = aura_server::create_router_with_frontend(state, frontend_dir);

    let port: u16 = std::env::var("AURA_SERVER_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3100);
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    info!("Aura server listening on http://{addr}");

    let listener = TcpListener::bind(addr).await.expect("failed to bind");
    axum::serve(listener, app).await.expect("server error");
}
