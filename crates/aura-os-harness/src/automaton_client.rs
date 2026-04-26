//! HTTP + WebSocket client for the harness automaton REST API.
//!
//! Provides typed methods for starting, stopping, pausing automatons and
//! subscribing to their event streams -- used by `dev_loop.rs` instead of the
//! old chat-session-based approach.

use std::sync::Arc;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
use tokio::task::AbortHandle;
use tokio::time::Duration;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use tracing::{info, warn};

use crate::runner::automaton_event_kinds::DONE;

mod event_normalization;

use aura_protocol::{AgentPermissionsWire, InstalledIntegration, InstalledTool};
use event_normalization::normalize_automaton_event;

/// Handle that keeps the harness WebSocket connection opened by
/// [`AutomatonClient::connect_event_stream`] alive for as long as it is
/// held, and closes it when cancelled or dropped.
///
/// The WebSocket reader spawned by `connect_event_stream` is a detached
/// `tokio::spawn` that owns both halves of the WS stream. Without an
/// explicit handle callers had no way to shut it down on restart or
/// stop, so every re-subscribe (infra retry, adopt-on-conflict, stop
/// loop) leaked one socket. The harness's per-node WS semaphore
/// (capped at 128 in `aura-node`) therefore filled up, causing
/// `503 Service Unavailable` on every subsequent `/stream/automaton/:id`
/// upgrade.
///
/// `WsReaderHandle` closes the loop by:
/// * [`cancel`](Self::cancel): explicit abort for call sites that know
///   the reader is no longer wanted (e.g. the `stop_loop` path).
/// * [`Drop`](Drop): safety net so a handle dropped on the floor still
///   tears down its reader task, letting the harness release its
///   permit. Aborting an already-finished task is a no-op.
///
/// Cloning is cheap (`Arc` on the inner state) and all clones share the
/// same underlying reader; the reader is only aborted when the last
/// clone is dropped or any clone explicitly calls `cancel`. Every
/// `cancel` is idempotent.
#[derive(Clone)]
pub struct WsReaderHandle {
    inner: Arc<WsReaderInner>,
}

struct WsReaderInner {
    abort: AbortHandle,
}

impl WsReaderHandle {
    fn new(abort: AbortHandle) -> Self {
        Self {
            inner: Arc::new(WsReaderInner { abort }),
        }
    }

    /// Abort the spawned WebSocket reader task, dropping its owned
    /// stream halves so TCP closes and the harness releases the
    /// corresponding `ws_slots` permit.
    pub fn cancel(&self) {
        self.inner.abort.abort();
    }
}

impl Drop for WsReaderInner {
    fn drop(&mut self) {
        // Safety net: if every `WsReaderHandle` clone is dropped
        // without an explicit `cancel`, still abort so we don't leak
        // the harness-side permit for the lifetime of the automaton.
        self.abort.abort();
    }
}

impl std::fmt::Debug for WsReaderHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WsReaderHandle").finish_non_exhaustive()
    }
}
#[derive(Debug, Clone, Serialize)]
pub struct AutomatonStartParams {
    pub project_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_repo_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_tools: Option<Vec<InstalledTool>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_integrations: Option<Vec<InstalledIntegration>>,
    /// Capability + scope bundle for the agent driving this automaton.
    /// The harness applies this to the same kernel policy gate used by
    /// chat sessions, so dev-loop runs inherit the agent's real tool
    /// capabilities instead of falling back to an empty bundle.
    pub agent_permissions: AgentPermissionsWire,
    /// Retry-warm-up: the reason text persisted on the previous
    /// attempt's `task_failed` record. Forwarded verbatim to the
    /// harness as `prior_failure`; the `task-run` automaton folds it
    /// into `TaskInfo::execution_notes` so the retry prompt differs
    /// from the initial one. Skipped on the wire when `None` so
    /// pre-C1 harnesses (which don't know about this field) still
    /// accept the payload.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prior_failure: Option<String>,
    /// Retry-warm-up: recent work-log entries the server wants the
    /// agent to re-see on this attempt. Forwarded to the harness as
    /// `work_log`; threaded straight into `AgenticTaskParams
    /// ::work_log`. Skipped on the wire when empty so pre-C1
    /// harnesses see the old payload shape.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub work_log: Vec<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum AutomatonStartError {
    #[error("a dev loop is already running (automaton_id: {0:?})")]
    Conflict(Option<String>),
    #[error("{message}")]
    Request {
        message: String,
        is_connect: bool,
        is_timeout: bool,
    },
    #[error("harness start returned status {status}: {body}")]
    Response { status: u16, body: String },
    #[error("{0}")]
    Other(#[from] anyhow::Error),
}

#[derive(Debug, Clone, Deserialize)]
pub struct AutomatonStartResult {
    #[serde(alias = "id")]
    pub automaton_id: String,
    #[serde(alias = "ws_url", alias = "stream_url")]
    pub event_stream_url: String,
}

/// Client for the harness automaton REST + WebSocket API.
#[derive(Debug, Clone)]
pub struct AutomatonClient {
    http_base: String,
    http: reqwest::Client,
    auth_token: Option<String>,
}

impl AutomatonClient {
    pub fn new(harness_base_url: &str) -> Self {
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(3))
            .timeout(Duration::from_secs(12))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            http_base: harness_base_url.trim_end_matches('/').to_string(),
            http,
            auth_token: None,
        }
    }

    pub fn with_auth(mut self, token: Option<String>) -> Self {
        self.auth_token = token;
        self
    }

    pub fn base_url(&self) -> &str {
        &self.http_base
    }

    fn apply_auth(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        match &self.auth_token {
            Some(token) => req.bearer_auth(token),
            None => req,
        }
    }

    /// Start a dev-loop or single-task automaton.
    pub async fn start(
        &self,
        params: AutomatonStartParams,
    ) -> Result<AutomatonStartResult, AutomatonStartError> {
        let url = format!("{}/automaton/start", self.http_base);
        let req = self.apply_auth(self.http.post(&url).json(&params));
        let resp = req.send().await.map_err(|e| AutomatonStartError::Request {
            message: format!("harness start request failed: {e}"),
            is_connect: e.is_connect(),
            is_timeout: e.is_timeout(),
        })?;
        let status = resp.status();
        let body = resp
            .text()
            .await
            .map_err(|e| AutomatonStartError::Other(e.into()))?;
        if status == reqwest::StatusCode::CONFLICT {
            let automaton_id = serde_json::from_str::<serde_json::Value>(&body)
                .ok()
                .and_then(|v| {
                    v.get("error").and_then(|e| e.as_str()).and_then(|msg| {
                        msg.find("automaton_id: ")
                            .map(|pos| msg[pos + 14..].trim_end_matches(')').to_string())
                    })
                });
            return Err(AutomatonStartError::Conflict(automaton_id));
        }
        if !status.is_success() {
            return Err(AutomatonStartError::Response {
                status: status.as_u16(),
                body,
            });
        }
        serde_json::from_str(&body).map_err(|e| AutomatonStartError::Other(e.into()))
    }

    /// Pause a running automaton.
    pub async fn pause(&self, automaton_id: &str) -> anyhow::Result<()> {
        let url = format!("{}/automaton/{automaton_id}/pause", self.http_base);
        let resp = self.apply_auth(self.http.post(&url)).send().await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("POST pause returned {status}: {body}");
        }
        Ok(())
    }

    /// Stop a running automaton.
    pub async fn stop(&self, automaton_id: &str) -> anyhow::Result<()> {
        let url = format!("{}/automaton/{automaton_id}/stop", self.http_base);
        let resp = self.apply_auth(self.http.post(&url)).send().await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("POST stop returned {status}: {body}");
        }
        Ok(())
    }

    /// Resume a paused automaton.
    pub async fn resume(&self, automaton_id: &str) -> anyhow::Result<()> {
        let url = format!("{}/automaton/{automaton_id}/resume", self.http_base);
        let resp = self.apply_auth(self.http.post(&url)).send().await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("POST resume returned {status}: {body}");
        }
        Ok(())
    }

    /// Get the status of an automaton.
    pub async fn status(&self, automaton_id: &str) -> anyhow::Result<serde_json::Value> {
        let url = format!("{}/automaton/{automaton_id}/status", self.http_base);
        let resp = self.apply_auth(self.http.get(&url)).send().await?;
        let status = resp.status();
        let body = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("GET status returned {status}: {body}");
        }
        Ok(serde_json::from_str(&body)?)
    }

    /// Ask the harness for the canonical workspace path for a project.
    ///
    /// Calls `GET {base}/workspace/resolve?project_name={name}` and returns
    /// the `path` field from the JSON response.
    pub async fn resolve_workspace(&self, project_name: &str) -> anyhow::Result<String> {
        let url = format!("{}/workspace/resolve", self.http_base);
        let resp = self
            .apply_auth(self.http.get(&url).query(&[("project_name", project_name)]))
            .send()
            .await?;
        let status = resp.status();
        let body = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("GET workspace/resolve returned {status}: {body}");
        }
        let json: serde_json::Value = serde_json::from_str(&body)?;
        json.get("path")
            .and_then(|v| v.as_str())
            .map(String::from)
            .ok_or_else(|| anyhow::anyhow!("workspace resolve response missing 'path' field"))
    }

    /// Derive the WebSocket base URL from `http_base`.
    fn ws_base(&self) -> String {
        self.http_base
            .replace("https://", "wss://")
            .replace("http://", "ws://")
    }

    /// Resolve the WebSocket URL for the automaton event stream.
    ///
    /// When `event_stream_url` is provided (from the harness start response),
    /// it is used -- either directly if already absolute, or prefixed with the
    /// gateway WS base when relative.  This mirrors how `SwarmHarness` handles
    /// the `ws_url` returned by session creation and is required because the
    /// swarm gateway only routes WebSocket upgrades on paths it knows about.
    ///
    /// Falls back to `{ws_base}/stream/automaton/{automaton_id}` (the local-
    /// harness convention) when no URL is supplied.
    fn resolve_event_stream_url(
        &self,
        automaton_id: &str,
        event_stream_url: Option<&str>,
    ) -> String {
        match event_stream_url {
            Some(u) if u.starts_with("ws://") || u.starts_with("wss://") => u.to_string(),
            Some(u) => format!("{}/{}", self.ws_base(), u.trim_start_matches('/')),
            None => format!("{}/stream/automaton/{automaton_id}", self.ws_base()),
        }
    }

    /// Connect to the automaton event WebSocket and forward events to a broadcast channel.
    /// Returns the broadcast sender plus a [`WsReaderHandle`]; keep the
    /// handle alive for as long as you want events to flow, and drop /
    /// [`cancel`](WsReaderHandle::cancel) it to close the underlying
    /// WebSocket (which releases the harness's WS slot).
    ///
    /// Spawns a background task that reads from the WebSocket and
    /// forwards parsed events to the returned `broadcast::Sender`.
    ///
    /// After a successful WS handshake a brief liveness probe waits for the first
    /// message or error.  If the connection is reset immediately (e.g. the harness
    /// already finished the automaton) the method returns `Err` so the caller can
    /// retry instead of silently spawning a dead reader task.
    ///
    /// Pass the `event_stream_url` returned by [`Self::start`] when available so
    /// the connection uses the gateway-routable path instead of a hardcoded one.
    pub async fn connect_event_stream(
        &self,
        automaton_id: &str,
        event_stream_url: Option<&str>,
    ) -> anyhow::Result<(broadcast::Sender<serde_json::Value>, WsReaderHandle)> {
        let url = self.resolve_event_stream_url(automaton_id, event_stream_url);
        info!(automaton_id, %url, "Connecting to automaton event stream");

        let mut request = url
            .clone()
            .into_client_request()
            .map_err(|e| anyhow::anyhow!("failed to build WS request: {e}"))?;
        if let Some(ref token) = self.auth_token {
            request.headers_mut().insert(
                "Authorization",
                format!("Bearer {token}")
                    .parse()
                    .map_err(|e| anyhow::anyhow!("bad auth header value: {e}"))?,
            );
        }
        let (ws_stream, _) = tokio::time::timeout(
            Duration::from_secs(8),
            tokio_tungstenite::connect_async(request),
        )
        .await
        .map_err(|_| anyhow::anyhow!("timed out connecting to automaton event stream: {url}"))??;
        info!(automaton_id, "Connected to automaton event stream");

        let (_write, mut read) = ws_stream.split();
        let buffered_event = probe_initial_event(&mut read).await?;
        let (broadcast_tx, _) = broadcast::channel(4096);
        let reader = spawn_automaton_reader(
            automaton_id.to_string(),
            _write,
            read,
            broadcast_tx.clone(),
            buffered_event,
        );

        let handle = WsReaderHandle::new(reader.abort_handle());
        Ok((broadcast_tx, handle))
    }
}

async fn probe_initial_event<R>(read: &mut R) -> anyhow::Result<Option<serde_json::Value>>
where
    R: futures_util::Stream<Item = Result<WsMessage, tokio_tungstenite::tungstenite::Error>>
        + Unpin,
{
    let probe = tokio::time::timeout(Duration::from_millis(200), read.next()).await;
    match probe {
        Ok(Some(Err(e))) => Err(anyhow::anyhow!(
            "automaton event stream died immediately after connect: {e}"
        )),
        Ok(None) => Err(anyhow::anyhow!(
            "automaton event stream closed immediately after connect"
        )),
        Ok(Some(Ok(WsMessage::Text(text)))) => Ok(parse_automaton_event(&text)),
        Ok(Some(Ok(WsMessage::Close(_)))) => Err(anyhow::anyhow!(
            "automaton event stream sent close frame immediately after connect"
        )),
        Ok(Some(Ok(_))) | Err(_) => Ok(None),
    }
}

fn spawn_automaton_reader<W, R>(
    automaton_id: String,
    write: W,
    mut read: R,
    tx: broadcast::Sender<serde_json::Value>,
    buffered_event: Option<serde_json::Value>,
) -> tokio::task::JoinHandle<()>
where
    W: Send + 'static,
    R: futures_util::Stream<Item = Result<WsMessage, tokio_tungstenite::tungstenite::Error>>
        + Unpin
        + Send
        + 'static,
{
    tokio::spawn(async move {
        let _keep_write = write;
        if send_buffered_event(&automaton_id, &tx, buffered_event) {
            return;
        }
        while let Some(msg_result) = read.next().await {
            if should_stop_reader(&automaton_id, &tx, msg_result) {
                break;
            }
        }
        info!(automaton_id = %automaton_id, "Automaton event stream ended");
    })
}

fn send_buffered_event(
    automaton_id: &str,
    tx: &broadcast::Sender<serde_json::Value>,
    event: Option<serde_json::Value>,
) -> bool {
    let Some(event) = event else {
        return false;
    };
    let is_done = event.get("type").and_then(|t| t.as_str()) == Some(DONE);
    let _ = tx.send(event);
    if is_done {
        info!(%automaton_id, "Automaton event stream ended");
    }
    is_done
}

fn should_stop_reader(
    automaton_id: &str,
    tx: &broadcast::Sender<serde_json::Value>,
    msg_result: Result<WsMessage, tokio_tungstenite::tungstenite::Error>,
) -> bool {
    match msg_result {
        Ok(WsMessage::Text(text)) => parse_and_send_event(tx, &text),
        Ok(WsMessage::Close(_)) => true,
        Err(e) => {
            warn!(error = %e, %automaton_id, "Automaton event stream error");
            true
        }
        _ => false,
    }
}

fn parse_and_send_event(tx: &broadcast::Sender<serde_json::Value>, text: &str) -> bool {
    let Some(event) = parse_automaton_event(text) else {
        return false;
    };
    let is_done = event.get("type").and_then(|t| t.as_str()) == Some(DONE);
    let _ = tx.send(event);
    is_done
}

fn parse_automaton_event(text: &str) -> Option<serde_json::Value> {
    match serde_json::from_str::<serde_json::Value>(text) {
        Ok(event) => Some(normalize_automaton_event(event)),
        Err(e) => {
            warn!(error = %e, "Failed to parse automaton event");
            None
        }
    }
}

#[cfg(test)]
mod tests;
