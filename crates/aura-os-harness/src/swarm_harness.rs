use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use anyhow::Context;
use async_trait::async_trait;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use reqwest::StatusCode;
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tracing::{info, warn};

use aura_protocol::InboundMessage;

use crate::error::HarnessError;
use crate::harness::{
    build_remote_handshake, build_session_init, HarnessLink, HarnessSession, SessionConfig,
};
use crate::ws_bridge::spawn_ws_bridge;

const AGENT_READY_POLL_INTERVAL: Duration = Duration::from_secs(2);
const AGENT_READY_TIMEOUT: Duration = Duration::from_secs(90);

#[derive(Debug, Clone)]
pub struct SwarmHarness {
    base_url: String,
    /// Optional fallback auth token injected by the caller. Per-request tokens
    /// from `SessionConfig.token` take priority when available.
    auth_token: Option<String>,
    client: reqwest::Client,
    session_tokens: Arc<Mutex<HashMap<String, String>>>,
}

impl SwarmHarness {
    /// Build a [`SwarmHarness`] from a configured base URL.
    ///
    /// Falls back to a default `reqwest::Client` if the configured one
    /// fails to build (e.g. TLS backend missing in a stripped test
    /// environment). The fallback log line tells operators to look at
    /// the surrounding warn message; we never panic in production
    /// because callers may run on heavily restricted hosts.
    pub fn new(base_url: String, auth_token: Option<String>) -> Self {
        let client = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(10))
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .unwrap_or_else(|error| {
                warn!(%error, "failed to build SwarmHarness HTTP client; falling back to defaults");
                reqwest::Client::new()
            });

        Self {
            base_url,
            auth_token,
            client,
            session_tokens: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Construct from `SWARM_BASE_URL`. Returns an empty-base instance
    /// when the env var is unset; callers should check
    /// [`SwarmHarness::is_configured`] before using it.
    pub fn from_env() -> Self {
        let base_url = std::env::var("SWARM_BASE_URL").unwrap_or_default();
        Self::new(base_url, None)
    }

    /// `true` when this harness has a non-empty base URL and is
    /// usable for outbound calls.
    #[must_use]
    pub fn is_configured(&self) -> bool {
        !self.base_url.trim().is_empty()
    }

    fn configured_base_url(&self) -> anyhow::Result<&str> {
        let base_url = self.base_url.trim();
        if base_url.is_empty() {
            anyhow::bail!("swarm gateway is not configured (SWARM_BASE_URL)");
        }
        Ok(base_url.trim_end_matches('/'))
    }

    fn ws_base_url(&self) -> anyhow::Result<String> {
        Ok(self
            .configured_base_url()?
            .replace("https://", "wss://")
            .replace("http://", "ws://"))
    }

    async fn wait_for_agent_ready(
        &self,
        agent_id: &str,
        token: Option<&str>,
    ) -> anyhow::Result<()> {
        let headers = self.bearer_headers(token);
        let url = format!("{}/v1/agents/{agent_id}/state", self.configured_base_url()?);
        let deadline = tokio::time::Instant::now() + AGENT_READY_TIMEOUT;

        loop {
            tokio::time::sleep(AGENT_READY_POLL_INTERVAL).await;

            if tokio::time::Instant::now() >= deadline {
                anyhow::bail!(
                    "agent {agent_id} did not become ready within {}s",
                    AGENT_READY_TIMEOUT.as_secs()
                );
            }

            let resp = self.client.get(&url).headers(headers.clone()).send().await;

            match resp {
                Ok(r) if r.status().is_success() => {
                    if let Ok(state) = r.json::<AgentStateResponse>().await {
                        match state.state.as_str() {
                            "running" | "idle" => return Ok(()),
                            "error" => {
                                anyhow::bail!("agent {agent_id} entered error state");
                            }
                            other => {
                                info!(agent_id = %agent_id, state = %other, "Waiting for agent...");
                            }
                        }
                    }
                }
                Ok(r) => {
                    warn!(agent_id = %agent_id, status = %r.status(), "Agent state check failed");
                }
                Err(e) => {
                    warn!(agent_id = %agent_id, error = %e, "Agent state poll error");
                }
            }
        }
    }

    fn bearer_headers(&self, token: Option<&str>) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        if let Some(t) = token {
            if let Ok(val) = HeaderValue::from_str(&format!("Bearer {t}")) {
                headers.insert(AUTHORIZATION, val);
            }
        }
        headers
    }

    async fn create_or_get_agent(
        &self,
        base_url: &str,
        config: &SessionConfig,
        headers: HeaderMap,
        token: Option<&str>,
    ) -> anyhow::Result<String> {
        let agent_body = self.create_agent_body(config);
        let response = self
            .client
            .post(format!("{base_url}/v1/agents"))
            .headers(headers)
            .json(&agent_body)
            .send()
            .await
            .context("swarm create agent request failed")?;
        let agent_resp = parse_create_agent_response(response).await?;
        if !matches!(agent_resp.status.as_str(), "running" | "idle") {
            self.wait_for_agent_ready(&agent_resp.agent_id, token)
                .await
                .context("swarm agent readiness check failed")?;
        }
        info!(agent_id = %agent_resp.agent_id, "Swarm agent ready");
        Ok(agent_resp.agent_id)
    }

    fn create_agent_body(&self, config: &SessionConfig) -> serde_json::Value {
        let agent_display_name = config
            .agent_name
            .as_deref()
            .or(config.agent_id.as_deref())
            .unwrap_or("default");
        let mut agent_body = serde_json::json!({ "name": agent_display_name });
        if let Some(ref aid) = config.agent_id {
            agent_body["agent_id"] = serde_json::Value::String(aid.clone());
        }
        if let Some(ref tid) = config.template_agent_id {
            agent_body["template_agent_id"] = serde_json::Value::String(tid.clone());
        }
        agent_body
    }

    async fn create_session(
        &self,
        base_url: &str,
        agent_id: &str,
        headers: HeaderMap,
        config: &SessionConfig,
    ) -> anyhow::Result<CreateSessionResponse> {
        let response = self
            .client
            .post(format!("{base_url}/v1/agents/{agent_id}/sessions"))
            .headers(headers)
            .json(&build_remote_handshake(config))
            .send()
            .await
            .context("swarm create session request failed")?;
        parse_create_session_response(response).await
    }

    async fn remember_session_token(&self, session_id: &str, token: Option<&str>) {
        if let Some(t) = token {
            self.session_tokens
                .lock()
                .await
                .insert(session_id.to_string(), t.to_string());
        }
    }

    async fn open_session_socket(
        &self,
        session_resp: CreateSessionResponse,
        config: &SessionConfig,
        token: Option<&str>,
    ) -> anyhow::Result<HarnessSession> {
        let ws_url = format!(
            "{}/{}",
            self.ws_base_url()?,
            session_resp.ws_url.trim_start_matches('/')
        );
        let mut ws_request = ws_url
            .into_client_request()
            .context("swarm websocket request build failed")?;
        if let Some(t) = token {
            ws_request.headers_mut().insert(
                "Authorization",
                format!("Bearer {t}").parse().map_err(|e| {
                    anyhow::anyhow!("swarm websocket auth header build failed: {e}")
                })?,
            );
        }

        let (ws_stream, _) = tokio_tungstenite::connect_async(ws_request)
            .await
            .context("swarm websocket connect failed")?;
        let (events_tx, raw_events_tx, commands_tx) = spawn_ws_bridge(ws_stream);
        send_session_init(&commands_tx, config)?;
        Ok(HarnessSession {
            session_id: session_resp.session_id,
            events_tx,
            raw_events_tx,
            commands_tx,
        })
    }
}

#[derive(serde::Deserialize)]
pub struct CreateAgentResponse {
    pub agent_id: String,
    pub status: String,
    #[serde(default)]
    pub pod_id: Option<String>,
}

#[derive(serde::Deserialize)]
struct AgentStateResponse {
    state: String,
}

#[derive(serde::Deserialize)]
struct CreateSessionResponse {
    session_id: String,
    ws_url: String,
}

async fn parse_create_agent_response(
    response: reqwest::Response,
) -> anyhow::Result<CreateAgentResponse> {
    let status = response.status();
    let body = response.text().await?;
    if !status.is_success() {
        anyhow::bail!("swarm create agent failed with {}: {}", status, body);
    }
    let agent_resp: CreateAgentResponse = serde_json::from_str(&body)?;
    if !matches!(agent_resp.status.as_str(), "running" | "idle") {
        info!(
            agent_id = %agent_resp.agent_id,
            status = %agent_resp.status,
            "Agent not ready, waiting for provisioning..."
        );
    }
    Ok(agent_resp)
}

async fn parse_create_session_response(
    response: reqwest::Response,
) -> anyhow::Result<CreateSessionResponse> {
    let status = response.status();
    let body = response.text().await?;
    if !status.is_success() {
        // TODO(phase 0.5): when the gateway returns 4xx with a body
        // containing "turn is currently in progress" (or a structured
        // `turn_in_progress` code), surface that as a typed error
        // variant — e.g. by parsing the body into an `ErrorMsg`-shaped
        // struct here and bubbling it as a dedicated error so the
        // server can call `remap_harness_error_to_api` instead of
        // pattern-matching on this flattened anyhow string.
        if is_capacity_exhausted_response(status, &body) {
            return Err(anyhow::Error::new(HarnessError::CapacityExhausted)
                .context(format!("swarm create session failed with {status}: {body}")));
        }
        anyhow::bail!("swarm create session failed with {}: {}", status, body);
    }
    serde_json::from_str(&body).map_err(Into::into)
}

/// Detect the upstream "all WS slots in use" rejection.
///
/// The aura-node gateway returns HTTP 503 in two shapes when the
/// per-process WS-slot semaphore is full:
/// * Structured: `{ "code": "capacity_exhausted", "message": "..." }`
///   (preferred wire — pinned by Phase 6 of the
///   robust-concurrent-agent-infra plan).
/// * Opaque: empty body or any non-JSON payload.
///
/// Both shapes resolve to [`HarnessError::CapacityExhausted`]. Any
/// 503 with a clearly-different structured `code` (e.g. `"db_down"`)
/// passes through as a regular `anyhow::Error` so the existing
/// gateway-error mappers in the server keep their current behavior.
fn is_capacity_exhausted_response(status: StatusCode, body: &str) -> bool {
    if status != StatusCode::SERVICE_UNAVAILABLE {
        return false;
    }
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return true;
    }
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) else {
        // Non-JSON 503 body: treat as opaque exhaustion. The harness
        // never surfaces a different structured 503 today, so this
        // matches the operational reality without needing a per-error
        // taxonomy.
        return true;
    };
    let code = parsed.get("code").and_then(|v| v.as_str()).or_else(|| {
        parsed
            .get("error")
            .and_then(|err| err.get("code"))
            .and_then(|v| v.as_str())
    });
    match code {
        Some(c) if c.eq_ignore_ascii_case("capacity_exhausted") => true,
        Some(_) => false,
        None => true,
    }
}

fn send_session_init(
    commands_tx: &tokio::sync::mpsc::Sender<InboundMessage>,
    config: &SessionConfig,
) -> anyhow::Result<()> {
    commands_tx
        .try_send(InboundMessage::SessionInit(Box::new(build_session_init(
            config,
        ))))
        .context("swarm session_init send failed")
}

#[async_trait]
impl HarnessLink for SwarmHarness {
    async fn open_session(&self, config: SessionConfig) -> anyhow::Result<HarnessSession> {
        let base_url = self.configured_base_url()?.to_string();
        let token = config.token.as_deref().or(self.auth_token.as_deref());
        let headers = self.bearer_headers(token);
        let agent_id = self
            .create_or_get_agent(&base_url, &config, headers.clone(), token)
            .await?;
        let session_resp = self
            .create_session(&base_url, &agent_id, headers, &config)
            .await?;
        self.remember_session_token(&session_resp.session_id, token)
            .await;
        info!(
            session_id = %session_resp.session_id,
            agent_id = %agent_id,
            "Swarm session created"
        );
        self.open_session_socket(session_resp, &config, token).await
    }

    async fn close_session(&self, session_id: &str) -> anyhow::Result<()> {
        let base_url = self.configured_base_url()?.to_string();
        let token = self
            .session_tokens
            .lock()
            .await
            .remove(session_id)
            .or_else(|| self.auth_token.clone());
        let headers = self.bearer_headers(token.as_deref());

        self.client
            .delete(format!("{base_url}/v1/sessions/{session_id}"))
            .headers(headers)
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }
}
