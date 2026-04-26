use aura_os_core::{ChatContentBlock, ChatRole};
use aura_os_storage::StorageSessionEvent;

use super::super::events_to_session_history;

fn raw_event(
    id: &str,
    ts: &str,
    event_type: &str,
    content: serde_json::Value,
) -> StorageSessionEvent {
    StorageSessionEvent {
        id: id.to_string(),
        session_id: Some("session-1".to_string()),
        user_id: None,
        agent_id: None,
        sender: None,
        project_id: Some("project-1".to_string()),
        org_id: None,
        event_type: Some(event_type.to_string()),
        content: Some(content),
        created_at: Some(ts.to_string()),
    }
}

#[test]
fn events_to_session_history_reconstructs_partial_assistant_turn_text_only() {
    // Mid-turn refresh recovery: a turn that has streamed some `text_delta`
    // rows but not yet emitted `assistant_message_end` must surface as a
    // synthesized in-flight `SessionEvent` so the chat panel keeps
    // rendering the partial response after the page is reloaded.
    let events = vec![
        raw_event(
            "evt-user",
            "2026-01-01T00:00:00Z",
            "user_message",
            serde_json::json!({ "text": "hi" }),
        ),
        raw_event(
            "evt-start",
            "2026-01-01T00:00:01Z",
            "assistant_message_start",
            serde_json::json!({ "message_id": "m1", "seq": 1 }),
        ),
        raw_event(
            "evt-d1",
            "2026-01-01T00:00:02Z",
            "text_delta",
            serde_json::json!({ "message_id": "m1", "text": "Hello, " }),
        ),
        raw_event(
            "evt-d2",
            "2026-01-01T00:00:03Z",
            "text_delta",
            serde_json::json!({ "message_id": "m1", "text": "world" }),
        ),
    ];

    let history = events_to_session_history(&events, "agent-1", "project-1");

    assert_eq!(history.len(), 2, "user + reconstructed assistant in-flight");
    assert_eq!(history[0].role, ChatRole::User);
    let assistant = &history[1];
    assert_eq!(assistant.role, ChatRole::Assistant);
    assert_eq!(assistant.content, "Hello, world");
    assert_eq!(assistant.in_flight, Some(true));
    let blocks = assistant
        .content_blocks
        .as_ref()
        .expect("text block flushed");
    assert_eq!(blocks.len(), 1);
    assert!(matches!(&blocks[0], ChatContentBlock::Text { text } if text == "Hello, world"));
}

#[test]
fn events_to_session_history_reconstructs_partial_turn_with_tool_blocks() {
    // Tool calls fired during an in-flight turn must come back as
    // `tool_use` (+ optional `tool_result`) blocks so the UI can rebuild
    // its tool cards and `pending-*` spec/task placeholders on refresh.
    let events = vec![
        raw_event(
            "evt-start",
            "2026-01-01T00:00:01Z",
            "assistant_message_start",
            serde_json::json!({ "message_id": "m1", "seq": 1 }),
        ),
        raw_event(
            "evt-text",
            "2026-01-01T00:00:02Z",
            "text_delta",
            serde_json::json!({ "message_id": "m1", "text": "calling " }),
        ),
        raw_event(
            "evt-tool-start",
            "2026-01-01T00:00:03Z",
            "tool_use_start",
            serde_json::json!({ "message_id": "m1", "id": "tool-1", "name": "create_spec", "seq": 2 }),
        ),
        raw_event(
            "evt-snap",
            "2026-01-01T00:00:04Z",
            "tool_call_snapshot",
            serde_json::json!({
                "message_id": "m1",
                "id": "tool-1",
                "name": "create_spec",
                "input": { "title": "Hello" },
            }),
        ),
        raw_event(
            "evt-result",
            "2026-01-01T00:00:05Z",
            "tool_result",
            serde_json::json!({
                "message_id": "m1",
                "tool_use_id": "tool-1",
                "name": "create_spec",
                "result": "spec-123",
                "is_error": false,
            }),
        ),
    ];

    let history = events_to_session_history(&events, "agent-1", "project-1");

    assert_eq!(history.len(), 1);
    let assistant = &history[0];
    assert_eq!(assistant.in_flight, Some(true));
    let blocks = assistant.content_blocks.as_ref().expect("blocks");
    assert_eq!(blocks.len(), 3, "text, tool_use, tool_result");
    assert!(matches!(&blocks[0], ChatContentBlock::Text { text } if text == "calling "));
    match &blocks[1] {
        ChatContentBlock::ToolUse { id, name, input } => {
            assert_eq!(id, "tool-1");
            assert_eq!(name, "create_spec");
            assert_eq!(input.get("title").and_then(|v| v.as_str()), Some("Hello"));
        }
        other => panic!("expected tool_use, got {:?}", other),
    }
    match &blocks[2] {
        ChatContentBlock::ToolResult {
            tool_use_id,
            content,
            is_error,
        } => {
            assert_eq!(tool_use_id, "tool-1");
            assert_eq!(content, "spec-123");
            assert_eq!(*is_error, Some(false));
        }
        other => panic!("expected tool_result, got {:?}", other),
    }
}

#[test]
fn events_to_session_history_skips_reconstruction_when_end_present() {
    // Once `assistant_message_end` has landed, the in-flight reconstruction
    // path must not double-render the turn — the existing terminal-row
    // branch already produced a complete `SessionEvent`.
    let events = vec![
        raw_event(
            "evt-start",
            "2026-01-01T00:00:01Z",
            "assistant_message_start",
            serde_json::json!({ "message_id": "m1", "seq": 1 }),
        ),
        raw_event(
            "evt-d1",
            "2026-01-01T00:00:02Z",
            "text_delta",
            serde_json::json!({ "message_id": "m1", "text": "hello" }),
        ),
        raw_event(
            "evt-end",
            "2026-01-01T00:00:03Z",
            "assistant_message_end",
            serde_json::json!({
                "message_id": "m1",
                "text": "hello",
                "thinking": null,
                "content_blocks": [{ "type": "text", "text": "hello" }],
            }),
        ),
    ];

    let history = events_to_session_history(&events, "agent-1", "project-1");

    assert_eq!(history.len(), 1, "only the terminal turn");
    assert_eq!(history[0].in_flight, None, "terminal turn is not in-flight");
}

#[test]
fn events_to_session_history_reconstruction_captures_thinking() {
    let events = vec![
        raw_event(
            "evt-start",
            "2026-01-01T00:00:01Z",
            "assistant_message_start",
            serde_json::json!({ "message_id": "m1", "seq": 1 }),
        ),
        raw_event(
            "evt-think",
            "2026-01-01T00:00:02Z",
            "thinking_delta",
            serde_json::json!({ "message_id": "m1", "thinking": "Considering options..." }),
        ),
    ];

    let history = events_to_session_history(&events, "agent-1", "project-1");

    assert_eq!(history.len(), 1);
    let assistant = &history[0];
    assert_eq!(assistant.in_flight, Some(true));
    assert_eq!(
        assistant.thinking.as_deref(),
        Some("Considering options...")
    );
    assert!(assistant.content.is_empty(), "no text yet");
    assert!(assistant.content_blocks.is_none(), "no blocks yet");
}

#[test]
fn events_to_session_history_reconstruction_only_uses_latest_message_id() {
    // Multiple turns in the same session: only the trailing in-flight one
    // (its `message_id` lacks an `assistant_message_end`) should be
    // reconstructed. Earlier completed turns are produced by the normal
    // `assistant_message_end` branch.
    let events = vec![
        raw_event(
            "evt-start-1",
            "2026-01-01T00:00:00Z",
            "assistant_message_start",
            serde_json::json!({ "message_id": "old", "seq": 1 }),
        ),
        raw_event(
            "evt-end-1",
            "2026-01-01T00:00:01Z",
            "assistant_message_end",
            serde_json::json!({
                "message_id": "old",
                "text": "first turn",
                "thinking": null,
                "content_blocks": [{ "type": "text", "text": "first turn" }],
            }),
        ),
        raw_event(
            "evt-start-2",
            "2026-01-01T00:00:02Z",
            "assistant_message_start",
            serde_json::json!({ "message_id": "new", "seq": 2 }),
        ),
        raw_event(
            "evt-d-2",
            "2026-01-01T00:00:03Z",
            "text_delta",
            serde_json::json!({ "message_id": "new", "text": "second " }),
        ),
    ];

    let history = events_to_session_history(&events, "agent-1", "project-1");

    assert_eq!(history.len(), 2);
    assert_eq!(history[0].in_flight, None, "completed turn unchanged");
    assert_eq!(history[0].content, "first turn");
    assert_eq!(history[1].in_flight, Some(true));
    assert_eq!(history[1].content, "second ");
}
