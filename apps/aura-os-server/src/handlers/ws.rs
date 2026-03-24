use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::IntoResponse;
use tracing::{info, warn};

use crate::state::AppState;

// #region agent log
fn _dbg_ws_log(location: &str, message: &str, data: &serde_json::Value, hypothesis: &str) {
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open("debug-926b20.log") {
        let entry = serde_json::json!({
            "sessionId": "926b20",
            "location": location,
            "message": message,
            "data": data,
            "hypothesisId": hypothesis,
            "timestamp": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64,
        });
        let _ = writeln!(f, "{}", entry);
    }
}
// #endregion

pub(crate) async fn ws_events(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    info!("WebSocket client connecting");
    ws.on_upgrade(|socket| handle_ws(socket, state))
}

async fn handle_ws(mut socket: WebSocket, state: AppState) {
    info!("WebSocket client connected");
    let mut rx = state.event_broadcast.subscribe();

    // #region agent log
    _dbg_ws_log("ws.rs:handle_ws:connected", "WS client subscribed to event_broadcast", &serde_json::json!({
        "receiver_count": state.event_broadcast.receiver_count(),
    }), "B");
    // #endregion

    loop {
        tokio::select! {
            result = rx.recv() => {
                match result {
                    Ok(value) => {
                        let event_type = value.get("type").and_then(|t| t.as_str()).unwrap_or("unknown");
                        // #region agent log
                        if event_type.starts_with("loop_") || event_type.starts_with("task_") {
                            _dbg_ws_log("ws.rs:handle_ws:sending", "sending domain event to WS client", &serde_json::json!({
                                "event_type": event_type,
                                "project_id": value.get("project_id"),
                                "agent_instance_id": value.get("agent_instance_id"),
                            }), "B");
                        }
                        // #endregion
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
