//! Background task that drains the harness outbound stream into
//! storage events and publishes lifecycle/progress signals onto the
//! WebSocket event bus.

use std::sync::Arc;

use aura_os_harness::HarnessOutbound;
use aura_os_storage::StorageClient;
use serde_json::{json, Value};
use tokio::sync::broadcast;
use tracing::{debug, error, info, warn};

use super::constants::ASSISTANT_TURN_PROGRESS_THROTTLE;
use super::cross_agent_reply::spawn_cross_agent_reply_callback;
use super::event_bus::{
    publish_assistant_message_end_event, publish_assistant_turn_progress_event,
};
use super::persist::ChatPersistCtx;
use super::persist_task_dispatch::handle_outbound;
use crate::stability_metrics::StabilityMetrics;

/// Bundle of process-wide handles the persist task needs above and
/// beyond the `ChatPersistCtx`. Held alongside `ctx` so the
/// auto-fork-on-context-pressure spawn (Phase 3 of the agent-stream
/// reliability plan) can call back into `generate_session_summary`
/// and update the storage row without dragging the full `AppState`
/// through the chat hot path. Equivalent in spirit to
/// `spawn_session_title_task`'s opt-in plumbing.
#[derive(Clone)]
pub(crate) struct ChatPersistTaskExtras {
    pub http_client: reqwest::Client,
    pub router_url: String,
    pub auto_fork_threshold: f64,
    /// Phase 5 observability bag. The persist task is the canonical
    /// "did this turn make it" observer — bumps `chat_turns_completed_ok`
    /// on a clean `AssistantMessageEnd` and `auto_fork_triggered`
    /// when the threshold marker fires. `Option` so the existing
    /// `persist_task_dispatch` unit tests can construct extras
    /// without needing a real `StabilityMetrics` instance.
    pub stability_metrics: Option<Arc<StabilityMetrics>>,
}

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
    pub(super) text_delta_count: u32,
    pub(super) thinking_delta_count: u32,
    pub(super) tool_use_count: u32,
    pub(super) total_text_bytes: usize,
    pub(super) total_thinking_bytes: usize,
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
            text_delta_count: 0,
            thinking_delta_count: 0,
            tool_use_count: 0,
            total_text_bytes: 0,
            total_thinking_bytes: 0,
            last_progress_at: None,
        }
    }
}

pub(crate) fn spawn_chat_persist_task(
    rx: broadcast::Receiver<HarnessOutbound>,
    ctx: ChatPersistCtx,
    event_bus: broadcast::Sender<Value>,
    model: Option<String>,
    extras: ChatPersistTaskExtras,
) {
    tokio::spawn(async move { run_persist_loop(rx, ctx, event_bus, model, extras).await });
}

async fn run_persist_loop(
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

/// Phase 3 auto-fork trigger. When the just-finalized assistant turn
/// reports `usage.context_utilization >= AURA_CHAT_AUTO_FORK_THRESHOLD`,
/// detach a background task that summarises the session and flags the
/// storage row `rolled_over`. The next user send to this partition
/// observes the flag in `resolve_chat_session_with_pin` and
/// transparently mints a fresh session via
/// `SessionService::create_chat_followup_session` carrying the summary
/// forward — the user never has to click `+`.
fn maybe_spawn_auto_fork_marker(
    ctx: &ChatPersistCtx,
    end: &aura_os_harness::AssistantMessageEnd,
    extras: &ChatPersistTaskExtras,
) {
    let utilization = end.usage.context_utilization as f64;
    if !utilization.is_finite() || utilization < extras.auto_fork_threshold {
        return;
    }
    info!(
        session_id = %ctx.session_id,
        project_agent_id = %ctx.project_agent_id,
        utilization,
        threshold = extras.auto_fork_threshold,
        "Marked chat session for auto-fork at next user send"
    );
    if let Some(metrics) = extras.stability_metrics.as_ref() {
        metrics.inc_auto_fork_triggered();
    }
    let ctx = ctx.clone();
    let extras = extras.clone();
    tokio::spawn(async move {
        run_auto_fork_marker(ctx, extras, utilization).await;
    });
}

async fn run_auto_fork_marker(
    ctx: ChatPersistCtx,
    extras: ChatPersistTaskExtras,
    utilization: f64,
) {
    // 1. Best-effort summarisation. `generate_session_summary` returns
    // an empty string when there's nothing useful to summarise (e.g.
    // every turn was tool-use only). Fall back to a static label so
    // the next session at least carries the context-pressure trigger
    // forward instead of an empty summary that
    // `create_chat_followup_session` would drop.
    let summary = generate_rollover_summary_for_session(&ctx, &extras).await;
    persist_rollover_summary_event(&ctx, &summary, utilization).await;
    mark_storage_session_rolled_over(&ctx).await;
}

async fn generate_rollover_summary_for_session(
    ctx: &ChatPersistCtx,
    extras: &ChatPersistTaskExtras,
) -> String {
    // Stringify the typed session id once at this storage boundary;
    // `generate_session_summary` keeps `&str` to match the REST shape.
    let session_id_str = ctx.session_id.to_string();
    let result = crate::handlers::agents::sessions::generate_session_summary(
        &ctx.storage,
        &extras.http_client,
        &extras.router_url,
        &ctx.jwt,
        &session_id_str,
        &ctx.project_id,
        &ctx.project_agent_id,
    )
    .await;
    match result {
        Ok(summary) if !summary.trim().is_empty() => summary,
        Ok(_) => {
            info!(
                session_id = %ctx.session_id,
                "Auto-fork summary was empty; using fallback label"
            );
            "Continued from a long conversation (no summary available).".to_string()
        }
        Err(error) => {
            warn!(
                session_id = %ctx.session_id,
                %error,
                "Auto-fork summary generation failed; using fallback label"
            );
            "Continued from a long conversation (no summary available).".to_string()
        }
    }
}

async fn persist_rollover_summary_event(ctx: &ChatPersistCtx, summary: &str, utilization: f64) {
    let payload = json!({
        "summary": summary,
        "trigger": "context_pressure",
        "utilization": utilization,
    });
    if !persist_event(ctx, "rollover_summary", payload).await {
        warn!(
            session_id = %ctx.session_id,
            "Failed to persist rollover_summary event; next send will fall back to a generic summary"
        );
    }
}

async fn mark_storage_session_rolled_over(ctx: &ChatPersistCtx) {
    let req = aura_os_storage::UpdateSessionRequest {
        status: Some("rolled_over".to_string()),
        total_input_tokens: None,
        total_output_tokens: None,
        context_usage_estimate: None,
        summary_of_previous_context: None,
        tasks_worked_count: None,
        ended_at: Some(chrono::Utc::now().to_rfc3339()),
    };
    if let Err(error) =
        update_session_with_storage(&ctx.storage, &ctx.session_id.to_string(), &ctx.jwt, &req).await
    {
        warn!(
            session_id = %ctx.session_id,
            %error,
            "Failed to flag chat session rolled_over; auto-fork will rely on the context_usage_estimate fallback"
        );
    }
}

async fn update_session_with_storage(
    storage: &Arc<StorageClient>,
    session_id: &str,
    jwt: &str,
    req: &aura_os_storage::UpdateSessionRequest,
) -> Result<(), aura_os_storage::StorageError> {
    storage.update_session(session_id, jwt, req).await
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

pub(super) fn log_stream_summary(
    state: &PersistTaskState,
    ctx: &ChatPersistCtx,
    model: Option<&str>,
    stop_reason: &str,
    synthesized: bool,
    terminal_event: &str,
) {
    info!(
        session_id = %ctx.session_id,
        project_agent_id = %ctx.project_agent_id,
        agent_id = ?ctx.agent_id,
        model = ?model,
        text_delta_count = state.text_delta_count,
        thinking_delta_count = state.thinking_delta_count,
        tool_use_count = state.tool_use_count,
        total_text_bytes = state.total_text_bytes,
        total_thinking_bytes = state.total_thinking_bytes,
        persisted_events = state.persisted_events,
        content_blocks = state.content_blocks.len(),
        stop_reason,
        synthesized,
        terminal_event,
        "assistant stream output summary",
    );
}

pub(crate) async fn persist_event(ctx: &ChatPersistCtx, event_type: &str, content: Value) -> bool {
    // Stringify the typed `SessionId` once at this storage-write
    // boundary: `CreateSessionEventRequest.session_id` is the
    // `aura_os_storage` REST shape (still `Option<String>`), and the
    // `create_event` URL segment is `&str`.
    let session_id_str = ctx.session_id.to_string();
    let req = aura_os_storage::CreateSessionEventRequest {
        session_id: Some(session_id_str.clone()),
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
        .create_event(&session_id_str, &ctx.jwt, &req)
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

#[cfg(test)]
mod tests {
    use super::*;
    use aura_os_harness::{AssistantMessageEnd, FilesChanged, SessionUsage};

    /// Phase 5 wiring guard: when `maybe_spawn_auto_fork_marker` fires
    /// because the assistant turn's `usage.context_utilization`
    /// exceeded the configured threshold, it must bump
    /// [`crate::stability_metrics::StabilityMetrics::inc_auto_fork_triggered`]
    /// once. The synchronous prefix runs before the spawned summary
    /// task so this test does NOT need to await any background work
    /// — the increment happens on the calling thread.
    ///
    /// Constructs a minimal `ChatPersistCtx` via a temporary storage
    /// client; the marker function only reads `ctx.session_id` /
    /// `project_agent_id` for log fields and never actually invokes
    /// the storage client when the threshold path is short-circuited
    /// in this thread (the spawned task is detached and can race the
    /// test's drop without tripping the assertion).
    #[tokio::test]
    async fn maybe_spawn_auto_fork_marker_increments_triggered_counter_when_over_threshold() {
        let metrics = Arc::new(StabilityMetrics::new());
        let extras = ChatPersistTaskExtras {
            http_client: reqwest::Client::new(),
            router_url: "http://localhost:9999".to_string(),
            auto_fork_threshold: 0.8,
            stability_metrics: Some(Arc::clone(&metrics)),
        };
        let ctx = ChatPersistCtx {
            storage: Arc::new(aura_os_storage::StorageClient::with_base_url(
                "http://localhost:9999",
            )),
            session_id: aura_os_core::SessionId::new(),
            project_id: "project-test".to_string(),
            project_agent_id: "00000000-0000-0000-0000-000000000aaa".to_string(),
            agent_id: None,
            originating_agent_id: None,
            cross_agent_depth: 0,
            jwt: "jwt".to_string(),
            from_agent_id: None,
        };
        let mut end = AssistantMessageEnd {
            message_id: "msg-1".to_string(),
            stop_reason: "stop".to_string(),
            usage: SessionUsage::default(),
            files_changed: FilesChanged::default(),
            originating_user_id: None,
        };
        end.usage.context_utilization = 0.9;

        maybe_spawn_auto_fork_marker(&ctx, &end, &extras);

        let snapshot = metrics.snapshot();
        assert_eq!(
            snapshot.auto_fork_triggered, 1,
            "auto_fork_triggered must advance on first over-threshold finalization"
        );
    }

    /// Negative case: utilization below threshold must NOT advance
    /// the counter. Pins the threshold gating logic so a future
    /// reorder of the early-return doesn't silently leak triggered
    /// events.
    #[tokio::test]
    async fn maybe_spawn_auto_fork_marker_skips_increment_when_below_threshold() {
        let metrics = Arc::new(StabilityMetrics::new());
        let extras = ChatPersistTaskExtras {
            http_client: reqwest::Client::new(),
            router_url: "http://localhost:9999".to_string(),
            auto_fork_threshold: 0.8,
            stability_metrics: Some(Arc::clone(&metrics)),
        };
        let ctx = ChatPersistCtx {
            storage: Arc::new(aura_os_storage::StorageClient::with_base_url(
                "http://localhost:9999",
            )),
            session_id: aura_os_core::SessionId::new(),
            project_id: "project-test".to_string(),
            project_agent_id: "00000000-0000-0000-0000-000000000aaa".to_string(),
            agent_id: None,
            originating_agent_id: None,
            cross_agent_depth: 0,
            jwt: "jwt".to_string(),
            from_agent_id: None,
        };
        let mut end = AssistantMessageEnd {
            message_id: "msg-1".to_string(),
            stop_reason: "stop".to_string(),
            usage: SessionUsage::default(),
            files_changed: FilesChanged::default(),
            originating_user_id: None,
        };
        end.usage.context_utilization = 0.5;

        maybe_spawn_auto_fork_marker(&ctx, &end, &extras);

        let snapshot = metrics.snapshot();
        assert_eq!(
            snapshot.auto_fork_triggered, 0,
            "auto_fork_triggered must not advance below the threshold"
        );
    }
}
