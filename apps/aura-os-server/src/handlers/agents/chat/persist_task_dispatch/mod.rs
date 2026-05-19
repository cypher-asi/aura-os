//! Per-event dispatch for the chat-persistence task. Pattern-matches
//! the inbound [`HarnessOutbound`] and forwards to focused handlers
//! (message vs tool vs error) that own the persistence + state-mutation
//! work. Public surface is just [`handle_outbound`].

use aura_os_harness::HarnessOutbound;
use serde_json::Value;
use tokio::sync::broadcast;

use super::persist::ChatPersistCtx;
use super::persist_task::PersistTaskState;

mod message;
mod normalize;
mod tool;

use message::{
    handle_error, handle_message_end, handle_message_start, handle_text_delta,
    handle_thinking_delta,
};
use tool::{handle_tool_call_snapshot, handle_tool_result, handle_tool_use_start};

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
            // Use the wire `tool_use_id` whenever the harness supplies it.
            // Falling back to `state.last_tool_use_id` is a back-compat
            // shim for older harness builds; new builds (post the parallel
            // tool-call protocol fix) always set it. See the doc-comment
            // on `handle_tool_result` for why preferring the wire id is
            // load-bearing for parallel tool calls.
            handle_tool_result(
                state,
                ctx,
                result.tool_use_id.as_deref(),
                &result.name,
                &result.result,
                result.is_error,
            )
            .await;
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
        | HarnessOutbound::ToolApprovalPrompt(_)
        // Progress heartbeats from the harness (Phase 6: `tool_running`
        // ticks every `AURA_TURN_TOOL_HEARTBEAT_INTERVAL_SECS`) are
        // transient liveness signals, not persistable turn progress —
        // they already flow through to the SSE forwarder so the chat
        // watchdog sees forward motion. We don't write them to
        // `SessionEvent`s and don't bump the throttled progress
        // publish (Progress is itself the progress publish).
        | HarnessOutbound::Progress(_) => false,
    }
}
