//! Authenticated desktop-local relay.
//!
//! A desktop-local agent owns a filesystem and a bundled harness, so a phone
//! must never be given those capabilities directly.  The desktop instead
//! opens an outbound WebSocket to the control plane.  Mobile requests are
//! forwarded over that connection and the desktop executes them against its
//! loopback API.  The control plane stores only the connection lease and
//! response bytes; workspace data stays on the desktop.

use std::sync::Arc;
use std::time::Duration;

use axum::Json;
use axum::body::Body;
use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Path, State, WebSocketUpgrade};
use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use base64::Engine;
use dashmap::DashMap;
use futures_util::{SinkExt, StreamExt, stream};
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::tungstenite;
use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthSession};

pub const DESKTOP_ENVIRONMENT_HEADER: &str = "x-aura-desktop-environment";
const DESKTOP_RELAY_MARKER_HEADER: &str = "x-aura-desktop-relay";
const RELAY_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const RELAY_REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_BUFFERED_RELAY_RESPONSE_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RelayFrame {
    Register {
        environment_id: String,
        label: String,
    },
    RegisterAck {
        environment_id: String,
    },
    Request {
        request_id: String,
        method: String,
        path: String,
        headers: Vec<(String, String)>,
        body_b64: Option<String>,
    },
    ResponseStart {
        request_id: String,
        status: u16,
        headers: Vec<(String, String)>,
    },
    ResponseChunk {
        request_id: String,
        data_b64: String,
    },
    ResponseEnd {
        request_id: String,
        error: Option<String>,
    },
    Ping,
    Pong,
}

#[derive(Debug, Clone, Serialize)]
pub struct DesktopEnvironment {
    pub environment_id: String,
    pub label: String,
    pub connected: bool,
    pub last_seen_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug)]
struct PendingResponse {
    start_tx: Option<oneshot::Sender<RelayResponseStart>>,
    chunks_tx: mpsc::Sender<Result<Vec<u8>, String>>,
}

#[derive(Debug, Clone)]
pub struct RelayResponseStart {
    pub status: StatusCode,
    pub headers: Vec<(String, String)>,
}

#[derive(Debug)]
pub struct RelayResponse {
    pub start: RelayResponseStart,
    pub chunks: mpsc::Receiver<Result<Vec<u8>, String>>,
}

#[derive(Debug)]
struct DesktopConnection {
    connection_id: Uuid,
    user_id: String,
    environment_id: String,
    label: String,
    tx: mpsc::Sender<RelayFrame>,
    pending: DashMap<String, PendingResponse>,
    last_seen_at: std::sync::Mutex<chrono::DateTime<chrono::Utc>>,
}

#[derive(Clone, Default)]
pub struct DesktopRelayRegistry {
    connections: Arc<DashMap<String, Arc<DesktopConnection>>>,
}

impl DesktopRelayRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    async fn attach(
        &self,
        user_id: String,
        environment_id: String,
        label: String,
        tx: mpsc::Sender<RelayFrame>,
    ) -> Arc<DesktopConnection> {
        let connection = Arc::new(DesktopConnection {
            connection_id: Uuid::new_v4(),
            user_id,
            environment_id: environment_id.clone(),
            label,
            tx,
            pending: DashMap::new(),
            last_seen_at: std::sync::Mutex::new(chrono::Utc::now()),
        });
        if let Some(previous) = self.connections.insert(environment_id, connection.clone()) {
            previous.fail_pending("desktop relay replaced by a newer connection");
        }
        connection
    }

    fn detach(&self, connection: &Arc<DesktopConnection>) {
        if let Some(current) = self.connections.get(&connection.environment_id) {
            if current.connection_id == connection.connection_id {
                drop(current);
                self.connections.remove(&connection.environment_id);
            }
        }
        connection.fail_pending("desktop relay disconnected");
    }

    fn get_for_user(&self, user_id: &str, environment_id: &str) -> Option<Arc<DesktopConnection>> {
        let connection = self.connections.get(environment_id)?.clone();
        (connection.user_id == user_id).then_some(connection)
    }

    pub fn list_for_user(&self, user_id: &str) -> Vec<DesktopEnvironment> {
        self.connections
            .iter()
            .filter(|entry| entry.user_id == user_id)
            .map(|entry| DesktopEnvironment {
                environment_id: entry.environment_id.clone(),
                label: entry.label.clone(),
                connected: true,
                last_seen_at: entry
                    .last_seen_at
                    .lock()
                    .map(|value| *value)
                    .unwrap_or_else(|_| chrono::Utc::now()),
            })
            .collect()
    }

    async fn request(
        &self,
        user_id: &str,
        environment_id: &str,
        method: &str,
        path: &str,
        headers: &HeaderMap,
        body: Option<Vec<u8>>,
    ) -> ApiResult<RelayResponse> {
        let connection = self
            .get_for_user(user_id, environment_id)
            .ok_or_else(|| ApiError::service_unavailable("desktop is offline"))?;
        let request_id = Uuid::new_v4().to_string();
        let (start_tx, start_rx) = oneshot::channel();
        let (chunks_tx, chunks_rx) = mpsc::channel(32);
        connection.pending.insert(
            request_id.clone(),
            PendingResponse {
                start_tx: Some(start_tx),
                chunks_tx,
            },
        );

        let mut forwarded_headers = Vec::new();
        for (name, value) in headers {
            let name = name.as_str().to_ascii_lowercase();
            if matches!(
                name.as_str(),
                "host" | "content-length" | DESKTOP_ENVIRONMENT_HEADER
            ) {
                continue;
            }
            if let Ok(value) = value.to_str() {
                forwarded_headers.push((name, value.to_string()));
            }
        }
        forwarded_headers.push((DESKTOP_RELAY_MARKER_HEADER.to_string(), "1".to_string()));

        let frame = RelayFrame::Request {
            request_id: request_id.clone(),
            method: method.to_string(),
            path: path.to_string(),
            headers: forwarded_headers,
            body_b64: body.map(|bytes| base64::engine::general_purpose::STANDARD.encode(bytes)),
        };
        if connection.tx.send(frame).await.is_err() {
            connection.pending.remove(&request_id);
            return Err(ApiError::service_unavailable("desktop relay disconnected"));
        }

        let start = match tokio::time::timeout(RELAY_REQUEST_TIMEOUT, start_rx).await {
            Ok(Ok(start)) => start,
            _ => {
                connection.pending.remove(&request_id);
                return Err(ApiError::service_unavailable(
                    "desktop did not accept the request",
                ));
            }
        };
        Ok(RelayResponse {
            start,
            chunks: chunks_rx,
        })
    }

    fn dispatch(&self, frame: RelayFrame) {
        let (request_id, action) = match frame {
            RelayFrame::ResponseStart {
                request_id,
                status,
                headers,
            } => (request_id, RelayAction::Start { status, headers }),
            RelayFrame::ResponseChunk {
                request_id,
                data_b64,
            } => (request_id, RelayAction::Chunk(data_b64)),
            RelayFrame::ResponseEnd { request_id, error } => (request_id, RelayAction::End(error)),
            _ => return,
        };
        let Some(connection) = self
            .connections
            .iter()
            .find(|entry| entry.pending.contains_key(&request_id))
            .map(|entry| entry.clone())
        else {
            return;
        };
        connection.touch();
        match action {
            RelayAction::Start { status, headers } => {
                if let Some(mut pending) = connection.pending.get_mut(&request_id) {
                    if let Some(start_tx) = pending.start_tx.take() {
                        let _ = start_tx.send(RelayResponseStart {
                            status: StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY),
                            headers,
                        });
                    }
                }
            }
            RelayAction::Chunk(data_b64) => {
                let result = base64::engine::general_purpose::STANDARD
                    .decode(data_b64)
                    .map_err(|error| format!("invalid desktop relay chunk: {error}"));
                if let Some(pending) = connection.pending.get(&request_id) {
                    let _ = pending.chunks_tx.try_send(result);
                }
            }
            RelayAction::End(error) => {
                if let Some((_, pending)) = connection.pending.remove(&request_id) {
                    if let Some(error) = error {
                        let _ = pending.chunks_tx.try_send(Err(error));
                    }
                }
            }
        }
    }
}

enum RelayAction {
    Start {
        status: u16,
        headers: Vec<(String, String)>,
    },
    Chunk(String),
    End(Option<String>),
}

impl DesktopConnection {
    fn touch(&self) {
        if let Ok(mut last_seen_at) = self.last_seen_at.lock() {
            *last_seen_at = chrono::Utc::now();
        }
    }

    fn fail_pending(&self, reason: &str) {
        for mut entry in self.pending.iter_mut() {
            if let Some(start_tx) = entry.start_tx.take() {
                drop(start_tx);
            }
            let _ = entry.chunks_tx.try_send(Err(reason.to_string()));
        }
        self.pending.clear();
    }
}

pub(crate) async fn list_environments(
    State(state): State<AppState>,
    AuthSession(session): AuthSession,
) -> Json<Vec<DesktopEnvironment>> {
    Json(state.desktop_relays.list_for_user(&session.user_id))
}

pub(crate) async fn desktop_relay_ws(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    AuthSession(session): AuthSession,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_relay_socket(socket, state, session.user_id))
}

async fn handle_relay_socket(mut socket: WebSocket, state: AppState, user_id: String) {
    let register = match tokio::time::timeout(RELAY_CONNECT_TIMEOUT, socket.recv()).await {
        Ok(Some(Ok(Message::Text(text)))) => serde_json::from_str::<RelayFrame>(&text).ok(),
        _ => None,
    };
    let Some(RelayFrame::Register {
        environment_id,
        label,
    }) = register
    else {
        let _ = socket.close().await;
        return;
    };
    if environment_id.trim().is_empty() || environment_id.len() > 128 {
        let _ = socket.close().await;
        return;
    }

    let (tx, mut outgoing) = mpsc::channel::<RelayFrame>(64);
    let connection = state
        .desktop_relays
        .attach(user_id, environment_id.clone(), label, tx)
        .await;
    let _ = socket
        .send(Message::Text(
            serde_json::to_string(&RelayFrame::RegisterAck { environment_id })
                .unwrap()
                .into(),
        ))
        .await;
    info!(environment = %connection.environment_id, "desktop relay connected");

    loop {
        tokio::select! {
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(frame) = serde_json::from_str::<RelayFrame>(&text) {
                            connection.touch();
                            if matches!(frame, RelayFrame::Pong) {
                                continue;
                            }
                            state.desktop_relays.dispatch(frame);
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {}
                    Some(Err(error)) => { warn!(%error, "desktop relay websocket failed"); break; }
                }
            }
            frame = outgoing.recv() => {
                let Some(frame) = frame else { break; };
                let text = match serde_json::to_string(&frame) { Ok(text) => text, Err(_) => continue };
                if socket.send(Message::Text(text.into())).await.is_err() { break; }
            }
        }
    }
    state.desktop_relays.detach(&connection);
    debug!(environment = %connection.environment_id, "desktop relay disconnected");
}

/// Forward a chat POST to the paired desktop and expose the desktop's SSE
/// events through the normal Aura stream contract.
pub(crate) async fn forward_chat_stream(
    state: &AppState,
    user_id: &str,
    environment_id: &str,
    path: &str,
    headers: &HeaderMap,
    body: Vec<u8>,
) -> ApiResult<(
    HeaderMap,
    axum::response::sse::Sse<crate::handlers::agents::chat::SseStream>,
)> {
    let response = state
        .desktop_relays
        .request(user_id, environment_id, "POST", path, headers, Some(body))
        .await?;
    if !response.start.status.is_success() {
        return Err(ApiError::service_unavailable(format!(
            "desktop returned {}",
            response.start.status
        )));
    }

    let mut response_headers = HeaderMap::new();
    for (name, value) in response.start.headers {
        if let (Ok(name), Ok(value)) = (HeaderName::try_from(name), HeaderValue::try_from(value)) {
            if name.as_str().starts_with("x-aura-chat-") || name.as_str() == "x-aura-attach-id" {
                response_headers.insert(name, value);
            }
        }
    }
    response_headers.insert("x-aura-desktop-relayed", HeaderValue::from_static("true"));

    let stream = sse_stream_from_chunks(response.chunks);
    Ok((
        response_headers,
        axum::response::sse::Sse::new(stream).keep_alive(axum::response::sse::KeepAlive::default()),
    ))
}

/// Forward a bounded JSON/file request to the paired desktop. Unlike chat,
/// these workspace routes return one ordinary HTTP body, so the control plane
/// buffers only the bounded response and preserves the desktop status code.
pub(crate) async fn forward_http_request(
    state: &AppState,
    user_id: &str,
    environment_id: &str,
    method: &str,
    path: &str,
    headers: &HeaderMap,
    body: Option<Vec<u8>>,
) -> ApiResult<Response> {
    let response = state
        .desktop_relays
        .request(user_id, environment_id, method, path, headers, body)
        .await?;
    let mut bytes = Vec::new();
    let mut chunks = response.chunks;
    while let Some(chunk) = chunks.recv().await {
        let chunk = chunk.map_err(|error| ApiError::service_unavailable(error))?;
        if bytes.len().saturating_add(chunk.len()) > MAX_BUFFERED_RELAY_RESPONSE_BYTES {
            return Err(ApiError::bad_gateway("desktop relay response is too large"));
        }
        bytes.extend_from_slice(&chunk);
    }
    let mut builder = Response::builder().status(response.start.status);
    for (name, value) in response.start.headers {
        if let (Ok(name), Ok(value)) = (HeaderName::try_from(name), HeaderValue::try_from(value)) {
            if !matches!(name.as_str(), "connection" | "content-length") {
                builder = builder.header(name, value);
            }
        }
    }
    builder
        .body(Body::from(bytes))
        .map_err(|error| ApiError::internal(format!("building desktop relay response: {error}")))
}

fn sse_stream_from_chunks(
    chunks: mpsc::Receiver<Result<Vec<u8>, String>>,
) -> crate::handlers::agents::chat::SseStream {
    let stream = stream::unfold(
        (chunks, String::new()),
        move |(mut chunks, mut buffer)| async move {
            loop {
                if let Some(index) = buffer.find("\n\n") {
                    let frame = buffer.drain(..index + 2).collect::<String>();
                    if let Some(event) = parse_sse_event(&frame) {
                        return Some((Ok(event), (chunks, buffer)));
                    }
                    continue;
                }
                match chunks.recv().await {
                    Some(Ok(bytes)) => buffer.push_str(&String::from_utf8_lossy(&bytes)),
                    Some(Err(error)) => {
                        return Some((
                            Ok(axum::response::sse::Event::default()
                                .event("error")
                                .data(error)),
                            (chunks, String::new()),
                        ));
                    }
                    None => {
                        return parse_sse_event(&buffer)
                            .map(|event| (Ok(event), (chunks, String::new())));
                    }
                }
            }
        },
    );
    Box::pin(stream)
}

fn parse_sse_event(frame: &str) -> Option<axum::response::sse::Event> {
    let mut event_type = None;
    let mut id = None;
    let mut data = Vec::new();
    for line in frame.lines() {
        if let Some(value) = line.strip_prefix("event:") {
            event_type = Some(value.trim());
        }
        if let Some(value) = line.strip_prefix("id:") {
            id = Some(value.trim());
        }
        if let Some(value) = line.strip_prefix("data:") {
            data.push(value.strip_prefix(' ').unwrap_or(value));
        }
    }
    if data.is_empty() {
        return None;
    }
    let mut event = axum::response::sse::Event::default().data(data.join("\n"));
    if let Some(event_type) = event_type {
        event = event.event(event_type);
    }
    if let Some(id) = id {
        event = event.id(id);
    }
    Some(event)
}

/// Stable id for one desktop installation.  It deliberately lives beside the
/// desktop settings store, not in network metadata, so reinstalling a user
/// profile creates a new explicit pairing rather than silently claiming the
/// old machine.
pub fn environment_id(data_dir: &std::path::Path) -> String {
    let path = data_dir.join("desktop-environment-id");
    if let Ok(value) = std::fs::read_to_string(&path) {
        let value = value.trim();
        if !value.is_empty() {
            return value.to_string();
        }
    }
    let value = Uuid::new_v4().to_string();
    let _ = std::fs::write(&path, format!("{value}\n"));
    value
}

/// Spawn the desktop side of the relay.  The task stays dormant until a
/// cached login exists, then reconnects with bounded exponential backoff.
pub fn spawn_desktop_relay(state: AppState, local_api: String) {
    let control_plane = std::env::var("AURA_DESKTOP_RELAY_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "https://api.aura.ai".to_string());
    let environment_id = environment_id(&state.data_dir);
    tokio::spawn(async move {
        desktop_relay_loop(state, control_plane, local_api, environment_id).await;
    });
}

async fn desktop_relay_loop(
    state: AppState,
    control_plane: String,
    local_api: String,
    environment_id: String,
) {
    let mut backoff = Duration::from_secs(2);
    loop {
        let Some(jwt) = state
            .validation_cache
            .iter()
            .next()
            .map(|entry| entry.key().clone())
        else {
            tokio::time::sleep(Duration::from_secs(5)).await;
            continue;
        };
        let Some(url) = relay_ws_url(&control_plane) else {
            warn!(control_plane = %control_plane, "invalid desktop relay URL");
            return;
        };
        let request = match axum::http::Request::builder()
            .uri(&url)
            .header("authorization", format!("Bearer {jwt}"))
            .body(())
        {
            Ok(request) => request,
            Err(error) => {
                warn!(%error, "failed to build desktop relay request");
                return;
            }
        };
        match tokio_tungstenite::connect_async(request).await {
            Ok((mut socket, _)) => {
                backoff = Duration::from_secs(2);
                let label = hostname::get()
                    .ok()
                    .and_then(|name| name.into_string().ok())
                    .unwrap_or_else(|| "Desktop".to_string());
                let register = serde_json::to_string(&RelayFrame::Register {
                    environment_id: environment_id.clone(),
                    label,
                })
                .unwrap();
                if socket
                    .send(tungstenite::Message::Text(register.into()))
                    .await
                    .is_err()
                {
                    continue;
                }
                while let Some(message) = socket.next().await {
                    let Ok(tungstenite::Message::Text(text)) = message else {
                        break;
                    };
                    let Ok(RelayFrame::Request {
                        request_id,
                        method,
                        path,
                        headers,
                        body_b64,
                    }) = serde_json::from_str(&text)
                    else {
                        continue;
                    };
                    let request_id_for_error = request_id.clone();
                    if let Err(error) = handle_desktop_request(
                        &state.http_client,
                        &local_api,
                        &jwt,
                        &mut socket,
                        request_id,
                        method,
                        path,
                        headers,
                        body_b64,
                    )
                    .await
                    {
                        let end = RelayFrame::ResponseEnd {
                            request_id: request_id_for_error,
                            error: Some(error.clone()),
                        };
                        if let Ok(text) = serde_json::to_string(&end) {
                            let _ = socket.send(tungstenite::Message::Text(text.into())).await;
                        }
                        warn!(%error, "desktop relay request failed");
                    }
                }
            }
            Err(error) => debug!(%error, "desktop relay connection unavailable"),
        }
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(Duration::from_secs(60));
    }
}

async fn handle_desktop_request(
    client: &reqwest::Client,
    local_api: &str,
    jwt: &str,
    socket: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    request_id: String,
    method: String,
    path: String,
    headers: Vec<(String, String)>,
    body_b64: Option<String>,
) -> Result<(), String> {
    let method =
        reqwest::Method::from_bytes(method.as_bytes()).map_err(|error| error.to_string())?;
    let mut request = client.request(method, format!("{local_api}{path}"));
    request = request
        .header("authorization", format!("Bearer {jwt}"))
        .header(DESKTOP_RELAY_MARKER_HEADER, "1");
    for (name, value) in headers {
        if name.eq_ignore_ascii_case("authorization") || name.eq_ignore_ascii_case("host") {
            continue;
        }
        request = request.header(name, value);
    }
    if let Some(body_b64) = body_b64 {
        let body = base64::engine::general_purpose::STANDARD
            .decode(body_b64)
            .map_err(|error| error.to_string())?;
        request = request.body(body);
    }
    let response = request.send().await.map_err(|error| error.to_string())?;
    let start = RelayFrame::ResponseStart {
        request_id: request_id.clone(),
        status: response.status().as_u16(),
        headers: response
            .headers()
            .iter()
            .filter_map(|(name, value)| {
                value
                    .to_str()
                    .ok()
                    .map(|value| (name.to_string(), value.to_string()))
            })
            .collect(),
    };
    socket
        .send(tungstenite::Message::Text(
            serde_json::to_string(&start)
                .map_err(|error| error.to_string())?
                .into(),
        ))
        .await
        .map_err(|error| error.to_string())?;
    let mut body = response.bytes_stream();
    while let Some(chunk) = body.next().await {
        let chunk = chunk.map_err(|error| error.to_string())?;
        let frame = RelayFrame::ResponseChunk {
            request_id: request_id.clone(),
            data_b64: base64::engine::general_purpose::STANDARD.encode(chunk),
        };
        socket
            .send(tungstenite::Message::Text(
                serde_json::to_string(&frame)
                    .map_err(|error| error.to_string())?
                    .into(),
            ))
            .await
            .map_err(|error| error.to_string())?;
    }
    let end = RelayFrame::ResponseEnd {
        request_id,
        error: None,
    };
    socket
        .send(tungstenite::Message::Text(
            serde_json::to_string(&end)
                .map_err(|error| error.to_string())?
                .into(),
        ))
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn relay_ws_url(base: &str) -> Option<String> {
    let mut url = url::Url::parse(base.trim_end_matches('/')).ok()?;
    let scheme = match url.scheme() {
        "https" => "wss",
        "http" => "ws",
        _ => return None,
    };
    url.set_scheme(scheme).ok()?;
    url.set_path("/ws/desktop-relay");
    url.set_query(None);
    Some(url.to_string())
}

#[derive(Debug, Deserialize)]
pub struct RelayRequestPath {
    pub environment_id: String,
}

pub(crate) async fn relay_environment_status(
    State(state): State<AppState>,
    AuthSession(session): AuthSession,
    Path(RelayRequestPath { environment_id }): Path<RelayRequestPath>,
) -> ApiResult<Json<DesktopEnvironment>> {
    state
        .desktop_relays
        .list_for_user(&session.user_id)
        .into_iter()
        .find(|env| env.environment_id == environment_id)
        .map(Json)
        .ok_or_else(|| ApiError::not_found("desktop environment is offline"))
}

#[cfg(test)]
mod tests {
    use super::{parse_sse_event, relay_ws_url};

    #[test]
    fn relay_url_changes_http_scheme_and_path() {
        assert_eq!(
            relay_ws_url("https://api.aura.ai/").as_deref(),
            Some("wss://api.aura.ai/ws/desktop-relay")
        );
        assert_eq!(
            relay_ws_url("http://localhost:3100").as_deref(),
            Some("ws://localhost:3100/ws/desktop-relay")
        );
    }

    #[test]
    fn parses_multiline_sse_frames() {
        let event =
            parse_sse_event("event: text_delta\nid: 12\ndata: {\"text\":\ndata: \"hi\"}\n\n")
                .unwrap();
        let rendered = format!("{event:?}");
        assert!(rendered.contains("text_delta"));
    }
}
