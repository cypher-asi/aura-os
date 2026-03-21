//! Conversions between provider-agnostic types and Claude wire types.

use aura_provider::{
    ContentBlock as ProviderBlock, Message as ProviderMessage,
    MessageContent as ProviderContent, Role, ThinkingConfig as ProviderThinking,
    ToolCall as ProviderToolCall, ToolDefinition as ProviderToolDef,
};

use crate::types::{
    CacheControl, ContentBlock, ImageSource, MessageContent, RichMessage, ThinkingConfig,
    ToolCall, ToolDefinition, ToolStreamResponse,
};
use crate::ClaudeClientError;

// -- Provider -> Wire (for outbound requests) --------------------------------

impl From<ProviderMessage> for RichMessage {
    fn from(msg: ProviderMessage) -> Self {
        let role = match msg.role {
            Role::User => "user",
            Role::Assistant => "assistant",
        };
        RichMessage {
            role: role.to_string(),
            content: msg.content.into(),
        }
    }
}

impl From<ProviderContent> for MessageContent {
    fn from(content: ProviderContent) -> Self {
        match content {
            ProviderContent::Text(t) => MessageContent::Text(t),
            ProviderContent::Blocks(blocks) => {
                MessageContent::Blocks(blocks.into_iter().map(Into::into).collect())
            }
        }
    }
}

impl From<ProviderBlock> for ContentBlock {
    fn from(block: ProviderBlock) -> Self {
        match block {
            ProviderBlock::Text { text } => ContentBlock::Text { text },
            ProviderBlock::Image { source } => ContentBlock::Image {
                source: ImageSource {
                    source_type: source.source_type,
                    media_type: source.media_type,
                    data: source.data,
                },
            },
            ProviderBlock::ToolUse { id, name, input } => {
                ContentBlock::ToolUse { id, name, input }
            }
            ProviderBlock::ToolResult {
                tool_use_id,
                content,
                is_error,
            } => ContentBlock::ToolResult {
                tool_use_id,
                content,
                is_error,
            },
        }
    }
}

impl From<ProviderToolDef> for ToolDefinition {
    fn from(td: ProviderToolDef) -> Self {
        ToolDefinition {
            name: td.name,
            description: td.description,
            input_schema: td.input_schema,
            cache_control: td.cache_control.map(|cc| CacheControl {
                cache_type: cc.cache_type,
            }),
        }
    }
}

impl From<ProviderThinking> for ThinkingConfig {
    fn from(tc: ProviderThinking) -> Self {
        ThinkingConfig {
            thinking_type: tc.thinking_type,
            budget_tokens: tc.budget_tokens,
        }
    }
}

// -- Wire -> Provider (for inbound responses) --------------------------------

impl From<ToolCall> for ProviderToolCall {
    fn from(tc: ToolCall) -> Self {
        ProviderToolCall {
            id: tc.id,
            name: tc.name,
            input: tc.input,
        }
    }
}

impl From<ToolStreamResponse> for aura_provider::ModelResponse {
    fn from(resp: ToolStreamResponse) -> Self {
        aura_provider::ModelResponse {
            text: resp.text,
            thinking: String::new(),
            tool_calls: resp.tool_calls.into_iter().map(Into::into).collect(),
            stop_reason: aura_provider::StopReason::from_str(&resp.stop_reason),
            usage: aura_provider::Usage {
                input_tokens: resp.input_tokens,
                output_tokens: resp.output_tokens,
                cache_creation_tokens: resp.cache_creation_input_tokens,
                cache_read_tokens: resp.cache_read_input_tokens,
            },
            model_used: resp.model_used,
        }
    }
}

impl From<ClaudeClientError> for aura_provider::ProviderError {
    fn from(e: ClaudeClientError) -> Self {
        match e {
            ClaudeClientError::Http(re) => {
                aura_provider::ProviderError::Http(re.to_string())
            }
            ClaudeClientError::Api { status, message } => {
                aura_provider::ProviderError::Api { status, message }
            }
            ClaudeClientError::Overloaded => aura_provider::ProviderError::Overloaded,
            ClaudeClientError::Truncated { max_tokens } => {
                aura_provider::ProviderError::Truncated { max_tokens }
            }
            ClaudeClientError::Parse(msg) => aura_provider::ProviderError::Parse(msg),
            ClaudeClientError::InsufficientCredits => {
                aura_provider::ProviderError::InsufficientCredits
            }
        }
    }
}
