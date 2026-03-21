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
