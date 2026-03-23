//! Request and response types for model completions.

use serde::{Deserialize, Serialize};

use crate::types::{Message, ToolCall, ToolDefinition};

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

/// Controls how the model selects tools.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolChoice {
    /// The model decides whether to use tools.
    Auto,
    /// The model must use at least one tool.
    Any,
    /// The model must not use tools.
    None,
}

/// A bundled request for a model completion.
#[derive(Debug, Clone)]
pub struct ModelRequest {
    /// The model identifier to use (e.g. "claude-opus-4-6").
    pub model: String,
    /// The system prompt.
    pub system_prompt: String,
    /// The conversation messages.
    pub messages: Vec<Message>,
    /// Available tool definitions.
    pub tools: Vec<ToolDefinition>,
    /// Maximum tokens to generate.
    pub max_tokens: u32,
    /// Optional thinking configuration.
    pub thinking: Option<ThinkingConfig>,
    /// Optional tool choice constraint.
    pub tool_choice: Option<ToolChoice>,
    /// API key for authentication.
    pub api_key: String,
}

/// Why the model stopped generating.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StopReason {
    /// The model finished its response naturally.
    EndTurn,
    /// The model wants to invoke one or more tools.
    ToolUse,
    /// The response was cut off at the token limit.
    MaxTokens,
    /// An unknown stop reason from the provider.
    Other(String),
}

impl StopReason {
    /// Parse a stop reason from a provider string.
    #[allow(clippy::should_implement_trait)]
    pub fn from_str(s: &str) -> Self {
        match s {
            "end_turn" => Self::EndTurn,
            "tool_use" => Self::ToolUse,
            "max_tokens" => Self::MaxTokens,
            other => Self::Other(other.to_string()),
        }
    }
}

/// Token usage statistics from a completion.
#[derive(Debug, Clone, Default)]
pub struct Usage {
    /// Number of input tokens consumed.
    pub input_tokens: u64,
    /// Number of output tokens generated.
    pub output_tokens: u64,
    /// Tokens used to create new cache entries.
    pub cache_creation_tokens: u64,
    /// Tokens read from existing cache entries.
    pub cache_read_tokens: u64,
}

/// A completed model response.
#[derive(Debug, Clone)]
pub struct ModelResponse {
    /// The generated text content.
    pub text: String,
    /// Any thinking content produced.
    pub thinking: String,
    /// Tool calls requested by the model.
    pub tool_calls: Vec<ToolCall>,
    /// Why the model stopped.
    pub stop_reason: StopReason,
    /// Token usage statistics.
    pub usage: Usage,
    /// The model that actually served this request (may differ after fallback).
    pub model_used: String,
}
