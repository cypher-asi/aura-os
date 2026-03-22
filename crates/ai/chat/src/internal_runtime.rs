//! Deprecated [`AgentRuntime`] implementation backed by the in-process tool loop.
//!
//! **Production code now uses `aura_link::LinkRuntime`.**
//!
//! `InternalRuntime` is kept only because integration tests in `aura-engine`
//! and `aura-server` rely on `MockLlmProvider` → `MeteredLlm` → `run_tool_loop()`
//! to exercise the full request pipeline. It will be removed once those tests
//! are migrated to use `LinkRuntime` with mock HTTP backends.
//!
//! Public conversion helpers that are still used by production code
//! (`chat_streaming.rs`, `chat_agent.rs`) have been moved to
//! [`crate::runtime_conversions`].

use std::sync::Arc;

use async_trait::async_trait;
use tokio::sync::mpsc;

use aura_billing::MeteredLlm;
use aura_link::{AgentRuntime, RuntimeError, RuntimeEvent, TotalUsage, TurnRequest, TurnResult};
use aura_settings::SettingsService;

use crate::tool_loop::{
    run_tool_loop, ToolLoopConfig, ToolLoopEvent, ToolLoopInput, ToolLoopResult,
};
use crate::tool_loop_types::{self as chat_types};

/// In-process agent runtime that delegates to [`run_tool_loop`].
///
/// **Deprecated**: production uses `aura_link::LinkRuntime`.
/// Kept for integration tests only.
pub struct InternalRuntime {
    llm: Arc<MeteredLlm>,
    settings: Arc<SettingsService>,
}

impl InternalRuntime {
    /// Create a new runtime backed by the given metered LLM provider.
    pub fn new(llm: Arc<MeteredLlm>, settings: Arc<SettingsService>) -> Self {
        Self { llm, settings }
    }
}

#[async_trait]
impl AgentRuntime for InternalRuntime {
    async fn execute_turn(&self, request: TurnRequest) -> Result<TurnResult, RuntimeError> {
        let api_key = self
            .settings
            .get_decrypted_api_key()
            .map_err(|e| RuntimeError::Internal(format!("API key error: {e}")))?;

        let messages = convert_messages(request.messages);
        let tools = convert_tools(request.tools);
        let config = convert_config(&request.config);
        let executor_adapter = ExecutorAdapter {
            inner: request.executor,
        };

        let (loop_tx, mut loop_rx) = mpsc::unbounded_channel::<ToolLoopEvent>();
        let event_tx = request.event_tx;

        let forwarder = tokio::spawn(async move {
            while let Some(evt) = loop_rx.recv().await {
                if let Some(ref tx) = event_tx {
                    let _ = tx.send(map_loop_event(evt));
                }
            }
        });

        let input = ToolLoopInput {
            llm: self.llm.clone(),
            api_key: &api_key,
            system_prompt: &request.system_prompt,
            initial_messages: messages,
            tools,
            config: &config,
            executor: &executor_adapter,
            event_tx: &loop_tx,
        };
        let result = run_tool_loop(input).await;

        drop(loop_tx);
        let _ = forwarder.await;

        Ok(convert_result(result))
    }
}

// ---------------------------------------------------------------------------
// Executor adapter (link ToolExecutor -> chat ToolExecutor)
// ---------------------------------------------------------------------------

struct ExecutorAdapter {
    inner: Arc<dyn aura_link::ToolExecutor>,
}

#[async_trait]
impl chat_types::ToolExecutor for ExecutorAdapter {
    async fn execute(
        &self,
        tool_calls: &[aura_claude::ToolCall],
    ) -> Vec<chat_types::ToolCallResult> {
        let link_calls: Vec<aura_link::ToolCall> = tool_calls
            .iter()
            .map(|tc| aura_link::ToolCall {
                id: tc.id.clone(),
                name: tc.name.clone(),
                input: tc.input.clone(),
            })
            .collect();

        self.inner
            .execute(&link_calls)
            .await
            .into_iter()
            .map(|r| chat_types::ToolCallResult {
                tool_use_id: r.tool_use_id,
                content: r.content,
                is_error: r.is_error,
                stop_loop: r.stop_loop,
            })
            .collect()
    }

    async fn auto_build_check(&self) -> Option<chat_types::AutoBuildResult> {
        self.inner
            .auto_build_check()
            .await
            .map(|r| chat_types::AutoBuildResult {
                success: r.success,
                output: r.output,
            })
    }

    async fn capture_build_baseline(&self) -> Option<chat_types::BuildBaseline> {
        self.inner
            .capture_build_baseline()
            .await
            .map(|r| chat_types::BuildBaseline {
                error_signatures: r.error_signatures,
            })
    }
}

// ---------------------------------------------------------------------------
// Type conversions (link boundary types -> Claude wire types)
// ---------------------------------------------------------------------------

fn convert_messages(messages: Vec<aura_link::Message>) -> Vec<aura_claude::RichMessage> {
    messages.into_iter().map(convert_message).collect()
}

fn convert_message(msg: aura_link::Message) -> aura_claude::RichMessage {
    let role = match msg.role {
        aura_link::Role::User => "user",
        aura_link::Role::Assistant => "assistant",
    };
    aura_claude::RichMessage {
        role: role.to_string(),
        content: convert_message_content(msg.content),
    }
}

fn convert_message_content(content: aura_link::MessageContent) -> aura_claude::MessageContent {
    match content {
        aura_link::MessageContent::Text(t) => aura_claude::MessageContent::Text(t),
        aura_link::MessageContent::Blocks(blocks) => {
            aura_claude::MessageContent::Blocks(blocks.into_iter().map(convert_block).collect())
        }
    }
}

fn convert_block(block: aura_link::ContentBlock) -> aura_claude::ContentBlock {
    match block {
        aura_link::ContentBlock::Text { text } => aura_claude::ContentBlock::Text { text },
        aura_link::ContentBlock::Image { source } => aura_claude::ContentBlock::Image {
            source: aura_claude::ImageSource {
                source_type: source.source_type,
                media_type: source.media_type,
                data: source.data,
            },
        },
        aura_link::ContentBlock::ToolUse { id, name, input } => {
            aura_claude::ContentBlock::ToolUse { id, name, input }
        }
        aura_link::ContentBlock::ToolResult {
            tool_use_id,
            content,
            is_error,
        } => aura_claude::ContentBlock::ToolResult {
            tool_use_id,
            content,
            is_error,
        },
    }
}

fn convert_tools(tools: Arc<[aura_link::ToolDefinition]>) -> Arc<[aura_claude::ToolDefinition]> {
    let claude_tools: Vec<aura_claude::ToolDefinition> =
        tools.iter().map(convert_tool_def).collect();
    claude_tools.into()
}

fn convert_tool_def(td: &aura_link::ToolDefinition) -> aura_claude::ToolDefinition {
    aura_claude::ToolDefinition {
        name: td.name.clone(),
        description: td.description.clone(),
        input_schema: td.input_schema.clone(),
        cache_control: td
            .cache_control
            .as_ref()
            .map(|cc| aura_claude::CacheControl {
                cache_type: cc.cache_type.clone(),
            }),
    }
}

fn convert_config(config: &aura_link::TurnConfig) -> ToolLoopConfig {
    ToolLoopConfig {
        max_iterations: config.max_iterations,
        max_tokens: config.max_tokens,
        thinking: config
            .thinking
            .as_ref()
            .map(|tc| aura_claude::ThinkingConfig {
                thinking_type: tc.thinking_type.clone(),
                budget_tokens: tc.budget_tokens,
            }),
        stream_timeout: config.stream_timeout,
        billing_reason: "agent_runtime",
        max_context_tokens: config.max_context_tokens,
        credit_budget: None,
        exploration_allowance: config.exploration_allowance,
        model_override: config.model_override.clone(),
        auto_build_cooldown: config.auto_build_cooldown,
    }
}

fn convert_result(result: ToolLoopResult) -> TurnResult {
    TurnResult {
        text: result.text,
        thinking: result.thinking,
        usage: TotalUsage {
            input_tokens: result.total_input_tokens,
            output_tokens: result.total_output_tokens,
        },
        iterations_run: result.iterations_run,
        timed_out: result.timed_out,
        insufficient_credits: result.insufficient_credits,
        llm_error: result.llm_error,
    }
}

fn map_loop_event(evt: ToolLoopEvent) -> RuntimeEvent {
    match evt {
        ToolLoopEvent::Delta(s) => RuntimeEvent::Delta(s),
        ToolLoopEvent::ThinkingDelta(s) => RuntimeEvent::ThinkingDelta(s),
        ToolLoopEvent::ToolUseStarted { id, name } => RuntimeEvent::ToolUseStarted { id, name },
        ToolLoopEvent::ToolInputSnapshot { id, name, input } => {
            RuntimeEvent::ToolInputSnapshot { id, name, input }
        }
        ToolLoopEvent::ToolUseDetected { id, name, input } => {
            RuntimeEvent::ToolUseDetected { id, name, input }
        }
        ToolLoopEvent::ToolResult {
            tool_use_id,
            tool_name,
            content,
            is_error,
        } => RuntimeEvent::ToolResult {
            tool_use_id,
            tool_name,
            content,
            is_error,
        },
        ToolLoopEvent::IterationTokenUsage {
            input_tokens,
            output_tokens,
        } => RuntimeEvent::IterationTokenUsage {
            input_tokens,
            output_tokens,
        },
        ToolLoopEvent::IterationComplete { iteration } => {
            RuntimeEvent::IterationComplete { iteration }
        }
        ToolLoopEvent::Error(s) => RuntimeEvent::Error(s),
    }
}
