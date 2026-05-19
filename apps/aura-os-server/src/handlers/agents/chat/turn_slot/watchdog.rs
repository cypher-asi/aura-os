//! Per-turn watchdogs: a first-event timeout that catches cold-start
//! hangs and a sliding-idle timeout that catches long-running but
//! stalled turns. Both synthesize a stamped `HarnessOutbound::Error`
//! event on the broadcast so the SSE client surfaces a real failure
//! instead of waiting on its own idle timer.

use std::sync::Arc;
use std::time::Duration;

use aura_os_harness::{ErrorMsg, HarnessOutbound};
use tokio::sync::broadcast;

use crate::stability_metrics::StabilityMetrics;

/// Watchdog for a single chat turn.
///
/// `first_event_timeout` bounds the cold-start window: if the harness
/// emits no event at all within this duration, we synthesize a
/// `stream_stalled` error so the SSE client surfaces a real failure
/// rather than waiting on its idle timeout.
///
/// `max_turn_idle_timeout` is a **sliding** ceiling: it resets every
/// time a non-terminal event is observed on the broadcast. Only a
/// genuinely quiet window longer than this duration synthesizes a
/// `turn_timeout`. A long Opus turn that keeps streaming text-deltas
/// or tool events will never trip this, but a truly hung session will
/// after the configured idle window elapses with no traffic.
pub(crate) fn spawn_turn_watchdog(
    events_tx: broadcast::Sender<HarnessOutbound>,
    events_rx: broadcast::Receiver<HarnessOutbound>,
    first_event_timeout: Duration,
    max_turn_idle_timeout: Duration,
    metrics: Arc<StabilityMetrics>,
) {
    spawn_turn_watchdog_with_timeouts(
        events_tx,
        events_rx,
        first_event_timeout,
        max_turn_idle_timeout,
        Some(metrics),
    );
}

fn spawn_turn_watchdog_with_timeouts(
    events_tx: broadcast::Sender<HarnessOutbound>,
    mut events_rx: broadcast::Receiver<HarnessOutbound>,
    first_event_timeout: Duration,
    max_turn_idle_timeout: Duration,
    metrics: Option<Arc<StabilityMetrics>>,
) {
    tokio::spawn(async move {
        match tokio::time::timeout(first_event_timeout, events_rx.recv()).await {
            Ok(Ok(HarnessOutbound::AssistantMessageEnd(_)) | Ok(HarnessOutbound::Error(_))) => {
                return;
            }
            Ok(Ok(_)) | Ok(Err(broadcast::error::RecvError::Lagged(_))) => {}
            Ok(Err(broadcast::error::RecvError::Closed)) => return,
            Err(_) => {
                if let Some(m) = metrics.as_ref() {
                    m.inc_stream_stalled();
                }
                let _ = events_tx.send(timeout_error(
                    "stream_stalled",
                    format!(
                        "Remote agent did not emit any stream events within {}s.",
                        first_event_timeout.as_secs()
                    ),
                ));
                return;
            }
        }

        // Sliding ceiling: each non-terminal event resets the per-recv
        // timer. The previous hard `MAX_TURN_TIMEOUT` synthesized a
        // `turn_timeout` on long but actively-progressing turns; now
        // only a quiet window longer than `max_turn_idle_timeout`
        // trips. The Closed arm covers the case where the broadcast
        // is dropped before any terminal event arrives.
        loop {
            match tokio::time::timeout(max_turn_idle_timeout, events_rx.recv()).await {
                Ok(Ok(HarnessOutbound::AssistantMessageEnd(_)))
                | Ok(Ok(HarnessOutbound::Error(_)))
                | Ok(Err(broadcast::error::RecvError::Closed)) => return,
                Ok(Ok(_)) | Ok(Err(broadcast::error::RecvError::Lagged(_))) => continue,
                Err(_) => {
                    if let Some(m) = metrics.as_ref() {
                        m.inc_turn_timeout();
                    }
                    let _ = events_tx.send(timeout_error(
                        "turn_timeout",
                        format!(
                            "Remote agent turn was idle for more than {}s with no progress event.",
                            max_turn_idle_timeout.as_secs()
                        ),
                    ));
                    return;
                }
            }
        }
    });
}

/// Synthesize a watchdog-issued `HarnessOutbound::Error` event with
/// a stamped `support_id` (Phase 3 of agent-stuck-and-reset).
///
/// The synthesized message is suffixed with `(support_id=<id>)` and
/// the same id is emitted on a structured tracing record by
/// [`super::super::errors::stamp_support_id`], so a user pasting the id
/// back into feedback joins straight to the server log line that
/// recorded the synthesis. `code` is one of the stable identifiers
/// (`stream_stalled`, `turn_timeout`) the client classifier already
/// knows. Recoverable from the user's perspective — they can retry
/// the same prompt — so the helper logs at `warn!` not `error!`.
fn timeout_error(code: &str, message: String) -> HarnessOutbound {
    let mut err = ErrorMsg {
        code: code.to_string(),
        message,
        recoverable: true,
        support_id: None,
    };
    let _ = super::super::errors::stamp_support_id(&mut err, code);
    HarnessOutbound::Error(err)
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use aura_os_harness::{ErrorMsg, HarnessOutbound};
    use tokio::sync::broadcast;

    use super::spawn_turn_watchdog_with_timeouts;

    #[tokio::test]
    async fn turn_watchdog_emits_stream_stalled_when_no_first_event_arrives() {
        let (tx, rx) = broadcast::channel::<HarnessOutbound>(8);
        let mut observed = tx.subscribe();

        spawn_turn_watchdog_with_timeouts(
            tx,
            rx,
            Duration::from_millis(10),
            Duration::from_secs(1),
            None,
        );

        let event = tokio::time::timeout(Duration::from_millis(200), observed.recv())
            .await
            .expect("watchdog event timed out")
            .expect("watchdog broadcast");
        assert!(matches!(
            event,
            HarnessOutbound::Error(ErrorMsg { ref code, .. }) if code == "stream_stalled"
        ));
    }

    /// Phase 5 wiring: when a `stream_stalled` synthesis fires, the
    /// watchdog must also bump the
    /// [`crate::stability_metrics::StabilityMetrics::inc_stream_stalled`]
    /// counter. Drives the same first-event timeout as the prior
    /// test, then asserts the snapshot moved by exactly +1 (and that
    /// the unrelated `turn_timeout` counter stayed put).
    #[tokio::test]
    async fn turn_watchdog_increments_stream_stalled_metric_on_first_event_timeout() {
        use crate::stability_metrics::StabilityMetrics;
        use std::sync::Arc as StdArc;

        let metrics = StdArc::new(StabilityMetrics::new());
        let (tx, rx) = broadcast::channel::<HarnessOutbound>(8);
        let mut observed = tx.subscribe();

        spawn_turn_watchdog_with_timeouts(
            tx,
            rx,
            Duration::from_millis(10),
            Duration::from_secs(1),
            Some(StdArc::clone(&metrics)),
        );

        let event = tokio::time::timeout(Duration::from_millis(200), observed.recv())
            .await
            .expect("watchdog event timed out")
            .expect("watchdog broadcast");
        assert!(matches!(
            event,
            HarnessOutbound::Error(ErrorMsg { ref code, .. }) if code == "stream_stalled"
        ));

        let snapshot = metrics.snapshot();
        assert_eq!(snapshot.stream_stalled, 1, "stalled counter must advance");
        assert_eq!(
            snapshot.turn_timeout, 0,
            "turn_timeout must not advance on first-event stall"
        );
    }

    /// Phase 5 wiring: when the sliding-idle watchdog synthesizes a
    /// `turn_timeout`, it must bump the
    /// [`crate::stability_metrics::StabilityMetrics::inc_turn_timeout`]
    /// counter. Drives the same idle-exceeded scenario as the prior
    /// test, then asserts the snapshot reflects exactly +1 on the
    /// `turn_timeout` counter (and `stream_stalled` is unaffected).
    #[tokio::test]
    async fn turn_watchdog_increments_turn_timeout_metric_on_idle_exceeded() {
        use crate::stability_metrics::StabilityMetrics;
        use std::sync::Arc as StdArc;

        let metrics = StdArc::new(StabilityMetrics::new());
        let (tx, rx) = broadcast::channel::<HarnessOutbound>(8);
        let mut observed = tx.subscribe();

        spawn_turn_watchdog_with_timeouts(
            tx.clone(),
            rx,
            Duration::from_secs(1),
            Duration::from_millis(10),
            Some(StdArc::clone(&metrics)),
        );
        tx.send(HarnessOutbound::TextDelta(aura_os_harness::TextDelta {
            text: "working".to_string(),
        }))
        .expect("seed nonterminal event");

        let mut saw_timeout = false;
        for _ in 0..2 {
            let event = tokio::time::timeout(Duration::from_millis(200), observed.recv())
                .await
                .expect("watchdog event timed out")
                .expect("watchdog broadcast");
            if matches!(
                event,
                HarnessOutbound::Error(ErrorMsg { ref code, .. }) if code == "turn_timeout"
            ) {
                saw_timeout = true;
                break;
            }
        }
        assert!(saw_timeout, "watchdog must emit turn_timeout");

        let snapshot = metrics.snapshot();
        assert_eq!(
            snapshot.turn_timeout, 1,
            "turn_timeout counter must advance"
        );
        assert_eq!(
            snapshot.stream_stalled, 0,
            "stream_stalled must not advance on sliding-idle timeout"
        );
    }

    /// Sliding-idle watchdog: a single non-terminal event lifts the
    /// watchdog out of `first_event_timeout` into the per-recv idle
    /// loop. With no further traffic, the idle window must trip the
    /// `turn_timeout` synth — pinning the behaviour for the
    /// genuinely-hung case after the Phase-1 sliding rewrite.
    #[tokio::test]
    async fn turn_watchdog_emits_turn_timeout_when_idle_exceeded() {
        let (tx, rx) = broadcast::channel::<HarnessOutbound>(8);
        let mut observed = tx.subscribe();

        spawn_turn_watchdog_with_timeouts(
            tx.clone(),
            rx,
            Duration::from_secs(1),
            Duration::from_millis(10),
            None,
        );
        tx.send(HarnessOutbound::TextDelta(aura_os_harness::TextDelta {
            text: "working".to_string(),
        }))
        .expect("seed nonterminal event");

        let mut saw_timeout = false;
        for _ in 0..2 {
            let event = tokio::time::timeout(Duration::from_millis(200), observed.recv())
                .await
                .expect("watchdog event timed out")
                .expect("watchdog broadcast");
            if matches!(
                event,
                HarnessOutbound::Error(ErrorMsg { ref code, .. }) if code == "turn_timeout"
            ) {
                saw_timeout = true;
                break;
            }
        }
        assert!(saw_timeout, "watchdog must emit turn_timeout");
    }

    /// Sliding-idle regression guard for Phase 1.1: the watchdog must
    /// keep the per-recv idle timer ticking against the most recent
    /// event, not against the wall-clock start of the turn. Periodic
    /// non-terminal events arriving at `idle / 2` cadence for `idle *
    /// 3` of wall-clock time must NOT synthesize a `turn_timeout`.
    #[tokio::test]
    async fn turn_watchdog_sliding_idle_resets_on_periodic_events() {
        let (tx, rx) = broadcast::channel::<HarnessOutbound>(64);
        let mut observed = tx.subscribe();

        let idle = Duration::from_millis(200);
        let interval = idle / 2;
        let total = idle * 3;

        spawn_turn_watchdog_with_timeouts(tx.clone(), rx, Duration::from_secs(5), idle, None);

        // Seed traffic at idle/2 cadence for idle*3 wall-clock seconds.
        // Each send must arrive on the broadcast inside the watchdog's
        // current idle window, resetting its timer.
        let started = std::time::Instant::now();
        let mut tick = 0usize;
        while started.elapsed() < total {
            tx.send(HarnessOutbound::TextDelta(aura_os_harness::TextDelta {
                text: format!("tick-{tick}"),
            }))
            .expect("seed sliding delta");
            tick += 1;
            tokio::time::sleep(interval).await;
        }
        assert!(
            tick >= 4,
            "test must emit enough deltas to outlast a non-sliding window (sent {tick})"
        );

        // Drain whatever observed picked up. We DO NOT close the
        // watchdog yet — if the sliding clock was broken, a
        // `turn_timeout` Error would already be sitting in the
        // broadcast.
        loop {
            match tokio::time::timeout(Duration::from_millis(10), observed.recv()).await {
                Ok(Ok(event)) => {
                    assert!(
                        !matches!(
                            event,
                            HarnessOutbound::Error(ErrorMsg { ref code, .. })
                                if code == "turn_timeout"
                        ),
                        "sliding watchdog must not emit turn_timeout while periodic events arrive"
                    );
                }
                Ok(Err(_)) | Err(_) => break,
            }
        }
    }

    /// Phase 3: every server-synthesized SSE-bound `ErrorMsg` carries
    /// a `support_id=<id>` suffix. Drives the same first-event
    /// timeout as `turn_watchdog_emits_stream_stalled_when_no_first_event_arrives`
    /// then asserts the suffix is present on the synthesized message
    /// and the canonical machine code (`stream_stalled`) is preserved.
    #[tokio::test]
    async fn turn_watchdog_stamps_support_id_in_stream_stalled_message() {
        let (tx, rx) = broadcast::channel::<HarnessOutbound>(8);
        let mut observed = tx.subscribe();

        spawn_turn_watchdog_with_timeouts(
            tx,
            rx,
            Duration::from_millis(10),
            Duration::from_secs(1),
            None,
        );

        let event = tokio::time::timeout(Duration::from_millis(200), observed.recv())
            .await
            .expect("watchdog event timed out")
            .expect("watchdog broadcast");
        let err = match event {
            HarnessOutbound::Error(err) => err,
            other => panic!("expected Error event, got {other:?}"),
        };
        assert_eq!(
            err.code, "stream_stalled",
            "stable machine code must remain `stream_stalled`"
        );
        assert!(
            err.message.contains("(support_id="),
            "synthesized stream_stalled message must carry a support_id suffix, got: {}",
            err.message
        );
        assert!(
            err.recoverable,
            "stream_stalled is recoverable from the user's perspective"
        );
    }

    /// Phase 3 (continued): the sliding-idle synthesis also stamps a
    /// support_id, so a user who sees a `turn_timeout` can paste the
    /// id back into feedback. Exercises the same idle-exceeded path
    /// as `turn_watchdog_emits_turn_timeout_when_idle_exceeded`.
    #[tokio::test]
    async fn turn_watchdog_stamps_support_id_in_turn_timeout_message() {
        let (tx, rx) = broadcast::channel::<HarnessOutbound>(8);
        let mut observed = tx.subscribe();

        spawn_turn_watchdog_with_timeouts(
            tx.clone(),
            rx,
            Duration::from_secs(1),
            Duration::from_millis(10),
            None,
        );
        tx.send(HarnessOutbound::TextDelta(aura_os_harness::TextDelta {
            text: "working".to_string(),
        }))
        .expect("seed nonterminal event");

        let mut stamped = None;
        for _ in 0..2 {
            let event = tokio::time::timeout(Duration::from_millis(200), observed.recv())
                .await
                .expect("watchdog event timed out")
                .expect("watchdog broadcast");
            if let HarnessOutbound::Error(err) = event {
                if err.code == "turn_timeout" {
                    stamped = Some(err);
                    break;
                }
            }
        }
        let err = stamped.expect("watchdog must emit turn_timeout");
        assert!(
            err.message.contains("(support_id="),
            "synthesized turn_timeout message must carry a support_id suffix, got: {}",
            err.message
        );
    }

    /// Phase 3: `tool_heartbeat_interval` reads the env-driven knob
    /// once, falls back to [`super::super::config::DEFAULT_TOOL_HEARTBEAT_INTERVAL_SECS`]
    /// when the env is unset, and clamps the value to its
    /// `[MIN, MAX]` bounds. The test process never sets the
    /// override, so the public accessor must observe exactly the
    /// documented default.
    #[tokio::test]
    async fn tool_heartbeat_interval_defaults_when_env_unset() {
        use super::super::config::{tool_heartbeat_interval, DEFAULT_TOOL_HEARTBEAT_INTERVAL_SECS};
        assert_eq!(
            tool_heartbeat_interval(),
            Duration::from_secs(DEFAULT_TOOL_HEARTBEAT_INTERVAL_SECS),
            "tool_heartbeat_interval must default to DEFAULT_TOOL_HEARTBEAT_INTERVAL_SECS \
             without an env override"
        );
    }
}
