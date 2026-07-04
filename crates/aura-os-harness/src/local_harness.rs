use async_trait::async_trait;
use tokio::time::Duration;
use tokio_tungstenite::tungstenite;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tracing::info;
use url::Url;

use crate::error::HarnessError;
use crate::harness::{
    build_runtime_request, validate_runtime_request_identity, HarnessLink, HarnessSession,
    RunHandle, SessionConfig,
};
use crate::harness_auth::{local_harness_transport_auth_token_from_env, preferred_transport_auth};
use crate::harness_url::local_harness_base_url;
use crate::stability_metrics;
use crate::ws_bridge::spawn_ws_bridge;
use aura_protocol::OutboundMessage;

/// WebSocket close code 1013 ("Try Again Later") signals upstream
/// capacity exhaustion before the upgrade completes. Detect it by
/// matching the tungstenite close-frame code numerically.
pub(crate) const WS_CLOSE_CODE_TRY_AGAIN_LATER: u16 = 1013;

/// Env var that overrides the per-attempt WS connect timeout. Falls
/// back to [`DEFAULT_CONNECT_TIMEOUT_SECS`] when unset, blank, or
/// non-numeric. Shared by [`LocalHarness`] and `SwarmHarness`.
pub const CONNECT_TIMEOUT_ENV: &str = "AURA_HARNESS_CONNECT_TIMEOUT_SECS";

/// Env var that overrides the number of WS connect attempts. Clamped
/// to `1..=MAX_CONNECT_ATTEMPTS`; falls back to
/// [`DEFAULT_CONNECT_ATTEMPTS`] when unset, blank, or non-numeric.
pub const CONNECT_ATTEMPTS_ENV: &str = "AURA_HARNESS_CONNECT_ATTEMPTS";

/// Default per-attempt WS connect timeout. Keeps the operational
/// ceiling unchanged when the retry loop short-circuits after a
/// single attempt.
pub const DEFAULT_CONNECT_TIMEOUT_SECS: u64 = 8;

/// Default number of WS connect attempts. Three attempts with
/// 500ms/1000ms/2000ms backoff covers brief network blips without
/// materially extending failure latency for genuinely-down
/// upstreams.
pub const DEFAULT_CONNECT_ATTEMPTS: u32 = 3;

/// Hard upper bound on retry attempts to prevent a misconfigured
/// env var from turning a 422-class failure into a 60s stall.
pub const MAX_CONNECT_ATTEMPTS: u32 = 10;

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

/// Backoff schedule between WS connect attempts. Hand-tuned 500ms /
/// 1s / 2s ramp; attempts beyond the third cap at 4s so a
/// misconfigured `AURA_HARNESS_CONNECT_ATTEMPTS=10` stays under a
/// 30s budget.
///
/// `attempt` is 1-indexed; the returned duration is the gap *before*
/// the next attempt, so `next_backoff(1)` is the gap between attempt
/// 1 (just failed) and attempt 2 (about to run).
pub(crate) fn next_backoff(attempt: u32) -> Duration {
    match attempt {
        0 | 1 => Duration::from_millis(500),
        2 => Duration::from_millis(1000),
        3 => Duration::from_millis(2000),
        _ => Duration::from_millis(4000),
    }
}

#[derive(Clone)]
pub struct LocalHarness {
    base_url: String,
    transport_auth_token: Option<String>,
}

impl std::fmt::Debug for LocalHarness {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LocalHarness")
            .field("base_url", &self.base_url)
            .field(
                "transport_auth_token",
                &self.transport_auth_token.as_ref().map(|_| "[redacted]"),
            )
            .finish()
    }
}

impl LocalHarness {
    pub fn new(base_url: String) -> Self {
        Self {
            base_url,
            transport_auth_token: None,
        }
    }

    #[must_use]
    pub fn with_transport_auth_token(
        base_url: String,
        transport_auth_token: Option<String>,
    ) -> Self {
        Self {
            base_url,
            transport_auth_token,
        }
    }

    pub fn from_env() -> Self {
        Self::with_transport_auth_token(
            local_harness_base_url(),
            local_harness_transport_auth_token_from_env(),
        )
    }

    pub fn for_configured_local_base_url(base_url: String) -> Self {
        let transport_auth_token =
            if normalized_base_url(&base_url) == normalized_base_url(&local_harness_base_url()) {
                local_harness_transport_auth_token_from_env()
            } else {
                None
            };
        Self::with_transport_auth_token(base_url, transport_auth_token)
    }

    fn transport_auth<'a>(&'a self, caller_token: Option<&'a str>) -> Option<&'a str> {
        preferred_transport_auth(self.transport_auth_token.as_deref(), caller_token)
    }

    fn ws_base(&self) -> String {
        self.base_url
            .replace("https://", "wss://")
            .replace("http://", "ws://")
    }

    fn ws_url_for_run(&self, run_id: &str) -> String {
        format!("{}/stream/{run_id}", self.ws_base())
    }

    /// Resolve the WebSocket URL for an automaton event stream.
    ///
    /// When `event_stream_url` is provided (from the `POST /v1/run`
    /// response), it is used — verbatim if already absolute
    /// (`ws://` / `wss://`), or joined onto the transport WS base when
    /// relative. Falls back to `{ws_base}/stream/:run_id` when no URL is
    /// supplied (e.g. when adopting an existing run whose start-time URL
    /// is no longer available). Ported from the legacy automaton
    /// client's `resolve_event_stream_url`.
    fn resolve_event_stream_url(
        &self,
        run_id: &str,
        event_stream_url: Option<&str>,
    ) -> anyhow::Result<String> {
        let url = match event_stream_url {
            Some(u) if u.starts_with("ws://") || u.starts_with("wss://") => u.to_string(),
            Some(u) => format!("{}/{}", self.ws_base(), u.trim_start_matches('/')),
            None => self.ws_url_for_run(run_id),
        };
        if self.transport_auth_token.is_some() && !ws_url_matches_base_origin(&self.base_url, &url)
        {
            anyhow::bail!("refusing to send local harness transport auth to off-origin stream URL");
        }
        Ok(url)
    }
}

fn normalized_base_url(url: &str) -> String {
    url.trim().trim_end_matches('/').to_string()
}

#[derive(Debug, PartialEq, Eq)]
struct CanonicalOrigin {
    scheme: &'static str,
    host: String,
    port: u16,
}

fn canonical_origin(url: &str) -> Option<CanonicalOrigin> {
    let parsed = Url::parse(url).ok()?;
    let scheme = match parsed.scheme().to_ascii_lowercase().as_str() {
        "http" | "ws" => "http",
        "https" | "wss" => "https",
        _ => return None,
    };
    let host = parsed.host_str()?.to_ascii_lowercase();
    let port = parsed.port_or_known_default()?;
    Some(CanonicalOrigin { scheme, host, port })
}

fn ws_url_matches_base_origin(base_url: &str, ws_url: &str) -> bool {
    canonical_origin(base_url).is_some_and(|base| canonical_origin(ws_url) == Some(base))
}

/// HTTP client timeout for the `POST /v1/run` step of the two-step
/// chat session exchange. Mirrors the
/// [`crate::automaton_client::client::AUTOMATON_START_TIMEOUT`]
/// rationale: the harness's `prepare_chat_session` does identity /
/// tool / skill resolution before returning, which can exceed the
/// client-wide 12s default on a freshly-launched node.
const RUN_START_TIMEOUT: Duration = Duration::from_secs(60);

#[async_trait]
impl HarnessLink for LocalHarness {
    async fn open_session(&self, config: SessionConfig) -> anyhow::Result<HarnessSession> {
        // Tier 2 fail-fast: validate the minimum identity contract
        // before any network work.
        if let Err(err) = validate_runtime_request_identity(&config) {
            return Err(anyhow::Error::new(err)
                .context("local harness rejected runtime_request: identity preflight"));
        }
        let auth_token = config.token.clone();
        // `open_session` is now a thin convenience wrapper over the
        // canonical `open_run`: it builds a Chat `RuntimeRequest` from
        // the `SessionConfig` and submits it through the same two-step
        // POST /v1/run + WS /stream/:run_id exchange every run type uses.
        self.open_run(build_runtime_request(&config), auth_token.as_deref())
            .await
    }

    async fn close_session(&self, _session_id: &str) -> anyhow::Result<()> {
        Ok(())
    }

    async fn submit_run(
        &self,
        request: aura_protocol::RuntimeRequest,
        auth_token: Option<&str>,
    ) -> anyhow::Result<RunHandle> {
        self.submit_run_once(&request, auth_token).await
    }

    async fn attach_run(
        &self,
        run_id: &str,
        auth_token: Option<&str>,
        wait_for_ready: bool,
    ) -> anyhow::Result<HarnessSession> {
        let per_attempt_timeout = read_connect_timeout_from_env();
        let ws_url = self.ws_url_for_run(run_id);
        self.attach_run_at_ws_url(
            &ws_url,
            run_id,
            auth_token,
            wait_for_ready,
            per_attempt_timeout,
        )
        .await
        .map_err(|e| match e {
            OpenAttemptError::Capacity(err) | OpenAttemptError::Other(err) => err,
        })
    }

    async fn attach_run_at_url(
        &self,
        run_id: &str,
        event_stream_url: Option<&str>,
        auth_token: Option<&str>,
        wait_for_ready: bool,
    ) -> anyhow::Result<HarnessSession> {
        let per_attempt_timeout = read_connect_timeout_from_env();
        let ws_url = self.resolve_event_stream_url(run_id, event_stream_url)?;
        self.attach_run_at_ws_url(
            &ws_url,
            run_id,
            auth_token,
            wait_for_ready,
            per_attempt_timeout,
        )
        .await
        .map_err(|e| match e {
            OpenAttemptError::Capacity(err) | OpenAttemptError::Other(err) => err,
        })
    }

    async fn pause_run(&self, run_id: &str, auth_token: Option<&str>) -> anyhow::Result<()> {
        self.lifecycle_post(run_id, "pause", auth_token).await
    }

    async fn stop_run(&self, run_id: &str, auth_token: Option<&str>) -> anyhow::Result<()> {
        self.lifecycle_post(run_id, "stop", auth_token).await
    }

    async fn resume_run(&self, run_id: &str, auth_token: Option<&str>) -> anyhow::Result<()> {
        self.lifecycle_post(run_id, "resume", auth_token).await
    }

    async fn resolve_workspace(
        &self,
        project_name: &str,
        auth_token: Option<&str>,
    ) -> anyhow::Result<String> {
        let url = format!("{}/workspace/resolve", self.base_url);
        let mut req = Self::lifecycle_http_client()?
            .get(&url)
            .query(&[("project_name", project_name)]);
        if let Some(token) = self.transport_auth(auth_token) {
            req = req.bearer_auth(token);
        }
        let resp = req.send().await?;
        let status = resp.status();
        let body = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("GET /workspace/resolve returned {status}: {body}");
        }
        let json: serde_json::Value = serde_json::from_str(&body)?;
        json.get("path")
            .and_then(|v| v.as_str())
            .map(String::from)
            .ok_or_else(|| anyhow::anyhow!("workspace resolve response missing 'path' field"))
    }

    async fn run_status(
        &self,
        run_id: &str,
        auth_token: Option<&str>,
    ) -> anyhow::Result<serde_json::Value> {
        let url = format!("{}/v1/run/{run_id}/status", self.base_url);
        let mut req = Self::lifecycle_http_client()?.get(&url);
        if let Some(token) = self.transport_auth(auth_token) {
            req = req.bearer_auth(token);
        }
        let resp = req.send().await?;
        let status = resp.status();
        let body = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("GET /v1/run/{run_id}/status returned {status}: {body}");
        }
        Ok(serde_json::from_str(&body)?)
    }
}

impl LocalHarness {
    /// Canonical run-open path shared by chat (`open_session`) and
    /// automaton (`DevLoop` / `TaskRun`) flows: submit a
    /// [`RuntimeRequest`] to `POST /v1/run`, attach `WS /stream/:run_id`,
    /// and return the live [`HarnessSession`] (typed + raw event
    /// broadcasts, command sink, and the retained `run_id`). Applies the
    /// shared connect-retry budget and the `503 -> CapacityExhausted`
    /// short-circuit.
    pub async fn open_run(
        &self,
        request_body: aura_protocol::RuntimeRequest,
        auth_token: Option<&str>,
    ) -> anyhow::Result<HarnessSession> {
        let max_attempts = read_connect_attempts_from_env();
        let per_attempt_timeout = read_connect_timeout_from_env();

        let mut last_err: Option<anyhow::Error> = None;
        let mut session_opt: Option<HarnessSession> = None;
        for attempt in 1..=max_attempts {
            match self
                .try_open_session_attempt(&request_body, auth_token, per_attempt_timeout)
                .await
            {
                Ok(session) => {
                    session_opt = Some(session);
                    break;
                }
                Err(OpenAttemptError::Capacity(err)) => {
                    return Err(err);
                }
                Err(OpenAttemptError::Other(err)) => {
                    last_err = Some(err);
                }
            }
            if attempt < max_attempts {
                let backoff = next_backoff(attempt);
                info!(
                    attempt,
                    max_attempts,
                    backoff_ms = backoff.as_millis() as u64,
                    error = ?last_err.as_ref().map(|e| e.to_string()),
                    "local harness run open failed, retrying"
                );
                // Phase 5 observability: every retry attempt past the
                // first bumps the global counter aura-os-server reads
                // through `stability_metrics::initial_connect_retries()`.
                stability_metrics::inc_initial_connect_retry();
                tokio::time::sleep(backoff).await;
            }
        }
        let session = session_opt.ok_or_else(|| {
            last_err.unwrap_or_else(|| {
                anyhow::anyhow!("local harness run open failed (no attempts ran)")
            })
        })?;

        info!(session_id = %session.session_id, run_id = %session.run_id, "Local harness run ready");
        Ok(session)
    }

    /// Build a lightweight HTTP client for a one-shot `/v1/run/:id/*`
    /// lifecycle call. Mirrors the per-call client the open path builds
    /// so a stale keep-alive socket never wedges a control request.
    fn lifecycle_http_client() -> anyhow::Result<reqwest::Client> {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(3))
            .timeout(Duration::from_secs(12))
            .build()
            .map_err(|e| anyhow::anyhow!("failed to build lifecycle http client: {e}"))
    }

    async fn lifecycle_post(
        &self,
        run_id: &str,
        action: &str,
        auth_token: Option<&str>,
    ) -> anyhow::Result<()> {
        let url = format!("{}/v1/run/{run_id}/{action}", self.base_url);
        let mut req = Self::lifecycle_http_client()?.post(&url);
        if let Some(token) = self.transport_auth(auth_token) {
            req = req.bearer_auth(token);
        }
        let resp = req.send().await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("POST /v1/run/{run_id}/{action} returned {status}: {body}");
        }
        Ok(())
    }
}

/// Per-attempt failure mode for the two-step open exchange.
///
/// Capacity-class rejections short-circuit the retry loop so the
/// upstream `503` surface is preserved verbatim instead of being
/// retried (and inflated into a 60s+ stall). Everything else falls
/// through to the retry budget.
enum OpenAttemptError {
    Capacity(anyhow::Error),
    Other(anyhow::Error),
}

impl LocalHarness {
    /// One attempt of the canonical open: submit a run then attach its
    /// WS, waiting for `SessionReady`. Used by [`Self::open_run`]'s retry
    /// loop. Splits into [`Self::submit_run_once`] (POST) and
    /// [`Self::attach_run_once`] (WS) so the automaton path can use the
    /// two halves independently.
    async fn try_open_session_attempt(
        &self,
        request_body: &aura_protocol::RuntimeRequest,
        auth_token: Option<&str>,
        per_attempt_timeout: Duration,
    ) -> Result<HarnessSession, OpenAttemptError> {
        let run_handle = self
            .submit_run_once(request_body, auth_token)
            .await
            .map_err(classify_open_error)?;
        let ws_url = self.ws_url_for_run(&run_handle.run_id);
        self.attach_run_at_ws_url(
            &ws_url,
            &run_handle.run_id,
            auth_token,
            true,
            per_attempt_timeout,
        )
        .await
    }

    /// `POST /v1/run` only. Maps `503 -> CapacityExhausted` and
    /// `409 -> Conflict(run_id)` to typed [`HarnessError`] causes so
    /// callers (chat retry loop, dev-loop adopt) can branch on them.
    async fn submit_run_once(
        &self,
        request_body: &aura_protocol::RuntimeRequest,
        auth_token: Option<&str>,
    ) -> anyhow::Result<RunHandle> {
        let http_client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(3))
            .timeout(RUN_START_TIMEOUT)
            .build()
            .map_err(|e| anyhow::anyhow!("failed to build reqwest client: {e}"))?;
        let mut http_req = http_client
            .post(format!("{}/v1/run", self.base_url))
            .json(request_body);
        if let Some(token) = self.transport_auth(auth_token) {
            http_req = http_req.bearer_auth(token);
        }
        let resp = http_req.send().await.map_err(|e| {
            // Preserve the transport-failure taxonomy so the dev-loop
            // start path can still map connect/timeout failures onto the
            // "harness unavailable → 503 + autospawn" UX instead of a
            // generic 500. Chat retry logic is unaffected: this is just
            // an `Other`-class cause to the connect retry loop.
            anyhow::Error::new(HarnessError::Unreachable {
                is_connect: e.is_connect(),
                is_timeout: e.is_timeout(),
                message: format!("local harness POST /v1/run failed: {e}"),
            })
        })?;
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            if status.as_u16() == 503 {
                return Err(anyhow::Error::new(HarnessError::CapacityExhausted)
                    .context(format!("POST /v1/run rejected with 503: {body}")));
            }
            if status.as_u16() == 409 {
                return Err(anyhow::Error::new(HarnessError::Conflict {
                    run_id: extract_conflict_run_id(&body),
                })
                .context(format!("POST /v1/run rejected with 409: {body}")));
            }
            // A non-2xx here (typically 404) means a server is
            // listening at `base_url` but does not serve `/v1/run` —
            // a stale/incompatible harness build or a misrouted
            // `LOCAL_HARNESS_URL`. Log the resolved endpoint so the
            // 404 is self-diagnosing in operator logs.
            tracing::warn!(
                base_url = %self.base_url,
                status = status.as_u16(),
                "local harness POST /v1/run returned non-success status"
            );
            return Err(anyhow::Error::new(HarnessError::UpstreamStatus {
                status: status.as_u16(),
                body,
            }));
        }
        let run_handle: RunHandle = serde_json::from_str(&body).map_err(|e| {
            anyhow::anyhow!("POST /v1/run response parse failed: {e}, body: {body}")
        })?;
        Ok(run_handle)
    }

    /// Attach `WS /stream/:run_id`, spawn the in-process bridge, and
    /// return the live [`HarnessSession`]. When `wait_for_ready`, block
    /// on the `SessionReady` frame (chat); otherwise run a short liveness
    /// probe and use `run_id` as the session id (automaton runs never
    /// emit `SessionReady`).
    async fn attach_run_at_ws_url(
        &self,
        ws_url: &str,
        run_id: &str,
        auth_token: Option<&str>,
        wait_for_ready: bool,
        per_attempt_timeout: Duration,
    ) -> Result<HarnessSession, OpenAttemptError> {
        let mut ws_req = ws_url.to_string().into_client_request().map_err(|e| {
            OpenAttemptError::Other(anyhow::anyhow!("failed to build ws request: {e}"))
        })?;
        if let Some(token) = self.transport_auth(auth_token) {
            let value = format!("Bearer {token}").parse().map_err(|e| {
                OpenAttemptError::Other(anyhow::anyhow!("bad authorization header value: {e}"))
            })?;
            ws_req.headers_mut().insert(
                tokio_tungstenite::tungstenite::http::header::AUTHORIZATION,
                value,
            );
        }
        let connect_outcome = tokio::time::timeout(
            per_attempt_timeout,
            tokio_tungstenite::connect_async(ws_req),
        )
        .await;
        let ws_stream = match connect_outcome {
            Ok(Ok((ws_stream, _))) => ws_stream,
            Ok(Err(err)) => {
                if is_capacity_exhausted_ws_error(&err) {
                    return Err(OpenAttemptError::Capacity(
                        anyhow::Error::new(HarnessError::CapacityExhausted)
                            .context(format!("local harness websocket connect rejected: {err}")),
                    ));
                }
                return Err(OpenAttemptError::Other(
                    anyhow::Error::new(err).context("local harness websocket connect failed"),
                ));
            }
            Err(_) => {
                return Err(OpenAttemptError::Other(anyhow::anyhow!(
                    "timed out connecting to local harness websocket: {ws_url}"
                )));
            }
        };

        let (events_tx, primed_events_rx, raw_events_tx, commands_tx) = spawn_ws_bridge(ws_stream);

        // Subagent frames the harness emits before `session_ready` (AURA
        // Council member fan-out happens at run start) would be dropped
        // because the server-side consumers only subscribe to `events_tx`
        // after `open_session` returns. Capture them here and hand them
        // back so the chat orchestrator can replay them onto the
        // broadcast once every consumer is subscribed.
        let mut pending_events: Vec<OutboundMessage> = Vec::new();

        let session_id = if wait_for_ready {
            // Chat runs emit `SessionReady` unprompted once the run is
            // created on the HTTP side; block on it to learn the
            // session id.
            let mut rx = events_tx.subscribe();
            match tokio::time::timeout(
                std::time::Duration::from_secs(30),
                wait_for_session_ready_collecting(&mut rx, &mut pending_events),
            )
            .await
            {
                Ok(Ok(id)) => id,
                Ok(Err(err)) => return Err(OpenAttemptError::Other(err)),
                Err(_) => {
                    return Err(OpenAttemptError::Other(anyhow::anyhow!(
                        "Timed out waiting for SessionReady from local harness (30s)"
                    )));
                }
            }
        } else {
            // Automaton runs (DevLoop / TaskRun) stream domain events
            // directly without a `SessionReady`. Do a brief liveness
            // probe: if the bridge reports the WS closed/errored right
            // away, fail so the caller can retry; otherwise proceed with
            // `run_id` as the session id.
            let mut rx = events_tx.subscribe();
            match tokio::time::timeout(Duration::from_millis(250), rx.recv()).await {
                Ok(Ok(OutboundMessage::Error(err)))
                    if err.code == "harness_ws_closed" || err.code == "harness_ws_read_error" =>
                {
                    return Err(OpenAttemptError::Other(anyhow::anyhow!(
                        "automaton event stream died immediately after connect: {}",
                        err.message
                    )));
                }
                Ok(Err(tokio::sync::broadcast::error::RecvError::Closed)) => {
                    return Err(OpenAttemptError::Other(anyhow::anyhow!(
                        "automaton event stream closed immediately after connect"
                    )));
                }
                // Any other event, lag, or timeout: treat as alive.
                _ => {}
            }
            run_id.to_string()
        };

        Ok(HarnessSession {
            session_id,
            run_id: run_id.to_string(),
            events_tx,
            raw_events_tx,
            commands_tx,
            pending_events,
            events_rx: Some(primed_events_rx),
        })
    }
}

/// Block on the `session_ready` frame, returning the harness-assigned
/// session id. Any subagent lifecycle frames (`SubagentSpawned` /
/// `SubagentStatus`) seen beforehand are collected into `pending_events`
/// instead of discarded: AURA Council parent runs fan their members out
/// at run start (around/before `session_ready`), so those frames arrive
/// before any server-side consumer subscribes to `events_tx` and would
/// otherwise be lost. The caller wraps this in a timeout and hands
/// `pending_events` back so the chat orchestrator can replay them.
async fn wait_for_session_ready_collecting(
    rx: &mut tokio::sync::broadcast::Receiver<OutboundMessage>,
    pending_events: &mut Vec<OutboundMessage>,
) -> anyhow::Result<String> {
    loop {
        match rx.recv().await {
            Ok(OutboundMessage::SessionReady(ready)) => return Ok(ready.session_id),
            Ok(OutboundMessage::Error(err)) => {
                anyhow::bail!("Harness error during init ({}): {}", err.code, err.message)
            }
            Ok(evt @ OutboundMessage::SubagentSpawned(_))
            | Ok(evt @ OutboundMessage::SubagentStatus(_)) => {
                if let OutboundMessage::SubagentSpawned(spawned) = &evt {
                    tracing::debug!(
                        target: "aura::council",
                        child_run_id = %spawned.child_run_id,
                        council_index = ?spawned.council_index,
                        "captured pre-session_ready subagent_spawned (local)"
                    );
                }
                pending_events.push(evt);
            }
            Ok(_) => continue,
            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
            Err(_) => anyhow::bail!("Connection closed before session_ready"),
        }
    }
}

/// Collapse a `submit_run_once` error into the retry-loop's
/// [`OpenAttemptError`], preserving the capacity short-circuit.
fn classify_open_error(err: anyhow::Error) -> OpenAttemptError {
    if HarnessError::is_capacity_exhausted(&err) {
        OpenAttemptError::Capacity(err)
    } else {
        OpenAttemptError::Other(err)
    }
}

/// Best-effort extraction of an existing `run_id` from a harness `409`
/// body. Accepts the structured `{run_id|automaton_id|id}` (optionally
/// nested under `data`) and the legacy `automaton_id: <id>` substring in
/// a free-text `error` / `message` field.
fn extract_conflict_run_id(body: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(body).ok()?;
    fn id_field(v: &serde_json::Value) -> Option<String> {
        let obj = v.as_object()?;
        for key in ["run_id", "automaton_id", "id"] {
            if let Some(s) = obj.get(key).and_then(|x| x.as_str()) {
                let t = s.trim().trim_matches('"');
                if !t.is_empty() {
                    return Some(t.to_string());
                }
            }
        }
        None
    }
    fn substring_id(msg: &str) -> Option<String> {
        for needle in ["run_id:", "automaton_id:"] {
            if let Some(pos) = msg.find(needle) {
                let tail = msg[pos + needle.len()..].trim_start();
                let tail = tail.strip_prefix("Some(").unwrap_or(tail);
                let tail = tail
                    .trim_matches('"')
                    .trim_matches(')')
                    .trim_matches('"')
                    .trim();
                let end = tail
                    .find(|c: char| {
                        c == ')' || c == ',' || c == '}' || c == '"' || c.is_whitespace()
                    })
                    .unwrap_or(tail.len());
                let candidate = &tail[..end];
                if !candidate.is_empty() {
                    return Some(candidate.to_string());
                }
            }
        }
        None
    }
    if let Some(id) = id_field(&value) {
        return Some(id);
    }
    if let Some(data) = value.get("data") {
        if let Some(id) = id_field(data) {
            return Some(id);
        }
    }
    for key in ["error", "message"] {
        if let Some(field) = value.get(key) {
            if let Some(id) = id_field(field) {
                return Some(id);
            }
            if let Some(s) = field.as_str() {
                if let Some(id) = substring_id(s) {
                    return Some(id);
                }
            }
        }
    }
    None
}

/// Returns `true` when the tungstenite connect error matches an
/// upstream capacity-exhaustion rejection. Two wire shapes are
/// covered:
///
/// * `tungstenite::Error::Http` with status `503` (the upstream
///   refused the upgrade outright).
/// * Any tungstenite error whose `Display` form mentions WS close
///   code `1013` ("Try Again Later") — the rare path where the
///   upgrade completes briefly before the server slams a 1013 close
///   frame on top, observed when the slot semaphore loses a race
///   with the upgrade handshake.
///
/// Other transport errors (DNS, TLS, generic IO) intentionally fall
/// through so the existing `bad_gateway` mapping in the server keeps
/// firing for them.
pub(crate) fn is_capacity_exhausted_ws_error(err: &tungstenite::Error) -> bool {
    if let tungstenite::Error::Http(resp) = err {
        if resp.status().as_u16() == 503 {
            return true;
        }
    }
    let display = err.to_string();
    display.contains(&WS_CLOSE_CODE_TRY_AGAIN_LATER.to_string())
        && display.to_ascii_lowercase().contains("try again")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio_tungstenite::tungstenite::http::Response;

    #[test]
    fn capacity_detector_matches_http_503() {
        let resp: Response<Option<Vec<u8>>> = Response::builder()
            .status(503)
            .body(None)
            .expect("response");
        let err = tungstenite::Error::Http(Box::new(resp));
        assert!(is_capacity_exhausted_ws_error(&err));
    }

    #[test]
    fn capacity_detector_ignores_http_502() {
        let resp: Response<Option<Vec<u8>>> = Response::builder()
            .status(502)
            .body(None)
            .expect("response");
        let err = tungstenite::Error::Http(Box::new(resp));
        assert!(!is_capacity_exhausted_ws_error(&err));
    }

    #[test]
    fn capacity_detector_ignores_unrelated_io_error() {
        let err = tungstenite::Error::Io(std::io::Error::new(
            std::io::ErrorKind::ConnectionRefused,
            "nope",
        ));
        assert!(!is_capacity_exhausted_ws_error(&err));
    }

    #[test]
    fn transport_auth_accepts_same_origin_absolute_stream_url() {
        let harness = LocalHarness::with_transport_auth_token(
            "https://harness.example.com/base".to_string(),
            Some("transport-secret".to_string()),
        );

        let resolved = harness
            .resolve_event_stream_url("run-1", Some("wss://harness.example.com/stream/run-1"))
            .expect("same-origin stream is accepted");

        assert_eq!(resolved, "wss://harness.example.com/stream/run-1");
    }

    #[test]
    fn transport_auth_accepts_same_origin_stream_url_with_default_port() {
        let harness = LocalHarness::with_transport_auth_token(
            "https://harness.example.com".to_string(),
            Some("transport-secret".to_string()),
        );

        let resolved = harness
            .resolve_event_stream_url("run-1", Some("wss://harness.example.com:443/stream/run-1"))
            .expect("same-origin stream with explicit default port is accepted");

        assert_eq!(resolved, "wss://harness.example.com:443/stream/run-1");
    }

    #[test]
    fn transport_auth_rejects_off_origin_absolute_stream_url() {
        let harness = LocalHarness::with_transport_auth_token(
            "https://harness.example.com".to_string(),
            Some("transport-secret".to_string()),
        );

        let error = harness
            .resolve_event_stream_url("run-1", Some("wss://evil.example.com/stream/run-1"))
            .expect_err("off-origin stream must not receive transport auth");

        assert!(error.to_string().contains("off-origin stream URL"));
    }

    #[tokio::test]
    async fn wait_for_session_ready_collects_pre_ready_subagent_frames() {
        use aura_protocol::{SessionReady, SubagentSpawned, SubagentStatus};

        let (tx, _rx0) = tokio::sync::broadcast::channel::<OutboundMessage>(16);
        let mut rx = tx.subscribe();

        // Council fan-out lands BEFORE session_ready.
        tx.send(OutboundMessage::SubagentSpawned(SubagentSpawned {
            child_run_id: "child-0".into(),
            parent_tool_use_id: Some("council-parent".into()),
            subagent_type: "council-member".into(),
            prompt: "deliberate".into(),
            model: Some("model-a".into()),
            council_index: Some(0),
            council_mechanism: Some("synthesize".into()),
        }))
        .expect("send spawn 0");
        tx.send(OutboundMessage::SubagentStatus(SubagentStatus {
            child_run_id: "child-0".into(),
            state: "running".into(),
            reason: None,
        }))
        .expect("send status 0");
        tx.send(OutboundMessage::SubagentSpawned(SubagentSpawned {
            child_run_id: "child-1".into(),
            parent_tool_use_id: Some("council-parent".into()),
            subagent_type: "council-member".into(),
            prompt: "deliberate".into(),
            model: Some("model-b".into()),
            council_index: Some(1),
            council_mechanism: Some("synthesize".into()),
        }))
        .expect("send spawn 1");
        tx.send(OutboundMessage::SessionReady(SessionReady {
            session_id: "sess-ready".into(),
            tools: Vec::new(),
            skills: Vec::new(),
        }))
        .expect("send ready");

        let mut pending = Vec::new();
        let session_id = wait_for_session_ready_collecting(&mut rx, &mut pending)
            .await
            .expect("session ready resolves");

        assert_eq!(session_id, "sess-ready");
        assert_eq!(
            pending.len(),
            3,
            "both spawns and the status frame must be captured before session_ready"
        );
        assert!(matches!(
            &pending[0],
            OutboundMessage::SubagentSpawned(s) if s.child_run_id == "child-0" && s.council_index == Some(0)
        ));
        assert!(
            matches!(&pending[1], OutboundMessage::SubagentStatus(s) if s.child_run_id == "child-0")
        );
        assert!(matches!(
            &pending[2],
            OutboundMessage::SubagentSpawned(s) if s.child_run_id == "child-1" && s.council_index == Some(1)
        ));
    }

    #[test]
    fn next_backoff_follows_plan_schedule() {
        // Pinned to the 500ms/1s/2s ramp called out in the Phase 2
        // plan so a future refactor that swaps the math has to update
        // the docs in lock-step.
        assert_eq!(next_backoff(1), Duration::from_millis(500));
        assert_eq!(next_backoff(2), Duration::from_millis(1000));
        assert_eq!(next_backoff(3), Duration::from_millis(2000));
    }

    #[test]
    fn next_backoff_caps_at_four_seconds_for_high_attempts() {
        // Misconfigured env should not let the loop drift into
        // arbitrarily-long sleeps — the cap matches the Phase 2 plan.
        assert_eq!(next_backoff(4), Duration::from_millis(4000));
        assert_eq!(next_backoff(10), Duration::from_millis(4000));
    }

    #[test]
    fn next_backoff_treats_zeroth_attempt_like_first() {
        // Defensive: callers iterate from 1, but guard the off-by-one
        // so a future direct-from-zero loop doesn't trip on a panic.
        assert_eq!(next_backoff(0), Duration::from_millis(500));
    }

    // Conflict-id extraction coverage ported from the removed
    // `automaton_client::client` parser tests: the dev-loop adopt path
    // depends on pulling the existing `run_id` out of a harness `409`
    // body across both the structured and legacy substring shapes.
    #[test]
    fn extract_conflict_run_id_reads_structured_top_level() {
        let body = r#"{"run_id":"run-abc","error":"conflict"}"#;
        assert_eq!(extract_conflict_run_id(body).as_deref(), Some("run-abc"));
    }

    #[test]
    fn extract_conflict_run_id_reads_legacy_automaton_id_alias() {
        let body = r#"{"automaton_id":"auto-legacy"}"#;
        assert_eq!(
            extract_conflict_run_id(body).as_deref(),
            Some("auto-legacy")
        );
    }

    #[test]
    fn extract_conflict_run_id_reads_nested_data_object() {
        let body = r#"{"error":"conflict","data":{"run_id":"run-nested"}}"#;
        assert_eq!(extract_conflict_run_id(body).as_deref(), Some("run-nested"));
    }

    #[test]
    fn extract_conflict_run_id_reads_legacy_error_substring() {
        let body = r#"{"error":"a dev loop is already running (automaton_id: \"auto-sub\")"}"#;
        assert_eq!(extract_conflict_run_id(body).as_deref(), Some("auto-sub"));
    }

    #[test]
    fn extract_conflict_run_id_reads_some_debug_substring() {
        let body = r#"{"message":"conflict at run_id: Some(\"run-some\")"}"#;
        assert_eq!(extract_conflict_run_id(body).as_deref(), Some("run-some"));
    }

    #[test]
    fn extract_conflict_run_id_missing_returns_none() {
        assert_eq!(
            extract_conflict_run_id(r#"{"error":"a dev loop is already running"}"#),
            None
        );
        assert_eq!(extract_conflict_run_id("not json at all"), None);
    }
}
