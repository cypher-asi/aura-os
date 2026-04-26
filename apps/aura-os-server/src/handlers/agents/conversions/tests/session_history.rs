use aura_os_core::ChatContentBlock;
use aura_os_storage::StorageSessionEvent;

use super::super::events_to_session_history;

#[test]
fn events_to_session_history_preserves_tool_only_assistant_turns() {
    // Regression: tool-only turns (no visible text) used to be dropped on
    // reopen, so the LLM saw user messages but no assistant context.
    let events = vec![StorageSessionEvent {
        id: "evt-1".to_string(),
        session_id: Some("session-1".to_string()),
        user_id: None,
        agent_id: None,
        sender: None,
        project_id: Some("project-1".to_string()),
        org_id: None,
        event_type: Some("assistant_message_end".to_string()),
        content: Some(serde_json::json!({
            "text": "",
            "thinking": null,
            "content_blocks": [
                {
                    "type": "tool_use",
                    "id": "tool-1",
                    "name": "create_spec",
                    "input": { "title": "hello" },
                },
                {
                    "type": "tool_result",
                    "tool_use_id": "tool-1",
                    "content": "ok",
                    "is_error": false,
                }
            ]
        })),
        created_at: Some("2026-01-01T00:00:00Z".to_string()),
    }];

    let history = events_to_session_history(&events, "agent-1", "project-1");

    assert_eq!(history.len(), 1, "tool-only assistant turn must survive");
    let blocks = history[0]
        .content_blocks
        .as_ref()
        .expect("content_blocks preserved");
    assert_eq!(blocks.len(), 2, "both tool_use and tool_result kept");
    assert!(matches!(blocks[0], ChatContentBlock::ToolUse { .. }));
    assert!(matches!(blocks[1], ChatContentBlock::ToolResult { .. }));
}

#[test]
fn events_to_session_history_tolerates_unknown_block_types() {
    // Regression: a single unknown/malformed block used to fail the whole
    // Vec<ChatContentBlock> deserialize and silently drop the turn.
    let events = vec![StorageSessionEvent {
        id: "evt-1".to_string(),
        session_id: Some("session-1".to_string()),
        user_id: None,
        agent_id: None,
        sender: None,
        project_id: Some("project-1".to_string()),
        org_id: None,
        event_type: Some("assistant_message_end".to_string()),
        content: Some(serde_json::json!({
            "text": "",
            "thinking": null,
            "content_blocks": [
                { "type": "text", "text": "hello" },
                { "type": "future_variant_we_dont_know_about", "foo": 1 },
                {
                    "type": "tool_use",
                    "id": "tool-1",
                    "name": "create_spec",
                    "input": { "title": "hi" },
                }
            ]
        })),
        created_at: Some("2026-01-01T00:00:00Z".to_string()),
    }];

    let history = events_to_session_history(&events, "agent-1", "project-1");
    assert_eq!(history.len(), 1);
    let blocks = history[0].content_blocks.as_ref().unwrap();
    assert_eq!(blocks.len(), 2, "known blocks survive, unknown is skipped");
}

#[test]
fn events_to_session_history_preserves_user_image_only_turns() {
    // Regression: user messages with only image attachments (no text)
    // round-trip via JSON where a single malformed/unknown block would
    // previously clear the whole content_blocks vec. After clearing,
    // the display filter (empty content + empty blocks) would drop the
    // whole turn, and users would see "my conversation is missing
    // random messages" on reopen.
    let events = vec![StorageSessionEvent {
        id: "evt-1".to_string(),
        session_id: Some("session-1".to_string()),
        user_id: None,
        agent_id: None,
        sender: Some("user".to_string()),
        project_id: Some("project-1".to_string()),
        org_id: None,
        event_type: Some("user_message".to_string()),
        content: Some(serde_json::json!({
            "text": "",
            "content_blocks": [
                {
                    "type": "image",
                    "media_type": "image/png",
                    "data": "aGVsbG8=",
                },
                { "type": "future_variant_we_dont_know_about", "foo": 1 },
            ]
        })),
        created_at: Some("2026-01-01T00:00:00Z".to_string()),
    }];

    let history = events_to_session_history(&events, "agent-1", "project-1");

    assert_eq!(history.len(), 1, "image-only user turn must survive");
    let blocks = history[0]
        .content_blocks
        .as_ref()
        .expect("content_blocks preserved");
    assert_eq!(
        blocks.len(),
        1,
        "known image block kept; unknown block skipped"
    );
    assert!(matches!(blocks[0], ChatContentBlock::Image { .. }));
}

#[test]
fn events_to_session_history_skips_incomplete_write_only_turns() {
    let events = vec![StorageSessionEvent {
        id: "evt-1".to_string(),
        session_id: Some("session-1".to_string()),
        user_id: None,
        agent_id: None,
        sender: None,
        project_id: Some("project-1".to_string()),
        org_id: None,
        event_type: Some("assistant_message_end".to_string()),
        content: Some(serde_json::json!({
            "text": "",
            "thinking": null,
            "content_blocks": [
                {
                    "type": "tool_use",
                    "id": "tool-1",
                    "name": "write_file",
                    "input": null,
                },
                {
                    "type": "tool_result",
                    "tool_use_id": "tool-1",
                    "content": "ok",
                    "is_error": false,
                }
            ]
        })),
        created_at: Some("2026-01-01T00:00:00Z".to_string()),
    }];

    let history = events_to_session_history(&events, "agent-1", "project-1");

    assert!(history.is_empty());
}
