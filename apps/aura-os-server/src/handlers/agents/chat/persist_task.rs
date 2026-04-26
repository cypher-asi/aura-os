//! Background task that drains the harness outbound stream into
//! storage events and publishes lifecycle/progress signals onto the
//! WebSocket event bus.

use aura_os_harness::HarnessOutbound;
use serde_json::{json, Value};
use tokio::sync::broadcast;
use tracing::{error, warn};

use super::constants::ASSISTANT_TURN_PROGRESS_THROTTLE;
use super::event_bus::{
    publish_assistant_message_end_event, publish_assistant_turn_progress_event,
};
use super::persist::ChatPersistCtx;
use super::persist_task_dispatch::handle_outbound;

/// Mutable state accumulated across the streamed assistant turn. Holds
/// the full text, thinking, content_blocks, and bookkeeping needed to
/// either persist the harness's `assistant_message_end` or synthesize a
/// terminating row when the harness errors / disconnects early.
pub(super) struct PersistTaskState {
    pub(super) full_text: String,
    pub(super) text_segment: String,
    pub(super) thinking_buf: String,
    pub(super) content_blocks: Vec<Value>,
    pub(super) message_id: String,
    pub(super) seq: u32,
    pub(super) last_tool_use_id: String,
    pub(super) persisted_events: u32,
    pub(super) end_persisted: bool,
    last_progress_at: Option<std::time::Instant>,
}

impl PersistTaskState {
    fn new() -> Self {
        Self {
            full_text: String::new(),
            text_segment: String::new(),
            thinking_buf: String::new(),
            content_blocks: Vec::new(),
            message_id: String::new(),
            seq: 0,
            last_tool_use_id: String::new(),
            persisted_events: 0,
            end_persisted: false,
            last_progress_at: None,
        }
    }
}

pub(crate) fn spawn_chat_persist_task(
    rx: broadcast::Receiver<HarnessOutbound>,
    ctx: ChatPersistCtx,
    event_bus: broadcast::Sender<Value>,
) {
    tokio::spawn(async move { run_persist_loop(rx, ctx, event_bus).await });
}

async fn run_persist_loop(
    mut rx: broadcast::Receiver<HarnessOutbound>,
    ctx: ChatPersistCtx,
    event_bus: broadcast::Sender<Value>,
) {
    let mut state = PersistTaskState::new();
    loop {
        match rx.recv().await {
            Ok(evt) => {
                state.seq += 1;
                let produced_progress = handle_outbound(&mut state, &ctx, &event_bus, &evt).await;
                if matches!(
                    evt,
                    HarnessOutbound::AssistantMessageEnd(_) | HarnessOutbound::Error(_)
                ) {
                    break;
                }
                maybe_publish_progress(&mut state, &ctx, &event_bus, produced_progress);
            }
            Err(broadcast::error::RecvError::Closed) => break,
            Err(broadcast::error::RecvError::Lagged(n)) => {
                warn!(
                    session_id = %ctx.session_id,
                    project_agent_id = %ctx.project_agent_id,
                    skipped = n,
                    "Chat persistence receiver lagged; continuing to drain so the assistant_message_end is not lost"
                );
                continue;
            }
        }
    }
    finalize_if_needed(&mut state, &ctx, &event_bus).await;
}

fn maybe_publish_progress(
    state: &mut PersistTaskState,
    ctx: &ChatPersistCtx,
    event_bus: &broadcast::Sender<Value>,
    produced_progress: bool,
) {
    // Throttled live-progress heartbeat. The client uses this signal
    // (carried over the WS event bus) to refetch the chat history and
    // pick up the in-flight reconstructed assistant turn — supporting
    // mid-turn page refreshes without losing chat / sidekick state. We
    // deliberately do not ship token-level deltas here; the periodic
    // refetch is enough because `events_to_session_history` already
    // rebuilds the partial turn from the persisted delta rows.
    // `assistant_message_end` continues to be the authoritative
    // finalization signal.
    if !produced_progress {
        return;
    }
    let now = std::time::Instant::now();
    let should_publish = match state.last_progress_at {
        None => true,
        Some(prev) => now.saturating_duration_since(prev) >= ASSISTANT_TURN_PROGRESS_THROTTLE,
    };
    if should_publish && !state.message_id.is_empty() {
        publish_assistant_turn_progress_event(event_bus, ctx, &state.message_id);
        state.last_progress_at = Some(now);
    }
}

/// Safety net: the broadcast channel closed before the harness emitted
/// `assistant_message_end` (e.g. the stream task panicked, the client
/// disconnected mid-turn, or a provider-side hard error). Synthesize a
/// terminating event from whatever we have accumulated so the LLM can
/// see at least a partial record of this turn on the next reopen.
async fn finalize_if_needed(
    state: &mut PersistTaskState,
    ctx: &ChatPersistCtx,
    event_bus: &broadcast::Sender<Value>,
) {
    if state.end_persisted {
        return;
    }
    if state.full_text.is_empty()
        && state.content_blocks.is_empty()
        && state.thinking_buf.is_empty()
    {
        return;
    }
    flush_text_segment(state);
    let end_payload = json!({
        "message_id": message_id_for_synth(state),
        "text": &state.full_text,
        "thinking": if state.thinking_buf.is_empty() {
            Value::Null
        } else {
            Value::String(state.thinking_buf.clone())
        },
        "content_blocks": &state.content_blocks,
        "usage": Value::Null,
        "files_changed": {
            "created": [],
            "modified": [],
            "deleted": [],
        },
        "stop_reason": "aborted",
        "seq": state.seq + 1,
        "synthesized": true,
    });
    if persist_event(ctx, "assistant_message_end", end_payload).await {
        state.persisted_events += 1;
        publish_assistant_message_end_event(event_bus, ctx, message_id_str(state));
    }
    warn!(
        session_id = %ctx.session_id,
        persisted_events = state.persisted_events,
        content_blocks = state.content_blocks.len(),
        "Synthesized assistant_message_end after broadcast channel closed early"
    );
}

pub(super) fn flush_text_segment(state: &mut PersistTaskState) {
    if state.text_segment.is_empty() {
        return;
    }
    state.content_blocks.push(json!({
        "type": "text",
        "text": &state.text_segment,
    }));
    state.text_segment.clear();
}

pub(super) fn message_id_for_synth(state: &PersistTaskState) -> Value {
    if state.message_id.is_empty() {
        Value::Null
    } else {
        Value::String(state.message_id.clone())
    }
}

pub(super) fn message_id_str(state: &PersistTaskState) -> &str {
    if state.message_id.is_empty() {
        ""
    } else {
        state.message_id.as_str()
    }
}

pub(super) async fn persist_event(ctx: &ChatPersistCtx, event_type: &str, content: Value) -> bool {
    let req = aura_os_storage::CreateSessionEventRequest {
        session_id: Some(ctx.session_id.clone()),
        user_id: None,
        agent_id: Some(ctx.project_agent_id.clone()),
        sender: Some("agent".to_string()),
        project_id: Some(ctx.project_id.clone()),
        org_id: None,
        event_type: event_type.to_string(),
        content: Some(content),
    };
    match ctx
        .storage
        .create_event(&ctx.session_id, &ctx.jwt, &req)
        .await
    {
        Ok(_) => true,
        Err(e) => {
            error!(
                error = %e,
                session_id = %ctx.session_id,
                project_agent_id = %ctx.project_agent_id,
                event_type = %event_type,
                "Failed to persist chat event"
            );
            false
        }
    }
}
