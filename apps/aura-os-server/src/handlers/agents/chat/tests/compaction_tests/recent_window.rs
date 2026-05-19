//! Recent-window cap tests: confirms that tool-result blocks outside the recent assistant-turn window are compressed harder than ones inside it.

use aura_os_core::{
    parse_dt, AgentInstanceId, ChatContentBlock, ChatRole, ProjectId, SessionEvent, SessionEventId,
};

use super::super::super::compaction::session_events_to_conversation_history;
use super::assistant_event;

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
        from_agent_id: None,
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
        from_agent_id: None,
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
