use std::sync::{Arc, Mutex};

use tokio::sync::mpsc;

use aura_core::*;

use crate::channel_ext::send_or_log;
use crate::chat::ChatStreamEvent;
use crate::tool_loop::ToolLoopEvent;

pub(crate) type ContentBlockAccumulator = Arc<Mutex<Vec<ChatContentBlock>>>;

/// Forward a tool-loop event to the chat stream and accumulate content blocks.
///
/// Uses `std::sync::Mutex` intentionally: the critical sections are sub-microsecond
/// (single `Vec::push`) and never held across `.await` points, which is the
/// recommended pattern per Tokio docs for short, synchronous locks.
pub(crate) fn forward_tool_loop_event(
    evt: ToolLoopEvent,
    tx: &mpsc::UnboundedSender<ChatStreamEvent>,
    blocks: &ContentBlockAccumulator,
) {
    match evt {
        ToolLoopEvent::Delta(text) => {
            send_or_log(tx, ChatStreamEvent::Delta(text));
        }
        ToolLoopEvent::ThinkingDelta(text) => {
            send_or_log(tx, ChatStreamEvent::ThinkingDelta(text));
        }
        ToolLoopEvent::ToolUseStarted { id, name } => {
            send_or_log(tx, ChatStreamEvent::ToolCallStarted { id, name });
        }
        ToolLoopEvent::ToolUseDetected { id, name, input } => {
            if let Ok(mut acc) = blocks.lock() {
                acc.push(ChatContentBlock::ToolUse {
                    id: id.clone(),
                    name: name.clone(),
                    input: input.clone(),
                });
            }
            send_or_log(tx, ChatStreamEvent::ToolCall { id, name, input });
        }
        ToolLoopEvent::ToolResult {
            tool_use_id,
            tool_name,
            content,
            is_error,
        } => {
            if let Ok(mut acc) = blocks.lock() {
                acc.push(ChatContentBlock::ToolResult {
                    tool_use_id: tool_use_id.clone(),
                    content: content.clone(),
                    is_error: if is_error { Some(true) } else { None },
                });
            }
            send_or_log(tx, ChatStreamEvent::ToolResult {
                id: tool_use_id,
                name: tool_name,
                result: content,
                is_error,
            });
        }
        ToolLoopEvent::IterationTokenUsage {
            input_tokens,
            output_tokens,
        } => {
            send_or_log(tx, ChatStreamEvent::TokenUsage {
                input_tokens,
                output_tokens,
            });
        }
        ToolLoopEvent::IterationComplete { .. } => {
            // Handled by the forwarder in chat_streaming to trigger incremental saves.
        }
        ToolLoopEvent::Error(msg) => {
            send_or_log(tx, ChatStreamEvent::Error(msg));
        }
    }
}

pub(crate) fn extract_user_text(messages: &[Message]) -> String {
    messages
        .iter()
        .filter(|m| m.role == ChatRole::User)
        .map(|m| {
            let block_text = m.content_blocks.as_ref().and_then(|blocks| {
                let texts: Vec<&str> = blocks
                    .iter()
                    .filter_map(|b| match b {
                        ChatContentBlock::Text { text } => Some(text.as_str()),
                        _ => None,
                    })
                    .collect();
                if texts.is_empty() { None } else { Some(texts.join("\n\n")) }
            });
            block_text.unwrap_or_else(|| m.content.clone())
        })
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use serde_json::json;

    fn make_msg(role: ChatRole, content: &str) -> Message {
        Message {
            message_id: MessageId::new(),
            agent_instance_id: AgentInstanceId::new(),
            project_id: ProjectId::new(),
            role,
            content: content.into(),
            content_blocks: None,
            thinking: None,
            thinking_duration_ms: None,
            created_at: Utc::now(),
        }
    }

    // ── forward_tool_loop_event ─────────────────────────────────────

    #[test]
    fn forward_delta_sends_chat_delta() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let blocks: ContentBlockAccumulator = Arc::new(Mutex::new(Vec::new()));

        forward_tool_loop_event(ToolLoopEvent::Delta("hello".into()), &tx, &blocks);

        match rx.try_recv().unwrap() {
            ChatStreamEvent::Delta(t) => assert_eq!(t, "hello"),
            other => panic!("expected Delta, got {other:?}"),
        }
        assert!(blocks.lock().unwrap().is_empty());
    }

    #[test]
    fn forward_thinking_delta() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let blocks: ContentBlockAccumulator = Arc::new(Mutex::new(Vec::new()));

        forward_tool_loop_event(ToolLoopEvent::ThinkingDelta("hmm".into()), &tx, &blocks);

        match rx.try_recv().unwrap() {
            ChatStreamEvent::ThinkingDelta(t) => assert_eq!(t, "hmm"),
            other => panic!("expected ThinkingDelta, got {other:?}"),
        }
    }

    #[test]
    fn forward_tool_use_detected_accumulates_block_and_sends() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let blocks: ContentBlockAccumulator = Arc::new(Mutex::new(Vec::new()));

        forward_tool_loop_event(
            ToolLoopEvent::ToolUseDetected {
                id: "t1".into(),
                name: "read_file".into(),
                input: json!({"path": "a.rs"}),
            },
            &tx,
            &blocks,
        );

        let acc = blocks.lock().unwrap();
        assert_eq!(acc.len(), 1);
        assert!(matches!(&acc[0], ChatContentBlock::ToolUse { id, name, .. }
            if id == "t1" && name == "read_file"));

        match rx.try_recv().unwrap() {
            ChatStreamEvent::ToolCall { id, name, .. } => {
                assert_eq!(id, "t1");
                assert_eq!(name, "read_file");
            }
            other => panic!("expected ToolCall, got {other:?}"),
        }
    }

    #[test]
    fn forward_tool_result_accumulates_and_sends() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let blocks: ContentBlockAccumulator = Arc::new(Mutex::new(Vec::new()));

        forward_tool_loop_event(
            ToolLoopEvent::ToolResult {
                tool_use_id: "t1".into(),
                tool_name: "read_file".into(),
                content: "fn main() {}".into(),
                is_error: false,
            },
            &tx,
            &blocks,
        );

        let acc = blocks.lock().unwrap();
        assert_eq!(acc.len(), 1);
        assert!(matches!(&acc[0], ChatContentBlock::ToolResult { tool_use_id, is_error, .. }
            if tool_use_id == "t1" && is_error.is_none()));

        match rx.try_recv().unwrap() {
            ChatStreamEvent::ToolResult { id, name, result, is_error } => {
                assert_eq!(id, "t1");
                assert_eq!(name, "read_file");
                assert_eq!(result, "fn main() {}");
                assert!(!is_error);
            }
            other => panic!("expected ToolResult, got {other:?}"),
        }
    }

    #[test]
    fn forward_tool_result_is_error_flag() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let blocks: ContentBlockAccumulator = Arc::new(Mutex::new(Vec::new()));

        forward_tool_loop_event(
            ToolLoopEvent::ToolResult {
                tool_use_id: "t1".into(),
                tool_name: "write_file".into(),
                content: "permission denied".into(),
                is_error: true,
            },
            &tx,
            &blocks,
        );

        let acc = blocks.lock().unwrap();
        assert!(matches!(&acc[0], ChatContentBlock::ToolResult { is_error: Some(true), .. }));
    }

    #[test]
    fn forward_token_usage() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let blocks: ContentBlockAccumulator = Arc::new(Mutex::new(Vec::new()));

        forward_tool_loop_event(
            ToolLoopEvent::IterationTokenUsage { input_tokens: 100, output_tokens: 50 },
            &tx,
            &blocks,
        );

        match rx.try_recv().unwrap() {
            ChatStreamEvent::TokenUsage { input_tokens, output_tokens } => {
                assert_eq!(input_tokens, 100);
                assert_eq!(output_tokens, 50);
            }
            other => panic!("expected TokenUsage, got {other:?}"),
        }
    }

    #[test]
    fn forward_error() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let blocks: ContentBlockAccumulator = Arc::new(Mutex::new(Vec::new()));

        forward_tool_loop_event(
            ToolLoopEvent::Error("something broke".into()),
            &tx,
            &blocks,
        );

        match rx.try_recv().unwrap() {
            ChatStreamEvent::Error(msg) => assert_eq!(msg, "something broke"),
            other => panic!("expected Error, got {other:?}"),
        }
    }

    #[test]
    fn forward_tool_use_started() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let blocks: ContentBlockAccumulator = Arc::new(Mutex::new(Vec::new()));

        forward_tool_loop_event(
            ToolLoopEvent::ToolUseStarted { id: "t1".into(), name: "read_file".into() },
            &tx,
            &blocks,
        );

        match rx.try_recv().unwrap() {
            ChatStreamEvent::ToolCallStarted { id, name } => {
                assert_eq!(id, "t1");
                assert_eq!(name, "read_file");
            }
            other => panic!("expected ToolCallStarted, got {other:?}"),
        }
        assert!(blocks.lock().unwrap().is_empty());
    }

    // ── extract_user_text ──────────────────────────────────────────

    #[test]
    fn extract_user_text_single_message() {
        let msgs = vec![make_msg(ChatRole::User, "Hello world")];
        assert_eq!(extract_user_text(&msgs), "Hello world");
    }

    #[test]
    fn extract_user_text_blocks_preferred_over_content() {
        let mut msg = make_msg(ChatRole::User, "fallback");
        msg.content_blocks = Some(vec![
            ChatContentBlock::Text { text: "from blocks".into() },
        ]);
        assert_eq!(extract_user_text(&[msg]), "from blocks");
    }

    #[test]
    fn extract_user_text_filters_non_user() {
        let msgs = vec![
            make_msg(ChatRole::User, "user msg"),
            make_msg(ChatRole::Assistant, "assistant msg"),
            make_msg(ChatRole::System, "system msg"),
        ];
        assert_eq!(extract_user_text(&msgs), "user msg");
    }

    #[test]
    fn extract_user_text_empty_messages() {
        let msgs: Vec<Message> = vec![];
        assert_eq!(extract_user_text(&msgs), "");
    }

    #[test]
    fn extract_user_text_joins_with_double_newline() {
        let msgs = vec![
            make_msg(ChatRole::User, "first"),
            make_msg(ChatRole::User, "second"),
        ];
        assert_eq!(extract_user_text(&msgs), "first\n\nsecond");
    }

    #[test]
    fn extract_user_text_skips_empty_content() {
        let msgs = vec![
            make_msg(ChatRole::User, ""),
            make_msg(ChatRole::User, "real content"),
        ];
        assert_eq!(extract_user_text(&msgs), "real content");
    }

    #[test]
    fn extract_user_text_blocks_with_non_text_blocks_only() {
        let mut msg = make_msg(ChatRole::User, "fallback content");
        msg.content_blocks = Some(vec![
            ChatContentBlock::ToolResult {
                tool_use_id: "t1".into(),
                content: "result".into(),
                is_error: None,
            },
        ]);
        assert_eq!(extract_user_text(&[msg]), "fallback content");
    }

    #[test]
    fn extract_user_text_multiple_text_blocks_joined() {
        let mut msg = make_msg(ChatRole::User, "");
        msg.content_blocks = Some(vec![
            ChatContentBlock::Text { text: "block one".into() },
            ChatContentBlock::Text { text: "block two".into() },
        ]);
        let result = extract_user_text(&[msg]);
        assert!(result.contains("block one"));
        assert!(result.contains("block two"));
    }
}
