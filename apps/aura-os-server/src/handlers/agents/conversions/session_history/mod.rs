mod blocks;
mod event_id;
mod in_flight;
mod subagent_link;

use aura_os_core::parse_dt;
use aura_os_core::{AgentInstanceId, ChatContentBlock, ChatRole, ProjectId, SessionEvent};
use aura_os_storage::StorageSessionEvent;

use blocks::{deserialize_content_blocks, sanitize_assistant_content_blocks};
pub(crate) use event_id::stable_event_id;
use in_flight::reconstruct_in_flight_assistant_turn;
use subagent_link::fold_subagent_session_links;

/// Reconstruct `Vec<SessionEvent>` from persisted session events.
///
/// Only `user_message`, `assistant_message_end`, and `task_output` events
/// produce `SessionEvent` objects.  Incremental events (`text_delta`, `tool_use_start`,
/// etc.) are stored for replay but skipped here — the `assistant_message_end`
/// event contains the full synthesis (text, thinking, content_blocks, usage).
///
/// Each reconstructed message's `event_id` is derived deterministically
/// from the backing storage-event row id (see [`event_id`]), so ids are
/// stable across requests and usable as pagination cursors.
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

    // Stamp `subagent_session_id` onto any `task` tool_use block whose
    // child run has a persisted subagent session, so a history-reopened
    // card can fetch the child transcript. Race-free read-time fold —
    // see `subagent_link`.
    fold_subagent_session_links(&mut messages, &sorted);

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
    for (index, event) in sorted.iter().enumerate() {
        let event_type = event.event_type.as_deref().unwrap_or("");
        let next = match event_type {
            "user_message" => parse_user_message_event(event, agent_instance_id, project_id),
            "assistant_message_end" => {
                parse_assistant_message_end_event(event, agent_instance_id, project_id).or_else(
                    || {
                        reconstruct_completed_assistant_from_deltas(
                            &sorted[..index],
                            event,
                            agent_instance_id,
                            project_id,
                        )
                    },
                )
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
    // Cross-agent provenance. When `persist_user_message` was called
    // from a cross-agent path (either A→B `send_to_agent` inbound or
    // B→A reply callback), the persisted content carries
    // `from_agent_id` — surface it on `SessionEvent` so the chat
    // panel can label the row "from <agent>" instead of rendering
    // a cross-agent message indistinguishably from a real user
    // prompt. Blank values are normalized to `None` so a stray
    // empty string written by a future producer doesn't trigger
    // the badge UI.
    let from_agent_id = content
        .and_then(|c| c.get("from_agent_id"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    Some(SessionEvent {
        event_id: stable_event_id(&event.id),
        agent_instance_id,
        project_id,
        role: ChatRole::User,
        content: text.to_string(),
        content_blocks,
        thinking: None,
        thinking_duration_ms: None,
        created_at: parse_dt(&event.created_at),
        in_flight: None,
        from_agent_id,
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
        event_id: stable_event_id(&event.id),
        agent_instance_id,
        project_id,
        role: ChatRole::Assistant,
        content: text,
        content_blocks,
        thinking,
        thinking_duration_ms: None,
        created_at: parse_dt(&event.created_at),
        in_flight: None,
        from_agent_id: None,
    })
}

fn message_id_of(event: &StorageSessionEvent) -> Option<&str> {
    event
        .content
        .as_ref()
        .and_then(|content| content.get("message_id"))
        .and_then(|value| value.as_str())
}

fn reconstruct_completed_assistant_from_deltas(
    prior_events: &[StorageSessionEvent],
    terminal_event: &StorageSessionEvent,
    agent_instance_id: AgentInstanceId,
    project_id: ProjectId,
) -> Option<SessionEvent> {
    let message_id = message_id_of(terminal_event)?;
    let mut text = String::new();
    let mut thinking = String::new();

    for event in prior_events {
        if message_id_of(event) != Some(message_id) {
            continue;
        }
        let content = event.content.as_ref();
        match event.event_type.as_deref().unwrap_or("") {
            "text_delta" => {
                if let Some(delta) = content
                    .and_then(|c| c.get("text"))
                    .and_then(|value| value.as_str())
                {
                    text.push_str(delta);
                }
            }
            "thinking_delta" => {
                if let Some(delta) = content
                    .and_then(|c| c.get("thinking"))
                    .and_then(|value| value.as_str())
                {
                    thinking.push_str(delta);
                }
            }
            _ => {}
        }
    }

    if text.is_empty() && thinking.is_empty() {
        return None;
    }

    Some(SessionEvent {
        event_id: stable_event_id(&terminal_event.id),
        agent_instance_id,
        project_id,
        role: ChatRole::Assistant,
        content: text,
        content_blocks: None,
        thinking: if thinking.is_empty() {
            None
        } else {
            Some(thinking)
        },
        thinking_duration_ms: None,
        created_at: parse_dt(&terminal_event.created_at),
        in_flight: None,
        from_agent_id: None,
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
        event_id: stable_event_id(&event.id),
        agent_instance_id,
        project_id,
        role: ChatRole::Assistant,
        content: text.to_string(),
        content_blocks: None,
        thinking: None,
        thinking_duration_ms: None,
        created_at: parse_dt(&event.created_at),
        in_flight: None,
        from_agent_id: None,
    })
}
