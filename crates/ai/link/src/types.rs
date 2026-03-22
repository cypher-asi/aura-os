//! Boundary types for the link abstraction layer.
//!
//! These are self-contained type definitions that mirror the conversation
//! primitives needed by [`AgentRuntime`](crate::AgentRuntime) and
//! [`ToolExecutor`](crate::ToolExecutor) without pulling in provider crates.

use serde::{Deserialize, Serialize};

/// The role of a message participant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    /// A user message.
    User,
    /// An assistant response.
    Assistant,
}

/// Cache control hints for prompt caching.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheControl {
    /// The cache control type (e.g. "ephemeral").
    #[serde(rename = "type")]
    pub cache_type: String,
}

impl CacheControl {
    /// Create an ephemeral cache control hint.
    pub fn ephemeral() -> Self {
        Self {
            cache_type: "ephemeral".to_string(),
        }
    }
}

/// A tool definition describing a callable tool.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    /// The tool name.
    pub name: String,
    /// Human-readable description of the tool.
    pub description: String,
    /// JSON Schema for the tool's input parameters.
    pub input_schema: serde_json::Value,
    /// Optional cache control for this tool definition.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_control: Option<CacheControl>,
}

/// A tool invocation requested by the model.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    /// Unique identifier for this tool use.
    pub id: String,
    /// The name of the tool to invoke.
    pub name: String,
    /// The input arguments as JSON.
    pub input: serde_json::Value,
}

/// Source data for an inline image.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageSource {
    /// The encoding type (e.g. "base64").
    #[serde(rename = "type")]
    pub source_type: String,
    /// The MIME type (e.g. "image/png").
    pub media_type: String,
    /// The encoded image data.
    pub data: String,
}

/// A block of content within a message.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentBlock {
    /// A text block.
    Text {
        /// The text content.
        text: String,
    },
    /// An inline image.
    Image {
        /// The image source data.
        source: ImageSource,
    },
    /// A tool invocation by the assistant.
    ToolUse {
        /// Tool use identifier.
        id: String,
        /// Tool name.
        name: String,
        /// Tool input as JSON.
        input: serde_json::Value,
    },
    /// The result of a tool invocation.
    ToolResult {
        /// The tool_use id this result corresponds to.
        tool_use_id: String,
        /// The textual result content.
        content: String,
        /// Whether this result represents an error.
        #[serde(skip_serializing_if = "Option::is_none")]
        is_error: Option<bool>,
    },
}

/// Message content — either a simple string or structured content blocks.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MessageContent {
    /// Plain text content.
    Text(String),
    /// Structured content blocks.
    Blocks(Vec<ContentBlock>),
}

/// A message in a conversation.
#[derive(Debug, Clone, Serialize, Deserialize)]
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
}

/// Configuration for extended thinking.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThinkingConfig {
    /// The thinking mode type (e.g. "enabled").
    #[serde(rename = "type")]
    pub thinking_type: String,
    /// Token budget for the thinking step.
    pub budget_tokens: u32,
}

impl ThinkingConfig {
    /// Create an enabled thinking configuration with the given budget.
    pub fn enabled(budget_tokens: u32) -> Self {
        Self {
            thinking_type: "enabled".to_string(),
            budget_tokens,
        }
    }
}
