//! Tests for `session_events_to_conversation_history`,
//! `truncate_for_history`, and `render_conversation_text`.

use aura_os_core::{
    parse_dt, AgentInstanceId, ChatContentBlock, ChatRole, ProjectId, SessionEvent, SessionEventId,
};

use super::super::compaction::{
    render_conversation_text, session_events_to_conversation_history, truncate_for_history,
};

fn assistant_event(content: &str, blocks: Option<Vec<ChatContentBlock>>) -> SessionEvent {
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
    }
}

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

#[test]
fn truncate_for_history_is_noop_below_cap() {
    let s = "hello world";
    assert_eq!(truncate_for_history(s, 2048), s);
}

#[test]
fn truncate_for_history_keeps_prefix_and_marker() {
    let big = "X".repeat(10_000);
    let truncated = truncate_for_history(&big, 128);
    assert!(truncated.len() < 512);
    assert!(truncated.starts_with("XXXX"));
    assert!(truncated.contains("[truncated 10000 bytes]"));
}

#[test]
fn truncate_for_history_respects_char_boundary() {
    // A 4-byte UTF-8 char right at the cap must not split.
    let s = format!("abc{}", "🦀".repeat(10));
    let truncated = truncate_for_history(&s, 5);
    assert!(truncated.starts_with("abc"));
    assert!(truncated.contains("[truncated"));
}

#[test]
fn render_conversation_text_truncates_oversized_tool_result() {
    let big = "Z".repeat(10_000);
    let blocks = vec![
        ChatContentBlock::ToolUse {
            id: "tool-1".into(),
            name: "list_agents".into(),
            input: serde_json::json!({}),
        },
        ChatContentBlock::ToolResult {
            tool_use_id: "tool-1".into(),
            content: big.clone(),
            is_error: Some(false),
        },
    ];
    let referenced: std::collections::HashSet<String> =
        std::iter::once("tool-1".to_string()).collect();
    let rendered = render_conversation_text("", Some(&blocks), &referenced, 512);
    assert!(
        rendered.len() < 2_000,
        "rendered still large: {}",
        rendered.len()
    );
    assert!(rendered.contains("[truncated 10000 bytes]"));
    assert!(!rendered.contains(&big));
}

#[test]
fn conversation_history_uses_tight_cap_for_old_tool_results() {
    // Ten assistant tool-result turns followed by two user turns so
    // the first assistant turn sits well outside the recent window.
    let big_old = "OLD".repeat(4_000); // 12_000 bytes
    let big_recent = "NEW".repeat(4_000);

    let old_assistant = assistant_event(
        "",
        Some(vec![
            ChatContentBlock::ToolUse {
                id: "tool-old".into(),
                name: "list_agents".into(),
                input: serde_json::json!({}),
            },
            ChatContentBlock::ToolResult {
                tool_use_id: "tool-old".into(),
                content: big_old.clone(),
                is_error: Some(false),
            },
        ]),
    );
    let user_a = SessionEvent {
        event_id: SessionEventId::new(),
        agent_instance_id: AgentInstanceId::nil(),
        project_id: ProjectId::nil(),
        role: ChatRole::User,
        content: "first turn".into(),
        content_blocks: None,
        thinking: None,
        thinking_duration_ms: None,
        created_at: parse_dt(&None),
        in_flight: None,
    };
    let recent_assistant = assistant_event(
        "",
        Some(vec![
            ChatContentBlock::ToolUse {
                id: "tool-new".into(),
                name: "list_agents".into(),
                input: serde_json::json!({}),
            },
            ChatContentBlock::ToolResult {
                tool_use_id: "tool-new".into(),
                content: big_recent.clone(),
                is_error: Some(false),
            },
        ]),
    );
    let user_b = SessionEvent {
        event_id: SessionEventId::new(),
        agent_instance_id: AgentInstanceId::nil(),
        project_id: ProjectId::nil(),
        role: ChatRole::User,
        content: "second turn".into(),
        content_blocks: None,
        thinking: None,
        thinking_duration_ms: None,
        created_at: parse_dt(&None),
        in_flight: None,
    };

    let history =
        session_events_to_conversation_history(&[old_assistant, user_a, recent_assistant, user_b]);

    // Old turn: capped at TOOL_BLOB_OLD_MAX_BYTES (256).
    let old_rendered = &history[0].content;
    assert!(
        old_rendered.len() < 1_000,
        "old assistant turn should be tightly capped, got {} bytes",
        old_rendered.len()
    );
    assert!(old_rendered.contains("[truncated 12000 bytes]"));

    // Recent turn: capped at TOOL_BLOB_MAX_BYTES (2048), so bigger
    // than old but still well under the raw 12KB.
    let recent_rendered = &history[2].content;
    assert!(
        recent_rendered.len() > old_rendered.len(),
        "recent window must keep more context than old window"
    );
    assert!(recent_rendered.contains("[truncated 12000 bytes]"));
    assert!(recent_rendered.len() < 4_000);
}
