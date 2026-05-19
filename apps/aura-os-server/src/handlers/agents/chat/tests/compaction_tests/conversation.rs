//! Tests covering the basic conversation-history reshape (tool-only assistant turns, narration + tool turns, fully empty drops).

use aura_os_core::{
    parse_dt, AgentInstanceId, ChatContentBlock, ChatRole, ProjectId, SessionEvent, SessionEventId,
};

use super::super::super::compaction::session_events_to_conversation_history;
use super::assistant_event;

#[test]
fn conversation_history_renders_tool_only_assistant_turn_to_text() {
    // Regression: on app reopen, a tool-only assistant turn (empty
    // `content`, populated `content_blocks`) used to be filtered out of
    // the harness conversation history, so the model lost all memory of
    // prior tool calls.
    let user = SessionEvent {
        event_id: SessionEventId::new(),
        agent_instance_id: AgentInstanceId::nil(),
        project_id: ProjectId::nil(),
        role: ChatRole::User,
        content: "make a spec".into(),
        content_blocks: None,
        thinking: None,
        thinking_duration_ms: None,
        created_at: parse_dt(&None),
        in_flight: None,
        from_agent_id: None,
    };
    let assistant = assistant_event(
        "",
        Some(vec![
            ChatContentBlock::ToolUse {
                id: "tool-1".into(),
                name: "create_spec".into(),
                input: serde_json::json!({ "title": "hello" }),
            },
            ChatContentBlock::ToolResult {
                tool_use_id: "tool-1".into(),
                content: "spec-123".into(),
                is_error: Some(false),
            },
        ]),
    );

    let history = session_events_to_conversation_history(&[user, assistant]);

    assert_eq!(history.len(), 2);
    assert_eq!(history[0].role, "user");
    assert_eq!(history[1].role, "assistant");
    assert!(
        history[1].content.contains("tool_use create_spec"),
        "assistant turn must carry tool call into LLM context, got: {}",
        history[1].content
    );
    assert!(
        history[1].content.contains("tool_result spec-123"),
        "assistant turn must carry tool result into LLM context, got: {}",
        history[1].content
    );
}

#[test]
fn conversation_history_preserves_text_plus_tool_turns() {
    // Healthy cycle: assistant emits narration + tool_use, tool result
    // arrives in a subsequent event. Both narration and tool call must
    // survive. (A dangling tool_use with no matching tool_result is
    // stripped as a crash signature — see the
    // `conversation_history_strips_dangling_tool_use_block` integration
    // test in tests/chat_events_test.rs.)
    let assistant = assistant_event(
        "Sure, creating now.",
        Some(vec![ChatContentBlock::ToolUse {
            id: "tool-1".into(),
            name: "create_spec".into(),
            input: serde_json::json!({ "title": "hello" }),
        }]),
    );
    let tool_result = assistant_event(
        "",
        Some(vec![ChatContentBlock::ToolResult {
            tool_use_id: "tool-1".into(),
            content: "spec-123".into(),
            is_error: Some(false),
        }]),
    );

    let history = session_events_to_conversation_history(&[assistant, tool_result]);
    assert!(
        history
            .iter()
            .any(|m| m.content.starts_with("Sure, creating now.")
                && m.content.contains("tool_use create_spec")),
        "narration and tool_use must both survive, got: {history:?}"
    );
}

#[test]
fn conversation_history_drops_fully_empty_assistant_turns() {
    let empty = assistant_event("", None);
    let history = session_events_to_conversation_history(&[empty]);
    assert!(history.is_empty());
}
