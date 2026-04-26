//! Per-event handlers used by the chat-persistence task. Split out of
//! `persist_task.rs` to keep both files within the 500-line cap.

use aura_os_harness::HarnessOutbound;
use serde_json::{json, Value};
use tokio::sync::broadcast;
use tracing::warn;

use super::event_bus::publish_assistant_message_end_event;
use super::persist::ChatPersistCtx;
use super::persist_task::{
    flush_text_segment, log_stream_summary, message_id_for_synth, message_id_str, persist_event,
    PersistTaskState,
};

/// Dispatch a single harness outbound event. Returns `true` when the
/// event represents user-visible turn progress (text, thinking, tool
/// activity) that should fire a throttled progress publish at the end
/// of the loop iteration.
pub(super) async fn handle_outbound(
    state: &mut PersistTaskState,
    ctx: &ChatPersistCtx,
    event_bus: &broadcast::Sender<Value>,
    evt: &HarnessOutbound,
    model: Option<&str>,
) -> bool {
    match evt {
        HarnessOutbound::AssistantMessageStart(start) => {
            handle_message_start(state, ctx, &start.message_id).await;
            true
        }
        HarnessOutbound::TextDelta(delta) => {
            handle_text_delta(state, ctx, &delta.text).await;
            true
        }
        HarnessOutbound::ThinkingDelta(delta) => {
            handle_thinking_delta(state, ctx, &delta.thinking).await;
            true
        }
        HarnessOutbound::ToolUseStart(tool) => {
            handle_tool_use_start(state, ctx, &tool.id, &tool.name).await;
            true
        }
        HarnessOutbound::ToolCallSnapshot(snap) => {
            handle_tool_call_snapshot(state, ctx, &snap.id, &snap.name, &snap.input).await;
            true
        }
        HarnessOutbound::ToolResult(result) => {
            handle_tool_result(state, ctx, &result.name, &result.result, result.is_error).await;
            true
        }
        HarnessOutbound::AssistantMessageEnd(end) => {
            handle_message_end(state, ctx, event_bus, end, model).await;
            false
        }
        HarnessOutbound::Error(err) => {
            handle_error(state, ctx, event_bus, err, model).await;
            false
        }
        HarnessOutbound::SessionReady(_)
        | HarnessOutbound::GenerationStart(_)
        | HarnessOutbound::GenerationProgress(_)
        | HarnessOutbound::GenerationPartialImage(_)
        | HarnessOutbound::GenerationCompleted(_)
        | HarnessOutbound::GenerationError(_)
        | HarnessOutbound::ToolApprovalPrompt(_) => false,
    }
}

async fn handle_message_start(
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

async fn handle_text_delta(state: &mut PersistTaskState, ctx: &ChatPersistCtx, text: &str) {
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

async fn handle_thinking_delta(state: &mut PersistTaskState, ctx: &ChatPersistCtx, thinking: &str) {
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

async fn handle_tool_use_start(
    state: &mut PersistTaskState,
    ctx: &ChatPersistCtx,
    id: &str,
    name: &str,
) {
    state.tool_use_count += 1;
    flush_text_segment(state);
    state.last_tool_use_id = id.to_string();
    state.content_blocks.push(json!({
        "type": "tool_use",
        "id": id,
        "name": name,
        "input": Value::Null,
    }));
    if persist_event(
        ctx,
        "tool_use_start",
        json!({
            "message_id": &state.message_id,
            "id": id,
            "name": name,
            "seq": state.seq,
        }),
    )
    .await
    {
        state.persisted_events += 1;
    }
}

async fn handle_tool_call_snapshot(
    state: &mut PersistTaskState,
    ctx: &ChatPersistCtx,
    id: &str,
    name: &str,
    input: &Value,
) {
    update_or_append_tool_use_input(state, id, name, input);
    if persist_event(
        ctx,
        "tool_call_snapshot",
        json!({
            "message_id": &state.message_id,
            "id": id,
            "name": name,
            "input": input,
            "seq": state.seq,
        }),
    )
    .await
    {
        state.persisted_events += 1;
    }
}

fn update_or_append_tool_use_input(
    state: &mut PersistTaskState,
    id: &str,
    name: &str,
    input: &Value,
) {
    if let Some(block) = state.content_blocks.iter_mut().rev().find(|b| {
        b.get("type").and_then(|t| t.as_str()) == Some("tool_use")
            && b.get("id").and_then(|i| i.as_str()) == Some(id)
    }) {
        block["input"] = input.clone();
    } else {
        state.content_blocks.push(json!({
            "type": "tool_use",
            "id": id,
            "name": name,
            "input": input,
        }));
    }
}

async fn handle_tool_result(
    state: &mut PersistTaskState,
    ctx: &ChatPersistCtx,
    name: &str,
    result: &str,
    is_error: bool,
) {
    backfill_null_tool_use_input(state);

    state.content_blocks.push(json!({
        "type": "tool_result",
        "tool_use_id": &state.last_tool_use_id,
        "content": result,
        "is_error": is_error,
    }));
    if persist_event(
        ctx,
        "tool_result",
        json!({
            "message_id": &state.message_id,
            "tool_use_id": &state.last_tool_use_id,
            "name": name,
            "result": result,
            "is_error": is_error,
            "seq": state.seq,
        }),
    )
    .await
    {
        state.persisted_events += 1;
    }
}

/// Fill in any tool_use block that still has a null input. Non-streaming
/// tools never emit a snapshot, so without this recovery the persisted
/// tool_use block would round-trip with `input: null` and be rejected by
/// the LLM on replay.
fn backfill_null_tool_use_input(state: &mut PersistTaskState) {
    if let Some(block) = state.content_blocks.iter_mut().rev().find(|b| {
        b.get("type").and_then(|t| t.as_str()) == Some("tool_use")
            && b.get("id").and_then(|i| i.as_str()) == Some(state.last_tool_use_id.as_str())
    }) {
        if block.get("input") == Some(&Value::Null) {
            block["input"] = json!({});
        }
    }
}

async fn handle_message_end(
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

async fn handle_error(
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
