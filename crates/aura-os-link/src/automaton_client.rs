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

use crate::runner::automaton_event_kinds::DONE;
use aura_protocol::{InstalledIntegration, InstalledTool};

const GENERIC_MILESTONE_EVENT_TYPES: &[&str] =
    &["milestone", "sync_milestone", "git_sync_milestone"];
const GIT_COMMITTED: &str = "git_committed";
const GIT_COMMIT_FAILED: &str = "git_commit_failed";
const GIT_PUSHED: &str = "git_pushed";
const GIT_PUSH_FAILED: &str = "git_push_failed";

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

fn canonical_git_event_type(value: &str) -> Option<&'static str> {
    match value {
        GIT_COMMITTED | "git_commit" | "commit" => Some(GIT_COMMITTED),
        GIT_COMMIT_FAILED | "git_commit_error" | "commit_failed" => Some(GIT_COMMIT_FAILED),
        GIT_PUSHED | "git_push" | "push" => Some(GIT_PUSHED),
        GIT_PUSH_FAILED | "git_push_error" | "push_failed" => Some(GIT_PUSH_FAILED),
        _ => None,
    }
}

fn is_git_like_payload(value: &serde_json::Value) -> bool {
    value.get("commit_sha").is_some()
        || value.get("branch").is_some()
        || value.get("remote").is_some()
        || value.get("push_id").is_some()
        || value.get("commits").is_some()
}

fn normalized_milestone_git_event(
    event: &serde_json::Value,
) -> Option<(&'static str, serde_json::Value)> {
    let mut candidates: Vec<serde_json::Value> = vec![event.clone()];
    for key in ["milestone", "sync", "git", "commit", "push"] {
        if let Some(value) = event.get(key) {
            candidates.push(value.clone());
        }
    }

    for candidate in &candidates {
        if let Some(kind) = candidate
            .get("event_type")
            .or_else(|| candidate.get("kind"))
            .or_else(|| candidate.get("type"))
            .and_then(|v| v.as_str())
            .and_then(canonical_git_event_type)
        {
            return Some((kind, candidate.clone()));
        }
    }

    for candidate in candidates {
        if !candidate.is_object() || !is_git_like_payload(&candidate) {
            continue;
        }
        if candidate.get("reason").is_some() || candidate.get("error").is_some() {
            if candidate.get("branch").is_some()
                || candidate.get("remote").is_some()
                || candidate.get("push_id").is_some()
            {
                return Some((GIT_PUSH_FAILED, candidate));
            }
            return Some((GIT_COMMIT_FAILED, candidate));
        }
        if candidate.get("branch").is_some()
            || candidate.get("remote").is_some()
            || candidate.get("push_id").is_some()
            || candidate.get("commits").is_some()
        {
            return Some((GIT_PUSHED, candidate));
        }
        if candidate.get("commit_sha").is_some() {
            return Some((GIT_COMMITTED, candidate));
        }
    }

    None
}

fn copy_if_missing(target: &mut serde_json::Value, source: &serde_json::Value, key: &str) {
    if target.get(key).is_none() {
        if let Some(value) = source.get(key) {
            target[key] = value.clone();
        }
    }
}

fn normalize_automaton_event(mut event: serde_json::Value) -> serde_json::Value {
    let Some(event_type) = event.get("type").and_then(|t| t.as_str()) else {
        return event;
    };
    if !GENERIC_MILESTONE_EVENT_TYPES.contains(&event_type) {
        return event;
    }
    let Some((canonical_type, payload)) = normalized_milestone_git_event(&event) else {
        return event;
    };

    event["type"] = serde_json::Value::String(canonical_type.to_string());
    for key in [
        "commit_sha",
        "branch",
        "remote",
        "reason",
        "error",
        "summary",
        "push_id",
        "commit_ids",
        "commits",
    ] {
        copy_if_missing(&mut event, &payload, key);
    }
    event
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
    /// it is used — either directly if already absolute, or prefixed with the
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
    /// Returns the broadcast sender (for sharing with other consumers) and spawns
    /// a background task that reads from the WebSocket.
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

        let (broadcast_tx, _) = broadcast::channel(4096);
        let tx = broadcast_tx.clone();
        let aid = automaton_id.to_string();

        let (_write, mut read) = ws_stream.split();

        // Liveness probe: wait briefly for the first frame to detect connections
        // that the harness resets immediately after the upgrade handshake (e.g.
        // because the automaton already finished before we connected).
        let mut buffered_event: Option<serde_json::Value> = None;
        let probe = tokio::time::timeout(Duration::from_millis(200), read.next()).await;
        match probe {
            Ok(Some(Err(e))) => {
                return Err(anyhow::anyhow!(
                    "automaton event stream died immediately after connect: {e}"
                ));
            }
            Ok(None) => {
                return Err(anyhow::anyhow!(
                    "automaton event stream closed immediately after connect"
                ));
            }
            Ok(Some(Ok(tokio_tungstenite::tungstenite::Message::Text(text)))) => {
                if let Ok(event) = serde_json::from_str::<serde_json::Value>(&text) {
                    buffered_event = Some(normalize_automaton_event(event));
                }
            }
            Ok(Some(Ok(tokio_tungstenite::tungstenite::Message::Close(_)))) => {
                return Err(anyhow::anyhow!(
                    "automaton event stream sent close frame immediately after connect"
                ));
            }
            Ok(Some(Ok(_))) => {}
            Err(_) => {}
        }

        tokio::spawn(async move {
            let _keep_write = _write;
            if let Some(event) = buffered_event {
                let is_done = event.get("type").and_then(|t| t.as_str()) == Some(DONE);
                let _ = tx.send(event);
                if is_done {
                    info!(automaton_id = %aid, "Automaton event stream ended");
                    return;
                }
            }
            while let Some(msg_result) = read.next().await {
                match msg_result {
                    Ok(tokio_tungstenite::tungstenite::Message::Text(text)) => {
                        match serde_json::from_str::<serde_json::Value>(&text) {
                            Ok(event) => {
                                let event = normalize_automaton_event(event);
                                let is_done =
                                    event.get("type").and_then(|t| t.as_str()) == Some(DONE);
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

#[cfg(test)]
mod tests {
    use super::{normalize_automaton_event, AutomatonStartResult};

    #[test]
    fn automaton_start_result_accepts_ws_url_alias() {
        let result: AutomatonStartResult = serde_json::from_value(serde_json::json!({
            "id": "auto-123",
            "ws_url": "/stream/automaton/auto-123",
        }))
        .expect("start result should deserialize");

        assert_eq!(result.automaton_id, "auto-123");
        assert_eq!(result.event_stream_url, "/stream/automaton/auto-123");
    }

    #[test]
    fn normalize_automaton_event_promotes_git_sync_milestones() {
        let event = normalize_automaton_event(serde_json::json!({
            "type": "sync_milestone",
            "summary": "Committed and pushed",
            "milestone": {
                "kind": "git_pushed",
                "commit_sha": "abc12345",
                "branch": "main",
                "remote": "origin",
                "push_id": "push-1",
                "commits": ["abc12345"],
            }
        }));

        assert_eq!(event["type"], "git_pushed");
        assert_eq!(event["commit_sha"], "abc12345");
        assert_eq!(event["branch"], "main");
        assert_eq!(event["remote"], "origin");
        assert_eq!(event["push_id"], "push-1");
        assert_eq!(event["summary"], "Committed and pushed");
    }
}
