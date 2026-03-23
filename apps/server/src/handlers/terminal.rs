use std::io::Read;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::response::IntoResponse;
use axum::Json;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tracing::{info, warn};

use aura_terminal::TerminalId;

use crate::state::AppState;

#[derive(Deserialize)]
pub struct SpawnRequest {
    cols: Option<u16>,
    rows: Option<u16>,
    cwd: Option<String>,
}

#[derive(Serialize)]
pub struct SpawnResponse {
    id: String,
    shell: String,
}

pub async fn spawn_terminal(
    State(state): State<AppState>,
    Json(body): Json<SpawnRequest>,
) -> impl IntoResponse {
    let cols = body.cols.unwrap_or(80);
    let rows = body.rows.unwrap_or(24);

    match state.terminal_manager.spawn(cols, rows, body.cwd) {
        Ok(info) => {
            let resp = SpawnResponse {
                id: info.id.to_string(),
                shell: info.shell,
            };
            (axum::http::StatusCode::OK, Json(serde_json::json!(resp))).into_response()
        }
        Err(e) => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e })),
        )
            .into_response(),
    }
}

pub async fn list_terminals(State(state): State<AppState>) -> impl IntoResponse {
    let terminals = state.terminal_manager.list();
    Json(serde_json::json!(terminals))
}

pub async fn kill_terminal(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let tid: TerminalId = match id.parse() {
        Ok(t) => t,
        Err(_) => {
            return (
                axum::http::StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "Invalid terminal ID" })),
            )
                .into_response()
        }
    };

    match state.terminal_manager.kill(tid) {
        Ok(()) => axum::http::StatusCode::NO_CONTENT.into_response(),
        Err(e) => (
            axum::http::StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": e })),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
struct WsClientMsg {
    #[serde(rename = "type")]
    msg_type: String,
    data: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
}

pub async fn ws_terminal(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let tid: TerminalId = match id.parse() {
        Ok(t) => t,
        Err(_) => {
            return (axum::http::StatusCode::BAD_REQUEST, "Invalid terminal ID").into_response()
        }
    };

    ws.on_upgrade(move |socket| handle_terminal_ws(socket, state, tid))
}

/// Returns true if the connection should close.
fn handle_ws_client_message(state: &AppState, id: TerminalId, msg: WsClientMsg) -> bool {
    match msg.msg_type.as_str() {
        "input" => {
            if let Some(data) = msg.data {
                if let Ok(bytes) = B64.decode(&data) {
                    if let Err(e) = state.terminal_manager.write_input(id, &bytes) {
                        warn!(%id, "Write to PTY failed: {e}");
                        return true;
                    }
                }
            }
        }
        "resize" => {
            if let (Some(cols), Some(rows)) = (msg.cols, msg.rows) {
                if let Err(e) = state.terminal_manager.resize(id, cols, rows) {
                    warn!(%id, "Resize PTY failed: {e}");
                }
            }
        }
        _ => {}
    }
    false
}

async fn handle_terminal_ws(mut socket: WebSocket, state: AppState, id: TerminalId) {
    info!(%id, "Terminal WebSocket connected");

    let reader = match state.terminal_manager.take_reader(id) {
        Ok(r) => r,
        Err(e) => {
            warn!(%id, "Failed to take reader: {e}");
            let _ = socket
                .send(Message::Text(
                    serde_json::json!({"type": "exit", "code": -1}).to_string(),
                ))
                .await;
            return;
        }
    };

    let (output_tx, mut output_rx) = mpsc::channel::<Vec<u8>>(256);
    let (exit_tx, mut exit_rx) = mpsc::channel::<i32>(1);
    tokio::task::spawn_blocking(move || {
        read_pty_loop(reader, output_tx, exit_tx);
    });

    loop {
        tokio::select! {
            Some(data) = output_rx.recv() => {
                let msg = serde_json::json!({"type": "output", "data": B64.encode(&data)});
                if socket.send(Message::Text(msg.to_string())).await.is_err() { break; }
            }
            Some(code) = exit_rx.recv() => {
                let _ = socket.send(Message::Text(serde_json::json!({"type": "exit", "code": code}).to_string())).await;
                break;
            }
            ws_msg = socket.recv() => {
                match ws_msg {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(msg) = serde_json::from_str::<WsClientMsg>(&text) {
                            if handle_ws_client_message(&state, id, msg) { break; }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }

    let _ = state.terminal_manager.kill(id);
    info!(%id, "Terminal WebSocket disconnected");
}

fn read_pty_loop(
    mut reader: Box<dyn Read + Send>,
    output_tx: mpsc::Sender<Vec<u8>>,
    exit_tx: mpsc::Sender<i32>,
) {
    let mut buf = [0u8; 4096];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => {
                let _ = exit_tx.blocking_send(0);
                break;
            }
            Ok(n) => {
                if output_tx.blocking_send(buf[..n].to_vec()).is_err() {
                    break;
                }
            }
            Err(_) => {
                let _ = exit_tx.blocking_send(-1);
                break;
            }
        }
    }
}
