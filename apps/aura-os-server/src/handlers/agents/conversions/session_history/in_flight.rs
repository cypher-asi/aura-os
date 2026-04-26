use aura_os_core::parse_dt;
use aura_os_core::{
    AgentInstanceId, ChatContentBlock, ChatRole, ProjectId, SessionEvent, SessionEventId,
};
use aura_os_storage::StorageSessionEvent;

/// Walk the persisted incremental events for the latest assistant turn that
/// has been started but not yet terminated by `assistant_message_end`, and
/// rebuild a snapshot `SessionEvent` from the deltas. Returns `None` when
/// every started turn has a matching end row, when no `assistant_message_start`
/// has been persisted yet, or when the trailing turn has produced no
/// observable text / thinking / tool blocks at all.
///
/// The reconstruction mirrors `spawn_chat_persist_task` (in `chat.rs`) so the
/// snapshot matches what would have been written out as
/// `assistant_message_end` had the stream completed at this instant. This is
/// what powers mid-turn refresh recovery: the UI gets back the partial text,
/// thinking, and tool cards (including `pending-*` spec/task placeholders) it
/// would have seen had it not lost its in-memory state.
pub(super) fn reconstruct_in_flight_assistant_turn(
    sorted: &[StorageSessionEvent],
    agent_instance_id: AgentInstanceId,
    project_id: ProjectId,
) -> Option<SessionEvent> {
    let (start_idx, target_message_id) = find_latest_in_flight_start(sorted)?;

    let start_event = &sorted[start_idx];
    let parts = collect_assistant_parts(sorted, start_idx, &target_message_id);

    if parts.is_empty() {
        return None;
    }

    Some(parts.into_session_event(agent_instance_id, project_id, &start_event.created_at))
}

fn message_id_of(event: &StorageSessionEvent) -> Option<&str> {
    event
        .content
        .as_ref()
        .and_then(|c| c.get("message_id"))
        .and_then(|v| v.as_str())
}

/// Find the most recent `assistant_message_start` whose `message_id` does
/// not yet have a matching `assistant_message_end`. Returns `(index,
/// message_id)` or `None` if every started turn has terminated.
fn find_latest_in_flight_start(sorted: &[StorageSessionEvent]) -> Option<(usize, String)> {
    let mut latest_start_idx: Option<usize> = None;
    let mut latest_message_id: Option<String> = None;

    for (idx, event) in sorted.iter().enumerate() {
        let event_type = event.event_type.as_deref().unwrap_or("");
        if event_type == "assistant_message_start" {
            if let Some(mid) = message_id_of(event) {
                latest_start_idx = Some(idx);
                latest_message_id = Some(mid.to_string());
            }
        }
    }

    let start_idx = latest_start_idx?;
    let target_message_id = latest_message_id?;

    let already_ended = sorted.iter().skip(start_idx + 1).any(|event| {
        event.event_type.as_deref() == Some("assistant_message_end")
            && message_id_of(event) == Some(target_message_id.as_str())
    });
    if already_ended {
        return None;
    }

    Some((start_idx, target_message_id))
}

/// Accumulator for the streaming-event projection used to rebuild a partial
/// assistant turn. Keeping this in one place lets the per-event-type handlers
/// stay narrow while the orchestrator only exposes the final shape.
struct AssistantParts {
    full_text: String,
    text_segment: String,
    thinking_buf: String,
    blocks: Vec<ChatContentBlock>,
    last_tool_use_id: String,
}

impl AssistantParts {
    fn new() -> Self {
        Self {
            full_text: String::new(),
            text_segment: String::new(),
            thinking_buf: String::new(),
            blocks: Vec::new(),
            last_tool_use_id: String::new(),
        }
    }

    fn is_empty(&self) -> bool {
        self.full_text.is_empty() && self.blocks.is_empty() && self.thinking_buf.is_empty()
    }

    fn into_session_event(
        self,
        agent_instance_id: AgentInstanceId,
        project_id: ProjectId,
        created_at: &Option<String>,
    ) -> SessionEvent {
        let blocks_opt = if self.blocks.is_empty() {
            None
        } else {
            Some(self.blocks)
        };
        let thinking_opt = if self.thinking_buf.is_empty() {
            None
        } else {
            Some(self.thinking_buf)
        };
        SessionEvent {
            event_id: SessionEventId::new(),
            agent_instance_id,
            project_id,
            role: ChatRole::Assistant,
            content: self.full_text,
            content_blocks: blocks_opt,
            thinking: thinking_opt,
            thinking_duration_ms: None,
            created_at: parse_dt(created_at),
            in_flight: Some(true),
        }
    }
}

fn collect_assistant_parts(
    sorted: &[StorageSessionEvent],
    start_idx: usize,
    target_message_id: &str,
) -> AssistantParts {
    let mut parts = AssistantParts::new();

    for event in sorted.iter().skip(start_idx + 1) {
        if message_id_of(event) != Some(target_message_id) {
            continue;
        }
        apply_streaming_event(&mut parts, event);
    }

    if !parts.text_segment.is_empty() {
        parts.blocks.push(ChatContentBlock::Text {
            text: std::mem::take(&mut parts.text_segment),
        });
    }
    parts
}

fn apply_streaming_event(parts: &mut AssistantParts, event: &StorageSessionEvent) {
    let event_type = event.event_type.as_deref().unwrap_or("");
    let content = event.content.as_ref();
    match event_type {
        "text_delta" => apply_text_delta(parts, content),
        "thinking_delta" => apply_thinking_delta(parts, content),
        "tool_use_start" => apply_tool_use_start(parts, content),
        "tool_call_snapshot" => apply_tool_call_snapshot(parts, content),
        "tool_result" => apply_tool_result(parts, content),
        _ => {}
    }
}

fn apply_text_delta(parts: &mut AssistantParts, content: Option<&serde_json::Value>) {
    if let Some(text) = content.and_then(|c| c.get("text")).and_then(|v| v.as_str()) {
        parts.full_text.push_str(text);
        parts.text_segment.push_str(text);
    }
}

fn apply_thinking_delta(parts: &mut AssistantParts, content: Option<&serde_json::Value>) {
    if let Some(text) = content
        .and_then(|c| c.get("thinking"))
        .and_then(|v| v.as_str())
    {
        parts.thinking_buf.push_str(text);
    }
}

fn apply_tool_use_start(parts: &mut AssistantParts, content: Option<&serde_json::Value>) {
    if !parts.text_segment.is_empty() {
        parts.blocks.push(ChatContentBlock::Text {
            text: std::mem::take(&mut parts.text_segment),
        });
    }
    let id = content
        .and_then(|c| c.get("id"))
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let name = content
        .and_then(|c| c.get("name"))
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    if id.is_empty() && name.is_empty() {
        return;
    }
    parts.last_tool_use_id = id.clone();
    parts.blocks.push(ChatContentBlock::ToolUse {
        id,
        name,
        input: serde_json::Value::Null,
    });
}

fn apply_tool_call_snapshot(parts: &mut AssistantParts, content: Option<&serde_json::Value>) {
    let snap_id = content
        .and_then(|c| c.get("id"))
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let snap_input = content
        .and_then(|c| c.get("input"))
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    let snap_name = content
        .and_then(|c| c.get("name"))
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let mut patched = false;
    for block in parts.blocks.iter_mut().rev() {
        if let ChatContentBlock::ToolUse { id, input, .. } = block {
            if *id == snap_id {
                *input = snap_input.clone();
                patched = true;
                break;
            }
        }
    }
    if !patched && !snap_id.is_empty() {
        parts.blocks.push(ChatContentBlock::ToolUse {
            id: snap_id,
            name: snap_name,
            input: snap_input,
        });
    }
}

fn apply_tool_result(parts: &mut AssistantParts, content: Option<&serde_json::Value>) {
    let tool_use_id = content
        .and_then(|c| c.get("tool_use_id"))
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| parts.last_tool_use_id.clone());
    let result_text = content
        .and_then(|c| c.get("result"))
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let is_error = content
        .and_then(|c| c.get("is_error"))
        .and_then(|v| v.as_bool());
    // Mirror chat.rs: any tool_use still carrying `Null` input
    // gets normalized to `{}` so replays don't fail validation.
    for block in parts.blocks.iter_mut().rev() {
        if let ChatContentBlock::ToolUse { id, input, .. } = block {
            if *id == tool_use_id && matches!(input, serde_json::Value::Null) {
                *input = serde_json::json!({});
                break;
            }
        }
    }
    parts.blocks.push(ChatContentBlock::ToolResult {
        tool_use_id,
        content: result_text,
        is_error,
    });
}
