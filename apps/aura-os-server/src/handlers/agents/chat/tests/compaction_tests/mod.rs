//! Tests for `session_events_to_conversation_history`, `truncate_for_history`, and `render_conversation_text`. Split by responsibility (conversation rendering, truncation, recent-window cap, parallel-tool-result dedupe, Anthropic-shape invariants) so each submodule stays under the 500-line cap.

use aura_os_core::{
    parse_dt, AgentInstanceId, ChatContentBlock, ChatRole, ProjectId, SessionEvent, SessionEventId,
};

mod conversation;
mod dedupe;
mod invariants;
mod recent_window;
mod truncate;

pub(super) fn assistant_event(
    content: &str,
    blocks: Option<Vec<ChatContentBlock>>,
) -> SessionEvent {
    SessionEvent {
        event_id: SessionEventId::new(),
        agent_instance_id: AgentInstanceId::nil(),
        project_id: ProjectId::nil(),
        role: ChatRole::Assistant,
        content: content.to_string(),
        content_blocks: blocks,
        thinking: None,
        thinking_duration_ms: None,
        created_at: parse_dt(&None),
        in_flight: None,
        from_agent_id: None,
    }
}

pub(super) fn user_event(content: &str) -> SessionEvent {
    SessionEvent {
        event_id: SessionEventId::new(),
        agent_instance_id: AgentInstanceId::nil(),
        project_id: ProjectId::nil(),
        role: ChatRole::User,
        content: content.to_string(),
        content_blocks: None,
        thinking: None,
        thinking_duration_ms: None,
        created_at: parse_dt(&None),
        in_flight: None,
        from_agent_id: None,
    }
}

/// Locate the most recent user message whose content is a JSON array of
/// blocks (i.e. the synthesized tool-result message) and return that array.
pub(super) fn extract_tool_result_blocks(history: &[serde_json::Value]) -> Vec<serde_json::Value> {
    history
        .iter()
        .rev()
        .find_map(|msg| {
            if msg.get("role").and_then(|r| r.as_str()) != Some("user") {
                return None;
            }
            msg.get("content")
                .and_then(|c| c.as_array())
                .filter(|arr| {
                    arr.iter()
                        .any(|b| b.get("type").and_then(|t| t.as_str()) == Some("tool_result"))
                })
                .cloned()
        })
        .unwrap_or_default()
}

/// Anthropic Messages API invariant checker: panics if the constructed
/// history would 400 with `each tool_use must have a single result. Found
/// multiple tool_result blocks with id: …`.
///
/// We check the two conditions that produce that exact error class:
///
/// 1. No user message may contain two `tool_result` blocks sharing a
///    `tool_use_id`. (This is the literal 400 message.)
/// 2. Every `tool_result.tool_use_id` must reference a `tool_use.id` that
///    appears earlier in the same conversation. A `tool_result` with no
///    matching `tool_use` 400s with a different — but equally fatal —
///    `tool_result block(s) provided when previous message does not contain
///    any tool_use blocks` error.
///
/// The checker walks every assistant message to build the set of valid
/// `tool_use` ids, then verifies every `tool_result` it sees against
/// both rules.
pub(super) fn assert_anthropic_messages_valid(history: &[serde_json::Value]) {
    use std::collections::HashSet;

    let mut known_tool_use_ids: HashSet<String> = HashSet::new();

    for (msg_idx, msg) in history.iter().enumerate() {
        let role = msg.get("role").and_then(|v| v.as_str()).unwrap_or_default();
        let content = match msg.get("content") {
            Some(c) => c,
            None => panic!("message {msg_idx} has no `content` field"),
        };

        let blocks: Vec<&serde_json::Value> = match content {
            serde_json::Value::Array(arr) => arr.iter().collect(),
            serde_json::Value::String(_) => continue,
            other => panic!("message {msg_idx} has non-string/non-array content: {other}"),
        };

        if role == "assistant" {
            for block in &blocks {
                if block.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                    if let Some(id) = block.get("id").and_then(|v| v.as_str()) {
                        known_tool_use_ids.insert(id.to_string());
                    }
                }
            }
        }

        if role == "user" {
            let mut seen_tool_result_ids: HashSet<String> = HashSet::new();
            for (block_idx, block) in blocks.iter().enumerate() {
                if block.get("type").and_then(|t| t.as_str()) != Some("tool_result") {
                    continue;
                }
                let id = block
                    .get("tool_use_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                assert!(
                    !id.is_empty(),
                    "messages.{msg_idx}.content.{block_idx}: tool_result missing tool_use_id"
                );
                assert!(
                    seen_tool_result_ids.insert(id.clone()),
                    "messages.{msg_idx}.content.{block_idx}: duplicate tool_result for tool_use_id `{id}` — Anthropic 400 `each tool_use must have a single result`"
                );
                assert!(
                    known_tool_use_ids.contains(&id),
                    "messages.{msg_idx}.content.{block_idx}: tool_result references tool_use_id `{id}` that has no matching tool_use earlier in the conversation"
                );
            }
        }
    }
}
