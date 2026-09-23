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

use std::collections::{HashMap, HashSet, VecDeque};
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
use crate::live_streams::{
    ActiveStreamSummary, LiveStream, UserInputAnswer, UserInputAnswers, UserInputQuestion,
};
use crate::state::{AppState, AuthSession};
use std::sync::Arc;

const SSE_NO_BUFFERING_HEADERS: [(&str, HeaderValue); 1] =
    [("X-Accel-Buffering", HeaderValue::from_static("no"))];

/// Typed heartbeat cadence for attached SSE streams. The HTTP keep-alive
/// comment fires more often (axum default); this typed event lets the
/// client distinguish "connection alive, run still working" from a true
/// stall surfaced by its SSE idle timeout.
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);
const USER_INPUT_WAIT_TIMEOUT: Duration = Duration::from_secs(29 * 60);

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
        .respond_to_tool_approval(request_id.clone(), body.decision, body.remember)
        .map_err(ApiError::bad_request)?;
    let _ = state.event_broadcast.send(serde_json::json!({
        "type": "tool_approval_resolved",
        "user_id": session.user_id,
        "request_id": request_id,
    }));
    Ok(Json(serde_json::json!({ "accepted": true })))
}

/// `GET /api/streams/tool-approvals` — authoritative cold-start snapshot of
/// unresolved requests across the caller's live chat turns.
pub(crate) async fn list_pending_tool_approvals(
    State(state): State<AppState>,
    AuthSession(session): AuthSession,
) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "approvals": state
            .live_streams
            .list_pending_tool_approvals(&session.user_id),
    }))
}

#[derive(Debug, Deserialize)]
pub(crate) struct UserInputToolQuery {
    agent_id: String,
    #[serde(default)]
    project_id: Option<String>,
    #[serde(default)]
    agent_instance_id: Option<String>,
    #[serde(default)]
    session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct UserInputToolBody {
    questions: Vec<UserInputQuestion>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct UserInputResponseBody {
    answers: HashMap<String, UserInputAnswer>,
}

fn clean_optional(value: Option<String>) -> Option<String> {
    value
        .map(|entry| entry.trim().to_string())
        .filter(|entry| !entry.is_empty())
}

fn validate_user_input_questions(questions: &[UserInputQuestion]) -> Result<(), String> {
    if questions.is_empty() || questions.len() > 3 {
        return Err("request_user_input requires between one and three questions".to_string());
    }
    let mut ids = HashSet::new();
    for question in questions {
        let id = question.id.trim();
        if id.is_empty()
            || id.len() > 64
            || !id.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '_' | '-')
            })
        {
            return Err(
                "question ids must be 1-64 ASCII letters, numbers, `_`, or `-`".to_string(),
            );
        }
        if !ids.insert(id) {
            return Err(format!("duplicate user input question id `{id}`"));
        }
        let header = question.header.trim();
        if header.is_empty() || header.len() > 40 {
            return Err(format!("question `{id}` header must be 1-40 characters"));
        }
        let prompt = question.question.trim();
        if prompt.is_empty() || prompt.len() > 500 {
            return Err(format!("question `{id}` prompt must be 1-500 characters"));
        }
        if !(2..=3).contains(&question.options.len()) {
            return Err(format!("question `{id}` must offer two or three options"));
        }
        let mut labels = HashSet::new();
        for option in &question.options {
            let label = option.label.trim();
            if label.is_empty() || label.len() > 80 {
                return Err(format!(
                    "question `{id}` option labels must be 1-80 characters"
                ));
            }
            if !labels.insert(label) {
                return Err(format!("question `{id}` has duplicate option `{label}`"));
            }
            let description = option.description.trim();
            if description.is_empty() || description.len() > 240 {
                return Err(format!(
                    "question `{id}` option descriptions must be 1-240 characters"
                ));
            }
        }
    }
    Ok(())
}

/// Installed-tool endpoint. The environment-owned agent blocks on this local
/// HTTP request while any authenticated client can discover and answer the
/// question by opaque request id.
pub(crate) async fn request_user_input(
    State(state): State<AppState>,
    AuthSession(session): AuthSession,
    Query(query): Query<UserInputToolQuery>,
    Json(body): Json<UserInputToolBody>,
) -> ApiResult<Json<serde_json::Value>> {
    let agent_id = query.agent_id.trim().to_string();
    if agent_id.is_empty() {
        return Err(ApiError::bad_request("agent_id is required"));
    }
    validate_user_input_questions(&body.questions).map_err(ApiError::bad_request)?;

    let registration = state.live_streams.register_user_input(
        session.user_id.clone(),
        agent_id.clone(),
        clean_optional(query.project_id),
        clean_optional(query.agent_instance_id),
        clean_optional(query.session_id),
        body.questions,
    );
    let summary = registration.summary;
    let request_id = summary.request_id.clone();
    let _ = state.event_broadcast.send(serde_json::json!({
        "type": "agent_user_input_requested",
        "user_id": session.user_id,
        "request_id": request_id,
        "agent_id": agent_id,
        "project_id": summary.project_id,
        "project_agent_id": summary.agent_instance_id,
        "session_id": summary.session_id,
        "questions": summary.questions,
        "started_at_ms": summary.started_at_ms,
    }));

    let answers = match tokio::time::timeout(USER_INPUT_WAIT_TIMEOUT, registration.receiver).await {
        Ok(Ok(answers)) => answers,
        Ok(Err(_)) => {
            state.live_streams.cancel_user_input(&request_id);
            let _ = state.event_broadcast.send(serde_json::json!({
                "type": "agent_user_input_resolved",
                "user_id": session.user_id,
                "request_id": request_id,
                "outcome": "abandoned",
            }));
            return Err(ApiError::service_unavailable(
                "The agent stopped waiting for user input before an answer arrived.",
            ));
        }
        Err(_) => {
            state.live_streams.cancel_user_input(&request_id);
            let _ = state.event_broadcast.send(serde_json::json!({
                "type": "agent_user_input_resolved",
                "user_id": session.user_id,
                "request_id": request_id,
                "outcome": "expired",
            }));
            return Err(ApiError::service_unavailable(
                "The user input request expired before an answer arrived.",
            ));
        }
    };
    state.live_streams.finish_user_input(&request_id);
    let _ = state.event_broadcast.send(serde_json::json!({
        "type": "agent_user_input_resolved",
        "user_id": session.user_id,
        "request_id": request_id,
        "outcome": "answered",
    }));
    Ok(Json(serde_json::json!({
        "request_id": request_id,
        "answers": answers,
    })))
}

#[cfg(test)]
mod user_input_validation_tests {
    use super::validate_user_input_questions;
    use crate::live_streams::{UserInputQuestion, UserInputQuestionOption};

    fn question(id: &str) -> UserInputQuestion {
        UserInputQuestion {
            id: id.to_string(),
            header: "Scope".to_string(),
            question: "Which scope should I use?".to_string(),
            options: vec![
                UserInputQuestionOption {
                    label: "Focused".to_string(),
                    description: "Change only the requested surface.".to_string(),
                },
                UserInputQuestionOption {
                    label: "Broad".to_string(),
                    description: "Update related surfaces too.".to_string(),
                },
            ],
            multi_select: false,
        }
    }

    #[test]
    fn accepts_one_to_three_typed_questions() {
        assert!(validate_user_input_questions(&[question("scope")]).is_ok());
        assert!(validate_user_input_questions(&[
            question("scope"),
            question("tests"),
            question("release"),
        ])
        .is_ok());
    }

    #[test]
    fn rejects_duplicate_ids_and_invalid_option_counts() {
        assert!(
            validate_user_input_questions(&[question("scope"), question("scope")])
                .unwrap_err()
                .contains("duplicate")
        );

        let mut invalid = question("scope");
        invalid.options.truncate(1);
        assert!(validate_user_input_questions(&[invalid])
            .unwrap_err()
            .contains("two or three options"));
    }
}

/// Authoritative cold-start snapshot for mobile/web clients that were not
/// connected when the environment-owned agent raised its hand.
pub(crate) async fn list_pending_user_inputs(
    State(state): State<AppState>,
    AuthSession(session): AuthSession,
) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "requests": state.live_streams.list_pending_user_inputs(&session.user_id),
    }))
}

/// Answer a structured question without attaching to the original SSE. The
/// registry enforces account ownership and idempotent retries.
pub(crate) async fn respond_to_user_input(
    State(state): State<AppState>,
    AuthSession(session): AuthSession,
    Path(request_id): Path<String>,
    Json(body): Json<UserInputResponseBody>,
) -> ApiResult<Json<serde_json::Value>> {
    let answers: UserInputAnswers = body.answers;
    state
        .live_streams
        .respond_to_user_input(&session.user_id, &request_id, answers)
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
