//! Harness broadcast → SSE bridge. Drains a
//! `broadcast::Receiver<HarnessOutbound>` into the SSE wire format,
//! handling backpressure (`Lagged`), broadcast close, and synthetic
//! heartbeats so the client-side stuck-stream watchdog never trips
//! on a legitimately quiet turn.

use std::convert::Infallible;
use std::sync::Arc;
use std::time::{Duration, Instant};

use aura_os_harness::{ErrorMsg, HarnessOutbound};
use axum::response::sse::Event;
use futures_util::stream;
use tracing::warn;

use crate::stability_metrics::StabilityMetrics;

use super::super::errors::remap_harness_error_to_sse;

pub(super) const LAGGED_PROGRESS_INTERVAL: Duration = Duration::from_secs(1);

/// Interval between synthetic `progress { stage: "heartbeat" }` SSE
/// frames emitted while the harness broadcast is silent.
///
/// Plumbs through to the frontend stuck-stream watchdog: every wire
/// event bumps `lastEventAt` on the Zustand stream store
/// (`interface/src/hooks/stream/store.ts`), and the watchdog
/// (`useStreamHealth`) flips `isStuck` true at `STUCK_THRESHOLD_MS`
/// (30s) and auto-aborts the turn at `FULLY_TIMED_OUT_MS` (60s).
/// Without these heartbeats, a tool-heavy chat turn that legitimately
/// pauses between a batch of `ToolResult` events and the model's
/// next `TextDelta` / `ThinkingDelta` (e.g. plan-mode translating
/// five `get_spec` results into a long German answer) leaves the SSE
/// wire silent for >60s and trips the watchdog even though the
/// upstream is healthy and progressing.
///
/// Sized comfortably under the 30s warn threshold so even a dropped
/// tick (network jitter, slow scheduler) lands the next heartbeat
/// before the watchdog flips. Mirrors the
/// `GENERATION_HEARTBEAT_INTERVAL` used by the image / video / 3D
/// generation handlers and the same client-side
/// `markStreamProgress` plumbing handles both.
pub(crate) const SSE_HEARTBEAT_INTERVAL: Duration = Duration::from_secs(15);

pub(super) struct HarnessSseState {
    rx: tokio::sync::broadcast::Receiver<HarnessOutbound>,
    done: bool,
    metrics: Option<Arc<StabilityMetrics>>,
    saw_content: bool,
    saw_terminal: bool,
    lagged_throttle: LaggedProgressThrottle,
}

impl HarnessSseState {
    fn new(
        rx: tokio::sync::broadcast::Receiver<HarnessOutbound>,
        metrics: Option<Arc<StabilityMetrics>>,
    ) -> Self {
        Self {
            rx,
            done: false,
            metrics,
            saw_content: false,
            saw_terminal: false,
            lagged_throttle: LaggedProgressThrottle::default(),
        }
    }
}

#[derive(Default)]
pub(super) struct LaggedProgressThrottle {
    last_lagged_progress_at: Option<Instant>,
    pending_lagged_skipped: u64,
}

impl LaggedProgressThrottle {
    pub(super) fn observe(&mut self, skipped: u64, now: Instant) -> Option<u64> {
        let should_emit = self
            .last_lagged_progress_at
            .map(|last| now.duration_since(last) >= LAGGED_PROGRESS_INTERVAL)
            .unwrap_or(true);

        if should_emit {
            let total = skipped.saturating_add(self.pending_lagged_skipped);
            self.pending_lagged_skipped = 0;
            self.last_lagged_progress_at = Some(now);
            Some(total)
        } else {
            self.pending_lagged_skipped = self.pending_lagged_skipped.saturating_add(skipped);
            None
        }
    }
}

fn is_terminal_harness_event(evt: &HarnessOutbound) -> bool {
    matches!(
        evt,
        HarnessOutbound::AssistantMessageEnd(_) | HarnessOutbound::Error(_)
    )
}

fn is_content_bearing_harness_event(evt: &HarnessOutbound) -> bool {
    matches!(
        evt,
        HarnessOutbound::AssistantMessageStart(_)
            | HarnessOutbound::TextDelta(_)
            | HarnessOutbound::ThinkingDelta(_)
            | HarnessOutbound::ToolUseStart(_)
            | HarnessOutbound::ToolResult(_)
            | HarnessOutbound::ToolCallSnapshot(_)
            | HarnessOutbound::ToolApprovalPrompt(_)
            | HarnessOutbound::GenerationStart(_)
            | HarnessOutbound::GenerationProgress(_)
            | HarnessOutbound::GenerationPartialImage(_)
    )
}

fn stream_truncated_error_event() -> Result<Event, Infallible> {
    let err = ErrorMsg {
        code: "stream_truncated".to_string(),
        message: "Agent stream ended before the turn completed. Retrying will recover the latest saved output from history.".to_string(),
        recoverable: true,
        support_id: None,
    };
    let normalized = HarnessOutbound::Error(remap_harness_error_to_sse(&err));
    super::super::super::super::sse::harness_event_to_sse(&normalized)
}

fn lagged_progress_event(skipped: u64) -> Result<Event, Infallible> {
    let payload = serde_json::json!({
        "type": "progress",
        "stage": "lagged",
        "skipped": skipped,
        "message": "Catching up...",
    });
    Ok(Event::default()
        .event("progress")
        .json_data(&payload)
        .unwrap_or_else(|_| {
            Event::default()
                .event("progress")
                .data("{\"type\":\"progress\",\"stage\":\"lagged\"}")
        }))
}

/// Synthetic `progress { stage: "heartbeat" }` SSE frame emitted when
/// the harness broadcast stays silent past
/// [`SSE_HEARTBEAT_INTERVAL`]. The client treats this stage as a
/// pure watchdog ack — see the `stage === "heartbeat"` branches in
/// `interface/src/hooks/use-chat-stream/build-stream-handler.ts` and
/// `interface/src/hooks/use-agent-chat-stream.ts`, which call
/// `markStreamProgress` without touching the visible progress label.
fn heartbeat_progress_event() -> Result<Event, Infallible> {
    let payload = serde_json::json!({
        "type": "progress",
        "stage": "heartbeat",
    });
    Ok(Event::default()
        .event("progress")
        .json_data(&payload)
        .unwrap_or_else(|_| {
            Event::default()
                .event("progress")
                .data("{\"type\":\"progress\",\"stage\":\"heartbeat\"}")
        }))
}

/// Bridge a harness broadcast receiver into the SSE wire format.
///
/// `metrics`, when `Some`, is bumped on the non-terminal `Lagged` arm
/// — Phase 5 wiring so the operator-visible `stream_lagged` counter
/// reflects every "consumer fell behind" event. Tests pass `None`
/// because the existing `harness_broadcast_to_sse_lagged_emits_*`
/// regressions only assert the SSE shape; the dedicated
/// `harness_broadcast_to_sse_lagged_increments_metric` test below
/// exercises the metrics path.
pub fn harness_broadcast_to_sse(
    rx: tokio::sync::broadcast::Receiver<HarnessOutbound>,
    metrics: Option<Arc<StabilityMetrics>>,
) -> impl futures_core::Stream<Item = Result<Event, Infallible>> + Send {
    stream::unfold(HarnessSseState::new(rx, metrics), |mut state| async move {
        if state.done {
            return None;
        }

        loop {
            match tokio::time::timeout(SSE_HEARTBEAT_INTERVAL, state.rx.recv()).await {
                // Heartbeat path: no harness event arrived inside the
                // interval, so emit a synthetic `progress: heartbeat`
                // frame to keep the client's stuck-stream watchdog
                // clock from tripping on a turn that is genuinely
                // working but happens to be quiet on the wire (e.g.
                // model thinking between a batch of tool results and
                // the next text-delta). Don't touch `saw_content` /
                // `saw_terminal` / `done` — heartbeats are neither
                // content nor terminal events.
                Err(_elapsed) => {
                    return Some((heartbeat_progress_event(), state));
                }
                Ok(Ok(evt)) => {
                    let should_close = is_terminal_harness_event(&evt);
                    state.saw_content |= is_content_bearing_harness_event(&evt);
                    state.saw_terminal |= should_close;
                    state.done = should_close;
                    // Phase 3 of agent-stuck-and-reset: every SSE-bound
                    // error goes through `remap_harness_error_to_sse`,
                    // which (a) intercepts the harness "turn already in
                    // progress" error mid-stream and rewrites it to the
                    // structured `agent_busy` code, and (b) stamps every
                    // forwarded error — busy or not — with a fresh
                    // `support_id=<id>` suffix so users can paste the id
                    // back into feedback and support can grep server
                    // logs immediately. The error still closes the SSE
                    // stream — `should_close` above already covers
                    // `Error(_)` regardless of remap outcome.
                    let normalized = match evt {
                        HarnessOutbound::Error(err) => {
                            HarnessOutbound::Error(remap_harness_error_to_sse(&err))
                        }
                        other => other,
                    };
                    let event = super::super::super::super::sse::harness_event_to_sse(&normalized);
                    return Some((event, state));
                }
                // The harness broadcast channel evicted `n` events before we
                // could read them — typically because heavy text-delta + large
                // tool-result traffic outran the SSE writer.
                //
                // Phase 1.2 of the agent-stream reliability plan demotes this
                // from a terminal SSE `error` (which closed the stream and
                // showed the user a red banner) to a transient
                // `progress: lagged` hint. The parallel `chat_persist_task`
                // already drains through lag, so the post-stream history
                // refetch will repaint the full assistant turn from storage;
                // there is no reliability reason to kill the live stream.
                // Phase 4 throttles those hints to avoid adding excessive
                // writes while the SSE path is already backpressured.
                Ok(Err(tokio::sync::broadcast::error::RecvError::Lagged(n))) => {
                    if let Some(m) = state.metrics.as_ref() {
                        m.inc_stream_lagged();
                    }
                    if let Some(skipped) = state.lagged_throttle.observe(n, Instant::now()) {
                        warn!(
                            skipped,
                            "harness_broadcast_to_sse: receiver lagged; emitting throttled progress:lagged and continuing"
                        );
                        return Some((lagged_progress_event(skipped), state));
                    }
                    warn!(
                        skipped = n,
                        pending_skipped = state.lagged_throttle.pending_lagged_skipped,
                        "harness_broadcast_to_sse: receiver lagged; suppressing throttled progress:lagged"
                    );
                }
                Ok(Err(tokio::sync::broadcast::error::RecvError::Closed)) => {
                    if state.saw_content && !state.saw_terminal {
                        warn!(
                            "harness_broadcast_to_sse: broadcast closed after content without terminal event; emitting stream_truncated"
                        );
                        state.saw_terminal = true;
                        state.done = true;
                        return Some((stream_truncated_error_event(), state));
                    }
                    return None;
                }
            }
        }
    })
}
