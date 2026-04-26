//! SSE streaming plumbing for chat: harness → SSE bridge, response
//! header construction, attachment translation, and the
//! `open_harness_chat_stream` orchestrator that ties persistence,
//! session lookup, and the SSE response together.

use std::convert::Infallible;

use aura_os_core::HarnessMode;
use aura_os_harness::{
    HarnessOutbound, MessageAttachment, SessionBridge, SessionBridgeStarted, SessionBridgeTurn,
    SessionConfig,
};
use axum::response::sse::{Event, KeepAlive, Sse};
use futures_util::stream;
use futures_util::StreamExt as FuturesStreamExt;
use tracing::{error, info, warn};

use crate::dto::ChatAttachmentDto;
use crate::error::{ApiError, ApiResult};
use crate::handlers::agents::chat::types::sse_response_headers;
use crate::state::{AppState, ChatSession};

use super::errors::{map_session_bridge_error, map_session_bridge_start_error};
use super::event_bus::publish_user_message_event;
use super::persist::{persist_user_message, ChatPersistCtx};
use super::persist_task::spawn_chat_persist_task;
use super::types::{SseResponse, SseStream};

pub(crate) fn harness_broadcast_to_sse(
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
                let event = super::super::super::sse::harness_event_to_sse(&evt);
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
    let (is_new, rx, _) = get_or_create_delegated_chat_session(
        state,
        &session_key,
        harness_mode,
        session_config,
        requested_model,
        turn,
    )
    .await?;

    let persist_rx = rx.resubscribe();

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

    let stream = build_sse_stream(rx, is_new);
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

fn build_sse_stream(
    rx: tokio::sync::broadcast::Receiver<HarnessOutbound>,
    is_new: bool,
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
) -> ApiResult<(
    bool,
    tokio::sync::broadcast::Receiver<HarnessOutbound>,
    aura_os_harness::HarnessCommandSender,
)> {
    if let Some(reused) = try_reuse_session(state, key, &requested_model, &turn).await? {
        return Ok(reused);
    }

    let harness = state.harness_for(harness_mode);
    let session_agent_id = session_config.agent_id.clone();
    let session_template_agent_id = session_config.template_agent_id.clone();
    let started = SessionBridge::open_and_send_user_message(harness, session_config, turn)
        .await
        .map_err(map_session_bridge_start_error(key, harness_mode))?;
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

async fn try_reuse_session(
    state: &AppState,
    key: &str,
    requested_model: &Option<String>,
    turn: &SessionBridgeTurn,
) -> ApiResult<
    Option<(
        bool,
        tokio::sync::broadcast::Receiver<HarnessOutbound>,
        aura_os_harness::HarnessCommandSender,
    )>,
> {
    let mut reg = state.chat_sessions.lock().await;
    let Some(session) = reg.get(key) else {
        return Ok(None);
    };
    if !session.is_alive() {
        return Ok(None);
    }
    if model_changed(&session.model, requested_model) {
        info!(
            key,
            "Model changed; closing existing delegated chat session"
        );
        reg.remove(key);
        return Ok(None);
    }
    SessionBridge::send_user_message(&session.commands_tx, turn.clone())
        .map_err(map_session_bridge_error)?;
    Ok(Some((
        false,
        session.events_tx.subscribe(),
        session.commands_tx.clone(),
    )))
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
) -> ApiResult<(
    bool,
    tokio::sync::broadcast::Receiver<HarnessOutbound>,
    aura_os_harness::HarnessCommandSender,
)> {
    let rx = started.events_rx;
    let commands_tx = started.commands_tx.clone();
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
        },
    );
    Ok((true, rx, commands_tx))
}
