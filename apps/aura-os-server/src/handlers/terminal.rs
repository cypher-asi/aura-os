use std::io::Read;
use std::str::FromStr;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::response::IntoResponse;
use axum::Json;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tracing::{debug, info, warn};

use aura_os_browser::session::discovery::extract_localhost_urls;
use aura_os_core::ProjectId;
use aura_os_terminal::TerminalId;

use crate::state::AppState;
use crate::state::AuthJwt;

#[derive(Deserialize)]
pub(crate) struct SpawnRequest {
    cols: Option<u16>,
    rows: Option<u16>,
    cwd: Option<String>,
    #[serde(default)]
    project_id: Option<String>,
}

#[derive(Serialize)]
pub(crate) struct SpawnResponse {
    id: String,
    shell: String,
}

pub(crate) async fn spawn_terminal(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Json(body): Json<SpawnRequest>,
) -> impl IntoResponse {
    let cols = body.cols.unwrap_or(80);
    let rows = body.rows.unwrap_or(24);
    let project_id = match authorize_optional_project_id(&state, &jwt, body.project_id).await {
        Ok(project_id) => project_id,
        Err(err) => return err.into_response(),
    };

    let terminal_manager = state.terminal_manager.clone();
    let spawn_result = tokio::task::spawn_blocking(move || {
        terminal_manager.spawn_with_project(cols, rows, body.cwd, project_id)
    })
    .await;

    match flatten_terminal_blocking_result(spawn_result) {
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

async fn authorize_optional_project_id(
    state: &AppState,
    jwt: &str,
    project_id: Option<String>,
) -> Result<Option<String>, axum::response::Response> {
    let Some(raw_project_id) = project_id else {
        return Ok(None);
    };
    let parsed = match ProjectId::from_str(&raw_project_id) {
        Ok(project_id) => project_id,
        Err(_) => {
            return Err((
                axum::http::StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "invalid project id" })),
            )
                .into_response())
        }
    };
    if let Some(client) = &state.network_client {
        if let Err((status, body)) = client
            .get_project(&parsed.to_string(), jwt)
            .await
            .map_err(crate::error::map_network_error)
        {
            return Err((status, body).into_response());
        }
    } else if let Err(err) = state.project_service.get_project(&parsed) {
        let response = match err {
            aura_os_projects::ProjectError::NotFound(_) => (
                axum::http::StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "project not found" })),
            )
                .into_response(),
            other => (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("fetching project: {other}") })),
            )
                .into_response(),
        };
        return Err(response);
    }
    Ok(Some(raw_project_id))
}

pub(crate) async fn list_terminals(State(state): State<AppState>) -> impl IntoResponse {
    let terminals = state.terminal_manager.list();
    Json(serde_json::json!(terminals))
}

pub(crate) async fn kill_terminal(
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

    let terminal_manager = state.terminal_manager.clone();
    let kill_result = tokio::task::spawn_blocking(move || terminal_manager.kill(tid)).await;

    match flatten_terminal_blocking_result(kill_result) {
        Ok(()) => axum::http::StatusCode::NO_CONTENT.into_response(),
        // Deleting an already-gone terminal should be idempotent.
        // The WS shutdown path already kills the PTY, so a follow-up DELETE
        // from the client can legitimately race and hit a missing ID.
        Err(_e) => axum::http::StatusCode::NO_CONTENT.into_response(),
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

pub(crate) async fn ws_terminal(
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

fn flatten_terminal_blocking_result<T>(
    result: Result<Result<T, String>, tokio::task::JoinError>,
) -> Result<T, String> {
    result.map_err(|error| format!("terminal worker failed: {error}"))?
}

async fn write_terminal_input(
    state: &AppState,
    id: TerminalId,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let terminal_manager = state.terminal_manager.clone();
    flatten_terminal_blocking_result(
        tokio::task::spawn_blocking(move || terminal_manager.write_input(id, &bytes)).await,
    )
}

async fn resize_terminal(
    state: &AppState,
    id: TerminalId,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let terminal_manager = state.terminal_manager.clone();
    flatten_terminal_blocking_result(
        tokio::task::spawn_blocking(move || terminal_manager.resize(id, cols, rows)).await,
    )
}

async fn kill_terminal_session(state: &AppState, id: TerminalId) -> Result<(), String> {
    let terminal_manager = state.terminal_manager.clone();
    flatten_terminal_blocking_result(
        tokio::task::spawn_blocking(move || terminal_manager.kill(id)).await,
    )
}

/// Returns true if the connection should close.
async fn handle_ws_client_message(state: &AppState, id: TerminalId, msg: WsClientMsg) -> bool {
    match msg.msg_type.as_str() {
        "input" => {
            if let Some(data) = msg.data {
                if let Ok(bytes) = B64.decode(&data) {
                    if let Err(e) = write_terminal_input(state, id, bytes).await {
                        warn!(%id, "Write to PTY failed: {e}");
                        return true;
                    }
                }
            }
        }
        "resize" => {
            if let (Some(cols), Some(rows)) = (msg.cols, msg.rows) {
                if let Err(e) = resize_terminal(state, id, cols, rows).await {
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

    let project_id: Option<ProjectId> = state
        .terminal_manager
        .project_id_of(id)
        .and_then(|s| ProjectId::from_str(&s).ok());
    let mut scanner = UrlLineScanner::default();

    let (output_tx, mut output_rx) = mpsc::channel::<Vec<u8>>(256);
    let (exit_tx, mut exit_rx) = mpsc::channel::<i32>(1);
    tokio::task::spawn_blocking(move || {
        read_pty_loop(reader, output_tx, exit_tx);
    });

    loop {
        tokio::select! {
            Some(data) = output_rx.recv() => {
                scan_output_for_urls(&state, project_id.as_ref(), &mut scanner, &data).await;
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
                            if handle_ws_client_message(&state, id, msg).await { break; }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }

    let _ = kill_terminal_session(&state, id).await;
    info!(%id, "Terminal WebSocket disconnected");
}

/// Buffers terminal output into lines and yields completed ones for
/// passive URL scanning. ANSI escape codes are stripped best-effort before
/// matching. Oversized lines are capped at 8 KiB so a malformed program
/// can't grow the buffer unbounded.
#[derive(Default)]
struct UrlLineScanner {
    buf: String,
}

const SCANNER_LINE_CAP: usize = 8 * 1024;

impl UrlLineScanner {
    /// Feed a chunk of raw PTY bytes; returns completed lines.
    fn feed(&mut self, bytes: &[u8]) -> Vec<String> {
        let text = String::from_utf8_lossy(bytes);
        let mut lines = Vec::new();
        for ch in text.chars() {
            if ch == '\n' {
                let stripped = strip_ansi(&self.buf);
                lines.push(stripped);
                self.buf.clear();
            } else if ch != '\r' && self.buf.len() < SCANNER_LINE_CAP {
                self.buf.push(ch);
            }
        }
        lines
    }
}

/// Minimal ANSI CSI stripper — we only care about producing a string
/// whose URL substrings aren't split across escape sequences.
fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == 0x1b && i + 1 < bytes.len() && bytes[i + 1] == b'[' {
            i += 2;
            while i < bytes.len() {
                let b = bytes[i];
                i += 1;
                if (0x40..=0x7e).contains(&b) {
                    break;
                }
            }
        } else {
            out.push(bytes[i] as char);
            i += 1;
        }
    }
    out
}

async fn scan_output_for_urls(
    state: &AppState,
    project_id: Option<&ProjectId>,
    scanner: &mut UrlLineScanner,
    bytes: &[u8],
) {
    if project_id.is_none() {
        // Avoid line buffering for untagged terminals; nothing to persist.
        return;
    }
    for line in scanner.feed(bytes) {
        for entry in extract_localhost_urls(&line) {
            if let Err(err) = state
                .browser_manager
                .settings()
                .record_detected(project_id, entry)
                .await
            {
                debug!(%err, "failed to record detected URL from terminal output");
            }
        }
    }
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
