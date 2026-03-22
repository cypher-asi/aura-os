//! [`AgentRuntime`] implementation backed by the in-process tool loop.

use std::sync::Arc;

use async_trait::async_trait;
use tokio::sync::mpsc;

use aura_billing::MeteredLlm;
use aura_harness::{AgentRuntime, RuntimeError, RuntimeEvent, TotalUsage, TurnRequest, TurnResult};
use aura_settings::SettingsService;

use crate::tool_loop::{run_tool_loop, ToolLoopConfig, ToolLoopEvent, ToolLoopInput, ToolLoopResult};
use crate::tool_loop_types::{self as chat_types};

/// In-process agent runtime that delegates to [`run_tool_loop`].
///
/// This bridges the provider-agnostic [`TurnRequest`] into the Claude-specific
/// types that the existing tool loop expects, forwarding [`ToolLoopEvent`]s as
/// [`RuntimeEvent`]s on the caller's channel.
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
// Executor adapter (harness ToolExecutor -> chat ToolExecutor)
// ---------------------------------------------------------------------------

/// Bridges a [`aura_harness::ToolExecutor`] to the chat crate's own
/// [`ToolExecutor`](chat_types::ToolExecutor) trait.
struct ExecutorAdapter {
    inner: Arc<dyn aura_harness::ToolExecutor>,
}

#[async_trait]
impl chat_types::ToolExecutor for ExecutorAdapter {
    async fn execute(
        &self,
        tool_calls: &[aura_claude::ToolCall],
    ) -> Vec<chat_types::ToolCallResult> {
        let provider_calls: Vec<aura_provider::ToolCall> =
            tool_calls.iter().map(|tc| tc.clone().into()).collect();

        self.inner
            .execute(&provider_calls)
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
        self.inner.auto_build_check().await.map(|r| {
            chat_types::AutoBuildResult {
                success: r.success,
                output: r.output,
            }
        })
    }

    async fn capture_build_baseline(&self) -> Option<chat_types::BuildBaseline> {
        self.inner.capture_build_baseline().await.map(|r| {
            chat_types::BuildBaseline {
                error_signatures: r.error_signatures,
            }
        })
    }
}

// ---------------------------------------------------------------------------
// Type conversions (provider-agnostic -> Claude wire types)
// ---------------------------------------------------------------------------

fn convert_messages(messages: Vec<aura_provider::Message>) -> Vec<aura_claude::RichMessage> {
    messages.into_iter().map(Into::into).collect()
}

fn convert_tools(
    tools: Arc<[aura_provider::ToolDefinition]>,
) -> Arc<[aura_claude::ToolDefinition]> {
    let claude_tools: Vec<aura_claude::ToolDefinition> =
        tools.iter().cloned().map(Into::into).collect();
    claude_tools.into()
}

fn convert_config(config: &aura_harness::TurnConfig) -> ToolLoopConfig {
    ToolLoopConfig {
        max_iterations: config.max_iterations,
        max_tokens: config.max_tokens,
        thinking: config.thinking.clone().map(Into::into),
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
        ToolLoopEvent::ToolUseStarted { id, name } => {
            RuntimeEvent::ToolUseStarted { id, name }
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
