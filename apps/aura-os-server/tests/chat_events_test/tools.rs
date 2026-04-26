//! Dangling `tool_use` blocks are stripped from LLM-context conversions.

use aura_os_core::*;

fn make_assistant_event_with_blocks(content_blocks: Vec<ChatContentBlock>) -> SessionEvent {
    SessionEvent {
        event_id: SessionEventId::new(),
        agent_instance_id: AgentInstanceId::new(),
        project_id: ProjectId::new(),
        role: ChatRole::Assistant,
        content: String::new(),
        content_blocks: Some(content_blocks),
        thinking: None,
        thinking_duration_ms: None,
        created_at: chrono::Utc::now(),
        in_flight: None,
    }
}

#[tokio::test]
async fn test_agent_harness_history_strips_dangling_tool_use_block() {
    // Mirrors the real-world corruption: an assistant turn emitted a
    // tool_use block and the harness crashed before the matching
    // tool_result landed in storage. Feeding this back into context trips
    // the Anthropic API 400 "tool_use ids were found without tool_result
    // blocks immediately after". The filter must drop the dangling block.
    let dangling_id = "tc-dangling";
    let matched_id = "tc-matched";

    let events = vec![
        SessionEvent {
            event_id: SessionEventId::new(),
            agent_instance_id: AgentInstanceId::new(),
            project_id: ProjectId::new(),
            role: ChatRole::User,
            content: "please do something".into(),
            content_blocks: None,
            thinking: None,
            thinking_duration_ms: None,
            created_at: chrono::Utc::now(),
            in_flight: None,
        },
        make_assistant_event_with_blocks(vec![
            ChatContentBlock::Text {
                text: "calling a tool".into(),
            },
            ChatContentBlock::ToolUse {
                id: matched_id.into(),
                name: "do_thing".into(),
                input: serde_json::json!({}),
            },
            ChatContentBlock::ToolUse {
                id: dangling_id.into(),
                name: "crashed_thing".into(),
                input: serde_json::json!({}),
            },
        ]),
        make_assistant_event_with_blocks(vec![ChatContentBlock::ToolResult {
            tool_use_id: matched_id.into(),
            content: "ok".into(),
            is_error: None,
        }]),
    ];

    let history =
        aura_os_server::handlers_test_support::session_events_to_agent_history_pub(&events);

    let serialized = serde_json::to_string(&history).unwrap();
    assert!(
        !serialized.contains(dangling_id),
        "dangling tool_use id must not survive into agent history, got: {serialized}"
    );
    assert!(
        serialized.contains(matched_id),
        "matched tool_use must still be present, got: {serialized}"
    );
}

#[tokio::test]
async fn conversation_history_strips_dangling_tool_use_block() {
    let dangling_id = "tc-dangling";
    let matched_id = "tc-matched";

    let events = vec![
        make_assistant_event_with_blocks(vec![
            ChatContentBlock::ToolUse {
                id: matched_id.into(),
                name: "ok_tool".into(),
                input: serde_json::json!({"a": 1}),
            },
            ChatContentBlock::ToolUse {
                id: dangling_id.into(),
                name: "crashed_tool".into(),
                input: serde_json::json!({"b": 2}),
            },
        ]),
        make_assistant_event_with_blocks(vec![ChatContentBlock::ToolResult {
            tool_use_id: matched_id.into(),
            content: "done".into(),
            is_error: None,
        }]),
    ];

    let history =
        aura_os_server::handlers_test_support::session_events_to_conversation_history_pub(&events);

    let joined: String = history
        .iter()
        .map(|m| m.content.as_str())
        .collect::<Vec<_>>()
        .join("\n");

    assert!(
        !joined.contains("crashed_tool"),
        "dangling tool_use must not appear in rendered harness history, got:\n{joined}"
    );
    assert!(
        joined.contains("ok_tool"),
        "matched tool_use should still be rendered, got:\n{joined}"
    );
}
