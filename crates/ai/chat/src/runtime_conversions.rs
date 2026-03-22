//! Bidirectional type conversions between Claude wire types and the link
//! boundary types.
//!
//! These helpers are used by `chat_streaming.rs` and `chat_agent.rs` to bridge
//! the existing Claude-typed data into [`aura_link::TurnRequest`] form.

use std::sync::Arc;

use aura_link::RuntimeEvent;

use crate::chat::ChatStreamEvent;

// ===========================================================================
// Claude → Link conversions
// ===========================================================================

pub fn rich_messages_to_link(
    messages: Vec<aura_claude::RichMessage>,
) -> Vec<aura_link::Message> {
    messages.into_iter().map(rich_message_to_link).collect()
}

fn rich_message_to_link(msg: aura_claude::RichMessage) -> aura_link::Message {
    let role = if msg.role == "assistant" {
        aura_link::Role::Assistant
    } else {
        aura_link::Role::User
    };
    aura_link::Message {
        role,
        content: message_content_to_link(msg.content),
    }
}

fn message_content_to_link(
    content: aura_claude::MessageContent,
) -> aura_link::MessageContent {
    match content {
        aura_claude::MessageContent::Text(t) => aura_link::MessageContent::Text(t),
        aura_claude::MessageContent::Blocks(blocks) => {
            aura_link::MessageContent::Blocks(blocks.into_iter().map(block_to_link).collect())
        }
    }
}

fn block_to_link(block: aura_claude::ContentBlock) -> aura_link::ContentBlock {
    match block {
        aura_claude::ContentBlock::Text { text } => aura_link::ContentBlock::Text { text },
        aura_claude::ContentBlock::Image { source } => aura_link::ContentBlock::Image {
            source: aura_link::ImageSource {
                source_type: source.source_type,
                media_type: source.media_type,
                data: source.data,
            },
        },
        aura_claude::ContentBlock::ToolUse { id, name, input } => {
            aura_link::ContentBlock::ToolUse { id, name, input }
        }
        aura_claude::ContentBlock::ToolResult {
            tool_use_id,
            content,
            is_error,
        } => aura_link::ContentBlock::ToolResult {
            tool_use_id,
            content,
            is_error,
        },
    }
}

pub fn tool_defs_to_link(
    tools: Arc<[aura_claude::ToolDefinition]>,
) -> Arc<[aura_link::ToolDefinition]> {
    let link_tools: Vec<aura_link::ToolDefinition> =
        tools.iter().map(tool_def_to_link).collect();
    link_tools.into()
}

fn tool_def_to_link(td: &aura_claude::ToolDefinition) -> aura_link::ToolDefinition {
    aura_link::ToolDefinition {
        name: td.name.clone(),
        description: td.description.clone(),
        input_schema: td.input_schema.clone(),
        cache_control: td
            .cache_control
            .as_ref()
            .map(|cc| aura_link::CacheControl {
                cache_type: cc.cache_type.clone(),
            }),
    }
}

// ===========================================================================
// RuntimeEvent → ChatStreamEvent mapping
// ===========================================================================

/// Map a [`RuntimeEvent`] to the corresponding [`ChatStreamEvent`].
///
/// Returns `None` for events that have no chat-stream equivalent (e.g.
/// `IterationComplete`).
pub fn map_runtime_event_to_chat_event(evt: RuntimeEvent) -> Option<ChatStreamEvent> {
    match evt {
        RuntimeEvent::Delta(text) => Some(ChatStreamEvent::Delta(text)),
        RuntimeEvent::ThinkingDelta(text) => Some(ChatStreamEvent::ThinkingDelta(text)),
        RuntimeEvent::ToolUseStarted { id, name } => {
            Some(ChatStreamEvent::ToolCallStarted { id, name })
        }
        RuntimeEvent::ToolInputSnapshot { id, name, input } => {
            Some(ChatStreamEvent::ToolCallSnapshot { id, name, input })
        }
        RuntimeEvent::ToolUseDetected { id, name, input } => {
            Some(ChatStreamEvent::ToolCall { id, name, input })
        }
        RuntimeEvent::ToolResult {
            tool_use_id,
            tool_name,
            content,
            is_error,
        } => Some(ChatStreamEvent::ToolResult {
            id: tool_use_id,
            name: tool_name,
            result: content,
            is_error,
        }),
        RuntimeEvent::IterationTokenUsage {
            input_tokens,
            output_tokens,
        } => Some(ChatStreamEvent::TokenUsage {
            input_tokens,
            output_tokens,
        }),
        RuntimeEvent::Warning(msg) => Some(ChatStreamEvent::Progress(format!("Warning: {msg}"))),
        RuntimeEvent::Error(msg) => Some(ChatStreamEvent::Error(msg)),
        RuntimeEvent::IterationComplete { .. } => None,
    }
}
