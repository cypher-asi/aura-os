use futures_util::StreamExt;
use tokio::sync::broadcast;
use tokio::time::Duration;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tracing::info;

use super::identity::validate_automaton_start_identity;
use super::start_params::{AutomatonStartError, AutomatonStartParams, AutomatonStartResult};
use super::ws_reader::{probe_initial_event, spawn_automaton_reader};
use super::ws_reader_handle::WsReaderHandle;

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
        // Tier 2 fail-fast: refuse to POST /automaton/start with a
        // payload missing one of the required identity fields. The
        // server's `start_or_adopt` / `run_single_task` already
        // preflight in Tier 1, but this guard catches direct
        // callers / outdated server builds and preserves the
        // structured error shape via `HarnessError::SessionIdentityMissing`.
        if let Err(err) = validate_automaton_start_identity(&params) {
            return Err(AutomatonStartError::Other(anyhow::Error::new(err).context(
                "automaton client rejected /automaton/start: identity preflight",
            )));
        }
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
        let connect_result = tokio::time::timeout(
            Duration::from_secs(8),
            tokio_tungstenite::connect_async(request),
        )
        .await
        .map_err(|_| anyhow::anyhow!("timed out connecting to automaton event stream: {url}"))?;
        let (ws_stream, _) = match connect_result {
            Ok(ok) => ok,
            Err(err) => {
                // Phase 4: surface upstream WS-slot exhaustion as the
                // typed `HarnessError::CapacityExhausted` so the
                // server's `map_harness_error_to_api` can funnel it
                // into the structured 503 envelope instead of letting
                // it inherit the generic `bad_gateway` mapping the
                // dev-loop adapter previously applied. Mirrors the
                // same detection used in `LocalHarness::open_session`.
                if crate::local_harness::is_capacity_exhausted_ws_error(&err) {
                    return Err(
                        anyhow::Error::new(crate::error::HarnessError::CapacityExhausted)
                            .context(format!("automaton event stream connect rejected: {err}")),
                    );
                }
                return Err(
                    anyhow::Error::new(err).context("automaton event stream connect failed")
                );
            }
        };
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
