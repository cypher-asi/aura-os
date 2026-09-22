//! Generic resumable-stream endpoints (Phase 2 of intelligent
//! reconnect):
//!
//! - `GET  /api/streams/active`            — list streams the caller can
//!   reattach to (spec gen, chat turns, media generation).
//! - `GET  /api/streams/:attach_id`        — SSE; replays the buffered
//!   backlog from `?since=<seq>` then streams live, stamping each frame
//!   with its `seq` as the SSE `id:` so the client can resume.
//! - `POST /api/streams/:attach_id/cancel` — request cancellation of the
//!   underlying harness run.
//!
//! All three are backed by [`crate::live_streams::LiveStreamRegistry`].

use std::collections::VecDeque;
use std::convert::Infallible;
use std::time::Duration;

use axum::extract::{Path, Query, State};
use axum::http::HeaderValue;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use futures_util::stream;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

use crate::error::{ApiError, ApiResult};
use crate::event_log::{ReplayResult, SeqEvent};
use crate::live_streams::{ActiveStreamSummary, LiveStream};
use crate::state::{AppState, AuthSession};
use std::sync::Arc;

const SSE_NO_BUFFERING_HEADERS: [(&str, HeaderValue); 1] =
    [("X-Accel-Buffering", HeaderValue::from_static("no"))];

/// Typed heartbeat cadence for attached SSE streams. The HTTP keep-alive
/// comment fires more often (axum default); this typed event lets the
/// client distinguish "connection alive, run still working" from a true
/// stall surfaced by its SSE idle timeout.
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);

#[derive(Debug, Default, Deserialize)]
pub(crate) struct ActiveStreamsQuery {
    pub project_id: Option<String>,
    pub agent_instance_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct ActiveStreamsResponse {
    pub streams: Vec<ActiveStreamSummary>,
}

/// `GET /api/streams/active` — streams the caller may reattach to.
pub(crate) async fn list_active_streams(
    State(state): State<AppState>,
    AuthSession(session): AuthSession,
    Query(query): Query<ActiveStreamsQuery>,
) -> ApiResult<Json<ActiveStreamsResponse>> {
    let streams = state.live_streams.list_for_scope(
        &session.user_id,
        query.project_id.as_deref(),
        query.agent_instance_id.as_deref(),
    );
    Ok(Json(ActiveStreamsResponse { streams }))
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct AttachQuery {
    /// Last seq the client already processed. Replay resumes from
    /// `since + 1`. Absent / 0 replays the whole buffered backlog.
    #[serde(default)]
    pub since: Option<u64>,
}

/// Reject attaching to a stream the caller doesn't own. A stream with no
/// `user_id` scope (anonymous flows) is visible to everyone.
fn authorize(stream: &LiveStream, user_id: &str) -> bool {
    stream
        .scope
        .user_id
        .as_deref()
        .map(|owner| owner == user_id)
        .unwrap_or(true)
}

/// `GET /api/streams/:attach_id` — attach (or reattach) to a stream.
pub(crate) async fn attach_stream(
    State(state): State<AppState>,
    AuthSession(session): AuthSession,
    Path(attach_id): Path<String>,
    Query(query): Query<AttachQuery>,
) -> ApiResult<(
    [(&'static str, HeaderValue); 1],
    Sse<impl futures_core::Stream<Item = Result<Event, Infallible>>>,
)> {
    let stream = state
        .live_streams
        .get(&attach_id)
        .ok_or_else(|| ApiError::not_found("stream not found"))?;
    if !authorize(&stream, &session.user_id) {
        return Err(ApiError::forbidden("not your stream"));
    }

    let sse = attach_sse(stream, query.since.unwrap_or(0));
    Ok((
        SSE_NO_BUFFERING_HEADERS,
        Sse::new(sse).keep_alive(KeepAlive::default()),
    ))
}

/// `POST /api/streams/:attach_id/cancel` — request cancellation.
pub(crate) async fn cancel_stream(
    State(state): State<AppState>,
    AuthSession(session): AuthSession,
    Path(attach_id): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    let stream = state
        .live_streams
        .get(&attach_id)
        .ok_or_else(|| ApiError::not_found("stream not found"))?;
    if !authorize(&stream, &session.user_id) {
        return Err(ApiError::forbidden("not your stream"));
    }
    stream.cancel();
    Ok(Json(serde_json::json!({ "cancelled": true })))
}

#[derive(Debug, Deserialize)]
pub(crate) struct ToolApprovalResponseBody {
    decision: aura_protocol::ToolApprovalDecision,
    remember: aura_protocol::ToolApprovalRemember,
}

/// `POST /api/streams/tool-approvals/:request_id` — answer a protected
/// tool request from any client that owns the live chat. The lookup is by
/// harness request id rather than attach id so a phone that discovered and
/// reattached to desktop-started work can answer the original prompt.
pub(crate) async fn respond_to_tool_approval(
    State(state): State<AppState>,
    AuthSession(session): AuthSession,
    Path(request_id): Path<String>,
    Json(body): Json<ToolApprovalResponseBody>,
) -> ApiResult<Json<serde_json::Value>> {
    let stream = state
        .live_streams
        .find_chat_tool_approval(&session.user_id, &request_id)
        .ok_or_else(|| ApiError::not_found("live tool approval request not found"))?;
    stream
        .respond_to_tool_approval(request_id, body.decision, body.remember)
        .map_err(ApiError::bad_request)?;
    Ok(Json(serde_json::json!({ "accepted": true })))
}

/// Build the SSE [`Event`] for a sequenced harness frame, using its
/// `seq` as the SSE `id:` so the client (and the `EventSource`
/// `lastEventId` mechanism) can resume from exactly here.
fn sse_from_seq(evt: &SeqEvent) -> Event {
    let type_str = evt
        .value
        .get("type")
        .and_then(|t| t.as_str())
        .unwrap_or("message");
    Event::default()
        .id(evt.seq.to_string())
        .event(type_str)
        .json_data(&*evt.value)
        .unwrap_or_else(|_| {
            Event::default()
                .id(evt.seq.to_string())
                .event(type_str)
                .data("{}")
        })
}

fn is_terminal_value(value: &serde_json::Value) -> bool {
    matches!(
        value.get("type").and_then(|t| t.as_str()),
        Some("assistant_message_end") | Some("error") | Some("stream_cancelled")
    )
}

struct AttachState {
    stream: Arc<LiveStream>,
    rx: broadcast::Receiver<SeqEvent>,
    pending: VecDeque<SeqEvent>,
    last_sent: u64,
    done: bool,
    heartbeat: tokio::time::Interval,
}

/// SSE body that replays the buffered backlog from `since` and then
/// streams live, ending when the stream reaches a terminal frame.
///
/// Exposed `pub(crate)` so flow handlers (spec gen, chat, media) can
/// register their harness session with the [`crate::live_streams::LiveStreamRegistry`]
/// and serve the very same resumable SSE body from their dedicated
/// start endpoint, rather than owning the session inside a bespoke
/// `stream::unfold`.
pub(crate) fn attach_sse(
    stream: Arc<LiveStream>,
    since: u64,
) -> impl futures_core::Stream<Item = Result<Event, Infallible>> + Send {
    // Subscribe BEFORE snapshotting the replay backlog so events
    // appended in between are delivered live (and de-duped via
    // `last_sent`) rather than lost.
    let rx = stream.events.subscribe();

    let mut pending: VecDeque<SeqEvent> = VecDeque::new();
    let mut last_sent = since;
    match stream.events.replay_since(since) {
        ReplayResult::Replay { events, .. } => {
            pending.extend(events);
        }
        ReplayResult::GapTooLarge { latest } => {
            // The backlog the client wanted was evicted. Tell it to
            // resync; subsequent live events still flow from here.
            let resync = SeqEvent {
                seq: latest,
                value: Arc::new(serde_json::json!({
                    "type": "stream_resync_required",
                    "last_seq": latest,
                })),
            };
            pending.push_back(resync);
            last_sent = latest;
        }
        ReplayResult::UpToDate { .. } => {}
    }

    let mut heartbeat = tokio::time::interval(HEARTBEAT_INTERVAL);
    heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    // Skip the immediate first tick so we don't emit a heartbeat before
    // any real content.
    heartbeat.reset();

    let state = AttachState {
        stream,
        rx,
        pending,
        last_sent,
        done: false,
        heartbeat,
    };

    stream::unfold(state, |mut st| async move {
        if st.done {
            return None;
        }
        loop {
            // Drain replay backlog first.
            if let Some(evt) = st.pending.pop_front() {
                st.last_sent = st.last_sent.max(evt.seq);
                let terminal = is_terminal_value(&evt.value);
                let sse = sse_from_seq(&evt);
                if terminal {
                    st.done = true;
                }
                return Some((Ok(sse), st));
            }

            // Backlog drained: if the run already terminated and we've
            // forwarded everything, end the SSE cleanly.
            if st.stream.is_terminated() && st.last_sent >= st.stream.events.latest_seq() {
                return None;
            }

            tokio::select! {
                _ = st.heartbeat.tick() => {
                    let hb = Event::default()
                        .event("stream_heartbeat")
                        .json_data(serde_json::json!({
                            "type": "stream_heartbeat",
                            "seq": st.stream.events.latest_seq(),
                        }))
                        .unwrap_or_else(|_| Event::default().event("stream_heartbeat").data("{}"));
                    return Some((Ok(hb), st));
                }
                res = st.rx.recv() => match res {
                    Ok(evt) => {
                        if evt.seq <= st.last_sent {
                            continue;
                        }
                        st.last_sent = evt.seq;
                        let terminal = is_terminal_value(&evt.value);
                        let sse = sse_from_seq(&evt);
                        if terminal {
                            st.done = true;
                        }
                        return Some((Ok(sse), st));
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => return None,
                }
            }
        }
    })
}
