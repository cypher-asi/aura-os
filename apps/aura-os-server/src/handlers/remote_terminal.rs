//! Remote terminal WebSocket proxy.
//!
//! Single WebSocket endpoint that proxies the full terminal lifecycle
//! (spawn, I/O, kill-on-close) through the swarm gateway to the agent
//! pod. Uses only the existing axum WS + tokio-tungstenite stack.

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::response::IntoResponse;
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message as TungsteniteMessage;
use tracing::{info, warn};

use aura_os_core::HarnessMode;

use crate::error::{map_network_error, ApiError};
use crate::state::{AppState, AuthJwt};

/// `GET /ws/agents/:agent_id/remote_agent/terminal`
///
/// Validates the agent is remote, then upgrades to WebSocket and proxies
/// all frames to the swarm gateway's terminal endpoint.
pub(crate) async fn ws_remote_terminal(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<String>,
) -> impl IntoResponse {
    let network = match state.require_network_client() {
        Ok(n) => n,
        Err(e) => return e.into_response(),
    };
    let net_agent = match network.get_agent(&agent_id, &jwt).await {
        Ok(a) => a,
        Err(e) => return map_network_error(e).into_response(),
    };

    let mt = net_agent.machine_type.as_deref().unwrap_or("local");
    if HarnessMode::from_machine_type(mt) != HarnessMode::Swarm {
        return ApiError::bad_request("agent is not a remote agent").into_response();
    }

    let base_url = match state.swarm_base_url.as_deref() {
        Some(u) => u,
        None => {
            return ApiError::service_unavailable("swarm gateway is not configured").into_response()
        }
    };

    let ws_base = base_url
        .replace("https://", "wss://")
        .replace("http://", "ws://");
    let upstream_url = format!("{ws_base}/v1/agents/{agent_id}/terminal/ws");

    ws.on_upgrade(move |client| proxy_terminal(client, upstream_url, jwt))
        .into_response()
}

async fn proxy_terminal(client: WebSocket, upstream_url: String, jwt: String) {
    let mut request = match upstream_url.clone().into_client_request() {
        Ok(r) => r,
        Err(e) => {
            warn!("invalid upstream URL {upstream_url}: {e}");
            return;
        }
    };
    if let Ok(val) = format!("Bearer {jwt}").parse() {
        request.headers_mut().insert("Authorization", val);
    }

    let (upstream, _) = match tokio_tungstenite::connect_async(request).await {
        Ok(s) => s,
        Err(e) => {
            warn!("upstream terminal WS connect failed: {e}");
            return;
        }
    };

    info!("remote terminal proxy connected to {upstream_url}");

    let (client_write, client_read) = client.split();
    let (up_write, up_read) = upstream.split();

    let c2u = forward_client(client_read, up_write);
    let u2c = forward_upstream(up_read, client_write);

    tokio::select! {
        _ = c2u => {}
        _ = u2c => {}
    }

    info!("remote terminal proxy ended");
}

async fn forward_client(
    mut rx: futures_util::stream::SplitStream<WebSocket>,
    mut tx: futures_util::stream::SplitSink<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        TungsteniteMessage,
    >,
) {
    while let Some(Ok(msg)) = rx.next().await {
        let t = match msg {
            Message::Text(t) => TungsteniteMessage::Text(t.into()),
            Message::Binary(b) => TungsteniteMessage::Binary(b.into()),
            Message::Ping(p) => TungsteniteMessage::Ping(p.into()),
            Message::Pong(p) => TungsteniteMessage::Pong(p.into()),
            Message::Close(_) => break,
        };
        if tx.send(t).await.is_err() {
            break;
        }
    }
}

async fn forward_upstream(
    mut rx: futures_util::stream::SplitStream<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
    >,
    mut tx: futures_util::stream::SplitSink<WebSocket, Message>,
) {
    while let Some(Ok(msg)) = rx.next().await {
        let m = match &msg {
            TungsteniteMessage::Text(t) => Some(Message::Text(t.to_string())),
            TungsteniteMessage::Binary(b) => Some(Message::Binary(b.to_vec())),
            TungsteniteMessage::Ping(p) => Some(Message::Ping(p.to_vec())),
            TungsteniteMessage::Pong(p) => Some(Message::Pong(p.to_vec())),
            TungsteniteMessage::Close(_) | TungsteniteMessage::Frame(_) => None,
        };
        if let Some(m) = m {
            if tx.send(m).await.is_err() {
                break;
            }
        } else if matches!(msg, TungsteniteMessage::Close(_)) {
            break;
        }
    }
}
