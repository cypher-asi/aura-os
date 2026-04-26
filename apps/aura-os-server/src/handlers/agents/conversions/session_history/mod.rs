mod blocks;
mod in_flight;

use aura_os_core::parse_dt;
use aura_os_core::{
    AgentInstanceId, ChatContentBlock, ChatRole, ProjectId, SessionEvent, SessionEventId,
};
use aura_os_storage::StorageSessionEvent;

use blocks::{deserialize_content_blocks, sanitize_assistant_content_blocks};
use in_flight::reconstruct_in_flight_assistant_turn;

/// Reconstruct `Vec<SessionEvent>` from persisted session events.
///
/// Only `user_message`, `assistant_message_end`, and `task_output` events
/// produce `SessionEvent` objects.  Incremental events (`text_delta`, `tool_use_start`,
/// etc.) are stored for replay but skipped here — the `assistant_message_end`
/// event contains the full synthesis (text, thinking, content_blocks, usage).
pub fn events_to_session_history(
    events: &[StorageSessionEvent],
    project_agent_id: &str,
    project_id: &str,
) -> Vec<SessionEvent> {
    let agent_instance_id = project_agent_id
        .parse::<AgentInstanceId>()
        .unwrap_or_else(|_| AgentInstanceId::nil());
    let pid = project_id
        .parse::<ProjectId>()
        .unwrap_or_else(|_| ProjectId::nil());

    let sorted = sort_events_chronologically(events);
    let mut messages = collect_terminal_events(&sorted, agent_instance_id, pid);

    if let Some(partial) = reconstruct_in_flight_assistant_turn(&sorted, agent_instance_id, pid) {
        messages.push(partial);
    }

    messages
}

fn sort_events_chronologically(events: &[StorageSessionEvent]) -> Vec<StorageSessionEvent> {
    let mut sorted = events.to_vec();
    sorted.sort_by(|a, b| {
        let ta = a.created_at.as_deref().unwrap_or("");
        let tb = b.created_at.as_deref().unwrap_or("");
        ta.cmp(tb).then_with(|| a.id.cmp(&b.id))
    });
    sorted
}

/// Convert each terminal storage event (`user_message`,
/// `assistant_message_end`, `task_output`) into a [`SessionEvent`]. Streaming
/// deltas are intentionally ignored here — they are projected back into a
/// synthesized in-flight turn in [`reconstruct_in_flight_assistant_turn`].
fn collect_terminal_events(
    sorted: &[StorageSessionEvent],
    agent_instance_id: AgentInstanceId,
    project_id: ProjectId,
) -> Vec<SessionEvent> {
    let mut messages = Vec::new();
    for event in sorted {
        let event_type = event.event_type.as_deref().unwrap_or("");
        let next = match event_type {
            "user_message" => parse_user_message_event(event, agent_instance_id, project_id),
            "assistant_message_end" => {
                parse_assistant_message_end_event(event, agent_instance_id, project_id)
            }
            "task_output" => parse_task_output_event(event, agent_instance_id, project_id),
            _ => None,
        };
        if let Some(message) = next {
            messages.push(message);
        }
    }
    messages
}

fn parse_user_message_event(
    event: &StorageSessionEvent,
    agent_instance_id: AgentInstanceId,
    project_id: ProjectId,
) -> Option<SessionEvent> {
    let content = event.content.as_ref();
    let text = content
        .and_then(|c| c.get("text"))
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    // Deserialize per-block so a single malformed or unknown block
    // variant (e.g. an image block written by a future client, or
    // a legacy shape) does not silently nuke the entire user
    // message. A strict `Vec<ChatContentBlock>` deserialize would
    // return `None` on any mismatch, which — combined with the
    // empty-content check on the display side — causes image-only
    // or attachment-only user turns to disappear on reopen.
    let content_blocks: Option<Vec<ChatContentBlock>> = content
        .and_then(|c| c.get("content_blocks"))
        .and_then(|v| v.as_array().cloned())
        .map(|raw_blocks| deserialize_content_blocks(&event.id, raw_blocks))
        .filter(|blocks| !blocks.is_empty());
    Some(SessionEvent {
        event_id: SessionEventId::new(),
        agent_instance_id,
        project_id,
        role: ChatRole::User,
        content: text.to_string(),
        content_blocks,
        thinking: None,
        thinking_duration_ms: None,
        created_at: parse_dt(&event.created_at),
        in_flight: None,
    })
}

fn parse_assistant_message_end_event(
    event: &StorageSessionEvent,
    agent_instance_id: AgentInstanceId,
    project_id: ProjectId,
) -> Option<SessionEvent> {
    let content = event.content.as_ref();
    let text = content
        .and_then(|c| c.get("text"))
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let thinking = content
        .and_then(|c| c.get("thinking"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from);
    // Deserialize per-block so a single malformed or newly-introduced
    // block variant does not nuke the entire turn. Previously a strict
    // `serde_json::from_value::<Vec<ChatContentBlock>>(..).ok()` would
    // silently return `None` on any mismatch and, combined with the
    // empty-content check below, drop the whole assistant turn — which
    // is exactly how tool-heavy turns were disappearing on reopen.
    let content_blocks: Option<Vec<ChatContentBlock>> = content
        .and_then(|c| c.get("content_blocks"))
        .and_then(|v| v.as_array().cloned())
        .map(|raw_blocks| deserialize_content_blocks(&event.id, raw_blocks))
        .map(sanitize_assistant_content_blocks)
        .filter(|blocks| !blocks.is_empty());

    if text.is_empty() && content_blocks.is_none() && thinking.is_none() {
        return None;
    }

    Some(SessionEvent {
        event_id: SessionEventId::new(),
        agent_instance_id,
        project_id,
        role: ChatRole::Assistant,
        content: text,
        content_blocks,
        thinking,
        thinking_duration_ms: None,
        created_at: parse_dt(&event.created_at),
        in_flight: None,
    })
}

fn parse_task_output_event(
    event: &StorageSessionEvent,
    agent_instance_id: AgentInstanceId,
    project_id: ProjectId,
) -> Option<SessionEvent> {
    let content = event.content.as_ref();
    let text = content
        .and_then(|c| c.get("text"))
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    if text.is_empty() {
        return None;
    }
    Some(SessionEvent {
        event_id: SessionEventId::new(),
        agent_instance_id,
        project_id,
        role: ChatRole::Assistant,
        content: text.to_string(),
        content_blocks: None,
        thinking: None,
        thinking_duration_ms: None,
        created_at: parse_dt(&event.created_at),
        in_flight: None,
    })
}
