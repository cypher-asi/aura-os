//! Boundary types for the link abstraction layer.
//!
//! Most conversation primitives are re-exported directly from the harness
//! crates (`aura-reasoner`, `aura-agent`) to avoid duplication. Only
//! app-specific convenience types like [`MessageContent`] live here.

pub use aura_reasoner::{
    CacheControl, ContentBlock, ImageSource, Role, ThinkingConfig, ToolDefinition,
    ToolResultContent,
};

/// A tool invocation requested by the model.
///
/// Type alias for the harness `ToolCallInfo`.
pub type ToolCall = aura_agent::ToolCallInfo;

/// Message content — either a simple string or structured content blocks.
///
/// This is an app-level convenience that the harness doesn't use (harness
/// `Message` always stores `Vec<ContentBlock>`). When sending to the harness,
/// `Text(s)` is expanded to `vec![ContentBlock::Text { text: s }]`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
pub enum MessageContent {
    /// Plain text content.
    Text(String),
    /// Structured content blocks.
    Blocks(Vec<ContentBlock>),
}

/// A message in a conversation.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Message {
    /// The role of the message sender.
    pub role: Role,
    /// The message content.
    pub content: MessageContent,
}

impl Message {
    /// Create a user message with plain text.
    pub fn user(text: &str) -> Self {
        Self {
            role: Role::User,
            content: MessageContent::Text(text.into()),
        }
    }

    /// Create an assistant message with plain text.
    pub fn assistant_text(text: &str) -> Self {
        Self {
            role: Role::Assistant,
            content: MessageContent::Text(text.into()),
        }
    }

    /// Create an assistant message with content blocks.
    pub fn assistant_blocks(blocks: Vec<ContentBlock>) -> Self {
        Self {
            role: Role::Assistant,
            content: MessageContent::Blocks(blocks),
        }
    }

    /// Create a user message containing tool results.
    pub fn tool_results(results: Vec<ContentBlock>) -> Self {
        Self {
            role: Role::User,
            content: MessageContent::Blocks(results),
        }
    }

    /// Convert to the harness `aura_reasoner::Message`, expanding
    /// `MessageContent::Text` into a single-element content block vec.
    pub(crate) fn to_reasoner(&self) -> aura_reasoner::Message {
        let content = match &self.content {
            MessageContent::Text(s) => {
                vec![ContentBlock::Text { text: s.clone() }]
            }
            MessageContent::Blocks(blocks) => blocks.clone(),
        };
        aura_reasoner::Message {
            role: self.role,
            content,
        }
    }
}

/// Extract the text payload from a [`ToolResultContent`], converting JSON
/// values to their string representation.
pub fn tool_result_as_str(content: &ToolResultContent) -> &str {
    match content {
        ToolResultContent::Text(s) => s,
        ToolResultContent::Json(_) => "",
    }
}

/// Get a mutable reference to the inner string of a [`ToolResultContent::Text`].
/// Returns `None` for JSON payloads.
pub fn tool_result_text_mut(content: &mut ToolResultContent) -> Option<&mut String> {
    match content {
        ToolResultContent::Text(s) => Some(s),
        ToolResultContent::Json(_) => None,
    }
}
