//! HTTP + WebSocket client for the harness automaton REST API.
//!
//! Provides typed methods for starting, stopping, pausing automatons and
//! subscribing to their event streams — used by `dev_loop.rs` instead of the
//! old chat-session-based approach.

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
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
}

#[derive(Debug, thiserror::Error)]
pub enum AutomatonStartError {
    #[error("a dev loop is already running (automaton_id: {0:?})")]
    Conflict(Option<String>),
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
}

impl AutomatonClient {
    pub fn new(harness_base_url: &str) -> Self {
        Self {
            http_base: harness_base_url.trim_end_matches('/').to_string(),
            http: reqwest::Client::new(),
        }
    }

    /// Start a dev-loop or single-task automaton.
    pub async fn start(
        &self,
        params: AutomatonStartParams,
    ) -> Result<AutomatonStartResult, AutomatonStartError> {
        let url = format!("{}/automaton/start", self.http_base);
        let resp = self
            .http
            .post(&url)
            .json(&params)
            .send()
            .await
            .map_err(|e| AutomatonStartError::Other(e.into()))?;
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
            return Err(AutomatonStartError::Other(anyhow::anyhow!(
                "POST /automaton/start returned {status}: {body}"
            )));
        }
        serde_json::from_str(&body).map_err(|e| AutomatonStartError::Other(e.into()))
    }

    /// Pause a running automaton.
    pub async fn pause(&self, automaton_id: &str) -> anyhow::Result<()> {
        let url = format!("{}/automaton/{automaton_id}/pause", self.http_base);
        let resp = self.http.post(&url).send().await?;
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
        let resp = self.http.post(&url).send().await?;
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
        let resp = self.http.get(&url).send().await?;
        let status = resp.status();
        let body = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("GET status returned {status}: {body}");
        }
        Ok(serde_json::from_str(&body)?)
    }

    /// Connect to the automaton event WebSocket and forward events to a broadcast channel.
    /// Returns the broadcast sender (for sharing with other consumers) and spawns
    /// a background task that reads from the WebSocket.
    pub async fn connect_event_stream(
        &self,
        automaton_id: &str,
    ) -> anyhow::Result<broadcast::Sender<serde_json::Value>> {
        let ws_base = self
            .http_base
            .replace("https://", "wss://")
            .replace("http://", "ws://");
        let url = format!("{ws_base}/stream/automaton/{automaton_id}");

        let (ws_stream, _) = tokio_tungstenite::connect_async(&url).await?;
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
