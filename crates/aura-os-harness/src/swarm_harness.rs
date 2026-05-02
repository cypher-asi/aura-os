use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use anyhow::Context;
use async_trait::async_trait;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use reqwest::StatusCode;
use tokio::sync::{broadcast, Mutex};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tracing::{info, warn};

use aura_protocol::{InboundMessage, OutboundMessage};

use crate::error::HarnessError;
use crate::harness::{
    build_remote_handshake, build_session_init, validate_session_init_identity, HarnessLink,
    HarnessSession, SessionConfig,
};
use crate::ws_bridge::spawn_ws_bridge;

const AGENT_READY_POLL_INTERVAL: Duration = Duration::from_secs(2);
const AGENT_READY_TIMEOUT: Duration = Duration::from_secs(90);
const SESSION_READY_TIMEOUT: Duration = Duration::from_secs(20);

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
                Ok(r) if r.status().is_success() => match parse_agent_state(r).await {
                    Ok(state) => match state.state.as_str() {
                        "running" | "idle" => return Ok(()),
                        "provisioning" | "stopping" => {
                            info!(agent_id = %agent_id, state = %state.state, "Waiting for agent...");
                        }
                        "error" => {
                            anyhow::bail!(
                                "agent {agent_id} entered error state{}",
                                format_error_suffix(state.error_message.as_deref())
                            );
                        }
                        other => {
                            anyhow::bail!(
                                "agent {agent_id} is in non-runnable state `{other}`{}",
                                format_error_suffix(state.error_message.as_deref())
                            );
                        }
                    },
                    Err(e) => anyhow::bail!("agent state response was invalid: {e}"),
                },
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
            .headers(headers.clone())
            .json(&agent_body)
            .send()
            .await
            .context("swarm create agent request failed")?;
        let agent_resp = parse_create_agent_response(response).await?;
        if matches!(agent_resp.status.as_str(), "stopped" | "error") {
            self.start_agent(base_url, &agent_resp.agent_id, headers.clone())
                .await
                .context("swarm start agent request failed")?;
        }
        if !matches!(agent_resp.status.as_str(), "running" | "idle") {
            self.wait_for_agent_ready(&agent_resp.agent_id, token)
                .await
                .context("swarm agent readiness check failed")?;
        }
        info!(agent_id = %agent_resp.agent_id, "Swarm agent ready");
        Ok(agent_resp.agent_id)
    }

    fn create_agent_body(&self, config: &SessionConfig) -> serde_json::Value {
        let agent_display_name = swarm_agent_display_name(config);
        let mut agent_body = serde_json::json!({ "name": agent_display_name });
        if let Some(aid) = swarm_control_agent_id(config) {
            agent_body["agent_id"] = serde_json::Value::String(aid);
        }
        agent_body
    }

    async fn start_agent(
        &self,
        base_url: &str,
        agent_id: &str,
        headers: HeaderMap,
    ) -> anyhow::Result<()> {
        let response = self
            .client
            .post(format!("{base_url}/v1/agents/{agent_id}/start"))
            .headers(headers)
            .send()
            .await
            .context("swarm start agent request failed")?;
        parse_lifecycle_response(response, "start").await
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
        let mut ready_rx = events_tx.subscribe();
        send_session_init(&commands_tx, config)?;
        wait_for_session_ready(&mut ready_rx, &session_resp.session_id).await?;
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
    #[serde(default)]
    error_message: Option<String>,
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

async fn parse_agent_state(response: reqwest::Response) -> anyhow::Result<AgentStateResponse> {
    let body = response.text().await?;
    serde_json::from_str(&body)
        .with_context(|| format!("invalid swarm state response body: {body}"))
}

async fn parse_lifecycle_response(response: reqwest::Response, action: &str) -> anyhow::Result<()> {
    let status = response.status();
    let body = response.text().await?;
    if !status.is_success() {
        anyhow::bail!("swarm {action} agent failed with {status}: {body}");
    }
    Ok(())
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

async fn wait_for_session_ready(
    rx: &mut broadcast::Receiver<OutboundMessage>,
    swarm_session_id: &str,
) -> anyhow::Result<()> {
    let ready = tokio::time::timeout(SESSION_READY_TIMEOUT, async {
        loop {
            match rx.recv().await {
                Ok(OutboundMessage::SessionReady(ready)) => break Ok(ready.session_id),
                Ok(OutboundMessage::Error(err)) => {
                    anyhow::bail!(
                        "harness error during swarm init ({}): {}",
                        err.code,
                        err.message
                    )
                }
                Ok(_) => continue,
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => {
                    anyhow::bail!("swarm websocket closed before session_ready")
                }
            }
        }
    })
    .await
    .with_context(|| {
        format!(
            "swarm session did not emit session_ready within {}s",
            SESSION_READY_TIMEOUT.as_secs()
        )
    })??;

    if ready != swarm_session_id {
        info!(
            swarm_session_id,
            runtime_session_id = %ready,
            "Swarm runtime session_ready id differs from control-plane session id"
        );
    }
    Ok(())
}

fn swarm_control_agent_id(config: &SessionConfig) -> Option<String> {
    config
        .template_agent_id
        .as_deref()
        .filter(|id| !id.trim().is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| {
            config
                .agent_id
                .as_deref()
                .and_then(|id| {
                    id.split_once("::")
                        .map(|(template, _)| template)
                        .or(Some(id))
                })
                .filter(|id| !id.trim().is_empty())
                .map(ToOwned::to_owned)
        })
}

fn swarm_agent_display_name(config: &SessionConfig) -> String {
    let source = config
        .agent_name
        .as_deref()
        .or(config.template_agent_id.as_deref())
        .or(config.agent_id.as_deref())
        .unwrap_or("default");
    let mut sanitized = String::with_capacity(source.len().min(64));
    for ch in source.chars() {
        if sanitized.len() >= 64 {
            break;
        }
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            sanitized.push(ch);
        } else if ch.is_whitespace() || ch == ':' {
            sanitized.push('-');
        }
    }
    let sanitized = sanitized.trim_matches('-').to_string();
    if sanitized.is_empty() {
        "agent".to_string()
    } else {
        sanitized
    }
}

fn format_error_suffix(message: Option<&str>) -> String {
    message
        .filter(|message| !message.trim().is_empty())
        .map(|message| format!(": {message}"))
        .unwrap_or_default()
}

#[async_trait]
impl HarnessLink for SwarmHarness {
    async fn open_session(&self, config: SessionConfig) -> anyhow::Result<HarnessSession> {
        // Tier 2 fail-fast: identical contract to LocalHarness — see
        // `validate_session_init_identity` for the rationale.
        if let Err(err) = validate_session_init_identity(&config) {
            return Err(anyhow::Error::new(err)
                .context("swarm harness rejected session_init: identity preflight"));
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_agent_body_uses_template_id_for_swarm_agent_id() {
        let harness = SwarmHarness::new("http://swarm.test".to_string(), None);
        let config = SessionConfig {
            agent_id: Some("71cb2243-1cc3-441a-8a24-4ecac56b7651::default".to_string()),
            template_agent_id: Some("71cb2243-1cc3-441a-8a24-4ecac56b7651".to_string()),
            agent_name: Some("Remote Agent!".to_string()),
            ..Default::default()
        };

        let body = harness.create_agent_body(&config);

        assert_eq!(
            body["agent_id"],
            serde_json::Value::String("71cb2243-1cc3-441a-8a24-4ecac56b7651".to_string())
        );
        assert_eq!(
            body["name"],
            serde_json::Value::String("Remote-Agent".to_string())
        );
        assert!(body.get("template_agent_id").is_none());
    }

    #[test]
    fn swarm_control_agent_id_falls_back_to_partition_template_prefix() {
        let config = SessionConfig {
            agent_id: Some("template-1::instance-1".to_string()),
            template_agent_id: None,
            ..Default::default()
        };

        assert_eq!(
            swarm_control_agent_id(&config).as_deref(),
            Some("template-1")
        );
    }

    #[test]
    fn swarm_agent_display_name_falls_back_when_empty_after_sanitize() {
        let config = SessionConfig {
            agent_name: Some("!!!".to_string()),
            ..Default::default()
        };

        assert_eq!(swarm_agent_display_name(&config), "agent");
    }
}
