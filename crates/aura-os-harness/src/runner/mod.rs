//! Shared automaton lifecycle runner.
//!
//! Provides [`start_and_connect`] and [`collect_automaton_events`] so both the
//! dev-loop task pipeline and the process executor can reuse the same
//! automaton start -> event-stream -> collection logic without duplication.
//!
//! The runner is transport-agnostic: it drives the canonical
//! [`HarnessLink`] surface (`submit_run` + `attach_run_at_url`) instead
//! of the removed bespoke `AutomatonClient`, so the same code path
//! serves the local harness and the swarm gateway (both expressed as a
//! [`crate::LocalHarness`] pointed at the relevant base URL).

pub mod automaton_event_kinds;
mod collector;

use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::sync::broadcast;
use tracing::warn;

pub use automaton_event_kinds::{
    is_git_sync_event, is_process_progress_broadcast_event, is_process_stream_forward_event,
    normalize_process_tool_type_field,
};
pub use collector::{collect_automaton_events, CollectedOutput, RunCompletion};

use crate::automaton_client::{
    automaton_start_params_to_runtime_request, validate_automaton_start_identity,
};
use crate::{
    AutomatonStartError, AutomatonStartParams, HarnessError, HarnessLink, RunHandle, WsReaderHandle,
};

/// Submit an automaton run via the canonical [`HarnessLink::submit_run`]
/// surface, mapping the transport's typed `anyhow` causes back onto the
/// dev-loop's [`AutomatonStartError`] taxonomy.
///
/// This replaces the bespoke `AutomatonClient::start`: the dev-loop
/// adapter still branches on [`AutomatonStartError`] (conflict / capacity
/// / connect-timeout / structured upstream status), so we reconstruct
/// those variants from the typed [`HarnessError`] causes the canonical
/// transport now threads through (`Conflict`, `CapacityExhausted`,
/// `UpstreamStatus`, `Unreachable`).
pub async fn submit_automaton_run(
    harness: &dyn HarnessLink,
    params: AutomatonStartParams,
    auth_token: Option<&str>,
) -> Result<RunHandle, AutomatonStartError> {
    // Tier 2 fail-fast: refuse to submit a run whose payload is missing
    // a required identity field before doing any network work.
    if let Err(err) = validate_automaton_start_identity(&params) {
        return Err(AutomatonStartError::Other(
            anyhow::Error::new(err).context("harness rejected /v1/run: identity preflight"),
        ));
    }
    let request = automaton_start_params_to_runtime_request(&params);
    harness
        .submit_run(request, auth_token)
        .await
        .map_err(map_submit_error)
}

/// Collapse a [`HarnessLink::submit_run`] `anyhow::Error` onto the
/// dev-loop's [`AutomatonStartError`] taxonomy, preserving each
/// operationally-distinct failure mode.
fn map_submit_error(err: anyhow::Error) -> AutomatonStartError {
    if let Some(run_id) = HarnessError::conflict_run_id(&err) {
        return AutomatonStartError::Conflict(run_id);
    }
    if let Some((status, body)) = HarnessError::upstream_status(&err) {
        return AutomatonStartError::Response { status, body };
    }
    // The canonical transport maps every harness `503` to
    // `CapacityExhausted`; surface it as the structured 503 the dev-loop
    // capacity branch keys on (an empty body reads as capacity).
    if HarnessError::is_capacity_exhausted(&err) {
        return AutomatonStartError::Response {
            status: 503,
            body: String::new(),
        };
    }
    if let Some((is_connect, is_timeout)) = HarnessError::unreachable_cause(&err) {
        return AutomatonStartError::Request {
            message: err.to_string(),
            is_connect,
            is_timeout,
        };
    }
    AutomatonStartError::Other(err)
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitSyncMilestone {
    pub event_type: String,
    pub commit_sha: Option<String>,
    pub branch: Option<String>,
    pub remote: Option<String>,
    pub push_id: Option<String>,
    pub reason: Option<String>,
    pub summary: Option<String>,
    #[serde(default)]
    pub commits: Vec<String>,
}

/// Errors from [`start_and_connect`].
#[derive(Debug, thiserror::Error)]
pub enum RunStartError {
    #[error("failed to start automaton: {0}")]
    Start(#[from] AutomatonStartError),
    #[error("failed to connect event stream after {attempts} attempt(s): {message}")]
    Connect { attempts: u32, message: String },
}

/// Raw automaton event fan-out with receivers subscribed before the
/// WebSocket reader starts. The live forwarder and persistence task each
/// own a receiver so an immediate replay-on-attach burst reaches both.
pub struct AutomatonEventStream {
    pub events_rx: broadcast::Receiver<serde_json::Value>,
    pub persist_events_rx: broadcast::Receiver<serde_json::Value>,
}

/// Start an automaton and connect to its event stream with retries.
///
/// `stream_retries` is the number of **additional** attempts after the first;
/// pass `0` for a single attempt, `2` for three total attempts, etc.
///
/// Returns a [`WsReaderHandle`] alongside two primed event receivers; the
/// caller must keep the handle alive for as long as events should flow and
/// drop / cancel it to release the harness's WS slot.
pub async fn start_and_connect(
    harness: &dyn HarnessLink,
    params: AutomatonStartParams,
    auth_token: Option<&str>,
    stream_retries: u32,
) -> Result<(RunHandle, AutomatonEventStream, WsReaderHandle), RunStartError> {
    let result = submit_automaton_run(harness, params, auth_token).await?;
    let (event_stream, ws_handle) = connect_with_retries(
        harness,
        &result.run_id,
        Some(&result.event_stream_url),
        auth_token,
        stream_retries,
    )
    .await
    .map_err(|err| RunStartError::Connect {
        attempts: stream_retries + 1,
        message: err.to_string(),
    })?;
    Ok((result, event_stream, ws_handle))
}

/// Connect to an automaton event stream, retrying on failure.
///
/// `retries` is the number of **additional** attempts after the first.
/// Passing `None` for `event_stream_url` lets the client fall back to its
/// default stream path -- used when adopting an existing automaton whose
/// start-time URL is no longer available (e.g. after recovering from a
/// `Conflict` on restart).
///
/// Returns a [`WsReaderHandle`] alongside primed receivers for the live
/// forwarder and persistence consumer; the caller must keep the handle
/// alive for as long as events should flow and drop / cancel it to release
/// the harness's WS slot.
/// Repeatedly call [`AutomatonClient::connect_event_stream`] with
/// exponential backoff. Returns an `anyhow::Error` so typed causes
/// (notably [`crate::HarnessError::CapacityExhausted`]) survive into
/// the caller and can be matched by
/// `aura_os_server::handlers::agents::chat::errors::map_harness_error_to_api`.
///
/// Capacity-exhausted errors are returned immediately on the first
/// attempt rather than retried — the upstream WS-slot semaphore
/// won't free up in 500ms and retrying just delays the structured
/// 503 the caller wants to surface.
pub async fn connect_with_retries(
    harness: &dyn HarnessLink,
    automaton_id: &str,
    event_stream_url: Option<&str>,
    auth_token: Option<&str>,
    retries: u32,
) -> anyhow::Result<(AutomatonEventStream, WsReaderHandle)> {
    let total_attempts = retries + 1;
    let mut last_err: Option<anyhow::Error> = None;
    for attempt in 0..total_attempts {
        if attempt > 0 {
            let delay = Duration::from_millis(500 * (1u64 << attempt.min(2)));
            warn!(
                %automaton_id, attempt,
                "Retrying event stream connection in {}ms", delay.as_millis()
            );
            tokio::time::sleep(delay).await;
        }
        // Automaton runs never emit `SessionReady`; attach with the
        // short liveness probe (`wait_for_ready = false`) and hand the
        // live session to a `WsReaderHandle` that owns it. The raw JSON
        // broadcast (`raw_events_tx`) is the channel the dev-loop /
        // task-run forwarder consumes; clone it out before the handle
        // takes ownership of the session.
        match harness
            .attach_run_at_url(automaton_id, event_stream_url, auth_token, false)
            .await
        {
            Ok(mut session) => {
                let raw_tx = session.raw_events_tx.clone();
                let mut primed = std::mem::take(&mut session.raw_events_rx).into_iter();
                let events_rx = primed.next().unwrap_or_else(|| raw_tx.subscribe());
                let persist_events_rx = primed.next().unwrap_or_else(|| raw_tx.subscribe());
                let handle = WsReaderHandle::from_session(session);
                return Ok((
                    AutomatonEventStream {
                        events_rx,
                        persist_events_rx,
                    },
                    handle,
                ));
            }
            Err(e) => {
                warn!(
                    %automaton_id, attempt,
                    error = %e, "Event stream connection attempt failed"
                );
                if crate::HarnessError::is_capacity_exhausted(&e) {
                    // Don't burn additional attempts on a known
                    // capacity rejection; the 1013 / 503 won't
                    // resolve in the next 500-2000ms.
                    return Err(e);
                }
                last_err = Some(e);
            }
        }
    }
    Err(last_err.unwrap_or_else(|| {
        anyhow::anyhow!("event stream connection failed without recording an error")
    }))
}

#[cfg(test)]
mod tests;
