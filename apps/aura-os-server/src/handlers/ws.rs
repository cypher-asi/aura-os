//! `/ws/events` forwarder. Subscribes to the sequenced
//! [`crate::event_log::EventLog`] (fed from the legacy
//! `event_broadcast` channel) and pushes each JSON event to the
//! connected client as a text frame, stamped with its monotonic `seq`.
//!
//! Reconnect support: clients pass `?since=<seq>` to ask for everything
//! they missed. The handler replays the buffered backlog before
//! switching to live streaming. If the requested backlog was already
//! evicted from the ring, the handler emits a single
//! `{"type":"ws_resync_required","last_seq":N}` frame so the client can
//! drop its stale view and rehydrate via HTTP snapshots.
//!
//! All logs in this module use `target: "aura::ws"` so the diagnostic
//! story can grep on a single tracing target across publisher
//! (`event_bus.rs`) and forwarder (here).

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::response::IntoResponse;
use serde::Deserialize;
use tracing::{debug, info, trace, warn};

use crate::event_log::ReplayResult;
use crate::state::{AppState, AuthSession};

#[derive(Debug, Default, Deserialize)]
pub(crate) struct WsEventsQuery {
    /// Last sequence number the client has already processed. The
    /// handler replays every event with `seq > since` before going
    /// live. Absent (or 0) means "live only" — preserves the legacy
    /// behaviour for older clients that don't track seqs.
    #[serde(default)]
    since: Option<u64>,
}

pub(crate) async fn ws_events(
    ws: WebSocketUpgrade,
    Query(query): Query<WsEventsQuery>,
    State(state): State<AppState>,
    AuthSession(session): AuthSession,
) -> impl IntoResponse {
    info!(target: "aura::ws", since = query.since.map(|s| s as i64).unwrap_or(-1), "ws upgrade requested");
    ws.on_upgrade(move |socket| handle_ws(socket, state, query.since, session.user_id))
}

fn visible_to_user(value: &serde_json::Value, user_id: &str) -> bool {
    value
        .get("user_id")
        .and_then(|entry| entry.as_str())
        .map(|owner| owner == user_id)
        .unwrap_or(true)
}

/// Build the JSON text frame for an event, injecting its `seq` into the
/// top-level object so the client can advance its cursor. Non-object
/// payloads (rare) are forwarded verbatim.
fn frame_with_seq(value: &serde_json::Value, seq: u64) -> String {
    match value {
        serde_json::Value::Object(map) => {
            let mut with_seq = map.clone();
            with_seq.insert("seq".to_string(), serde_json::json!(seq));
            serde_json::to_string(&serde_json::Value::Object(with_seq)).unwrap_or_default()
        }
        other => serde_json::to_string(other).unwrap_or_default(),
    }
}

async fn handle_ws(mut socket: WebSocket, state: AppState, since: Option<u64>, user_id: String) {
    debug!(target: "aura::ws", since = ?since, "ws subscriber connected");

    // Subscribe BEFORE reading the replay backlog so any event appended
    // between the snapshot and going live is delivered on the live
    // channel rather than lost. Overlap is de-duplicated below via
    // `last_sent_seq`.
    let mut rx = state.event_log.subscribe();

    // Highest seq we have already forwarded to this client. Live events
    // with `seq <= last_sent_seq` are skipped to avoid duplicating an
    // event that was also part of the replay snapshot.
    let mut last_sent_seq: u64 = 0;

    if let Some(since) = since {
        match state.event_log.replay_since(since) {
            ReplayResult::Replay { events, latest } => {
                debug!(
                    target: "aura::ws",
                    since,
                    replayed = events.len(),
                    latest,
                    "replaying missed events on reconnect"
                );
                for evt in events {
                    if !visible_to_user(&evt.value, &user_id) {
                        last_sent_seq = last_sent_seq.max(evt.seq);
                        continue;
                    }
                    let json = frame_with_seq(&evt.value, evt.seq);
                    if socket.send(Message::Text(json)).await.is_err() {
                        warn!(target: "aura::ws", "ws send failed during replay; closing");
                        return;
                    }
                    last_sent_seq = last_sent_seq.max(evt.seq);
                }
            }
            ReplayResult::GapTooLarge { latest } => {
                warn!(
                    target: "aura::ws",
                    since,
                    latest,
                    "client too far behind for delta replay; requesting full resync"
                );
                let frame = serde_json::json!({
                    "type": "ws_resync_required",
                    "last_seq": latest,
                })
                .to_string();
                if socket.send(Message::Text(frame)).await.is_err() {
                    return;
                }
                // Don't replay anything else; the client will rehydrate
                // from HTTP snapshots and resume live from here. Skip any
                // live events older than the newest we know about.
                last_sent_seq = latest;
            }
            ReplayResult::UpToDate { .. } => {}
        }
    }

    loop {
        tokio::select! {
            result = rx.recv() => {
                match result {
                    Ok(evt) => {
                        if evt.seq <= last_sent_seq {
                            // Already delivered during replay overlap.
                            continue;
                        }
                        if !visible_to_user(&evt.value, &user_id) {
                            last_sent_seq = evt.seq;
                            continue;
                        }
                        let json = frame_with_seq(&evt.value, evt.seq);
                        trace!(
                            target: "aura::ws",
                            seq = evt.seq,
                            bytes = json.len(),
                            "forwarding ws message to client"
                        );
                        if socket.send(Message::Text(json)).await.is_err() {
                            warn!(target: "aura::ws", "ws send failed; closing connection");
                            break;
                        }
                        last_sent_seq = evt.seq;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        // This live subscriber fell behind the broadcast
                        // ring. Unlike the legacy handler (which silently
                        // skipped ahead and left the client with a
                        // permanent hole), tell the client to resync so
                        // it can rehydrate from HTTP snapshots and we
                        // never present an inconsistent view.
                        let latest = state.event_log.latest_seq();
                        warn!(
                            target: "aura::ws",
                            skipped = n,
                            latest,
                            "ws subscriber lagged behind; requesting resync"
                        );
                        let frame = serde_json::json!({
                            "type": "ws_resync_required",
                            "last_seq": latest,
                        })
                        .to_string();
                        if socket.send(Message::Text(frame)).await.is_err() {
                            break;
                        }
                        last_sent_seq = latest;
                        continue;
                    }
                    Err(_) => break,
                }
            }
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }
    debug!(target: "aura::ws", "ws subscriber disconnected");
}

#[cfg(test)]
mod tests {
    use super::visible_to_user;

    #[test]
    fn user_scoped_events_are_visible_only_to_their_owner() {
        let scoped = serde_json::json!({ "type": "tool_approval_prompt", "user_id": "owner" });
        assert!(visible_to_user(&scoped, "owner"));
        assert!(!visible_to_user(&scoped, "someone-else"));
        assert!(visible_to_user(
            &serde_json::json!({ "type": "legacy_event" }),
            "someone-else"
        ));
    }
}
