use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

use crate::ClaudeClientError;

// ---------------------------------------------------------------------------
// Public types for tool use
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheControl {
    #[serde(rename = "type")]
    pub cache_type: String,
}

impl CacheControl {
    pub fn ephemeral() -> Self {
        Self {
            cache_type: "ephemeral".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_control: Option<CacheControl>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub input: serde_json::Value,
}

#[derive(Debug, Clone)]
pub struct ToolStreamResponse {
    pub text: String,
    pub tool_calls: Vec<ToolCall>,
    pub stop_reason: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_creation_input_tokens: u64,
    pub cache_read_input_tokens: u64,
    /// The model that actually served this request (may differ from the
    /// requested model after overload fallback).
    pub model_used: String,
}

// ---------------------------------------------------------------------------
// Rich message types for the Anthropic API
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageSource {
    #[serde(rename = "type")]
    pub source_type: String,
    pub media_type: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentBlock {
    Text {
        text: String,
    },
    Image {
        source: ImageSource,
    },
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    ToolResult {
        tool_use_id: String,
        content: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        is_error: Option<bool>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MessageContent {
    Text(String),
    Blocks(Vec<ContentBlock>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RichMessage {
    pub role: String,
    pub content: MessageContent,
}

impl RichMessage {
    pub fn user(text: &str) -> Self {
        Self {
            role: "user".into(),
            content: MessageContent::Text(text.into()),
        }
    }
    pub fn assistant_text(text: &str) -> Self {
        Self {
            role: "assistant".into(),
            content: MessageContent::Text(text.into()),
        }
    }
    pub fn assistant_blocks(blocks: Vec<ContentBlock>) -> Self {
        Self {
            role: "assistant".into(),
            content: MessageContent::Blocks(blocks),
        }
    }
    pub fn tool_results(results: Vec<ContentBlock>) -> Self {
        Self {
            role: "user".into(),
            content: MessageContent::Blocks(results),
        }
    }
}

// ---------------------------------------------------------------------------
// Generic type aliases (provider-agnostic names for callers)
// ---------------------------------------------------------------------------

pub type LlmStreamEvent = ClaudeStreamEvent;
pub type LlmToolResponse = ToolStreamResponse;
pub type LlmError = ClaudeClientError;

#[derive(Debug, Clone)]
pub struct LlmResponse {
    pub text: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
}

// ---------------------------------------------------------------------------
// Provider trait
// ---------------------------------------------------------------------------

#[async_trait]
pub trait LlmProvider: Send + Sync {
    async fn complete(
        &self,
        api_key: &str,
        system_prompt: &str,
        user_message: &str,
        max_tokens: u32,
    ) -> Result<LlmResponse, ClaudeClientError>;

    async fn complete_stream(
        &self,
        api_key: &str,
        system_prompt: &str,
        user_message: &str,
        max_tokens: u32,
        event_tx: mpsc::UnboundedSender<LlmStreamEvent>,
    ) -> Result<String, ClaudeClientError>;

    async fn complete_stream_multi(
        &self,
        api_key: &str,
        system_prompt: &str,
        messages: Vec<(String, String)>,
        max_tokens: u32,
        event_tx: mpsc::UnboundedSender<LlmStreamEvent>,
    ) -> Result<String, ClaudeClientError>;

    async fn complete_stream_with_tools(
        &self,
        api_key: &str,
        system_prompt: &str,
        messages: Vec<RichMessage>,
        tools: Vec<ToolDefinition>,
        max_tokens: u32,
        thinking: Option<ThinkingConfig>,
        event_tx: mpsc::UnboundedSender<LlmStreamEvent>,
    ) -> Result<ToolStreamResponse, ClaudeClientError>;

    async fn complete_stream_with_tools_model(
        &self,
        model: &str,
        api_key: &str,
        system_prompt: &str,
        messages: Vec<RichMessage>,
        tools: Vec<ToolDefinition>,
        max_tokens: u32,
        thinking: Option<ThinkingConfig>,
        event_tx: mpsc::UnboundedSender<LlmStreamEvent>,
    ) -> Result<ToolStreamResponse, ClaudeClientError> {
        let _ = model;
        self.complete_stream_with_tools(
            api_key, system_prompt, messages, tools, max_tokens, thinking, event_tx,
        ).await
    }

    async fn complete_with_model(
        &self,
        model: &str,
        api_key: &str,
        system_prompt: &str,
        user_message: &str,
        max_tokens: u32,
    ) -> Result<LlmResponse, ClaudeClientError> {
        let _ = model;
        self.complete(api_key, system_prompt, user_message, max_tokens).await
    }
}

// ---------------------------------------------------------------------------
// Stream events
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub enum ClaudeStreamEvent {
    Delta(String),
    ThinkingDelta(String),
    ToolUseStarted {
        id: String,
        name: String,
    },
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    Done {
        stop_reason: String,
        input_tokens: u64,
        output_tokens: u64,
        cache_creation_input_tokens: u64,
        cache_read_input_tokens: u64,
    },
    Error(String),
}

// ---------------------------------------------------------------------------
// Internal request/response types (shared between client and SSE parser)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub(crate) struct SimpleMessage {
    pub role: String,
    pub content: String,
}

#[derive(Serialize)]
pub(crate) struct SimpleMessagesRequest {
    pub model: String,
    pub max_tokens: u32,
    pub system: serde_json::Value,
    pub messages: Vec<SimpleMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream: Option<bool>,
}

#[derive(Serialize, Clone)]
pub struct ThinkingConfig {
    #[serde(rename = "type")]
    pub thinking_type: String,
    pub budget_tokens: u32,
}

impl ThinkingConfig {
    pub fn enabled(budget_tokens: u32) -> Self {
        Self {
            thinking_type: "enabled".to_string(),
            budget_tokens,
        }
    }
}

#[derive(Serialize)]
pub(crate) struct ToolMessagesRequest {
    pub model: String,
    pub max_tokens: u32,
    pub system: serde_json::Value,
    pub messages: Vec<RichMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<ToolDefinition>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking: Option<ThinkingConfig>,
}

#[derive(Deserialize)]
pub(crate) struct MessagesResponse {
    pub content: Vec<ResponseContentBlock>,
    pub stop_reason: Option<String>,
    #[serde(default)]
    pub usage: Option<UsageBlock>,
}

#[derive(Deserialize, Default)]
#[allow(dead_code)]
pub(crate) struct UsageBlock {
    #[serde(default)]
    pub input_tokens: u64,
    #[serde(default)]
    pub output_tokens: u64,
    #[serde(default)]
    pub cache_creation_input_tokens: u64,
    #[serde(default)]
    pub cache_read_input_tokens: u64,
}

#[derive(Deserialize)]
pub(crate) struct ResponseContentBlock {
    pub text: Option<String>,
}

// ---------------------------------------------------------------------------
// Token estimation helpers
// ---------------------------------------------------------------------------

/// Approximate token count for a text string (~4 characters per token).
pub fn estimate_tokens(text: &str) -> u64 {
    (text.len() as u64).div_ceil(4)
}

/// Estimate token count for a RichMessage.
pub fn estimate_message_tokens(msg: &RichMessage) -> u64 {
    match &msg.content {
        MessageContent::Text(t) => estimate_tokens(t) + 4,
        MessageContent::Blocks(blocks) => {
            let mut total: u64 = 4;
            for block in blocks {
                total += match block {
                    ContentBlock::Text { text } => estimate_tokens(text),
                    ContentBlock::Image { source } => {
                        1000 + (source.data.len() as u64 / 4)
                    }
                    ContentBlock::ToolUse { name, input, .. } => {
                        estimate_tokens(name)
                            + estimate_tokens(&input.to_string())
                            + 10
                    }
                    ContentBlock::ToolResult { content, .. } => {
                        estimate_tokens(content) + 10
                    }
                };
            }
            total
        }
    }
}
