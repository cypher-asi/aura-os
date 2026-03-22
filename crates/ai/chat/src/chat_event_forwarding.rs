use std::sync::{Arc, Mutex};

use tokio::sync::mpsc;

use aura_core::*;
use aura_link::RuntimeEvent;

use crate::channel_ext::send_or_log;
use crate::chat::ChatStreamEvent;
use crate::runtime_conversions::map_runtime_event_to_chat_event;

pub(crate) type ContentBlockAccumulator = Arc<Mutex<Vec<ChatContentBlock>>>;

/// Flush accumulated text as a `ChatContentBlock::Text` block.
pub(crate) fn flush_text_buffer(blocks: &ContentBlockAccumulator, buf: &mut String) {
    if !buf.is_empty() {
        if let Ok(mut acc) = blocks.lock() {
            acc.push(ChatContentBlock::Text { text: buf.clone() });
        }
        buf.clear();
    }
}

/// Forward a [`RuntimeEvent`] to the chat stream, accumulating content blocks
/// for tool use and tool results.
///
/// Text deltas are buffered; when a tool-use event arrives the buffer is
/// flushed as a `Text` content block *before* the tool block.
/// The caller must call [`flush_text_buffer`] once more after the receive
/// loop exits to commit any trailing text segment.
pub(crate) fn forward_runtime_event(
    evt: RuntimeEvent,
    tx: &mpsc::UnboundedSender<ChatStreamEvent>,
    blocks: &ContentBlockAccumulator,
    text_buffer: &mut String,
) {
    match &evt {
        RuntimeEvent::Delta(text) => {
            text_buffer.push_str(text);
        }
        RuntimeEvent::ToolUseStarted { .. } | RuntimeEvent::ToolUseDetected { .. } => {
            flush_text_buffer(blocks, text_buffer);
        }
        _ => {}
    }
    if let RuntimeEvent::ToolUseDetected { id, name, input } = &evt {
        if let Ok(mut acc) = blocks.lock() {
            acc.push(ChatContentBlock::ToolUse {
                id: id.clone(),
                name: name.clone(),
                input: input.clone(),
            });
        }
    }
    if let RuntimeEvent::ToolResult {
        tool_use_id,
        content,
        is_error,
        ..
    } = &evt
    {
        if let Ok(mut acc) = blocks.lock() {
            acc.push(ChatContentBlock::ToolResult {
                tool_use_id: tool_use_id.clone(),
                content: content.clone(),
                is_error: if *is_error { Some(true) } else { None },
            });
        }
    }
    if let Some(chat_evt) = map_runtime_event_to_chat_event(evt) {
        send_or_log(tx, chat_evt);
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
                if texts.is_empty() {
                    None
                } else {
                    Some(texts.join("\n\n"))
                }
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

    // ── flush_text_buffer ───────────────────────────────────────────

    #[test]
    fn flush_text_buffer_pushes_text_block() {
        let blocks: ContentBlockAccumulator = Arc::new(Mutex::new(Vec::new()));
        let mut buf = "some text".to_string();
        flush_text_buffer(&blocks, &mut buf);
        assert!(buf.is_empty());
        let acc = blocks.lock().unwrap();
        assert_eq!(acc.len(), 1);
        assert!(matches!(&acc[0], ChatContentBlock::Text { text } if text == "some text"));
    }

    #[test]
    fn flush_text_buffer_noop_when_empty() {
        let blocks: ContentBlockAccumulator = Arc::new(Mutex::new(Vec::new()));
        let mut buf = String::new();
        flush_text_buffer(&blocks, &mut buf);
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
        msg.content_blocks = Some(vec![ChatContentBlock::Text {
            text: "from blocks".into(),
        }]);
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
        msg.content_blocks = Some(vec![ChatContentBlock::ToolResult {
            tool_use_id: "t1".into(),
            content: "result".into(),
            is_error: None,
        }]);
        assert_eq!(extract_user_text(&[msg]), "fallback content");
    }

    #[test]
    fn extract_user_text_multiple_text_blocks_joined() {
        let mut msg = make_msg(ChatRole::User, "");
        msg.content_blocks = Some(vec![
            ChatContentBlock::Text {
                text: "block one".into(),
            },
            ChatContentBlock::Text {
                text: "block two".into(),
            },
        ]);
        let result = extract_user_text(&[msg]);
        assert!(result.contains("block one"));
        assert!(result.contains("block two"));
    }
}
