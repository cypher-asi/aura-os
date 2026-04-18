//! WebSocket handler for an in-app browser session.
//!
//! Frame delivery uses binary WS messages with a compact header followed
//! by the JPEG payload (see [`aura_os_browser::protocol`]). Control /
//! navigation messages travel as JSON on the text channel.

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::response::IntoResponse;
use tracing::{debug, info, warn};

use aura_os_browser::{
    encode_frame_header, ClientMsg, FrameHeader, NavState, ServerEvent, SessionId,
    FRAME_HEADER_LEN,
};

use crate::state::AppState;

pub(crate) async fn ws_browser(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let session_id: SessionId = match id.parse() {
        Ok(sid) => sid,
        Err(_) => {
            return (axum::http::StatusCode::BAD_REQUEST, "invalid session id").into_response();
        }
    };
    ws.on_upgrade(move |socket| handle_socket(socket, state, session_id))
}

async fn handle_socket(mut socket: WebSocket, state: AppState, id: SessionId) {
    info!(%id, "browser WebSocket connected");

    loop {
        tokio::select! {
            biased;
            ws_msg = socket.recv() => {
                match ws_msg {
                    Some(Ok(Message::Text(text))) => {
                        if !handle_client_text(&state, id, &text).await {
                            break;
                        }
                    }
                    Some(Ok(Message::Binary(bytes))) => {
                        handle_client_binary(&state, id, &bytes).await;
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }

    if let Err(err) = state.browser_manager.kill(id).await {
        warn!(%id, %err, "failed to kill browser session on WS close");
    }
    info!(%id, "browser WebSocket disconnected");
}

/// Returns `false` when the socket should close.
async fn handle_client_text(state: &AppState, id: SessionId, text: &str) -> bool {
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
            .record_visit(None, url.clone(), None)
            .await
        {
            debug!(%id, %err, "record_visit failed; continuing");
        }
    }
    match state.browser_manager.dispatch(id, msg).await {
        Ok(()) => true,
        Err(err) => {
            warn!(%id, %err, "browser dispatch failed");
            true
        }
    }
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

#[allow(dead_code)]
async fn send_frame(socket: &mut WebSocket, seq: u32, width: u16, height: u16, jpeg: &[u8]) {
    let mut header = [0u8; FRAME_HEADER_LEN];
    encode_frame_header(
        &mut header,
        FrameHeader {
            seq,
            width,
            height,
        },
    );
    let mut buf = Vec::with_capacity(FRAME_HEADER_LEN + jpeg.len());
    buf.extend_from_slice(&header);
    buf.extend_from_slice(jpeg);
    let _ = socket.send(Message::Binary(buf)).await;
}

#[allow(dead_code)]
async fn send_nav(socket: &mut WebSocket, nav: &NavState) {
    let payload = serde_json::json!({ "type": "nav", "nav": nav });
    let _ = socket.send(Message::Text(payload.to_string())).await;
}

#[allow(dead_code)]
async fn forward_server_event(socket: &mut WebSocket, event: ServerEvent) {
    match event {
        ServerEvent::Frame {
            seq,
            width,
            height,
            jpeg,
        } => send_frame(socket, seq, width, height, &jpeg).await,
        ServerEvent::Nav(nav) => send_nav(socket, &nav).await,
        ServerEvent::Exit { code } => {
            let payload = serde_json::json!({ "type": "exit", "code": code });
            let _ = socket.send(Message::Text(payload.to_string())).await;
        }
    }
}
