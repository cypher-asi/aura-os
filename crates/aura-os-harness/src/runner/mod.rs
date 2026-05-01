//! Shared automaton lifecycle runner.
//!
//! Provides [`start_and_connect`] and [`collect_automaton_events`] so both the
//! dev-loop task pipeline and the process executor can reuse the same
//! automaton start -> event-stream -> collection logic without duplication.

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

use crate::{
    AutomatonClient, AutomatonStartError, AutomatonStartParams, AutomatonStartResult,
    WsReaderHandle,
};

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

/// Start an automaton and connect to its event stream with retries.
///
/// `stream_retries` is the number of **additional** attempts after the first;
/// pass `0` for a single attempt, `2` for three total attempts, etc.
///
/// Returns a [`WsReaderHandle`] alongside the broadcast sender; the
/// caller must keep the handle alive for as long as events should flow
/// and drop / cancel it to release the harness's WS slot.
pub async fn start_and_connect(
    client: &AutomatonClient,
    params: AutomatonStartParams,
    stream_retries: u32,
) -> Result<
    (
        AutomatonStartResult,
        broadcast::Sender<serde_json::Value>,
        WsReaderHandle,
    ),
    RunStartError,
> {
    let result = client.start(params).await?;
    let (tx, ws_handle) = connect_with_retries(
        client,
        &result.automaton_id,
        Some(&result.event_stream_url),
        stream_retries,
    )
    .await
    .map_err(|err| RunStartError::Connect {
        attempts: stream_retries + 1,
        message: err.to_string(),
    })?;
    Ok((result, tx, ws_handle))
}

/// Connect to an automaton event stream, retrying on failure.
///
/// `retries` is the number of **additional** attempts after the first.
/// Passing `None` for `event_stream_url` lets the client fall back to its
/// default stream path -- used when adopting an existing automaton whose
/// start-time URL is no longer available (e.g. after recovering from a
/// `Conflict` on restart).
///
/// Returns a [`WsReaderHandle`] alongside the broadcast sender; the
/// caller must keep the handle alive for as long as events should flow
/// and drop / cancel it to release the harness's WS slot.
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
    client: &AutomatonClient,
    automaton_id: &str,
    event_stream_url: Option<&str>,
    retries: u32,
) -> anyhow::Result<(broadcast::Sender<serde_json::Value>, WsReaderHandle)> {
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
        match client
            .connect_event_stream(automaton_id, event_stream_url)
            .await
        {
            Ok(pair) => return Ok(pair),
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
