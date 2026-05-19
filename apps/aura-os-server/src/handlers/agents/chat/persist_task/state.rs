//! Mutable per-turn state and small string helpers shared by the
//! persist task and its dispatch arms. Holds the streamed assistant
//! text, thinking, and content blocks plus bookkeeping for the
//! summary log line emitted on terminal events.

use serde_json::{json, Value};
use tracing::info;

use super::super::persist::ChatPersistCtx;

/// Mutable state accumulated across the streamed assistant turn. Holds
/// the full text, thinking, content_blocks, and bookkeeping needed to
/// either persist the harness's `assistant_message_end` or synthesize a
/// terminating row when the harness errors / disconnects early.
pub(crate) struct PersistTaskState {
    pub(crate) full_text: String,
    pub(crate) text_segment: String,
    pub(crate) thinking_buf: String,
    pub(crate) content_blocks: Vec<Value>,
    pub(crate) message_id: String,
    pub(crate) seq: u32,
    pub(crate) last_tool_use_id: String,
    pub(crate) persisted_events: u32,
    pub(crate) end_persisted: bool,
    pub(crate) text_delta_count: u32,
    pub(crate) thinking_delta_count: u32,
    pub(crate) tool_use_count: u32,
    pub(crate) total_text_bytes: usize,
    pub(crate) total_thinking_bytes: usize,
    pub(crate) last_progress_at: Option<std::time::Instant>,
}

impl PersistTaskState {
    pub(crate) fn new() -> Self {
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

pub(crate) fn flush_text_segment(state: &mut PersistTaskState) {
    if state.text_segment.is_empty() {
        return;
    }
    state.content_blocks.push(json!({
        "type": "text",
        "text": &state.text_segment,
    }));
    state.text_segment.clear();
}

pub(crate) fn message_id_for_synth(state: &PersistTaskState) -> Value {
    if state.message_id.is_empty() {
        Value::Null
    } else {
        Value::String(state.message_id.clone())
    }
}

pub(crate) fn message_id_str(state: &PersistTaskState) -> &str {
    if state.message_id.is_empty() {
        ""
    } else {
        state.message_id.as_str()
    }
}

pub(crate) fn log_stream_summary(
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
