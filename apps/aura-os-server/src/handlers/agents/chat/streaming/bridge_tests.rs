//! Regression tests for `harness_broadcast_to_sse` and the
//! `LaggedProgressThrottle`. Kept in a sibling file because the
//! combined code + tests for the bridge exceeds the 500-line cap.

use std::time::{Duration, Instant};

use aura_os_harness::{
    AssistantMessageEnd, ErrorMsg, FilesChanged, HarnessOutbound, SessionUsage, TextDelta,
};
use futures_util::StreamExt;
use tokio::sync::broadcast;

use super::bridge::{
    harness_broadcast_to_sse, LaggedProgressThrottle, LAGGED_PROGRESS_INTERVAL,
    SSE_HEARTBEAT_INTERVAL,
};

fn end_event() -> HarnessOutbound {
    HarnessOutbound::AssistantMessageEnd(AssistantMessageEnd {
        message_id: "msg-1".into(),
        stop_reason: "stop".into(),
        usage: SessionUsage::default(),
        files_changed: FilesChanged::default(),
        originating_user_id: None,
    })
}

fn text_delta(text: &str) -> HarnessOutbound {
    HarnessOutbound::TextDelta(TextDelta {
        text: text.to_string(),
    })
}

fn dump(event: &axum::response::sse::Event) -> String {
    // Event has a derived Debug impl that reveals the underlying
    // BytesMut buffer (the raw `event: ...\ndata: ...\n` SSE wire
    // bytes), which is the only way to inspect a constructed Event
    // without going through the IntoResponse path.
    format!("{:?}", event)
}

/// Phase 1.2 regression guard: a `broadcast::RecvError::Lagged`
/// observed by `harness_broadcast_to_sse` must NOT close the SSE
/// stream — it must emit a synthetic `progress: lagged` event and
/// keep reading subsequent broadcast events. The previous
/// terminal `error: stream_lagged` killed the live turn whenever
/// a slow consumer fell behind; now backpressure is a transient
/// hint and the assistant turn streams to completion.
#[tokio::test]
async fn harness_broadcast_to_sse_lagged_emits_progress_and_keeps_streaming() {
    // Capacity 2: send three text deltas before reading so the
    // receiver lags by at least one event on its next recv. After
    // the synthetic progress event, the bridge must forward the
    // remaining events that survived eviction (e.g. the most
    // recent text delta and the terminal end).
    let (tx, rx) = broadcast::channel::<HarnessOutbound>(2);
    tx.send(text_delta("first")).expect("seed first delta");
    tx.send(text_delta("second")).expect("seed second delta");
    tx.send(text_delta("third")).expect("seed third delta");
    tx.send(end_event()).expect("seed end");
    drop(tx);

    let stream = harness_broadcast_to_sse(rx, None);
    tokio::pin!(stream);

    let first = tokio::time::timeout(Duration::from_millis(200), stream.next())
        .await
        .expect("lagged progress event in time")
        .expect("first event")
        .expect("ok");
    let first_body = dump(&first);
    assert!(
        first_body.contains("event: progress"),
        "first event must be a progress SSE event, got: {first_body}"
    );
    assert!(
        first_body.contains("lagged"),
        "first event must carry the lagged stage, got: {first_body}"
    );
    assert!(
        !first_body.contains("event: error"),
        "lagged path must NOT surface an error SSE event, got: {first_body}"
    );

    // The stream must NOT terminate after a lagged event. Drain a
    // few more items and ensure at least one is a forwarded
    // broadcast event (text_delta with a payload). The end event
    // terminates the stream cleanly via `should_close=true`.
    let mut saw_post_lag_forward = false;
    let mut saw_terminal = false;
    for _ in 0..3 {
        let next = match tokio::time::timeout(Duration::from_millis(200), stream.next()).await {
            Ok(Some(Ok(evt))) => evt,
            Ok(Some(Err(_))) | Ok(None) => break,
            Err(_) => break,
        };
        let body = dump(&next);
        if body.contains("event: text_delta") {
            saw_post_lag_forward = true;
        }
        if body.contains("event: assistant_message_end") {
            saw_terminal = true;
            break;
        }
    }
    assert!(
        saw_post_lag_forward,
        "stream must forward a subsequent text_delta after the lagged progress event"
    );
    assert!(
        saw_terminal,
        "stream must still reach the terminal assistant_message_end event"
    );
}

#[tokio::test]
async fn harness_broadcast_to_sse_closed_after_content_emits_stream_truncated() {
    let (tx, rx) = broadcast::channel::<HarnessOutbound>(8);
    tx.send(text_delta("partial")).expect("seed text delta");
    drop(tx);

    let stream = harness_broadcast_to_sse(rx, None);
    tokio::pin!(stream);

    let first = tokio::time::timeout(Duration::from_millis(200), stream.next())
        .await
        .expect("forwarded text in time")
        .expect("first event")
        .expect("ok");
    assert!(
        dump(&first).contains("partial"),
        "first event must forward the content before synthetic terminal"
    );

    let second = tokio::time::timeout(Duration::from_millis(200), stream.next())
        .await
        .expect("synthetic error in time")
        .expect("second event")
        .expect("ok");
    let body = dump(&second);
    assert!(
        body.contains("event: error"),
        "closed-after-content must emit an error SSE event, got: {body}"
    );
    assert!(
        body.contains("stream_truncated"),
        "synthetic error must carry stream_truncated code, got: {body}"
    );
    assert!(
        body.contains("recoverable"),
        "synthetic error must preserve recoverable payload shape, got: {body}"
    );

    let next = tokio::time::timeout(Duration::from_millis(100), stream.next()).await;
    assert!(
        matches!(next, Ok(None)),
        "stream must close after synthetic stream_truncated event, got: {next:?}"
    );
}

#[tokio::test]
async fn harness_broadcast_to_sse_closed_before_content_emits_nothing() {
    let (tx, rx) = broadcast::channel::<HarnessOutbound>(8);
    drop(tx);

    let stream = harness_broadcast_to_sse(rx, None);
    tokio::pin!(stream);

    let next = tokio::time::timeout(Duration::from_millis(100), stream.next()).await;
    assert!(
        matches!(next, Ok(None)),
        "closed before content must remain silent, got: {next:?}"
    );
}

#[tokio::test]
async fn harness_broadcast_to_sse_closed_after_terminal_does_not_emit_stream_truncated() {
    let (tx, rx) = broadcast::channel::<HarnessOutbound>(8);
    tx.send(text_delta("complete")).expect("seed text delta");
    tx.send(end_event()).expect("seed end");
    drop(tx);

    let stream = harness_broadcast_to_sse(rx, None);
    tokio::pin!(stream);

    let first = stream
        .next()
        .await
        .expect("text delta")
        .expect("first item is Ok");
    assert!(
        dump(&first).contains("complete"),
        "first event must forward content"
    );

    let second = stream
        .next()
        .await
        .expect("terminal end")
        .expect("second item is Ok");
    let terminal = dump(&second);
    assert!(
        terminal.contains("assistant_message_end"),
        "second event must be the real terminal, got: {terminal}"
    );
    assert!(
        !terminal.contains("stream_truncated"),
        "real terminal must not be replaced by synthetic error, got: {terminal}"
    );

    let next = tokio::time::timeout(Duration::from_millis(100), stream.next()).await;
    assert!(
        matches!(next, Ok(None)),
        "stream must close cleanly after real terminal, got: {next:?}"
    );
}

/// Stuck-stream fix: while the harness broadcast is silent —
/// e.g. a plan-mode chat turn between a batch of `ToolResult`
/// events and the model's next `TextDelta` — the SSE bridge
/// must synthesize `progress { stage: "heartbeat" }` frames at
/// least every [`SSE_HEARTBEAT_INTERVAL`] so the frontend's
/// stuck-stream watchdog (`STUCK_THRESHOLD_MS = 30s` /
/// `FULLY_TIMED_OUT_MS = 60s` in
/// `interface/src/hooks/stream/use-stream-health.ts`) sees
/// forward motion. Driven on paused tokio time so the assertion
/// is deterministic and the test stays sub-millisecond.
#[tokio::test(start_paused = true)]
async fn harness_broadcast_to_sse_emits_heartbeat_when_broadcast_is_silent() {
    let (tx, rx) = broadcast::channel::<HarnessOutbound>(8);

    let stream = harness_broadcast_to_sse(rx, None);
    tokio::pin!(stream);

    // Cross the heartbeat boundary by advancing virtual time.
    // tokio::time::advance fires expired timers before yielding,
    // so the next stream poll sees the timeout already elapsed.
    tokio::time::advance(SSE_HEARTBEAT_INTERVAL + Duration::from_millis(100)).await;

    let first = stream
        .next()
        .await
        .expect("heartbeat event")
        .expect("first item is Ok");
    let body = dump(&first);
    assert!(
        body.contains("event: progress"),
        "first event must be a progress SSE event, got: {body}",
    );
    assert!(
        body.contains("heartbeat"),
        "first event must carry stage=heartbeat, got: {body}",
    );

    // After the heartbeat the stream must still be alive and
    // forward a real event the moment one lands. Send a text
    // delta on the broadcast and confirm it surfaces without
    // another heartbeat-interval wait.
    tx.send(text_delta("after-heartbeat"))
        .expect("seed text delta");
    let next = stream
        .next()
        .await
        .expect("forwarded text delta")
        .expect("ok");
    assert!(
        dump(&next).contains("after-heartbeat"),
        "post-heartbeat broadcast must still reach the SSE stream",
    );

    // And a terminal event closes the stream cleanly — heartbeats
    // never mark the unfold state `done`, so the terminal path
    // still runs unchanged.
    tx.send(end_event()).expect("seed terminal end");
    let terminal = stream.next().await.expect("terminal end").expect("ok");
    assert!(
        dump(&terminal).contains("assistant_message_end"),
        "terminal event must follow without being shadowed by a heartbeat",
    );

    let after_terminal = stream.next().await;
    assert!(
        after_terminal.is_none(),
        "stream must close after the terminal event, got: {after_terminal:?}",
    );
}

/// Heartbeat path must NOT fire when real broadcast events keep
/// arriving inside the interval. Drives a steady text-delta
/// cadence at half the heartbeat interval for three intervals'
/// worth of wall-clock time and asserts every emitted SSE event
/// is a real `text_delta` — no heartbeat frames slipped in.
#[tokio::test(start_paused = true)]
async fn harness_broadcast_to_sse_skips_heartbeat_while_events_flow() {
    let (tx, rx) = broadcast::channel::<HarnessOutbound>(64);

    let stream = harness_broadcast_to_sse(rx, None);
    tokio::pin!(stream);

    let cadence = SSE_HEARTBEAT_INTERVAL / 2;
    let bursts = 3usize;
    for i in 0..bursts {
        tx.send(text_delta(&format!("tick-{i}")))
            .expect("seed delta");
        let event = stream.next().await.expect("forwarded delta").expect("ok");
        let body = dump(&event);
        assert!(
            body.contains(&format!("tick-{i}")),
            "delta `tick-{i}` must surface as the next event, got: {body}",
        );
        assert!(
            !body.contains("heartbeat"),
            "no heartbeat must slip in while broadcast traffic flows, got: {body}",
        );
        tokio::time::advance(cadence).await;
    }

    tx.send(end_event()).expect("seed terminal");
    let terminal = stream.next().await.expect("terminal").expect("ok");
    assert!(
        dump(&terminal).contains("assistant_message_end"),
        "terminal event must close out the stream"
    );
}

#[test]
fn lagged_progress_throttle_suppresses_within_interval_and_accumulates() {
    let mut throttle = LaggedProgressThrottle::default();
    let start = Instant::now();

    assert_eq!(
        throttle.observe(2, start),
        Some(2),
        "first lagged observation should emit immediately"
    );
    assert_eq!(
        throttle.observe(3, start + Duration::from_millis(250)),
        None,
        "second lagged observation inside the throttle interval should suppress"
    );
    assert_eq!(
        throttle.observe(5, start + Duration::from_millis(500)),
        None,
        "additional lagged observations inside the interval should suppress"
    );
    assert_eq!(
        throttle.observe(7, start + LAGGED_PROGRESS_INTERVAL),
        Some(15),
        "next emitted progress should include accumulated skipped counts"
    );
}

/// Phase 5 wiring guard: the new non-terminal `Lagged` arm of
/// `harness_broadcast_to_sse` must bump
/// [`crate::stability_metrics::StabilityMetrics::inc_stream_lagged`]
/// every time it synthesizes a `progress: lagged` event. Mirrors
/// the existing `harness_broadcast_to_sse_lagged_emits_progress_*`
/// regression but additionally pins the metrics-side wiring so a
/// future refactor can't silently regress to "log + emit but
/// counter never moves".
#[tokio::test]
async fn harness_broadcast_to_sse_lagged_increments_metric() {
    use crate::stability_metrics::StabilityMetrics;
    use std::sync::Arc as StdArc;

    let metrics = StdArc::new(StabilityMetrics::new());
    let (tx, rx) = broadcast::channel::<HarnessOutbound>(2);
    tx.send(text_delta("first")).expect("seed first delta");
    tx.send(text_delta("second")).expect("seed second delta");
    tx.send(text_delta("third")).expect("seed third delta");
    tx.send(end_event()).expect("seed end");
    drop(tx);

    let stream = harness_broadcast_to_sse(rx, Some(StdArc::clone(&metrics)));
    tokio::pin!(stream);
    // Drain to completion so the Lagged arm is definitely hit.
    while tokio::time::timeout(Duration::from_millis(200), stream.next())
        .await
        .ok()
        .flatten()
        .is_some()
    {}

    let snapshot = metrics.snapshot();
    assert!(
        snapshot.stream_lagged >= 1,
        "Lagged arm must bump stream_lagged at least once, got snapshot={snapshot:?}"
    );
}

/// Phase-5 regression guard for the in-stream busy remap.
///
/// `harness_broadcast_to_sse` must intercept any
/// `HarnessOutbound::Error { code: "turn_in_progress", … }` it
/// observes mid-stream and surface a clean `agent_busy` SSE
/// `error` event, so the frontend never has to string-match the
/// raw harness wording. Phase 2 added the
/// `remap_harness_error_to_sse` helper and the in-bridge call
/// site; this test pins the end-to-end behavior of the bridge
/// itself: feed a raw `turn_in_progress` error in, get a
/// canonical `agent_busy` event out and the stream closes.
#[tokio::test]
async fn harness_turn_in_progress_remapped_to_agent_busy_sse_event() {
    let (tx, rx) = broadcast::channel::<HarnessOutbound>(8);
    tx.send(HarnessOutbound::Error(ErrorMsg {
        code: "turn_in_progress".into(),
        message: "A turn is currently in progress; send cancel first".into(),
        recoverable: true,
        support_id: None,
    }))
    .expect("seed turn_in_progress error");
    drop(tx);

    let stream = harness_broadcast_to_sse(rx, None);
    tokio::pin!(stream);
    let first = tokio::time::timeout(Duration::from_secs(1), stream.next())
        .await
        .expect("event in time")
        .expect("first event")
        .expect("ok");
    let body = dump(&first);
    assert!(
        body.contains("agent_busy"),
        "remapped event must surface the structured `agent_busy` code, got: {body}"
    );
    assert!(
        !body
            .to_ascii_lowercase()
            .contains("turn is currently in progress")
            && !body.contains("turn_in_progress"),
        "remapped event must NOT leak the raw harness wording, got: {body}"
    );

    let next = tokio::time::timeout(Duration::from_millis(100), stream.next()).await;
    assert!(
        matches!(next, Ok(None)),
        "stream must close after the remapped error event, got: {next:?}"
    );
}
