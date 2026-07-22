use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use anyhow::Context;
use async_trait::async_trait;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use reqwest::StatusCode;
use tokio::sync::{broadcast, Mutex};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};
use tracing::{info, warn};

use aura_protocol::OutboundMessage;

use crate::error::HarnessError;
use crate::harness::{
    build_runtime_request, validate_runtime_request_identity, HarnessLink, HarnessSession,
    RunHandle, SessionConfig,
};
use crate::local_harness::{
    CONNECT_ATTEMPTS_ENV, CONNECT_TIMEOUT_ENV, DEFAULT_CONNECT_ATTEMPTS,
    DEFAULT_CONNECT_TIMEOUT_SECS, MAX_CONNECT_ATTEMPTS,
};
use crate::stability_metrics;
use crate::ws_bridge::{spawn_ws_bridge, spawn_ws_bridge_with_reconnect, WsReconnect};

const AGENT_READY_POLL_INTERVAL: Duration = Duration::from_secs(2);
const AGENT_READY_TIMEOUT: Duration = Duration::from_secs(90);
const SESSION_READY_TIMEOUT: Duration = Duration::from_secs(20);

/// Concrete upstream WS stream type produced by `connect_async` for the
/// swarm gateway. Named so the [`WsReconnect`] factory the bridge takes
/// can reference the exact type the initial connect yielded.
type SwarmWsStream = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

/// Env flag enabling transparent mid-turn WS reconnect for swarm runs.
///
/// Off by default: the gateway's run-only reattach proxy
/// (`{ws_base}/stream/:run_id`) must replay (not merely tail) the run on
/// attach for a mid-turn reconnect to be lossless. Operators flip this on
/// once that semantic is confirmed for their gateway build. The keepalive
/// ping (`AURA_HARNESS_WS_PING_SECS`) is always on and prevents most
/// drops regardless of this flag.
const WS_RECONNECT_ENV: &str = "AURA_HARNESS_WS_RECONNECT";

fn ws_reconnect_enabled() -> bool {
    std::env::var(WS_RECONNECT_ENV)
        .map(|v| {
            let v = v.trim();
            v == "1" || v.eq_ignore_ascii_case("true") || v.eq_ignore_ascii_case("on")
        })
        .unwrap_or(false)
}

/// Re-open the swarm run WS at `ws_url` with the shared bounded
/// connect-retry budget. Used as the [`WsReconnect`] body so a dropped
/// mid-turn socket is transparently re-established against the same
/// broadcast / command channels.
async fn connect_swarm_ws(
    ws_url: &str,
    token: Option<&str>,
    per_attempt_timeout: Duration,
    max_attempts: u32,
) -> anyhow::Result<SwarmWsStream> {
    let mut last_err: Option<anyhow::Error> = None;
    for attempt in 1..=max_attempts {
        let mut ws_request = ws_url
            .into_client_request()
            .context("swarm websocket reconnect request build failed")?;
        if let Some(t) = token {
            ws_request.headers_mut().insert(
                "Authorization",
                format!("Bearer {t}").parse().map_err(|e| {
                    anyhow::anyhow!("swarm websocket auth header build failed: {e}")
                })?,
            );
        }
        match tokio::time::timeout(
            per_attempt_timeout,
            tokio_tungstenite::connect_async(ws_request),
        )
        .await
        {
            Ok(Ok((ws_stream, _))) => return Ok(ws_stream),
            Ok(Err(err)) => {
                last_err = Some(anyhow::Error::new(err).context("swarm websocket reconnect failed"))
            }
            Err(_) => {
                last_err = Some(anyhow::anyhow!(
                    "timed out reconnecting to swarm websocket: {ws_url}"
                ))
            }
        }
        if attempt < max_attempts {
            let backoff = next_backoff(attempt);
            stability_metrics::inc_initial_connect_retry();
            tokio::time::sleep(backoff).await;
        }
    }
    Err(last_err
        .unwrap_or_else(|| anyhow::anyhow!("swarm websocket reconnect failed (no attempts ran)")))
}

/// Swarm-side mirror of [`crate::local_harness::next_backoff`]. Kept
/// in this module so the unit test for the swarm path is self-
/// contained and can pin its own pre/post values, even though the
/// two implementations share the same plan-mandated schedule.
pub(crate) fn next_backoff(attempt: u32) -> Duration {
    crate::local_harness::next_backoff(attempt)
}

fn read_connect_attempts_from_env() -> u32 {
    std::env::var(CONNECT_ATTEMPTS_ENV)
        .ok()
        .and_then(|v| v.trim().parse::<u32>().ok())
        .map(|n| n.clamp(1, MAX_CONNECT_ATTEMPTS))
        .unwrap_or(DEFAULT_CONNECT_ATTEMPTS)
}

fn read_connect_timeout_from_env() -> Duration {
    let secs = std::env::var(CONNECT_TIMEOUT_ENV)
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|n| *n > 0)
        .unwrap_or(DEFAULT_CONNECT_TIMEOUT_SECS);
    Duration::from_secs(secs)
}

/// Returns `true` when the tungstenite connect error matches a
/// non-retriable upstream rejection: HTTP 503 / "capacity_exhausted"
/// from the aura-node gateway, or a WS handshake that completed only
/// to be slammed with close code 1013 ("Try Again Later"). Mirrors
/// [`crate::local_harness::is_capacity_exhausted_ws_error`] but
/// scoped to what the swarm path can observe at the WS layer.
fn is_capacity_exhausted_ws_handshake_error(err: &tokio_tungstenite::tungstenite::Error) -> bool {
    use tokio_tungstenite::tungstenite::Error as WsError;
    if let WsError::Http(resp) = err {
        if resp.status().as_u16() == 503 {
            return true;
        }
    }
    let display = err.to_string();
    display.contains("1013") && display.to_ascii_lowercase().contains("try again")
}

#[derive(Debug, Clone)]
pub struct SwarmHarness {
    base_url: String,
    /// Optional fallback auth token injected by the caller. Per-request tokens
    /// from `SessionConfig.token` take priority when available.
    auth_token: Option<String>,
    client: reqwest::Client,
    /// Per-run close metadata remembered at `open_session` time so
    /// `close_session` can target the run-scoped stop endpoint
    /// (`POST /v1/agents/:agent_id/run/:run_id/stop`), which needs both
    /// the agent id and the run's auth token. Keyed by `run_id`.
    run_sessions: Arc<Mutex<HashMap<String, RunSession>>>,
}

/// Close-time metadata for an open swarm run.
#[derive(Debug, Clone)]
struct RunSession {
    agent_id: String,
    token: Option<String>,
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
            run_sessions: Arc::new(Mutex::new(HashMap::new())),
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
                        "provisioning" | "starting" | "stopping" | "hibernating" | "waking" => {
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
        if let Some(action) = lifecycle_action_for_initial_status(&agent_resp.status) {
            self.transition_agent(base_url, &agent_resp.agent_id, action, headers.clone())
                .await
                .with_context(|| format!("swarm {action} agent request failed"))?;
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

    async fn transition_agent(
        &self,
        base_url: &str,
        agent_id: &str,
        action: &str,
        headers: HeaderMap,
    ) -> anyhow::Result<()> {
        let response = self
            .client
            .post(format!("{base_url}/v1/agents/{agent_id}/{action}"))
            .headers(headers)
            .send()
            .await
            .with_context(|| format!("swarm {action} agent request failed"))?;
        parse_lifecycle_response(response, action).await
    }

    /// Start a run on the swarm gateway via the migrated two-step
    /// contract: `POST /v1/agents/:agent_id/run` with a
    /// [`build_runtime_request`]-shaped body, returning the
    /// harness-allocated [`RunHandle`] (`run_id` + relative
    /// `event_stream_url`). The legacy per-session
    /// `POST /v1/agents/:id/sessions` + `ws_url` exchange is gone.
    async fn submit_run(
        &self,
        base_url: &str,
        agent_id: &str,
        headers: HeaderMap,
        config: &SessionConfig,
    ) -> anyhow::Result<RunHandle> {
        let response = self
            .client
            .post(format!("{base_url}/v1/agents/{agent_id}/run"))
            .headers(headers)
            .json(&build_runtime_request(config))
            .send()
            .await
            .context("swarm run start request failed")?;
        parse_run_start_response(response).await
    }

    async fn remember_run(&self, run_id: &str, agent_id: &str, token: Option<&str>) {
        self.run_sessions.lock().await.insert(
            run_id.to_string(),
            RunSession {
                agent_id: agent_id.to_string(),
                token: token.map(ToOwned::to_owned),
            },
        );
    }

    /// Resolve the WebSocket URL for a run's event stream from the
    /// `event_stream_url` returned by `POST /v1/agents/:id/run`. An
    /// absolute `ws(s)://` URL is used verbatim; a relative path (the
    /// gateway returns `/v1/agents/{id}/stream/{run_id}`) is joined onto
    /// the transport WS base. Mirrors
    /// [`crate::LocalHarness`]'s `resolve_event_stream_url`.
    fn resolve_event_stream_url(&self, event_stream_url: &str) -> anyhow::Result<String> {
        if event_stream_url.starts_with("ws://") || event_stream_url.starts_with("wss://") {
            return Ok(event_stream_url.to_string());
        }
        Ok(format!(
            "{}/{}",
            self.ws_base_url()?,
            event_stream_url.trim_start_matches('/')
        ))
    }

    async fn open_run_socket(
        &self,
        run_handle: RunHandle,
        token: Option<&str>,
    ) -> anyhow::Result<HarnessSession> {
        let ws_url = self.resolve_event_stream_url(&run_handle.event_stream_url)?;
        // The `open_session` path always waits for the proxied
        // `session_ready` frame (the gateway emits it unprompted after
        // `POST /v1/agents/:id/run`).
        self.connect_run_stream(&ws_url, &run_handle.run_id, token, true)
            .await
    }

    /// WS base for the gateway's run-only stream proxy
    /// (`{ws_base}/stream/:run_id`). Mirrors
    /// [`crate::LocalHarness`]'s `ws_url_for_run`; used by `attach_run`
    /// when no explicit `event_stream_url` is available (e.g. attaching
    /// to a council child run spawned on the pod directly).
    fn ws_url_for_run(&self, run_id: &str) -> anyhow::Result<String> {
        Ok(format!("{}/stream/{run_id}", self.ws_base_url()?))
    }

    /// Connect (with the shared retry budget) to a run's WS event
    /// stream at `ws_url`, spawn the in-process bridge, and return the
    /// live [`HarnessSession`]. `wait_for_ready` blocks on the
    /// `session_ready` frame (chat open); when false a short liveness
    /// probe is used instead (run reattach / council child runs, which
    /// never re-emit `session_ready`). Mirrors
    /// [`crate::LocalHarness`]'s `attach_run_at_ws_url`.
    async fn connect_run_stream(
        &self,
        ws_url: &str,
        run_id: &str,
        token: Option<&str>,
        wait_for_ready: bool,
    ) -> anyhow::Result<HarnessSession> {
        let max_attempts = read_connect_attempts_from_env();
        let per_attempt_timeout = read_connect_timeout_from_env();
        let mut last_err: Option<anyhow::Error> = None;
        let mut ws_stream_opt = None;
        for attempt in 1..=max_attempts {
            // Each attempt rebuilds the request because `IntoClientRequest`
            // consumes the URL; cheap, and keeps the auth header fresh
            // in case a future change rotates the token between retries.
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
            let connect_outcome = tokio::time::timeout(
                per_attempt_timeout,
                tokio_tungstenite::connect_async(ws_request),
            )
            .await;
            match connect_outcome {
                Ok(Ok((ws_stream, _))) => {
                    ws_stream_opt = Some(ws_stream);
                    break;
                }
                Ok(Err(err)) => {
                    if is_capacity_exhausted_ws_handshake_error(&err) {
                        return Err(anyhow::Error::new(HarnessError::CapacityExhausted).context(
                            format!(
                                "swarm websocket connect rejected as capacity_exhausted: {err}"
                            ),
                        ));
                    }
                    last_err =
                        Some(anyhow::Error::new(err).context("swarm websocket connect failed"));
                }
                Err(_) => {
                    last_err = Some(anyhow::anyhow!(
                        "timed out connecting to swarm websocket: {ws_url}"
                    ));
                }
            }
            if attempt < max_attempts {
                let backoff = next_backoff(attempt);
                info!(
                    attempt,
                    max_attempts,
                    backoff_ms = backoff.as_millis() as u64,
                    error = ?last_err.as_ref().map(|e| e.to_string()),
                    "swarm websocket connect failed, retrying"
                );
                // Phase 5 observability: count every additional retry
                // attempt (not the first attempt). Same global counter
                // the local harness retry loop bumps so the
                // `/api/admin/health` snapshot reports a single
                // process-wide tally regardless of which path failed.
                stability_metrics::inc_initial_connect_retry();
                tokio::time::sleep(backoff).await;
            }
        }
        let ws_stream = match ws_stream_opt {
            Some(stream) => stream,
            None => {
                return Err(last_err.unwrap_or_else(|| {
                    anyhow::anyhow!("swarm websocket connect failed (no attempts ran)")
                }));
            }
        };
        let (events_tx, primed_events_rx, raw_events_tx, commands_tx) = if ws_reconnect_enabled() {
            // Capture the run's WS coordinates so the bridge can re-open
            // the gateway proxy stream after a recoverable drop without
            // tearing the warm chat session down.
            let reconnect_url = ws_url.to_string();
            let reconnect_token = token.map(ToOwned::to_owned);
            let reconnect: WsReconnect<SwarmWsStream> = Box::new(move || {
                let url = reconnect_url.clone();
                let tok = reconnect_token.clone();
                Box::pin(async move {
                    connect_swarm_ws(&url, tok.as_deref(), per_attempt_timeout, max_attempts).await
                })
            });
            spawn_ws_bridge_with_reconnect(ws_stream, reconnect)
        } else {
            spawn_ws_bridge(ws_stream)
        };
        let mut pending_events: Vec<OutboundMessage> = Vec::new();
        if wait_for_ready {
            // Phase A: the gateway proxies a run that was already created
            // on the HTTP side (`POST /v1/agents/:id/run`), so the harness
            // driver emits `session_ready` unprompted. Retain that consumed
            // frame for replay after downstream subscribers attach.
            let mut ready_rx = events_tx.subscribe();
            wait_for_session_ready(&mut ready_rx, run_id, &mut pending_events).await?;
        } else {
            // Reattach / council child runs stream domain events directly
            // and never re-emit `session_ready`. Do a brief liveness probe
            // (mirroring `LocalHarness::attach_run_at_ws_url`): if the
            // bridge reports the WS closed/errored immediately, fail so the
            // caller can retry; otherwise proceed.
            let mut rx = events_tx.subscribe();
            match tokio::time::timeout(Duration::from_millis(250), rx.recv()).await {
                Ok(Ok(OutboundMessage::Error(err)))
                    if err.code == "harness_ws_closed" || err.code == "harness_ws_read_error" =>
                {
                    anyhow::bail!(
                        "swarm child event stream died immediately after connect: {}",
                        err.message
                    );
                }
                Ok(Err(broadcast::error::RecvError::Closed)) => {
                    anyhow::bail!("swarm child event stream closed immediately after connect");
                }
                // Any other event, lag, or timeout: treat as alive.
                _ => {}
            }
        }
        Ok(HarnessSession {
            // The swarm gateway keys ownership / idle detection on the
            // harness-allocated `run_id`, so it doubles as the session id
            // here (the runtime's own `session_ready.session_id` is logged
            // for correlation but not used as the control handle).
            session_id: run_id.to_string(),
            run_id: run_id.to_string(),
            events_tx,
            raw_events_tx,
            commands_tx,
            pending_events,
            events_rx: Some(primed_events_rx),
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

fn lifecycle_action_for_initial_status(status: &str) -> Option<&'static str> {
    match status {
        "stopped" | "error" => Some("start"),
        "hibernating" => Some("wake"),
        _ => None,
    }
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

async fn parse_run_start_response(response: reqwest::Response) -> anyhow::Result<RunHandle> {
    let status = response.status();
    let body = response.text().await?;
    if !status.is_success() {
        // The gateway forwards the pod's 503 verbatim when the harness
        // WS-slot semaphore (or pod) is saturated; surface it as the
        // typed capacity error so the server maps it to a structured
        // 503 instead of a raw bad_gateway.
        if is_capacity_exhausted_response(status, &body) {
            return Err(anyhow::Error::new(HarnessError::CapacityExhausted)
                .context(format!("swarm run start failed with {status}: {body}")));
        }
        anyhow::bail!("swarm run start failed with {}: {}", status, body);
    }
    serde_json::from_str(&body)
        .with_context(|| format!("swarm run start response parse failed, body: {body}"))
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

/// Block on the proxied `session_ready` frame, collecting the ready frame
/// and any subagent lifecycle frames (`SubagentSpawned` /
/// `SubagentStatus`) the harness emits beforehand into `pending_events`.
/// These frames arrive before any server-side consumer subscribes to
/// `events_tx`; capturing them lets the chat orchestrator replay them.
/// The ready frame is placed first so a fresh chat adopts the parent
/// session before any nested council member can materialize.
async fn wait_for_session_ready(
    rx: &mut broadcast::Receiver<OutboundMessage>,
    swarm_session_id: &str,
    pending_events: &mut Vec<OutboundMessage>,
) -> anyhow::Result<()> {
    let ready = tokio::time::timeout(SESSION_READY_TIMEOUT, async {
        loop {
            match rx.recv().await {
                Ok(OutboundMessage::SessionReady(ready)) => {
                    let session_id = ready.session_id.clone();
                    pending_events.insert(0, OutboundMessage::SessionReady(ready));
                    break Ok(session_id);
                }
                Ok(OutboundMessage::Error(err)) => {
                    anyhow::bail!(
                        "harness error during swarm init ({}): {}",
                        err.code,
                        err.message
                    )
                }
                Ok(evt @ OutboundMessage::SubagentSpawned(_))
                | Ok(evt @ OutboundMessage::SubagentStatus(_)) => {
                    if let OutboundMessage::SubagentSpawned(spawned) = &evt {
                        tracing::debug!(
                            target: "aura::council",
                            child_run_id = %spawned.child_run_id,
                            council_index = ?spawned.council_index,
                            "captured pre-session_ready subagent_spawned (swarm)"
                        );
                    }
                    pending_events.push(evt);
                    continue;
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
        // `validate_runtime_request_identity` for the rationale.
        if let Err(err) = validate_runtime_request_identity(&config) {
            return Err(anyhow::Error::new(err)
                .context("swarm harness rejected runtime_request: identity preflight"));
        }
        let base_url = self.configured_base_url()?.to_string();
        let token = config.token.as_deref().or(self.auth_token.as_deref());
        let headers = self.bearer_headers(token);
        let agent_id = self
            .create_or_get_agent(&base_url, &config, headers.clone(), token)
            .await?;
        let run_handle = self
            .submit_run(&base_url, &agent_id, headers, &config)
            .await?;
        self.remember_run(&run_handle.run_id, &agent_id, token)
            .await;
        info!(
            run_id = %run_handle.run_id,
            agent_id = %agent_id,
            "Swarm run created"
        );
        self.open_run_socket(run_handle, token).await
    }

    async fn attach_run(
        &self,
        run_id: &str,
        auth_token: Option<&str>,
        wait_for_ready: bool,
    ) -> anyhow::Result<HarnessSession> {
        // Per-request token wins, falling back to the harness-wide token —
        // same precedence `open_session` uses. The child-run stream is the
        // gateway's run-only proxy `{ws_base}/stream/:run_id`, mirroring
        // `LocalHarness::attach_run`.
        let token = auth_token.or(self.auth_token.as_deref());
        let ws_url = self.ws_url_for_run(run_id)?;
        self.connect_run_stream(&ws_url, run_id, token, wait_for_ready)
            .await
    }

    async fn attach_run_at_url(
        &self,
        run_id: &str,
        event_stream_url: Option<&str>,
        auth_token: Option<&str>,
        wait_for_ready: bool,
    ) -> anyhow::Result<HarnessSession> {
        // Prefer the gateway-provided `event_stream_url` (the
        // agent-scoped `/v1/agents/:id/stream/:run_id` route returned by
        // `POST /v1/agents/:id/run`); fall back to the run-only proxy.
        // Mirrors `LocalHarness::attach_run_at_url`.
        let token = auth_token.or(self.auth_token.as_deref());
        let ws_url = match event_stream_url {
            Some(url) => self.resolve_event_stream_url(url)?,
            None => self.ws_url_for_run(run_id)?,
        };
        self.connect_run_stream(&ws_url, run_id, token, wait_for_ready)
            .await
    }

    async fn close_session(&self, session_id: &str) -> anyhow::Result<()> {
        // `session_id` is the harness-allocated `run_id` (see
        // `open_run_socket`). Stop it through the run-scoped lifecycle
        // endpoint, which needs the owning agent id resolved at open time.
        let base_url = self.configured_base_url()?.to_string();
        let run = self.run_sessions.lock().await.remove(session_id);
        let Some(run) = run else {
            // Unknown run (e.g. process restarted since open): nothing we
            // can address. The gateway reaps idle runs on its own.
            warn!(
                run_id = %session_id,
                "swarm close_session called for an unknown run; relying on gateway idle reaping"
            );
            return Ok(());
        };
        let token = run.token.or_else(|| self.auth_token.clone());
        let headers = self.bearer_headers(token.as_deref());

        self.client
            .post(format!(
                "{base_url}/v1/agents/{}/run/{session_id}/stop",
                run.agent_id
            ))
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

    #[tokio::test]
    async fn wait_for_session_ready_collects_pre_ready_subagent_frames() {
        use aura_protocol::{SessionReady, SubagentSpawned};

        let (tx, _rx0) = broadcast::channel::<OutboundMessage>(16);
        let mut rx = tx.subscribe();

        tx.send(OutboundMessage::SubagentSpawned(SubagentSpawned {
            child_run_id: "child-0".into(),
            parent_tool_use_id: Some("council-parent".into()),
            subagent_type: "council-member".into(),
            prompt: "deliberate".into(),
            model: Some("model-a".into()),
            council_index: Some(0),
            council_mechanism: Some("synthesize".into()),
        }))
        .expect("send spawn");
        tx.send(OutboundMessage::SessionReady(SessionReady {
            session_id: "swarm-run".into(),
            tools: Vec::new(),
            skills: Vec::new(),
        }))
        .expect("send ready");

        let mut pending = Vec::new();
        wait_for_session_ready(&mut rx, "swarm-run", &mut pending)
            .await
            .expect("session ready resolves");

        assert_eq!(
            pending.len(),
            2,
            "ready and pre-ready council spawn must be captured"
        );
        assert!(matches!(
            &pending[0],
            OutboundMessage::SessionReady(ready) if ready.session_id == "swarm-run"
        ));
        assert!(matches!(
            &pending[1],
            OutboundMessage::SubagentSpawned(s) if s.child_run_id == "child-0" && s.council_index == Some(0)
        ));
    }

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

    #[test]
    fn lifecycle_action_for_initial_status_wakes_hibernating_agents() {
        assert_eq!(
            lifecycle_action_for_initial_status("hibernating"),
            Some("wake")
        );
    }

    #[test]
    fn lifecycle_action_for_initial_status_preserves_start_transitions() {
        assert_eq!(
            lifecycle_action_for_initial_status("stopped"),
            Some("start")
        );
        assert_eq!(lifecycle_action_for_initial_status("error"), Some("start"));
    }

    #[test]
    fn lifecycle_action_for_initial_status_leaves_ready_agents_alone() {
        assert_eq!(lifecycle_action_for_initial_status("running"), None);
        assert_eq!(lifecycle_action_for_initial_status("idle"), None);
    }

    #[test]
    fn next_backoff_matches_local_harness_schedule() {
        // The swarm helper delegates to the local module but is
        // re-exposed here so the swarm retry loop and its docs can
        // be refactored in isolation. Pinning the values here keeps
        // the two paths in lock-step.
        assert_eq!(next_backoff(1), Duration::from_millis(500));
        assert_eq!(next_backoff(2), Duration::from_millis(1000));
        assert_eq!(next_backoff(3), Duration::from_millis(2000));
        assert_eq!(next_backoff(7), Duration::from_millis(4000));
    }

    #[test]
    fn capacity_handshake_detector_matches_503_and_1013() {
        use tokio_tungstenite::tungstenite::http::Response;
        let resp: Response<Option<Vec<u8>>> = Response::builder()
            .status(503)
            .body(None)
            .expect("response");
        let err = tokio_tungstenite::tungstenite::Error::Http(Box::new(resp));
        assert!(is_capacity_exhausted_ws_handshake_error(&err));

        let other: Response<Option<Vec<u8>>> = Response::builder()
            .status(502)
            .body(None)
            .expect("response");
        let other_err = tokio_tungstenite::tungstenite::Error::Http(Box::new(other));
        assert!(!is_capacity_exhausted_ws_handshake_error(&other_err));
    }
}
