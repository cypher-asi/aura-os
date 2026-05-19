//! Per-turn drain loop: consume the harness outbound broadcast, fan each event into the right dispatch arm, fire the auto-fork bookkeeping on a clean terminal, and synthesise an `assistant_message_end` row if the broadcast closes before the harness produced one.

use aura_os_harness::HarnessOutbound;
use serde_json::{json, Value};
use tokio::sync::broadcast;
use tracing::{debug, warn};

use super::super::constants::ASSISTANT_TURN_PROGRESS_THROTTLE;
use super::super::cross_agent_reply::spawn_cross_agent_reply_callback;
use super::super::event_bus::{
    publish_assistant_message_end_event, publish_assistant_turn_progress_event,
};
use super::super::persist::ChatPersistCtx;
use super::super::persist_task_dispatch::handle_outbound;
use super::auto_fork::maybe_spawn_auto_fork_marker;
use super::persist_event::persist_event;
use super::state::{
    flush_text_segment, log_stream_summary, message_id_for_synth, message_id_str, PersistTaskState,
};
use super::ChatPersistTaskExtras;

pub(super) async fn run_persist_loop(
    mut rx: broadcast::Receiver<HarnessOutbound>,
    ctx: ChatPersistCtx,
    event_bus: broadcast::Sender<Value>,
    model: Option<String>,
    extras: ChatPersistTaskExtras,
) {
    // Phase 6 cross-agent observability breadcrumb. Phase 3 will read
    // `ctx.originating_agent_id` from inside this task to post B's
    // reply back into A's session on `AssistantMessageEnd`; logging
    // it on entry gives operators a single grep target
    // (`target = "aura::cross_agent"`) for tracing a `send_to_agent`
    // hop end-to-end across the harness ↔ os-server boundary.
    debug!(
        target: "aura::cross_agent",
        session_id = %ctx.session_id,
        project_agent_id = %ctx.project_agent_id,
        originating_agent_id = ?ctx.originating_agent_id,
        "persist_task started"
    );
    let mut state = PersistTaskState::new();
    // Phase 5 observability: a turn is "completed_ok" only when the
    // persist task observes a clean `AssistantMessageEnd` AND no
    // `Error` event preceded it on this broadcast. An error before
    // end (or instead of end) flips this to false so the
    // `chat_turns_completed_ok` counter advances exactly once per
    // genuinely-clean turn.
    let mut saw_error = false;
    loop {
        match rx.recv().await {
            Ok(evt) => {
                state.seq += 1;
                // Phase 6 cross-agent observability breadcrumb. Pairs with
                // `aura::ws::publishing chat event` (event_bus.rs) so an
                // operator filtering on `aura::cross_agent` can see "did
                // the persist task even observe this harness event" right
                // alongside "did the WS broadcast fire". Variant kind is
                // a short string instead of `{:?}` so the log line stays
                // the same length regardless of payload size.
                debug!(
                    target: "aura::cross_agent",
                    session_id = %ctx.session_id,
                    event = harness_outbound_kind(&evt),
                    "persist_task observed harness event"
                );
                let produced_progress =
                    handle_outbound(&mut state, &ctx, &event_bus, &evt, model.as_deref()).await;
                if matches!(evt, HarnessOutbound::Error(_)) {
                    saw_error = true;
                }
                // Phase 3: peek at the terminal AssistantMessageEnd so
                // we can fire the auto-fork bookkeeping (summary +
                // `rolled_over` flag) into a detached task before this
                // loop breaks. We deliberately do NOT block the
                // turn-finalization sentinel on the summary call: the
                // user-visible turn completes on this session, only the
                // NEXT user send rolls over.
                if let HarnessOutbound::AssistantMessageEnd(end) = &evt {
                    maybe_spawn_auto_fork_marker(&ctx, end, &extras);
                    // Phase 5: clean terminal — only counts if no
                    // `Error` was observed earlier in the same turn.
                    if !saw_error {
                        if let Some(metrics) = extras.stability_metrics.as_ref() {
                            metrics.inc_chat_turns_completed_ok();
                        }
                        // Phase 3 cross-agent reply delivery. When this
                        // turn was opened by another agent's
                        // `send_to_agent` call (Phase 1: harness sets
                        // `originating_agent_id`; Phase 2: server
                        // threads it onto `ChatPersistCtx`), post B's
                        // accumulated reply back into A's session as
                        // a fresh `user_message` so A's LLM gets a
                        // turn to react. Skipped on `saw_error` so
                        // partial / failed turns don't leak garbage
                        // back into the originator's history. The
                        // cycle-depth guard inside the callback fires
                        // belt-and-suspenders alongside the
                        // single-hop `originating_agent_id: null`
                        // body field — see `cross_agent_reply.rs`.
                        // `state.full_text` is populated by the
                        // `text_delta` accumulator in
                        // `persist_task_dispatch::handle_text_delta`
                        // — by the time we observe
                        // `AssistantMessageEnd` it holds the full
                        // assistant reply for this turn.
                        if ctx.originating_agent_id.is_some() {
                            spawn_cross_agent_reply_callback(
                                &ctx,
                                state.full_text.clone(),
                                ctx.cross_agent_depth,
                                extras.http_client.clone(),
                            );
                        }
                    }
                }
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
    finalize_if_needed(&mut state, &ctx, &event_bus, model.as_deref()).await;
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
    model: Option<&str>,
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
        state.end_persisted = true;
        publish_assistant_message_end_event(event_bus, ctx, message_id_str(state));
        log_stream_summary(state, ctx, model, "aborted", true, "broadcast_closed");
    }
    warn!(
        session_id = %ctx.session_id,
        persisted_events = state.persisted_events,
        content_blocks = state.content_blocks.len(),
        "Synthesized assistant_message_end after broadcast channel closed early"
    );
}

/// Phase 6 cross-agent tracing helper. Maps a [`HarnessOutbound`]
/// variant onto a short, stable string so the
/// `aura::cross_agent::"persist_task observed harness event"` log
/// line is greppable without dragging the full event body into the
/// trace output. Keep these strings stable — they are part of the
/// (informal) operator-facing diagnostic surface.
fn harness_outbound_kind(evt: &HarnessOutbound) -> &'static str {
    match evt {
        HarnessOutbound::SessionReady(_) => "session_ready",
        HarnessOutbound::AssistantMessageStart(_) => "assistant_message_start",
        HarnessOutbound::TextDelta(_) => "text_delta",
        HarnessOutbound::ThinkingDelta(_) => "thinking_delta",
        HarnessOutbound::ToolUseStart(_) => "tool_use_start",
        HarnessOutbound::ToolCallSnapshot(_) => "tool_call_snapshot",
        HarnessOutbound::ToolResult(_) => "tool_result",
        HarnessOutbound::ToolApprovalPrompt(_) => "tool_approval_prompt",
        HarnessOutbound::AssistantMessageEnd(_) => "assistant_message_end",
        HarnessOutbound::Error(_) => "error",
        HarnessOutbound::Progress(_) => "progress",
        HarnessOutbound::GenerationStart(_) => "generation_start",
        HarnessOutbound::GenerationProgress(_) => "generation_progress",
        HarnessOutbound::GenerationPartialImage(_) => "generation_partial_image",
        HarnessOutbound::GenerationCompleted(_) => "generation_completed",
        HarnessOutbound::GenerationError(_) => "generation_error",
    }
}
