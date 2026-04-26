//! SSE streaming plumbing for chat: harness → SSE bridge, response
//! header construction, attachment translation, and the
//! `open_harness_chat_stream` orchestrator that ties persistence,
//! session lookup, and the SSE response together.

use std::convert::Infallible;
use std::sync::atomic::AtomicUsize;
use std::sync::Arc;

use aura_os_core::HarnessMode;
use aura_os_harness::{
    HarnessCommandSender, HarnessOutbound, MessageAttachment, SessionBridge, SessionBridgeStarted,
    SessionBridgeTurn, SessionConfig,
};
use axum::response::sse::{Event, KeepAlive, Sse};
use futures_util::stream;
use futures_util::StreamExt as FuturesStreamExt;
use tokio::sync::{broadcast, Mutex};
use tracing::{error, info, warn};

use crate::dto::ChatAttachmentDto;
use crate::error::{ApiError, ApiResult};
use crate::handlers::agents::chat::types::sse_response_headers;
use crate::state::{AppState, ChatSession};

use super::errors::{
    map_session_bridge_error, map_session_bridge_start_error, remap_harness_error_to_sse,
};
use super::event_bus::publish_user_message_event;
use super::persist::{persist_user_message, ChatPersistCtx};
use super::persist_task::spawn_chat_persist_task;
use super::turn_slot::{acquire_turn_slot, spawn_turn_slot_release, TurnSlotGuard};
use super::types::{SseResponse, SseStream};

pub fn harness_broadcast_to_sse(
    rx: tokio::sync::broadcast::Receiver<HarnessOutbound>,
) -> impl futures_core::Stream<Item = Result<Event, Infallible>> + Send {
    stream::unfold((rx, false), |(mut rx, done)| async move {
        if done {
            return None;
        }

        match rx.recv().await {
            Ok(evt) => {
                let should_close = matches!(
                    evt,
                    HarnessOutbound::AssistantMessageEnd(_) | HarnessOutbound::Error(_)
                );
                // Intercept the harness "turn already in progress"
                // error mid-stream and surface it as the structured
                // `agent_busy` SSE event so the UI never has to
                // string-match the raw upstream wording. The error
                // still closes the SSE stream — the `should_close`
                // flag above already covers `Error(_)` regardless of
                // remap outcome.
                let normalized = match &evt {
                    HarnessOutbound::Error(err) => remap_harness_error_to_sse(err)
                        .map(HarnessOutbound::Error)
                        .unwrap_or(evt),
                    _ => evt,
                };
                let event = super::super::super::sse::harness_event_to_sse(&normalized);
                Some((event, (rx, should_close)))
            }
            // The harness broadcast channel evicted `n` events before we
            // could read them — typically because heavy text-delta + large
            // tool-result traffic outran the SSE writer. Previously we
            // silently `continue`d the recv loop, which meant a dropped
            // terminal `AssistantMessageEnd` would leave the client
            // waiting until its 90s idle timeout fired and the run
            // appeared to "just get dropped with no explanation."
            //
            // Now we log, surface a synthetic SSE error event so the UI
            // can render an explicit banner, and close the stream. The
            // parallel `chat_persist_task` keeps draining through lag, so
            // the post-stream history refetch will repaint the full
            // assistant turn from storage.
            Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                warn!(
                    skipped = n,
                    "harness_broadcast_to_sse: receiver lagged; closing SSE with synthetic error"
                );
                let payload = serde_json::json!({
                    "type": "error",
                    "message": format!(
                        "Stream lagged ({n} events skipped). Reloading history…"
                    ),
                    "code": "stream_lagged",
                    "recoverable": true,
                });
                let event = Event::default()
                    .event("error")
                    .json_data(&payload)
                    .unwrap_or_else(|_| {
                        Event::default()
                            .event("error")
                            .data("{\"type\":\"error\",\"message\":\"Stream lagged\",\"code\":\"stream_lagged\",\"recoverable\":true}")
                    });
                Some((Ok(event), (rx, true)))
            }
            Err(tokio::sync::broadcast::error::RecvError::Closed) => None,
        }
    })
}

pub(super) fn dto_attachments_to_protocol(
    atts: &Option<Vec<ChatAttachmentDto>>,
) -> Option<Vec<MessageAttachment>> {
    atts.as_ref().and_then(|v| {
        if v.is_empty() {
            None
        } else {
            Some(
                v.iter()
                    .map(|a| MessageAttachment {
                        type_: a.type_.clone(),
                        media_type: a.media_type.clone(),
                        data: a.data.clone(),
                        name: a.name.clone(),
                    })
                    .collect(),
            )
        }
    })
}

/// Inputs to `open_harness_chat_stream`. Bundled so the function stays
/// inside the 5-parameter limit and call sites compose easily.
pub(super) struct OpenChatStreamArgs {
    pub(super) session_key: String,
    pub(super) harness_mode: HarnessMode,
    pub(super) session_config: SessionConfig,
    pub(super) user_content: String,
    pub(super) requested_model: Option<String>,
    pub(super) persist_ctx: Option<ChatPersistCtx>,
    pub(super) attachments: Option<Vec<ChatAttachmentDto>>,
}

pub(super) async fn open_harness_chat_stream(
    state: &AppState,
    args: OpenChatStreamArgs,
) -> ApiResult<SseResponse> {
    let OpenChatStreamArgs {
        session_key,
        harness_mode,
        session_config,
        user_content,
        requested_model,
        persist_ctx,
        attachments,
    } = args;

    // Guiding invariant: no silent success. If the inbound user message
    // cannot be persisted for ANY reason, we must return a non-2xx to the
    // caller, we must NOT forward the turn to the harness, and we must
    // NOT open an SSE body. The CEO's `send_to_agent` tool relied on the
    // previous soft-success behavior to report `persisted: true` for
    // writes that silently vanished — see the structured
    // `chat_persist_failed` / `chat_persist_unavailable` shapes in
    // `error.rs` for what callers now see on failure.
    let ctx = require_persist_ctx(&session_key, persist_ctx)?;
    let err_ctx = persist_error_ctx(&ctx);

    // Persist the user turn BEFORE starting the harness session. If
    // storage rejects the write we must not charge the caller credits
    // for a turn that would never make it into the target agent's chat
    // history, and we must not leave an orphaned harness turn mid-flight.
    let persisted_user_evt = persist_user_message(&ctx, &user_content, &attachments)
        .await
        .map_err(|e| crate::error::map_chat_persist_storage_error(e, err_ctx.clone()))?;

    // Snapshot the persistence identifiers so we can advertise them in
    // SSE response headers for callers (e.g. the CEO's `send_to_agent`)
    // that want to locate the saved turn without draining the stream.
    let persist_snapshot: Option<(String, String)> =
        Some((ctx.session_id.clone(), ctx.project_id.clone()));

    let turn = SessionBridgeTurn {
        content: user_content,
        tool_hints: None,
        attachments: dto_attachments_to_protocol(&attachments),
    };
    let persist_model = requested_model
        .clone()
        .or_else(|| session_config.model.clone());
    let SessionForTurn {
        is_new,
        was_queued,
        rx,
        slot_guard,
    } = get_or_create_delegated_chat_session(
        state,
        &session_key,
        harness_mode,
        session_config,
        requested_model,
        turn,
    )
    .await?;

    let persist_rx = rx.resubscribe();
    let release_rx = rx.resubscribe();

    // Fan out the now-persisted user turn onto the local WebSocket event
    // bus so the UI can live-refresh the target agent's chat panel when
    // another agent (e.g. the CEO) writes into its history. See
    // `useChatHistorySync` for the consumer.
    publish_user_message_event(&state.event_broadcast, &ctx, persisted_user_evt.id.as_str());

    spawn_chat_persist_task(
        persist_rx,
        ctx,
        state.event_broadcast.clone(),
        persist_model,
    );

    // Hand the turn-slot guard to a sentinel that releases it on the
    // harness's terminal event for this turn. Without this, the guard
    // would drop as soon as `open_harness_chat_stream` returns and a
    // back-to-back send would race the WS writer just like before
    // Phase 3.
    spawn_turn_slot_release(slot_guard, release_rx);

    let stream = build_sse_stream(rx, is_new, was_queued);
    let boxed: SseStream = Box::pin(stream);

    Ok((
        sse_response_headers(persist_snapshot.as_ref()),
        Sse::new(boxed).keep_alive(KeepAlive::default()),
    ))
}

fn require_persist_ctx(
    session_key: &str,
    persist_ctx: Option<ChatPersistCtx>,
) -> ApiResult<ChatPersistCtx> {
    match persist_ctx {
        Some(ctx) => Ok(ctx),
        None => {
            error!(
                session_key,
                "chat stream rejected: persistence context unavailable (no project binding / storage down)"
            );
            Err(ApiError::chat_persist_unavailable(
                "Chat persistence unavailable: target agent is not bound to any project in storage, or storage is not configured. Call assign_agent_to_project before retrying.",
                crate::error::ChatPersistErrorCtx::default(),
            ))
        }
    }
}

fn persist_error_ctx(ctx: &ChatPersistCtx) -> crate::error::ChatPersistErrorCtx {
    crate::error::ChatPersistErrorCtx {
        session_id: Some(ctx.session_id.clone()),
        project_id: Some(ctx.project_id.clone()),
        project_agent_id: Some(ctx.project_agent_id.clone()),
    }
}

/// Result of `get_or_create_delegated_chat_session`: a freshly opened
/// or reused chat session with its turn-slot guard already held by
/// the orchestrator.
pub(super) struct SessionForTurn {
    /// `true` when we cold-started the harness session in this call.
    /// Preserves the existing `progress: connecting` SSE prefix
    /// behaviour for first-turn UX.
    pub(super) is_new: bool,
    /// `true` when the per-partition turn slot was held when this
    /// call entered, i.e. the user message had to wait for the
    /// previous turn to terminate. Drives the new
    /// `progress: queued` SSE prefix.
    pub(super) was_queued: bool,
    /// SSE-bound receiver. The harness fan-out broadcast is wired
    /// here; the orchestrator resubscribes to feed the persist task
    /// and the turn-slot release sentinel.
    pub(super) rx: broadcast::Receiver<HarnessOutbound>,
    /// Held for the entire lifetime of this user turn; handed to a
    /// sentinel task that watches the broadcast for the terminal
    /// event and drops the guard there.
    pub(super) slot_guard: TurnSlotGuard,
}

fn build_sse_stream(
    rx: tokio::sync::broadcast::Receiver<HarnessOutbound>,
    is_new: bool,
    was_queued: bool,
) -> impl futures_core::Stream<Item = Result<Event, Infallible>> + Send {
    let mut prefix: Vec<Result<Event, Infallible>> = Vec::new();
    if is_new {
        if let Ok(progress_event) = Event::default()
            .event("progress")
            .json_data(serde_json::json!({"type":"progress","stage":"connecting"}))
        {
            prefix.push(Ok(progress_event));
        }
    }
    if was_queued {
        // Surface the "your message is waiting behind the previous
        // turn" hint as a structured SSE progress event so the UI
        // can render distinct copy from `connecting`. Phase 4 wires
        // this into the chat composer; until then the event is a
        // no-op for older clients that ignore unknown progress
        // stages.
        if let Ok(progress_event) = Event::default()
            .event("progress")
            .json_data(serde_json::json!({
                "type":"progress",
                "stage":"queued",
                "message":"Queued behind current turn",
            }))
        {
            prefix.push(Ok(progress_event));
        }
    }
    let broadcast_stream = harness_broadcast_to_sse(rx);
    FuturesStreamExt::chain(stream::iter(prefix), broadcast_stream)
}

async fn get_or_create_delegated_chat_session(
    state: &AppState,
    key: &str,
    harness_mode: HarnessMode,
    session_config: SessionConfig,
    requested_model: Option<String>,
    turn: SessionBridgeTurn,
) -> ApiResult<SessionForTurn> {
    if let Some(reused) = try_reuse_session(state, key, &requested_model).await {
        return reuse_with_turn_slot(reused, turn, state.harness_ws_slots).await;
    }

    let harness = state.harness_for(harness_mode);
    let session_agent_id = session_config.agent_id.clone();
    let session_template_agent_id = session_config.template_agent_id.clone();
    let started = SessionBridge::open_and_send_user_message(harness, session_config, turn)
        .await
        .map_err(map_session_bridge_start_error(
            key,
            harness_mode,
            state.harness_ws_slots,
        ))?;
    insert_delegated_chat_session(
        state,
        key,
        requested_model,
        session_agent_id,
        session_template_agent_id,
        started,
    )
    .await
}

/// Handles the cloned turn-slot from an alive registry entry —
/// acquires the per-partition mutex (waiting if another turn is
/// in flight), maps queue-full to `ApiError::agent_busy`, and only
/// then forwards the user message into the harness mpsc. Sending
/// AFTER the slot is held is what prevents the upstream
/// `turn_in_progress` race.
async fn reuse_with_turn_slot(
    reused: ReusedSessionHandles,
    turn: SessionBridgeTurn,
    ws_slots_cap: usize,
) -> ApiResult<SessionForTurn> {
    let acquired = acquire_turn_slot(reused.turn_slot, reused.turn_pending_count)
        .await
        .map_err(|_| {
            ApiError::agent_busy(
                "Agent is busy: another turn is already running and one is queued.",
                None,
            )
        })?;
    SessionBridge::send_user_message(&reused.commands_tx, turn)
        .map_err(|err| map_session_bridge_error(err, ws_slots_cap))?;
    Ok(SessionForTurn {
        is_new: false,
        was_queued: acquired.queued,
        rx: reused.rx,
        slot_guard: acquired.guard,
    })
}

/// Cloned handles needed by `reuse_with_turn_slot` — taken while
/// holding the registry mutex briefly, then released so the slot
/// `await` does not block other partitions.
struct ReusedSessionHandles {
    rx: broadcast::Receiver<HarnessOutbound>,
    commands_tx: HarnessCommandSender,
    turn_slot: Arc<Mutex<()>>,
    turn_pending_count: Arc<AtomicUsize>,
}

async fn try_reuse_session(
    state: &AppState,
    key: &str,
    requested_model: &Option<String>,
) -> Option<ReusedSessionHandles> {
    let mut reg = state.chat_sessions.lock().await;
    let session = reg.get(key)?;
    if !session.is_alive() {
        return None;
    }
    if model_changed(&session.model, requested_model) {
        info!(
            key,
            "Model changed; closing existing delegated chat session"
        );
        reg.remove(key);
        return None;
    }
    Some(ReusedSessionHandles {
        rx: session.events_tx.subscribe(),
        commands_tx: session.commands_tx.clone(),
        turn_slot: Arc::clone(&session.turn_slot),
        turn_pending_count: Arc::clone(&session.turn_pending_count),
    })
}

fn model_changed(current: &Option<String>, requested: &Option<String>) -> bool {
    match (current, requested) {
        (Some(current), Some(requested)) => current != requested,
        (None, Some(_)) => true,
        _ => false,
    }
}

async fn insert_delegated_chat_session(
    state: &AppState,
    key: &str,
    requested_model: Option<String>,
    session_agent_id: Option<String>,
    session_template_agent_id: Option<String>,
    started: SessionBridgeStarted,
) -> ApiResult<SessionForTurn> {
    // Build the per-partition turn slot up front and acquire it BEFORE
    // exposing the new session through the registry. The first user
    // message is already in flight via `open_and_send_user_message`,
    // so no other call can collide with us here — but a second
    // back-to-back send arriving the moment we publish the entry
    // MUST observe the slot as held, otherwise it would race the
    // first turn and trigger the upstream `turn_in_progress` error.
    let turn_slot = Arc::new(Mutex::new(()));
    let turn_pending_count = Arc::new(AtomicUsize::new(0));
    let acquired = acquire_turn_slot(Arc::clone(&turn_slot), Arc::clone(&turn_pending_count))
        .await
        .map_err(|_| {
            ApiError::internal("turn slot rejected fresh acquire — should be unreachable")
        })?;

    let rx = started.events_rx;
    let mut reg = state.chat_sessions.lock().await;
    reg.insert(
        key.to_string(),
        ChatSession {
            session_id: started.session.session_id,
            commands_tx: started.session.commands_tx,
            events_tx: started.session.events_tx,
            model: requested_model,
            agent_id: session_agent_id,
            template_agent_id: session_template_agent_id,
            turn_slot,
            turn_pending_count,
        },
    );
    Ok(SessionForTurn {
        is_new: true,
        was_queued: false,
        rx,
        slot_guard: acquired.guard,
    })
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    use aura_os_harness::{
        AssistantMessageEnd, ErrorMsg, FilesChanged, HarnessOutbound, SessionUsage, TextDelta,
    };
    use futures_util::StreamExt;
    use tokio::sync::{broadcast, Mutex};

    use super::super::turn_slot::acquire_turn_slot;
    use super::{build_sse_stream, harness_broadcast_to_sse};

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

    #[tokio::test]
    async fn build_sse_stream_prepends_queued_progress_when_was_queued() {
        let (tx, rx) = broadcast::channel::<HarnessOutbound>(8);
        tx.send(text_delta("hello")).expect("seed text delta");
        tx.send(end_event()).expect("seed terminal end");
        drop(tx);

        let stream = build_sse_stream(rx, /* is_new */ false, /* was_queued */ true);
        tokio::pin!(stream);
        let first = stream
            .next()
            .await
            .expect("queued prefix event")
            .expect("first item is Ok");
        let body = dump(&first);
        assert!(
            body.contains("queued"),
            "first event must be the queued progress event, got: {body}"
        );
        assert!(
            body.contains("Queued behind current turn"),
            "queued event must include the human-readable hint, got: {body}"
        );
        // The prepended queued event must come BEFORE any forwarded
        // text delta — that's the whole UX contract for Phase 3.
        let second = stream
            .next()
            .await
            .expect("forwarded text delta")
            .expect("second item is Ok");
        assert!(
            dump(&second).contains("hello"),
            "second event must be the broadcast text delta"
        );
    }

    #[tokio::test]
    async fn build_sse_stream_omits_queued_progress_when_not_queued() {
        let (tx, rx) = broadcast::channel::<HarnessOutbound>(8);
        tx.send(text_delta("hello")).expect("seed text delta");
        tx.send(end_event()).expect("seed terminal end");
        drop(tx);

        let stream = build_sse_stream(rx, /* is_new */ false, /* was_queued */ false);
        tokio::pin!(stream);
        let first = stream
            .next()
            .await
            .expect("first event")
            .expect("first item is Ok");
        let body = dump(&first);
        assert!(
            !body.contains("queued"),
            "no prefix event must precede the broadcast when was_queued=false, got: {body}"
        );
    }

    #[tokio::test]
    async fn build_sse_stream_emits_both_connecting_and_queued_when_set() {
        let (tx, rx) = broadcast::channel::<HarnessOutbound>(8);
        tx.send(end_event()).expect("seed terminal end");
        drop(tx);

        let stream = build_sse_stream(rx, /* is_new */ true, /* was_queued */ true);
        tokio::pin!(stream);
        let first = dump(
            &stream
                .next()
                .await
                .expect("connecting event")
                .expect("ok"),
        );
        let second = dump(&stream.next().await.expect("queued event").expect("ok"));
        assert!(
            first.contains("connecting"),
            "is_new must emit `connecting` before `queued`, got: {first}"
        );
        assert!(
            second.contains("queued"),
            "queued event must follow the connecting event, got: {second}"
        );
    }

    /// End-to-end-ish guard for the queued-turn UX: two back-to-back
    /// acquirers on the same partition slot, with the second one's
    /// SSE stream built using its `was_queued` flag. The first
    /// acquirer holds the slot; the second is unblocked only after
    /// the first releases. The second must observe `queued = true`
    /// AND its build_sse_stream output must lead with the queued
    /// progress event before the first text delta arrives.
    #[tokio::test]
    async fn back_to_back_partition_sends_queue_with_progress_event() {
        let slot = Arc::new(Mutex::new(()));
        let counter = Arc::new(AtomicUsize::new(0));

        let first = acquire_turn_slot(Arc::clone(&slot), Arc::clone(&counter))
            .await
            .expect("first acquire");
        assert!(!first.queued, "first acquire on a fresh slot is not queued");

        let slot_2 = Arc::clone(&slot);
        let counter_2 = Arc::clone(&counter);
        let second_handle =
            tokio::spawn(async move { acquire_turn_slot(slot_2, counter_2).await });

        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(
            !second_handle.is_finished(),
            "second send must wait while the first holds the slot",
        );
        assert_eq!(
            counter.load(Ordering::Acquire),
            2,
            "both acquirers must be counted while the second is queued",
        );

        drop(first.guard);

        let second = tokio::time::timeout(Duration::from_millis(200), second_handle)
            .await
            .expect("second acquire timed out")
            .expect("join handle")
            .expect("second acquire");
        assert!(
            second.queued,
            "second back-to-back send must observe queued = true",
        );

        let (tx, rx) = broadcast::channel::<HarnessOutbound>(8);
        tx.send(text_delta("second-turn")).expect("seed delta");
        tx.send(end_event()).expect("seed end");
        drop(tx);

        let stream = build_sse_stream(rx, /* is_new */ false, second.queued);
        tokio::pin!(stream);
        let first_evt = dump(
            &stream
                .next()
                .await
                .expect("queued prefix event")
                .expect("ok"),
        );
        let next_evt = dump(
            &stream
                .next()
                .await
                .expect("forwarded text delta")
                .expect("ok"),
        );
        assert!(
            first_evt.contains("queued"),
            "queued progress event must precede the forwarded text delta",
        );
        assert!(
            next_evt.contains("second-turn"),
            "forwarded broadcast event must follow the queued prefix",
        );

        drop(second.guard);
        assert_eq!(
            counter.load(Ordering::Acquire),
            0,
            "both guards dropped should leave the counter at zero",
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
        }))
        .expect("seed turn_in_progress error");
        drop(tx);

        let stream = harness_broadcast_to_sse(rx);
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
            !body.to_ascii_lowercase().contains("turn is currently in progress")
                && !body.contains("turn_in_progress"),
            "remapped event must NOT leak the raw harness wording, got: {body}"
        );

        let next = tokio::time::timeout(Duration::from_millis(100), stream.next()).await;
        assert!(
            matches!(next, Ok(None)),
            "stream must close after the remapped error event, got: {next:?}"
        );
    }
}
