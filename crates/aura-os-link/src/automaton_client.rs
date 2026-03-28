//! HTTP + WebSocket client for the harness automaton REST API.
//!
//! Provides typed methods for starting, stopping, pausing automatons and
//! subscribing to their event streams — used by `dev_loop.rs` instead of the
//! old chat-session-based approach.

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
use tokio::time::Duration;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tracing::{info, warn};

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
    pub automaton_id: String,
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
        let resp = req.send().await.map_err(|e| {
            AutomatonStartError::Request {
                message: format!("harness start request failed: {e}"),
                is_connect: e.is_connect(),
                is_timeout: e.is_timeout(),
            }
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
    /// it is used — either directly if already absolute, or prefixed with the
    /// gateway WS base when relative.  This mirrors how `SwarmHarness` handles
    /// the `ws_url` returned by session creation and is required because the
    /// swarm gateway only routes WebSocket upgrades on paths it knows about.
    ///
    /// Falls back to `{ws_base}/stream/automaton/{automaton_id}` (the local-
    /// harness convention) when no URL is supplied.
    fn resolve_event_stream_url(&self, automaton_id: &str, event_stream_url: Option<&str>) -> String {
        match event_stream_url {
            Some(u) if u.starts_with("ws://") || u.starts_with("wss://") => u.to_string(),
            Some(u) => format!("{}/{}", self.ws_base(), u.trim_start_matches('/')),
            None => format!("{}/stream/automaton/{automaton_id}", self.ws_base()),
        }
    }

    /// Connect to the automaton event WebSocket and forward events to a broadcast channel.
    /// Returns the broadcast sender (for sharing with other consumers) and spawns
    /// a background task that reads from the WebSocket.
    ///
    /// Pass the `event_stream_url` returned by [`Self::start`] when available so
    /// the connection uses the gateway-routable path instead of a hardcoded one.
    pub async fn connect_event_stream(
        &self,
        automaton_id: &str,
        event_stream_url: Option<&str>,
    ) -> anyhow::Result<broadcast::Sender<serde_json::Value>> {
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

        let (broadcast_tx, _) = broadcast::channel(256);
        let tx = broadcast_tx.clone();
        let aid = automaton_id.to_string();

        tokio::spawn(async move {
            let (_write, mut read) = ws_stream.split();
            while let Some(msg_result) = read.next().await {
                match msg_result {
                    Ok(tokio_tungstenite::tungstenite::Message::Text(text)) => {
                        match serde_json::from_str::<serde_json::Value>(&text) {
                            Ok(event) => {
                                let is_done = event
                                    .get("type")
                                    .and_then(|t| t.as_str())
                                    .map_or(false, |t| t == "done");
                                let _ = tx.send(event);
                                if is_done {
                                    break;
                                }
                            }
                            Err(e) => {
                                warn!(error = %e, "Failed to parse automaton event");
                            }
                        }
                    }
                    Ok(tokio_tungstenite::tungstenite::Message::Close(_)) => break,
                    Err(e) => {
                        warn!(error = %e, automaton_id = %aid, "Automaton event stream error");
                        break;
                    }
                    _ => continue,
                }
            }
            info!(automaton_id = %aid, "Automaton event stream ended");
        });

        Ok(broadcast_tx)
    }
}
