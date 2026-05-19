//! Message-shaped dispatch arms: `AssistantMessageStart`, `TextDelta`,
//! `ThinkingDelta`, `AssistantMessageEnd`, and the `Error` arm
//! (including the synthesized-end fallback when the harness errors
//! before producing any content).

use serde_json::{json, Value};
use tokio::sync::broadcast;
use tracing::warn;

use super::super::event_bus::publish_assistant_message_end_event;
use super::super::persist::ChatPersistCtx;
use super::super::persist_task::{
    flush_text_segment, log_stream_summary, message_id_for_synth, message_id_str, persist_event,
    PersistTaskState,
};

pub(super) async fn handle_message_start(
    state: &mut PersistTaskState,
    ctx: &ChatPersistCtx,
    message_id: &str,
) {
    state.message_id = message_id.to_string();
    if persist_event(
        ctx,
        "assistant_message_start",
        json!({
            "message_id": message_id,
            "seq": state.seq,
        }),
    )
    .await
    {
        state.persisted_events += 1;
    }
}

pub(super) async fn handle_text_delta(
    state: &mut PersistTaskState,
    ctx: &ChatPersistCtx,
    text: &str,
) {
    state.text_delta_count += 1;
    state.total_text_bytes += text.len();
    state.full_text.push_str(text);
    state.text_segment.push_str(text);
    if persist_event(
        ctx,
        "text_delta",
        json!({
            "message_id": &state.message_id,
            "text": text,
            "seq": state.seq,
        }),
    )
    .await
    {
        state.persisted_events += 1;
    }
}

pub(super) async fn handle_thinking_delta(
    state: &mut PersistTaskState,
    ctx: &ChatPersistCtx,
    thinking: &str,
) {
    state.thinking_delta_count += 1;
    state.total_thinking_bytes += thinking.len();
    state.thinking_buf.push_str(thinking);
    if persist_event(
        ctx,
        "thinking_delta",
        json!({
            "message_id": &state.message_id,
            "thinking": thinking,
            "seq": state.seq,
        }),
    )
    .await
    {
        state.persisted_events += 1;
    }
}

pub(super) async fn handle_message_end(
    state: &mut PersistTaskState,
    ctx: &ChatPersistCtx,
    event_bus: &broadcast::Sender<Value>,
    end: &aura_os_harness::AssistantMessageEnd,
    model: Option<&str>,
) {
    flush_text_segment(state);
    let payload = json!({
        "message_id": &end.message_id,
        "text": &state.full_text,
        "thinking": if state.thinking_buf.is_empty() {
            Value::Null
        } else {
            Value::String(state.thinking_buf.clone())
        },
        "content_blocks": &state.content_blocks,
        "usage": &end.usage,
        "files_changed": &end.files_changed,
        "stop_reason": &end.stop_reason,
        "seq": state.seq,
    });
    if persist_event(ctx, "assistant_message_end", payload).await {
        state.persisted_events += 1;
        state.end_persisted = true;
        publish_assistant_message_end_event(event_bus, ctx, &end.message_id);
        log_stream_summary(
            state,
            ctx,
            model,
            &end.stop_reason,
            false,
            "assistant_message_end",
        );
    }
}

pub(super) async fn handle_error(
    state: &mut PersistTaskState,
    ctx: &ChatPersistCtx,
    event_bus: &broadcast::Sender<Value>,
    err: &aura_os_harness::ErrorMsg,
    model: Option<&str>,
) {
    if persist_event(
        ctx,
        "error",
        json!({
            "message_id": &state.message_id,
            "code": &err.code,
            "message": &err.message,
            "recoverable": err.recoverable,
            "seq": state.seq,
        }),
    )
    .await
    {
        state.persisted_events += 1;
    }

    if state.end_persisted
        || !state.full_text.is_empty()
        || !state.content_blocks.is_empty()
        || !state.thinking_buf.is_empty()
    {
        return;
    }

    synthesize_error_message_end(state, ctx, event_bus, err, model).await;
}

/// If the harness errored before producing any text, thinking, or
/// tool blocks (e.g. auth, credits, provider 4xx on first byte), no
/// `assistant_message_end` will ever arrive. The broadcast-closed
/// safety net only fires when *some* output has accumulated, so the
/// turn would otherwise round-trip as "user message with no assistant
/// reply" on every reopen. Persist a minimal synthesized end row here
/// so the turn is recoverable.
async fn synthesize_error_message_end(
    state: &mut PersistTaskState,
    ctx: &ChatPersistCtx,
    event_bus: &broadcast::Sender<Value>,
    err: &aura_os_harness::ErrorMsg,
    model: Option<&str>,
) {
    let err_summary = if err.message.trim().is_empty() {
        format!("(agent error: {})", err.code)
    } else {
        format!("(agent error: {})", err.message)
    };
    let end_payload = json!({
        "message_id": message_id_for_synth(state),
        "text": err_summary,
        "thinking": Value::Null,
        "content_blocks": [],
        "usage": Value::Null,
        "files_changed": {
            "created": [],
            "modified": [],
            "deleted": [],
        },
        "stop_reason": "error",
        "seq": state.seq + 1,
        "synthesized": true,
        "error_code": &err.code,
    });
    if persist_event(ctx, "assistant_message_end", end_payload).await {
        state.persisted_events += 1;
        state.end_persisted = true;
        publish_assistant_message_end_event(event_bus, ctx, message_id_str(state));
        log_stream_summary(state, ctx, model, "error", true, "error");
        warn!(
            session_id = %ctx.session_id,
            error_code = %err.code,
            "Synthesized assistant_message_end after early harness error"
        );
    }
}
