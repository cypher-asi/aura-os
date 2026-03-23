use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::IntoResponse;
use tracing::{info, warn};

use crate::state::AppState;

pub async fn ws_events(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    info!("WebSocket client connecting");
    ws.on_upgrade(|socket| handle_ws(socket, state))
}

async fn handle_ws(mut socket: WebSocket, state: AppState) {
    info!("WebSocket client connected");
    let mut rx = state.event_broadcast.subscribe();

    loop {
        tokio::select! {
            result = rx.recv() => {
                match result {
                    Ok(value) => {
                        let json = serde_json::to_string(&value).unwrap_or_default();
                        if socket.send(Message::Text(json)).await.is_err() {
                            warn!("WebSocket send failed, closing connection");
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        warn!(skipped = n, "WebSocket client lagged, skipping events");
                        continue;
                    }
                    Err(_) => break,
                }
            }
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }
    info!("WebSocket client disconnected");
}
