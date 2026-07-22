//! Bridge between the harness WebSocket and the in-process broadcast
//! channels used by aura-os-server. The broadcast capacity for both
//! outbound (typed) and raw harness events is controlled by
//! `AURA_HARNESS_BROADCAST_CAPACITY` (default
//! [`DEFAULT_BROADCAST_CAPACITY`]). Raising it reduces the chance
//! that a slow SSE consumer falls behind on tool-heavy turns and
//! triggers a `broadcast::RecvError::Lagged` — which Phase 1.2 of
//! the agent-stream reliability plan now surfaces as a
//! `progress: lagged` SSE hint rather than a terminal error, but is
//! still preferable to avoid entirely on heavy turns.

use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::sync::{broadcast, mpsc};
use tokio_tungstenite::tungstenite::Message as WsMessage;
use tracing::{debug, info, warn};

use aura_protocol::{AutomatonEvent, ErrorMsg, InboundMessage, OutboundMessage, ProgressMsg};

use crate::stability_metrics;

const WS_COMMAND_BUFFER: usize = 1024;
const WS_DEBUG_PAYLOAD_LIMIT: usize = 256;

/// Default cadence of the bridge's outbound WebSocket keepalive ping.
///
/// tokio-tungstenite does NOT send pings on its own, so a long chat
/// session with quiet stretches (the model thinking on a large context,
/// or the user reading) would let an intermediary NAT / load balancer /
/// proxy silently reap the idle TCP socket — surfacing on the next read
/// as `Connection reset by peer (os error 104)` and a terminal
/// `harness_ws_read_error`. A periodic Ping keeps the path warm. The
/// peer's Pong is auto-handled by tungstenite on read; we only originate
/// the Ping.
const DEFAULT_WS_PING_SECS: u64 = 20;

/// Env var overriding [`DEFAULT_WS_PING_SECS`]. A value of `0` disables
/// the keepalive ping entirely; any other parse failure falls back to
/// the default.
const WS_PING_SECS_ENV: &str = "AURA_HARNESS_WS_PING_SECS";

/// Resolve the keepalive ping interval. `None` means "no keepalive"
/// (explicit `AURA_HARNESS_WS_PING_SECS=0`).
fn read_ws_ping_interval_from_env() -> Option<Duration> {
    parse_ws_ping_interval(std::env::var(WS_PING_SECS_ENV).ok().as_deref())
}

/// Pure core of [`read_ws_ping_interval_from_env`], split out so the
/// parsing rules (disable on `0`, fall back to the default on missing /
/// unparsable) are unit-testable without mutating process-global env.
fn parse_ws_ping_interval(raw: Option<&str>) -> Option<Duration> {
    match raw {
        Some(raw) => match raw.trim().parse::<u64>() {
            Ok(0) => None,
            Ok(n) => Some(Duration::from_secs(n)),
            Err(_) => Some(Duration::from_secs(DEFAULT_WS_PING_SECS)),
        },
        None => Some(Duration::from_secs(DEFAULT_WS_PING_SECS)),
    }
}

/// Factory that re-establishes a fresh upstream WebSocket after a
/// recoverable mid-turn drop. Returns the same stream type the bridge
/// was constructed with so the supervisor can resume against the
/// existing broadcast / command channels without the chat session
/// noticing. The closure is expected to perform its own bounded
/// connect-retry loop and return `Err` only once it has given up.
pub(crate) type WsReconnect<S> =
    Box<dyn Fn() -> Pin<Box<dyn Future<Output = anyhow::Result<S>> + Send>> + Send + Sync>;

/// Why the inner connection loop returned.
enum ConnOutcome {
    /// The inbound command channel closed (all `commands_tx` senders
    /// dropped) — the owning session is gone. Stop; do not reconnect.
    ShutdownRequested,
    /// The socket dropped recoverably. The supervisor decides whether
    /// to reconnect or surface a terminal error.
    Disconnected(DisconnectReason),
}

/// Categorises a recoverable socket drop so the supervisor can emit the
/// matching terminal error (and metric) if it ultimately gives up.
enum DisconnectReason {
    /// A WS `Close` frame was received.
    Closed,
    /// A transport read/write error (e.g. ECONNRESET) occurred.
    Errored(String),
}

/// Outcome of forwarding a single inbound WS frame.
enum FrameOutcome {
    /// Frame handled (or ignored); keep reading.
    Continue,
    /// Peer sent a `Close` frame.
    Closed,
    /// Transport error reading the frame.
    Errored(String),
}

/// Default capacity of the per-bridge broadcast channels that fan a
/// single upstream WebSocket out to every interested SSE consumer
/// (live UI stream, `chat_persist_task`, watchdog, etc.). Raised
/// from 4096 → 16384 in Phase 1.3 of the agent-stream reliability
/// plan to absorb bursty tool-heavy turns without dropping events.
/// Override at runtime with `AURA_HARNESS_BROADCAST_CAPACITY`.
pub const DEFAULT_BROADCAST_CAPACITY: usize = 16384;

/// Env var that overrides [`DEFAULT_BROADCAST_CAPACITY`]. Must parse
/// to a positive `usize`; any other value (missing, blank, 0, or
/// non-numeric) falls back to the default.
pub const BROADCAST_CAPACITY_ENV: &str = "AURA_HARNESS_BROADCAST_CAPACITY";

/// Reads `AURA_HARNESS_BROADCAST_CAPACITY` from the environment with
/// the same fallbacks `spawn_ws_bridge` uses. Re-exported via
/// [`crate::ws_bridge_config`] so aura-os-server's `/api/admin/health`
/// snapshot reports the exact value the harness bridge will sum onto
/// its broadcast channels.
pub fn read_broadcast_capacity_from_env() -> usize {
    std::env::var(BROADCAST_CAPACITY_ENV)
        .ok()
        .and_then(|v| v.trim().parse::<usize>().ok())
        .filter(|n| *n > 0)
        .unwrap_or(DEFAULT_BROADCAST_CAPACITY)
}

pub(crate) struct WsBridgeChannels {
    pub events_tx: broadcast::Sender<OutboundMessage>,
    /// Receiver reserved for the transport's readiness/liveness probe.
    /// It is subscribed before the reader task starts, so the probe cannot
    /// miss an immediate `SessionReady` or terminal bridge error.
    pub control_rx: broadcast::Receiver<OutboundMessage>,
    /// Independent, fully primed typed receiver for transcript consumers.
    /// Control probes may consume their own copy without truncating this one.
    pub events_rx: broadcast::Receiver<OutboundMessage>,
    pub raw_events_tx: broadcast::Sender<serde_json::Value>,
    /// Primed raw receivers for the automaton forwarder and persistence
    /// consumer. Both must observe an attach-time replay burst in full.
    pub raw_events_rx: Vec<broadcast::Receiver<serde_json::Value>>,
    pub commands_tx: mpsc::Sender<InboundMessage>,
}

pub(crate) fn spawn_ws_bridge<S>(ws_stream: S) -> WsBridgeChannels
where
    S: StreamExt<Item = Result<WsMessage, tokio_tungstenite::tungstenite::Error>>
        + SinkExt<WsMessage>
        + Unpin
        + Send
        + 'static,
    <S as futures_util::Sink<WsMessage>>::Error: std::fmt::Display + Send,
{
    spawn_ws_bridge_inner(ws_stream, None)
}

/// Like [`spawn_ws_bridge`] but resilient to a recoverable mid-turn WS
/// drop: when the upstream socket closes or errors, the supervisor
/// emits a non-terminal `progress { stage: "reconnecting" }` frame and
/// invokes `reconnect` to re-establish the stream, resuming against the
/// SAME broadcast / command channels. Only after `reconnect` itself
/// gives up does the bridge surface the terminal
/// `harness_ws_closed` / `harness_ws_read_error` it would have sent
/// immediately on the non-reconnecting path. Callers gate this behind
/// `AURA_HARNESS_WS_RECONNECT` (see `swarm_harness::connect_run_stream`).
pub(crate) fn spawn_ws_bridge_with_reconnect<S>(
    ws_stream: S,
    reconnect: WsReconnect<S>,
) -> WsBridgeChannels
where
    S: StreamExt<Item = Result<WsMessage, tokio_tungstenite::tungstenite::Error>>
        + SinkExt<WsMessage>
        + Unpin
        + Send
        + 'static,
    <S as futures_util::Sink<WsMessage>>::Error: std::fmt::Display + Send,
{
    spawn_ws_bridge_inner(ws_stream, Some(reconnect))
}

fn spawn_ws_bridge_inner<S>(ws_stream: S, reconnect: Option<WsReconnect<S>>) -> WsBridgeChannels
where
    S: StreamExt<Item = Result<WsMessage, tokio_tungstenite::tungstenite::Error>>
        + SinkExt<WsMessage>
        + Unpin
        + Send
        + 'static,
    <S as futures_util::Sink<WsMessage>>::Error: std::fmt::Display + Send,
{
    let cap = read_broadcast_capacity_from_env();
    let (outbound_tx, _) = broadcast::channel::<OutboundMessage>(cap);
    // Subscribe primed receivers BEFORE the supervisor is spawned. The
    // harness replays a run's full history as a burst the instant a WS
    // attaches (see `handle_chat_ws_attach` in aura-node), then streams
    // live. A consumer that only `events_tx.subscribe()`s AFTER this
    // function returns races the reader task and drops that burst — which
    // for a completed child run (e.g. an AURA Council member) is the
    // ENTIRE transcript. A consumer that adopts this primed receiver
    // instead observes every frame from the first one. Returned on
    // `HarnessSession.events_rx`.
    let control_rx = outbound_tx.subscribe();
    let events_rx = outbound_tx.subscribe();
    let (raw_tx, _) = broadcast::channel::<serde_json::Value>(cap);
    let raw_events_rx = vec![raw_tx.subscribe(), raw_tx.subscribe()];
    let (inbound_tx, inbound_rx) = mpsc::channel::<InboundMessage>(WS_COMMAND_BUFFER);

    spawn_bridge_supervisor(
        ws_stream,
        reconnect,
        outbound_tx.clone(),
        raw_tx.clone(),
        inbound_rx,
    );

    WsBridgeChannels {
        events_tx: outbound_tx,
        control_rx,
        events_rx,
        raw_events_tx: raw_tx,
        raw_events_rx,
        commands_tx: inbound_tx,
    }
}

/// Owns the upstream WebSocket for the life of the session. Reads frames
/// into the broadcast channels, writes queued inbound commands, and
/// originates keepalive pings — all in one task so a reconnect can swap
/// in a fresh stream without coordinating across the old reader/writer
/// split.
fn spawn_bridge_supervisor<S>(
    initial: S,
    reconnect: Option<WsReconnect<S>>,
    reader_tx: broadcast::Sender<OutboundMessage>,
    reader_raw_tx: broadcast::Sender<serde_json::Value>,
    mut inbound_rx: mpsc::Receiver<InboundMessage>,
) where
    S: StreamExt<Item = Result<WsMessage, tokio_tungstenite::tungstenite::Error>>
        + SinkExt<WsMessage>
        + Unpin
        + Send
        + 'static,
    <S as futures_util::Sink<WsMessage>>::Error: std::fmt::Display + Send,
{
    let ping_interval = read_ws_ping_interval_from_env();
    tokio::spawn(async move {
        let mut ws = initial;
        loop {
            let outcome = run_connection(
                ws,
                &reader_tx,
                &reader_raw_tx,
                &mut inbound_rx,
                ping_interval,
            )
            .await;
            match outcome {
                ConnOutcome::ShutdownRequested => return,
                ConnOutcome::Disconnected(reason) => {
                    // Always count the disconnect itself; the reconnect
                    // counter below is what distinguishes "recovered"
                    // from "gave up".
                    match &reason {
                        DisconnectReason::Closed => stability_metrics::inc_ws_closed(),
                        DisconnectReason::Errored(e) => {
                            debug!(error = %e, "WebSocket dropped");
                            stability_metrics::inc_ws_read_error();
                        }
                    }
                    match reconnect.as_ref() {
                        Some(reconnect_fn) => {
                            let _ = reader_tx.send(reconnecting_progress(&reason));
                            info!(
                                "harness ws dropped mid-session; attempting transparent reconnect"
                            );
                            match reconnect_fn().await {
                                Ok(fresh) => {
                                    stability_metrics::inc_ws_reconnect();
                                    info!("harness ws reconnected; resuming stream");
                                    ws = fresh;
                                    continue;
                                }
                                Err(e) => {
                                    warn!(error = %e, "harness ws reconnect failed; surfacing terminal error");
                                    let _ = reader_tx.send(terminal_error(&reason));
                                    return;
                                }
                            }
                        }
                        None => {
                            let _ = reader_tx.send(terminal_error(&reason));
                            return;
                        }
                    }
                }
            }
        }
    });
}

/// Drive a single live connection until it drops or the session shuts
/// down. Consumes `ws` (so a reconnect can hand in a fresh stream) and
/// reports back via [`ConnOutcome`]. Never emits terminal errors itself
/// — that decision belongs to the supervisor, which knows whether a
/// reconnect is available.
async fn run_connection<S>(
    ws: S,
    reader_tx: &broadcast::Sender<OutboundMessage>,
    reader_raw_tx: &broadcast::Sender<serde_json::Value>,
    inbound_rx: &mut mpsc::Receiver<InboundMessage>,
    ping_interval: Option<Duration>,
) -> ConnOutcome
where
    S: StreamExt<Item = Result<WsMessage, tokio_tungstenite::tungstenite::Error>>
        + SinkExt<WsMessage>
        + Unpin
        + Send
        + 'static,
    <S as futures_util::Sink<WsMessage>>::Error: std::fmt::Display + Send,
{
    let (mut ws_sink, mut ws_read) = ws.split();
    let mut ping = ping_interval.map(|d| {
        let mut t = tokio::time::interval(d);
        // A missed tick should not fire a thundering burst of pings.
        t.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        t
    });

    loop {
        tokio::select! {
            msg = ws_read.next() => {
                match msg {
                    Some(msg_result) => {
                        match classify_frame(msg_result, reader_tx, reader_raw_tx) {
                            FrameOutcome::Continue => {}
                            FrameOutcome::Closed => {
                                return ConnOutcome::Disconnected(DisconnectReason::Closed);
                            }
                            FrameOutcome::Errored(e) => {
                                return ConnOutcome::Disconnected(DisconnectReason::Errored(e));
                            }
                        }
                    }
                    // Stream ended without an explicit Close frame.
                    None => return ConnOutcome::Disconnected(DisconnectReason::Closed),
                }
            }
            cmd = inbound_rx.recv() => {
                match cmd {
                    Some(cmd) => {
                        if send_ws_command(&mut ws_sink, cmd).await {
                            return ConnOutcome::Disconnected(DisconnectReason::Errored(
                                "harness websocket write failed".to_string(),
                            ));
                        }
                    }
                    // All command senders dropped: the owning session is
                    // gone. Close politely and stop for good.
                    None => {
                        let _ = ws_sink.close().await;
                        return ConnOutcome::ShutdownRequested;
                    }
                }
            }
            _ = tick_ping(&mut ping), if ping.is_some() => {
                if ws_sink.send(WsMessage::Ping(Vec::<u8>::new().into())).await.is_err() {
                    return ConnOutcome::Disconnected(DisconnectReason::Errored(
                        "harness websocket ping failed".to_string(),
                    ));
                }
            }
        }
    }
}

/// Await the next ping tick. Split out so the `select!` branch above can
/// stay readable; the `if ping.is_some()` guard guarantees the unwrap.
async fn tick_ping(ping: &mut Option<tokio::time::Interval>) {
    match ping {
        Some(interval) => {
            interval.tick().await;
        }
        // Unreachable: the `select!` guard disables this branch when
        // `ping` is `None`. Park forever so the branch never resolves.
        None => std::future::pending::<()>().await,
    }
}

/// Forward one inbound WS frame onto the broadcast channels. Returns the
/// non-terminal/terminal disposition WITHOUT emitting any synthetic
/// bridge error — the supervisor owns terminal-error emission so it can
/// suppress it across a reconnect.
fn classify_frame(
    msg_result: Result<WsMessage, tokio_tungstenite::tungstenite::Error>,
    reader_tx: &broadcast::Sender<OutboundMessage>,
    reader_raw_tx: &broadcast::Sender<serde_json::Value>,
) -> FrameOutcome {
    match msg_result {
        Ok(WsMessage::Text(text)) => {
            debug!(
                direction = "received",
                payload_len = text.len(),
                payload = %debug_payload(&text),
                "WS frame received"
            );
            forward_ws_text(&text, reader_tx, reader_raw_tx);
            FrameOutcome::Continue
        }
        Ok(WsMessage::Close(_)) => FrameOutcome::Closed,
        Err(e) => FrameOutcome::Errored(e.to_string()),
        _ => FrameOutcome::Continue,
    }
}

/// The terminal bridge error a dropped connection surfaces once no (more)
/// reconnect is possible. Message text is byte-for-byte the same as the
/// pre-reconnect bridge so the client classifier and the local/swarm
/// liveness probes (which match on `code`) are unaffected.
fn terminal_error(reason: &DisconnectReason) -> OutboundMessage {
    match reason {
        DisconnectReason::Closed => {
            bridge_error("harness_ws_closed", "harness websocket closed", true)
        }
        DisconnectReason::Errored(e) => bridge_error(
            "harness_ws_read_error",
            format!("harness websocket read error: {e}"),
            true,
        ),
    }
}

/// Non-terminal progress frame emitted while a reconnect is in flight so
/// the UI shows life (and the watchdog's sliding-idle timer resets)
/// instead of either freezing or tearing the turn down.
fn reconnecting_progress(reason: &DisconnectReason) -> OutboundMessage {
    let detail = match reason {
        DisconnectReason::Closed => "harness connection closed".to_string(),
        DisconnectReason::Errored(e) => format!("harness connection dropped: {e}"),
    };
    OutboundMessage::Progress(ProgressMsg {
        stage: "reconnecting".to_string(),
        tool_name: None,
        elapsed_ms: None,
        message: Some(format!("Reconnecting to the agent ({detail})...")),
    })
}

fn forward_ws_text(
    text: &str,
    reader_tx: &broadcast::Sender<OutboundMessage>,
    reader_raw_tx: &broadcast::Sender<serde_json::Value>,
) {
    // Always publish the complete frame as a normalized JSON Value on
    // the raw channel so a raw-only consumer (the dev-loop / task-run
    // event forwarder, now sharing this single bridge) sees EVERY event
    // — not just the ones that fail typed parsing. Chat-path consumers
    // read the typed `reader_tx` and are unaffected. No-op normalization
    // for non-milestone events.
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(text) {
        let _ = reader_raw_tx.send(crate::event_normalization::normalize_automaton_event(value));
    }

    match serde_json::from_str::<OutboundMessage>(text) {
        Ok(event) => {
            debug!("Parsed harness event");
            let _ = reader_tx.send(event);
        }
        Err(err) => forward_untyped_ws_text(text, err, reader_tx),
    }
}

fn forward_untyped_ws_text(
    text: &str,
    err: serde_json::Error,
    reader_tx: &broadcast::Sender<OutboundMessage>,
) {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(text) {
        // Automaton/dev-loop events (`token_usage`, `tool_call_completed`,
        // `debug.*`, git/sync milestones, ...) are intentionally absent
        // from the typed `OutboundMessage` chat protocol. They were
        // already published on the raw channel by `forward_ws_text`, so a
        // failed typed parse here is expected — not protocol drift. Skip
        // the warn, the `harness_protocol_mismatch` metric, and the typed
        // error (which the client treats as a stream drop) for these. A
        // tag not recognized by `AutomatonEvent` deserializes to its
        // `#[serde(other)]` fallback and falls through to the warn path.
        if AutomatonEvent::is_recognized(&value) {
            debug!(
                direction = "received",
                payload_len = text.len(),
                payload = %debug_payload(text),
                "Forwarding raw-only harness event (not in typed protocol)"
            );
            return;
        }
        // The complete (normalized) JSON Value was already published on
        // the raw channel by `forward_ws_text`; here we only surface the
        // typed-parse miss to chat consumers reading the typed channel.
        warn!(
            direction = "received",
            payload_len = text.len(),
            payload = %debug_payload(text),
            error = %err,
            "Forwarding untyped harness event"
        );
        stability_metrics::inc_protocol_mismatch();
        let _ = reader_tx.send(bridge_error(
            "harness_protocol_mismatch",
            format!("harness websocket emitted an unsupported event shape: {err}"),
            true,
        ));
    } else {
        warn!(
            direction = "received",
            payload_len = text.len(),
            payload = %debug_payload(text),
            "Non-JSON harness message, dropping"
        );
        stability_metrics::inc_protocol_mismatch();
        let _ = reader_tx.send(bridge_error(
            "harness_protocol_mismatch",
            "harness websocket emitted a non-JSON message",
            true,
        ));
    }
}

async fn send_ws_command<W>(ws_sink: &mut W, cmd: InboundMessage) -> bool
where
    W: SinkExt<WsMessage> + Unpin,
    <W as futures_util::Sink<WsMessage>>::Error: std::fmt::Display,
{
    match serde_json::to_string(&cmd) {
        Ok(json) => {
            debug!(
                direction = "sent",
                payload_len = json.len(),
                payload = %debug_payload(&json),
                "WS frame sending"
            );
            ws_sink.send(WsMessage::Text(json.into())).await.is_err()
        }
        Err(e) => {
            warn!("Failed to serialize harness command: {e}");
            false
        }
    }
}

fn bridge_error(code: &str, message: impl Into<String>, recoverable: bool) -> OutboundMessage {
    OutboundMessage::Error(ErrorMsg {
        code: code.to_string(),
        message: message.into(),
        recoverable,
        support_id: None,
    })
}

fn debug_payload(text: &str) -> String {
    let mut preview = String::new();
    for ch in text.chars() {
        if preview.len() + ch.len_utf8() > WS_DEBUG_PAYLOAD_LIMIT {
            break;
        }
        preview.push(ch);
    }

    if preview.len() < text.len() {
        preview.push_str("...");
    }

    preview
}

// Reconnect: the bridge now supports transparent mid-turn reconnect via
// [`spawn_ws_bridge_with_reconnect`]. The caller supplies a [`WsReconnect`]
// factory that re-opens the upstream socket (for swarm, the gateway's
// run-only `{ws_base}/stream/:run_id` proxy, which replays the run's
// history on attach); the supervisor swaps the fresh stream into the same
// broadcast / command channels so the chat session survives a
// `Connection reset by peer` without tearing the turn down. This is gated
// behind `AURA_HARNESS_WS_RECONNECT` at the call site because it depends on
// the gateway replaying (rather than only tailing) on reattach.
//
// The keepalive ping (always on, tunable via `AURA_HARNESS_WS_PING_SECS`)
// is the first line of defence: it keeps idle intermediaries from reaping
// the socket in the first place. The bounded initial-connect retry in
// `LocalHarness::open_session` / `SwarmHarness::open_run_socket` and the
// client-side auto-retry on `streamDropped` remain the fallbacks for the
// non-reconnecting path.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_payload_truncates_large_frames() {
        let input = "x".repeat(WS_DEBUG_PAYLOAD_LIMIT + 100);
        let payload = debug_payload(&input);

        assert_eq!(payload.len(), WS_DEBUG_PAYLOAD_LIMIT + 3);
        assert!(payload.ends_with("..."));
    }

    #[test]
    fn debug_payload_preserves_short_frames() {
        assert_eq!(debug_payload("{\"type\":\"ping\"}"), "{\"type\":\"ping\"}");
    }

    #[test]
    fn untyped_json_emits_visible_protocol_error() {
        let (typed_tx, mut typed_rx) = broadcast::channel(8);
        let (raw_tx, mut raw_rx) = broadcast::channel(8);

        forward_ws_text("{\"type\":\"unknown_event\"}", &typed_tx, &raw_tx);

        let typed = typed_rx.try_recv().expect("typed protocol error");
        assert!(matches!(
            typed,
            OutboundMessage::Error(ErrorMsg { ref code, .. }) if code == "harness_protocol_mismatch"
        ));
        let raw = raw_rx.try_recv().expect("raw diagnostic event");
        assert_eq!(raw["type"], "unknown_event");
    }

    #[test]
    fn known_raw_only_event_does_not_emit_typed_protocol_error() {
        for raw in [
            "{\"type\":\"token_usage\",\"input_tokens\":1,\"output_tokens\":259}",
            "{\"type\":\"tool_call_completed\",\"id\":\"abc\",\"name\":\"search_code\"}",
            "{\"type\":\"debug.iteration\",\"index\":3,\"tool_calls\":2}",
            "{\"type\":\"log_line\",\"message\":\"Listening for harness events\"}",
            "{\"type\":\"started\"}",
            "{\"type\":\"loop_finished\",\"succeeded\":true}",
            "{\"type\":\"stopped\"}",
        ] {
            let (typed_tx, mut typed_rx) = broadcast::channel(8);
            let (raw_tx, mut raw_rx) = broadcast::channel(8);

            forward_ws_text(raw, &typed_tx, &raw_tx);

            // The event is still published on the raw channel ...
            assert!(raw_rx.try_recv().is_ok(), "raw event missing for {raw}");
            // ... but no spurious protocol-mismatch error reaches the typed
            // chat channel.
            assert!(
                typed_rx.try_recv().is_err(),
                "unexpected typed error for {raw}"
            );
        }
    }

    #[test]
    fn non_json_message_emits_visible_protocol_error() {
        let (typed_tx, mut typed_rx) = broadcast::channel(8);
        let (raw_tx, mut raw_rx) = broadcast::channel(8);

        forward_ws_text("not json", &typed_tx, &raw_tx);

        let typed = typed_rx.try_recv().expect("typed protocol error");
        assert!(matches!(
            typed,
            OutboundMessage::Error(ErrorMsg { ref code, .. }) if code == "harness_protocol_mismatch"
        ));
        assert!(raw_rx.try_recv().is_err());
    }

    #[test]
    fn ping_interval_parsing_rules() {
        // Missing / unparsable -> default cadence.
        assert_eq!(
            parse_ws_ping_interval(None),
            Some(Duration::from_secs(DEFAULT_WS_PING_SECS))
        );
        assert_eq!(
            parse_ws_ping_interval(Some("not-a-number")),
            Some(Duration::from_secs(DEFAULT_WS_PING_SECS))
        );
        // Explicit zero disables the keepalive.
        assert_eq!(parse_ws_ping_interval(Some("0")), None);
        // A positive value (with surrounding whitespace) is honoured.
        assert_eq!(
            parse_ws_ping_interval(Some("  5 ")),
            Some(Duration::from_secs(5))
        );
    }

    // ---- Mid-turn reconnect harness -------------------------------------

    use futures_util::{Sink, Stream};
    use std::pin::Pin;
    use std::task::{Context as TaskContext, Poll};
    use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};
    use tokio_tungstenite::tungstenite::Error as WsErr;

    type WsItem = Result<WsMessage, WsErr>;

    /// Minimal in-memory `Stream + Sink` standing in for a live
    /// `WebSocketStream`. Preloaded inbound frames are yielded in order;
    /// once drained the receiver parks (a clone of the sender is kept
    /// alive inside the mock) so the "connection" stays open instead of
    /// reporting EOF. Outbound frames (commands / pings) are accepted and
    /// discarded.
    struct MockWs {
        incoming: UnboundedReceiver<WsItem>,
        _keep_open: UnboundedSender<WsItem>,
    }

    fn mock_ws(frames: Vec<WsItem>) -> MockWs {
        let (tx, rx) = unbounded_channel();
        for f in frames {
            let _ = tx.send(f);
        }
        MockWs {
            incoming: rx,
            _keep_open: tx,
        }
    }

    impl Stream for MockWs {
        type Item = WsItem;
        fn poll_next(self: Pin<&mut Self>, cx: &mut TaskContext<'_>) -> Poll<Option<Self::Item>> {
            self.get_mut().incoming.poll_recv(cx)
        }
    }

    impl Sink<WsMessage> for MockWs {
        type Error = WsErr;
        fn poll_ready(
            self: Pin<&mut Self>,
            _cx: &mut TaskContext<'_>,
        ) -> Poll<Result<(), Self::Error>> {
            Poll::Ready(Ok(()))
        }
        fn start_send(self: Pin<&mut Self>, _item: WsMessage) -> Result<(), Self::Error> {
            Ok(())
        }
        fn poll_flush(
            self: Pin<&mut Self>,
            _cx: &mut TaskContext<'_>,
        ) -> Poll<Result<(), Self::Error>> {
            Poll::Ready(Ok(()))
        }
        fn poll_close(
            self: Pin<&mut Self>,
            _cx: &mut TaskContext<'_>,
        ) -> Poll<Result<(), Self::Error>> {
            Poll::Ready(Ok(()))
        }
    }

    fn conn_reset() -> WsErr {
        WsErr::Io(std::io::Error::new(
            std::io::ErrorKind::ConnectionReset,
            "Connection reset by peer (os error 104)",
        ))
    }

    #[tokio::test]
    async fn primed_control_transcript_and_raw_receivers_observe_the_first_frame() {
        let ready = OutboundMessage::SessionReady(aura_protocol::SessionReady {
            session_id: "session-first".into(),
            tools: Vec::new(),
            skills: Vec::new(),
        });
        let payload = serde_json::to_string(&ready).expect("serialize session_ready");
        let bridge = spawn_ws_bridge(mock_ws(vec![Ok(WsMessage::Text(payload.into()))]));
        let mut control_rx = bridge.control_rx;
        let mut events_rx = bridge.events_rx;
        let mut raw_receivers = bridge.raw_events_rx.into_iter();
        let mut raw_forwarder_rx = raw_receivers.next().expect("forwarder raw receiver");
        let mut raw_persist_rx = raw_receivers.next().expect("persist raw receiver");

        for rx in [&mut control_rx, &mut events_rx] {
            let event = tokio::time::timeout(Duration::from_secs(1), rx.recv())
                .await
                .expect("primed typed receiver must receive first frame")
                .expect("typed broadcast open");
            assert!(matches!(
                event,
                OutboundMessage::SessionReady(ref ready) if ready.session_id == "session-first"
            ));
        }
        for rx in [&mut raw_forwarder_rx, &mut raw_persist_rx] {
            let event = tokio::time::timeout(Duration::from_secs(1), rx.recv())
                .await
                .expect("primed raw receiver must receive first frame")
                .expect("raw broadcast open");
            assert_eq!(event["type"], "session_ready");
            assert_eq!(event["session_id"], "session-first");
        }
    }

    /// Without a reconnect factory, a recoverable read error surfaces the
    /// terminal `harness_ws_read_error` exactly as before (the
    /// local/swarm liveness probes match on this code), and no
    /// `reconnecting` progress is emitted.
    #[tokio::test]
    async fn no_reconnect_surfaces_terminal_read_error() {
        let bridge = spawn_ws_bridge(mock_ws(vec![Err(conn_reset())]));
        let mut rx = bridge.control_rx;
        drop(bridge.events_tx);

        let event = tokio::time::timeout(Duration::from_secs(1), rx.recv())
            .await
            .expect("bridge must emit an event")
            .expect("broadcast open");
        assert!(
            matches!(
                event,
                OutboundMessage::Error(ErrorMsg { ref code, .. }) if code == "harness_ws_read_error"
            ),
            "expected terminal harness_ws_read_error, got {event:?}"
        );
    }

    /// With a reconnect factory, the same recoverable read error is
    /// recovered transparently: a non-terminal `progress: reconnecting`
    /// frame is emitted, the `ws_reconnect` metric advances, and NO
    /// terminal error reaches consumers.
    #[tokio::test]
    async fn reconnect_recovers_without_terminal_error() {
        let before = stability_metrics::ws_reconnect();

        // First connection dies on its first frame; the factory hands
        // back a fresh connection that simply stays open (parks).
        let reconnect: WsReconnect<MockWs> =
            Box::new(|| Box::pin(async { Ok(mock_ws(Vec::new())) }));
        let bridge = spawn_ws_bridge_with_reconnect(mock_ws(vec![Err(conn_reset())]), reconnect);
        let mut rx = bridge.control_rx;

        let first = tokio::time::timeout(Duration::from_secs(1), rx.recv())
            .await
            .expect("bridge must emit a reconnecting progress")
            .expect("broadcast open");
        assert!(
            matches!(
                first,
                OutboundMessage::Progress(ProgressMsg { ref stage, .. }) if stage == "reconnecting"
            ),
            "expected progress:reconnecting, got {first:?}"
        );

        // After a successful reconnect the fresh stream is quiet, so no
        // terminal error should arrive.
        match tokio::time::timeout(Duration::from_millis(300), rx.recv()).await {
            Err(_elapsed) => {}
            Ok(Ok(OutboundMessage::Error(err))) => {
                panic!("reconnect must not surface a terminal error, got {err:?}")
            }
            Ok(other) => {
                // A heartbeat/other non-terminal frame is fine; just must
                // not be an Error (covered above).
                let _ = other;
            }
        }

        assert!(
            stability_metrics::ws_reconnect() > before,
            "ws_reconnect metric must advance on a successful reconnect"
        );
    }

    /// When the reconnect factory itself gives up, the bridge falls back
    /// to surfacing the terminal error so the turn does not hang forever.
    #[tokio::test]
    async fn reconnect_failure_falls_back_to_terminal_error() {
        let reconnect: WsReconnect<MockWs> =
            Box::new(|| Box::pin(async { Err(anyhow::anyhow!("gateway unreachable")) }));
        let bridge = spawn_ws_bridge_with_reconnect(mock_ws(vec![Err(conn_reset())]), reconnect);
        let mut rx = bridge.control_rx;

        let mut saw_terminal = false;
        for _ in 0..3 {
            match tokio::time::timeout(Duration::from_secs(1), rx.recv()).await {
                Ok(Ok(OutboundMessage::Error(ErrorMsg { code, .. })))
                    if code == "harness_ws_read_error" =>
                {
                    saw_terminal = true;
                    break;
                }
                Ok(Ok(_)) => continue,
                _ => break,
            }
        }
        assert!(
            saw_terminal,
            "an exhausted reconnect must surface the terminal harness_ws_read_error"
        );
    }
}
