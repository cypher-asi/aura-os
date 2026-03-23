//! Mapping between runtime events and chat stream events.

use aura_link::RuntimeEvent;

use crate::chat::ChatStreamEvent;

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
