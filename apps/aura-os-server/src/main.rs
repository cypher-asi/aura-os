use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;

use tokio::net::TcpListener;
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

fn default_data_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("aura")
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

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| {
            EnvFilter::new("aura_os_server=debug,aura_services=debug,tower_http=debug,info")
        }))
        .init();

    let data_dir = default_data_dir();
    std::fs::create_dir_all(&data_dir).expect("failed to create data directory");

    let db_path = data_dir.join("db");
    let state = aura_os_server::build_app_state(&db_path).expect("failed to open database");

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
