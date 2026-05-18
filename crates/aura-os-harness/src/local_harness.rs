use anyhow::Context;
use async_trait::async_trait;
use tokio::time::Duration;
use tokio_tungstenite::tungstenite;
use tracing::info;

use crate::error::HarnessError;
use crate::harness::{
    build_session_init, validate_session_init_identity, HarnessLink, HarnessSession, SessionConfig,
};
use crate::harness_url::local_harness_base_url;
use crate::stability_metrics;
use crate::ws_bridge::spawn_ws_bridge;
use aura_protocol::{InboundMessage, OutboundMessage};

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

/// Default per-attempt WS connect timeout, matching the pre-Phase 2
/// behavior so the operational ceiling is unchanged when the retry
/// loop short-circuits after a single attempt.
pub const DEFAULT_CONNECT_TIMEOUT_SECS: u64 = 8;

/// Default number of WS connect attempts. Three attempts with
/// 500ms/1000ms/2000ms backoff covers the brief network blips
/// observed in the Phase 2 capture without materially extending
/// failure latency for genuinely-down upstreams.
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

/// Backoff schedule between WS connect attempts. Hand-tuned to the
/// 500ms/1s/2s ramp called out in the Phase 2 plan; attempts beyond
/// the third cap at 4s so a misconfigured `AURA_HARNESS_CONNECT_ATTEMPTS=10`
/// stays under a 30s budget.
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

#[derive(Debug, Clone)]
pub struct LocalHarness {
    base_url: String,
}

impl LocalHarness {
    pub fn new(base_url: String) -> Self {
        Self { base_url }
    }

    pub fn from_env() -> Self {
        Self::new(local_harness_base_url())
    }

    fn ws_url(&self) -> String {
        let base = self
            .base_url
            .replace("https://", "wss://")
            .replace("http://", "ws://");
        format!("{base}/stream")
    }
}

#[async_trait]
impl HarnessLink for LocalHarness {
    async fn open_session(&self, config: SessionConfig) -> anyhow::Result<HarnessSession> {
        // Tier 2 fail-fast: validate the minimum identity contract
        // before any network work. Surfaces as a structured
        // `HarnessError::SessionIdentityMissing` inside the returned
        // `anyhow::Error` so the server's `map_harness_error_to_api`
        // can funnel it into the same 422 response Tier 1 emits.
        if let Err(err) = validate_session_init_identity(&config) {
            return Err(anyhow::Error::new(err)
                .context("local harness rejected session_init: identity preflight"));
        }
        let ws_url = self.ws_url();
        let max_attempts = read_connect_attempts_from_env();
        let per_attempt_timeout = read_connect_timeout_from_env();
        let mut last_err: Option<anyhow::Error> = None;
        let mut ws_stream_opt = None;
        for attempt in 1..=max_attempts {
            let connect_outcome = tokio::time::timeout(
                per_attempt_timeout,
                tokio_tungstenite::connect_async(&ws_url),
            )
            .await;
            match connect_outcome {
                Ok(Ok((ws_stream, _))) => {
                    ws_stream_opt = Some(ws_stream);
                    break;
                }
                Ok(Err(err)) => {
                    // Capacity exhaustion is an authoritative upstream
                    // rejection — retrying would only delay the
                    // 503/1013 surface and waste a slot. Short-circuit
                    // immediately so the existing capacity mapper in
                    // the server keeps firing.
                    if is_capacity_exhausted_ws_error(&err) {
                        return Err(anyhow::Error::new(HarnessError::CapacityExhausted)
                            .context(format!("local harness websocket connect rejected: {err}")));
                    }
                    last_err = Some(
                        anyhow::Error::new(err).context("local harness websocket connect failed"),
                    );
                }
                Err(_) => {
                    last_err = Some(anyhow::anyhow!(
                        "timed out connecting to local harness websocket: {ws_url}"
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
                    "local harness websocket connect failed, retrying"
                );
                // Phase 5 observability: every retry attempt past the
                // first bumps the global counter aura-os-server reads
                // through `stability_metrics::initial_connect_retries()`.
                // The first attempt failing on its own is not a retry —
                // we count the *additional* attempts the loop spends.
                stability_metrics::inc_initial_connect_retry();
                tokio::time::sleep(backoff).await;
            }
        }
        let ws_stream = match ws_stream_opt {
            Some(stream) => stream,
            None => {
                return Err(last_err.unwrap_or_else(|| {
                    anyhow::anyhow!("local harness websocket connect failed (no attempts ran)")
                }));
            }
        };

        let (events_tx, raw_events_tx, commands_tx) = spawn_ws_bridge(ws_stream);

        // Subscribe BEFORE sending SessionInit so any OutboundMessage::Error
        // emitted by the bridge in the microseconds between the send and the
        // subscribe is not lost. The recv loop below is the only consumer of
        // these events, so a missed Error here would mean the loop waits on
        // a SessionReady that will never arrive.
        let mut rx = events_tx.subscribe();

        commands_tx
            .try_send(InboundMessage::SessionInit(Box::new(build_session_init(
                &config,
            ))))
            .context("local harness session_init send failed")?;

        // Bound the SessionReady wait with a 30s timeout. Without it, a
        // harness binary that opens then immediately closes the WS (observed
        // on warm cold-reopens, ~3.3ms WS lifecycle) causes rx.recv() to
        // hang forever: the local `events_tx` above keeps the broadcast
        // channel alive even after the bridge tasks drop their senders, so
        // the recv never sees Err(Closed). The 30s ceiling sits comfortably
        // under the server-side 60s outer timeout in
        // apps/aura-os-server/src/handlers/agents/chat/streaming.rs so this
        // surfaces first with the more informative error string.
        let session_id = tokio::time::timeout(std::time::Duration::from_secs(30), async {
            loop {
                match rx.recv().await {
                    Ok(OutboundMessage::SessionReady(ready)) => {
                        break Ok::<String, anyhow::Error>(ready.session_id);
                    }
                    Ok(OutboundMessage::Error(err)) => {
                        break Err(anyhow::anyhow!(
                            "Harness error during init ({}): {}",
                            err.code,
                            err.message
                        ));
                    }
                    Err(_) => {
                        break Err(anyhow::anyhow!("Connection closed before session_ready"));
                    }
                    _ => continue,
                }
            }
        })
        .await
        .map_err(|_| {
            anyhow::anyhow!("Timed out waiting for SessionReady from local harness (30s)")
        })??;

        info!(%session_id, "Local harness session ready");

        Ok(HarnessSession {
            session_id,
            events_tx,
            raw_events_tx,
            commands_tx,
        })
    }

    async fn close_session(&self, _session_id: &str) -> anyhow::Result<()> {
        Ok(())
    }
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
}
