//! WebSocket handler for an in-app browser session.
//!
//! Frame delivery uses binary WS messages with a compact header followed
//! by the JPEG payload (see [`aura_os_browser::protocol`]). Control /
//! navigation messages travel as JSON on the text channel.

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::response::IntoResponse;
use tokio::sync::mpsc;
use tracing::{debug, info, warn};

use aura_os_browser::{
    encode_frame_header, ClientMsg, FrameHeader, NavState, ServerEvent, SessionId, FRAME_HEADER_LEN,
};
use aura_os_core::ProjectId;

use crate::state::AppState;
use crate::state::AuthSession;

pub(crate) async fn ws_browser(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    AuthSession(session): AuthSession,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let session_id: SessionId = match id.parse() {
        Ok(sid) => sid,
        Err(_) => {
            return (axum::http::StatusCode::BAD_REQUEST, "invalid session id").into_response();
        }
    };
    if !state
        .browser_manager
        .is_owned_by(session_id, &session.user_id)
    {
        return (
            axum::http::StatusCode::NOT_FOUND,
            "browser session not found",
        )
            .into_response();
    }
    ws.on_upgrade(move |socket| handle_socket(socket, state, session_id))
}

async fn handle_socket(mut socket: WebSocket, state: AppState, id: SessionId) {
    info!(%id, "browser WebSocket connected");

    let events = state.browser_manager.take_events(id);
    let project_id = state.browser_manager.project_id_of(id);

    match events {
        Some(rx) => pump_loop(&mut socket, &state, id, project_id, rx).await,
        None => {
            debug!(%id, "no event channel available; running dispatch-only loop");
            dispatch_only_loop(&mut socket, &state, id, project_id).await;
        }
    }

    if let Err(err) = state.browser_manager.kill(id).await {
        warn!(%id, %err, "failed to kill browser session on WS close");
    }
    info!(%id, "browser WebSocket disconnected");
}

async fn pump_loop(
    socket: &mut WebSocket,
    state: &AppState,
    id: SessionId,
    project_id: Option<ProjectId>,
    mut events: mpsc::Receiver<ServerEvent>,
) {
    loop {
        tokio::select! {
            biased;
            ws_msg = socket.recv() => {
                if !handle_incoming(socket, state, id, project_id, ws_msg).await {
                    break;
                }
            }
            event = events.recv() => {
                match event {
                    Some(evt) => {
                        if !forward_server_event(socket, state, id, project_id, evt).await {
                            break;
                        }
                    }
                    None => {
                        debug!(%id, "backend event channel closed");
                        break;
                    }
                }
            }
        }
    }
}

async fn dispatch_only_loop(
    socket: &mut WebSocket,
    state: &AppState,
    id: SessionId,
    project_id: Option<ProjectId>,
) {
    loop {
        let ws_msg = socket.recv().await;
        if !handle_incoming(socket, state, id, project_id, ws_msg).await {
            break;
        }
    }
}

/// Returns `false` when the socket should close.
async fn handle_incoming(
    _socket: &mut WebSocket,
    state: &AppState,
    id: SessionId,
    project_id: Option<ProjectId>,
    ws_msg: Option<Result<Message, axum::Error>>,
) -> bool {
    match ws_msg {
        Some(Ok(Message::Text(text))) => handle_client_text(state, id, project_id, &text).await,
        Some(Ok(Message::Binary(bytes))) => {
            handle_client_binary(state, id, &bytes).await;
            true
        }
        Some(Ok(Message::Close(_))) | None => false,
        _ => true,
    }
}

/// Returns `false` when the socket should close.
async fn handle_client_text(
    state: &AppState,
    id: SessionId,
    project_id: Option<ProjectId>,
    text: &str,
) -> bool {
    let msg: ClientMsg = match serde_json::from_str(text) {
        Ok(m) => m,
        Err(err) => {
            warn!(%id, %err, "dropping malformed browser client message");
            return true;
        }
    };
    if let ClientMsg::Navigate { ref url } = msg {
        if let Err(err) = state
            .browser_manager
            .record_visit(project_id.as_ref(), url.clone(), None)
            .await
        {
            debug!(%id, %err, "record_visit failed; continuing");
        }
    }
    if let Err(err) = state.browser_manager.dispatch(id, msg).await {
        warn!(%id, %err, "browser dispatch failed");
    }
    true
}

async fn handle_client_binary(state: &AppState, id: SessionId, bytes: &[u8]) {
    // The only binary C→S frame right now is a 4-byte frame ack `[seq: u32 LE]`.
    if bytes.len() < 4 {
        return;
    }
    let seq = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
    if let Err(err) = state.browser_manager.ack_frame(id, seq).await {
        debug!(%id, %err, "frame ack failed");
    }
}

/// Returns `false` when the socket should close after sending an exit event.
async fn forward_server_event(
    socket: &mut WebSocket,
    state: &AppState,
    id: SessionId,
    project_id: Option<ProjectId>,
    event: ServerEvent,
) -> bool {
    match event {
        ServerEvent::Frame {
            seq,
            width,
            height,
            jpeg,
        } => {
            send_frame(socket, seq, width, height, &jpeg).await;
            true
        }
        ServerEvent::Nav(nav) => {
            if let Ok(url) = url::Url::parse(&nav.url) {
                if let Err(err) = state
                    .browser_manager
                    .record_visit(project_id.as_ref(), url, nav.title.clone())
                    .await
                {
                    debug!(%id, %err, "record_visit on nav failed");
                }
            }
            send_nav(socket, &nav).await;
            true
        }
        ServerEvent::Exit { code } => {
            let payload = serde_json::json!({ "type": "exit", "code": code });
            let _ = socket.send(Message::Text(payload.to_string())).await;
            false
        }
    }
}

async fn send_frame(socket: &mut WebSocket, seq: u32, width: u16, height: u16, jpeg: &[u8]) {
    let mut header = [0u8; FRAME_HEADER_LEN];
    encode_frame_header(&mut header, FrameHeader { seq, width, height });
    let mut buf = Vec::with_capacity(FRAME_HEADER_LEN + jpeg.len());
    buf.extend_from_slice(&header);
    buf.extend_from_slice(jpeg);
    let _ = socket.send(Message::Binary(buf)).await;
}

async fn send_nav(socket: &mut WebSocket, nav: &NavState) {
    let payload = serde_json::json!({ "type": "nav", "nav": nav });
    let _ = socket.send(Message::Text(payload.to_string())).await;
}
