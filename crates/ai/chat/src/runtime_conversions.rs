//! Bidirectional type conversions between Claude wire types and the link
//! boundary types.
//!
//! These helpers are used by `chat_streaming.rs` and `chat_agent.rs` to bridge
//! the existing Claude-typed data into [`aura_link::TurnRequest`] form.

use std::sync::Arc;

use async_trait::async_trait;

use aura_link::{RuntimeEvent, TurnConfig, TurnResult};

use crate::chat::ChatStreamEvent;
use crate::tool_loop::{ToolLoopConfig, ToolLoopResult};
use crate::tool_loop_types::{self as chat_types};

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

pub fn tool_loop_config_to_turn_config(config: &ToolLoopConfig) -> TurnConfig {
    TurnConfig {
        max_iterations: config.max_iterations,
        max_tokens: config.max_tokens,
        thinking: config
            .thinking
            .as_ref()
            .map(|tc| aura_link::ThinkingConfig {
                thinking_type: tc.thinking_type.clone(),
                budget_tokens: tc.budget_tokens,
            }),
        stream_timeout: config.stream_timeout,
        max_context_tokens: config.max_context_tokens,
        model_override: config.model_override.clone(),
        exploration_allowance: config.exploration_allowance,
        auto_build_cooldown: config.auto_build_cooldown,
        credit_budget: config.credit_budget,
        billing_reason: Some(config.billing_reason.to_string()),
    }
}

pub fn turn_result_to_tool_loop_result(result: TurnResult) -> ToolLoopResult {
    ToolLoopResult {
        text: result.text,
        thinking: result.thinking,
        total_input_tokens: result.usage.input_tokens,
        total_output_tokens: result.usage.output_tokens,
        iterations_run: result.iterations_run,
        timed_out: result.timed_out,
        insufficient_credits: result.insufficient_credits,
        llm_error: result.llm_error,
    }
}

// ===========================================================================
// ChatToolExecutorAdapter — wraps a chat-crate ToolExecutor for the link
// ===========================================================================

/// Bridges a chat-crate [`ToolExecutor`](chat_types::ToolExecutor) to the
/// link [`ToolExecutor`](aura_link::ToolExecutor) so that existing
/// `ForwardingToolExecutor` / `EngineToolLoopExecutor` can be passed through
/// `TurnRequest`.
pub struct ChatToolExecutorAdapter<T: chat_types::ToolExecutor + 'static> {
    /// The inner chat-crate tool executor.
    pub inner: T,
}

#[async_trait]
impl<T: chat_types::ToolExecutor + 'static> aura_link::ToolExecutor
    for ChatToolExecutorAdapter<T>
{
    async fn execute(
        &self,
        tool_calls: &[aura_link::ToolCall],
    ) -> Vec<aura_link::ToolCallResult> {
        let claude_calls: Vec<aura_claude::ToolCall> = tool_calls
            .iter()
            .map(|tc| aura_claude::ToolCall {
                id: tc.id.clone(),
                name: tc.name.clone(),
                input: tc.input.clone(),
            })
            .collect();

        self.inner
            .execute(&claude_calls)
            .await
            .into_iter()
            .map(|r| aura_link::ToolCallResult {
                tool_use_id: r.tool_use_id,
                content: r.content,
                is_error: r.is_error,
                stop_loop: r.stop_loop,
            })
            .collect()
    }

    async fn auto_build_check(&self) -> Option<aura_link::AutoBuildResult> {
        self.inner
            .auto_build_check()
            .await
            .map(|r| aura_link::AutoBuildResult {
                success: r.success,
                output: r.output,
                error_count: 0,
            })
    }

    async fn capture_build_baseline(&self) -> Option<aura_link::BuildBaseline> {
        self.inner
            .capture_build_baseline()
            .await
            .map(|r| aura_link::BuildBaseline {
                error_signatures: r.error_signatures,
            })
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
