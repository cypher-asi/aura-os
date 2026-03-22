//! Bidirectional type conversions between Claude wire types and the harness
//! boundary types.
//!
//! These helpers are used by `chat_streaming.rs` and `chat_agent.rs` to bridge
//! the existing Claude-typed data into [`aura_harness::TurnRequest`] form.

use std::sync::Arc;

use async_trait::async_trait;

use aura_harness::{RuntimeEvent, TurnConfig, TurnResult};

use crate::chat::ChatStreamEvent;
use crate::tool_loop::{ToolLoopConfig, ToolLoopResult};
use crate::tool_loop_types::{self as chat_types};

// ===========================================================================
// Claude → Harness conversions
// ===========================================================================

pub fn rich_messages_to_harness(
    messages: Vec<aura_claude::RichMessage>,
) -> Vec<aura_harness::Message> {
    messages.into_iter().map(rich_message_to_harness).collect()
}

fn rich_message_to_harness(msg: aura_claude::RichMessage) -> aura_harness::Message {
    let role = if msg.role == "assistant" {
        aura_harness::Role::Assistant
    } else {
        aura_harness::Role::User
    };
    aura_harness::Message {
        role,
        content: message_content_to_harness(msg.content),
    }
}

fn message_content_to_harness(
    content: aura_claude::MessageContent,
) -> aura_harness::MessageContent {
    match content {
        aura_claude::MessageContent::Text(t) => aura_harness::MessageContent::Text(t),
        aura_claude::MessageContent::Blocks(blocks) => {
            aura_harness::MessageContent::Blocks(blocks.into_iter().map(block_to_harness).collect())
        }
    }
}

fn block_to_harness(block: aura_claude::ContentBlock) -> aura_harness::ContentBlock {
    match block {
        aura_claude::ContentBlock::Text { text } => aura_harness::ContentBlock::Text { text },
        aura_claude::ContentBlock::Image { source } => aura_harness::ContentBlock::Image {
            source: aura_harness::ImageSource {
                source_type: source.source_type,
                media_type: source.media_type,
                data: source.data,
            },
        },
        aura_claude::ContentBlock::ToolUse { id, name, input } => {
            aura_harness::ContentBlock::ToolUse { id, name, input }
        }
        aura_claude::ContentBlock::ToolResult {
            tool_use_id,
            content,
            is_error,
        } => aura_harness::ContentBlock::ToolResult {
            tool_use_id,
            content,
            is_error,
        },
    }
}

pub fn tool_defs_to_harness(
    tools: Arc<[aura_claude::ToolDefinition]>,
) -> Arc<[aura_harness::ToolDefinition]> {
    let harness_tools: Vec<aura_harness::ToolDefinition> =
        tools.iter().map(tool_def_to_harness).collect();
    harness_tools.into()
}

fn tool_def_to_harness(td: &aura_claude::ToolDefinition) -> aura_harness::ToolDefinition {
    aura_harness::ToolDefinition {
        name: td.name.clone(),
        description: td.description.clone(),
        input_schema: td.input_schema.clone(),
        cache_control: td
            .cache_control
            .as_ref()
            .map(|cc| aura_harness::CacheControl {
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
            .map(|tc| aura_harness::ThinkingConfig {
                thinking_type: tc.thinking_type.clone(),
                budget_tokens: tc.budget_tokens,
            }),
        stream_timeout: config.stream_timeout,
        max_context_tokens: config.max_context_tokens,
        model_override: config.model_override.clone(),
        exploration_allowance: config.exploration_allowance,
        auto_build_cooldown: config.auto_build_cooldown,
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
// ChatToolExecutorAdapter — wraps a chat-crate ToolExecutor for the harness
// ===========================================================================

/// Bridges a chat-crate [`ToolExecutor`](chat_types::ToolExecutor) to the
/// harness [`ToolExecutor`](aura_harness::ToolExecutor) so that existing
/// `ForwardingToolExecutor` / `EngineToolLoopExecutor` can be passed through
/// `TurnRequest`.
pub struct ChatToolExecutorAdapter<T: chat_types::ToolExecutor + 'static> {
    /// The inner chat-crate tool executor.
    pub inner: T,
}

#[async_trait]
impl<T: chat_types::ToolExecutor + 'static> aura_harness::ToolExecutor
    for ChatToolExecutorAdapter<T>
{
    async fn execute(
        &self,
        tool_calls: &[aura_harness::ToolCall],
    ) -> Vec<aura_harness::ToolCallResult> {
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
            .map(|r| aura_harness::ToolCallResult {
                tool_use_id: r.tool_use_id,
                content: r.content,
                is_error: r.is_error,
                stop_loop: r.stop_loop,
            })
            .collect()
    }

    async fn auto_build_check(&self) -> Option<aura_harness::AutoBuildResult> {
        self.inner
            .auto_build_check()
            .await
            .map(|r| aura_harness::AutoBuildResult {
                success: r.success,
                output: r.output,
            })
    }

    async fn capture_build_baseline(&self) -> Option<aura_harness::BuildBaseline> {
        self.inner
            .capture_build_baseline()
            .await
            .map(|r| aura_harness::BuildBaseline {
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
