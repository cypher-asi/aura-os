use crate::chat::ChatService;
use aura_core::*;
use aura_link::{TotalUsage, TurnResult};

fn make_result(text: &str, thinking: &str) -> TurnResult {
    TurnResult {
        text: text.into(),
        thinking: thinking.into(),
        usage: TotalUsage {
            input_tokens: 100,
            output_tokens: 50,
        },
        iterations_run: 1,
        timed_out: false,
        insufficient_credits: false,
        llm_error: None,
    }
}

#[test]
fn build_assistant_message_text_only() {
    let pid = ProjectId::new();
    let aid = AgentInstanceId::new();
    let result = make_result("Hello!", "");
    let start = std::time::Instant::now();

    let (msg, thinking, thinking_ms) =
        ChatService::build_assistant_message_test(&pid, &aid, &result, None, start);

    assert_eq!(msg.content, "Hello!");
    assert_eq!(msg.role, ChatRole::Assistant);
    assert_eq!(msg.project_id, pid);
    assert_eq!(msg.agent_instance_id, aid);
    assert!(thinking.is_none());
    assert!(thinking_ms.is_none());
    assert!(msg.content_blocks.is_none());
}

#[test]
fn build_assistant_message_with_thinking() {
    let pid = ProjectId::new();
    let aid = AgentInstanceId::new();
    let result = make_result("Response", "Let me think...");
    let start = std::time::Instant::now();

    let (msg, thinking, thinking_ms) =
        ChatService::build_assistant_message_test(&pid, &aid, &result, None, start);

    assert_eq!(msg.content, "Response");
    assert_eq!(thinking.as_deref(), Some("Let me think..."));
    assert!(thinking_ms.is_some());
    assert_eq!(msg.thinking.as_deref(), Some("Let me think..."));
    assert!(msg.thinking_duration_ms.is_some());
}

#[test]
fn build_assistant_message_with_content_blocks() {
    let pid = ProjectId::new();
    let aid = AgentInstanceId::new();
    let result = make_result("Done", "");
    let blocks = vec![
        ChatContentBlock::ToolUse {
            id: "t1".into(),
            name: "read_file".into(),
            input: serde_json::json!({"path": "a.rs"}),
        },
        ChatContentBlock::ToolResult {
            tool_use_id: "t1".into(),
            content: "fn main() {}".into(),
            is_error: None,
        },
    ];
    let start = std::time::Instant::now();

    let (msg, _, _) =
        ChatService::build_assistant_message_test(&pid, &aid, &result, Some(&blocks), start);

    assert!(msg.content_blocks.is_some());
    assert_eq!(msg.content_blocks.as_ref().unwrap().len(), 2);
}

#[test]
fn build_assistant_message_empty_text_empty_thinking() {
    let pid = ProjectId::new();
    let aid = AgentInstanceId::new();
    let result = make_result("", "");
    let start = std::time::Instant::now();

    let (msg, thinking, thinking_ms) =
        ChatService::build_assistant_message_test(&pid, &aid, &result, None, start);

    assert_eq!(msg.content, "");
    assert!(thinking.is_none());
    assert!(thinking_ms.is_none());
}
