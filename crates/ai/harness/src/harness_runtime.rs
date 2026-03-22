//! `HarnessRuntime` — default [`AgentRuntime`] implementation wrapping
//! `aura-agent::AgentLoop` from the external aura-harness workspace.
//!
//! This module is the **only** place in `aura-app` that imports from the
//! external `aura-agent` / `aura-reasoner` crates.  All other code interacts
//! through the crate-local boundary types defined in [`crate::types`],
//! [`crate::events`], and [`crate::executor`].

use std::sync::Arc;

use async_trait::async_trait;
use tokio::sync::mpsc;

use crate::error::RuntimeError;
use crate::events::RuntimeEvent;
use crate::executor::ToolExecutor;
use crate::runtime::AgentRuntime;
use crate::turn_types::{TotalUsage, TurnRequest, TurnResult};
use crate::types;

// ---------------------------------------------------------------------------
// HarnessRuntime
// ---------------------------------------------------------------------------

/// Default [`AgentRuntime`] that delegates to `aura_agent::AgentLoop`.
///
/// Holds the credentials and model name needed to construct an
/// `AnthropicProvider` per turn.  All type conversions between the harness
/// boundary types and the external crate types live in this module.
pub struct HarnessRuntime {
    api_key: String,
    model: String,
    auth_token: Option<String>,
}

impl HarnessRuntime {
    /// Create a runtime with explicit credentials.
    pub fn new(api_key: String, model: String, auth_token: Option<String>) -> Self {
        Self {
            api_key,
            model,
            auth_token,
        }
    }

    /// Create a runtime from environment variables.
    ///
    /// | Variable              | Fallback                      |
    /// |-----------------------|-------------------------------|
    /// | `ANTHROPIC_API_KEY`   | `AURA_API_KEY`, then empty    |
    /// | `AURA_MODEL`          | `claude-opus-4-6-20250514`    |
    /// | `AURA_AUTH_TOKEN`     | `None`                        |
    pub fn from_env() -> anyhow::Result<Self> {
        let api_key = std::env::var("ANTHROPIC_API_KEY")
            .or_else(|_| std::env::var("AURA_API_KEY"))
            .unwrap_or_default();
        let model = std::env::var("AURA_MODEL")
            .unwrap_or_else(|_| "claude-opus-4-6-20250514".to_string());
        let auth_token = std::env::var("AURA_AUTH_TOKEN").ok();
        Ok(Self {
            api_key,
            model,
            auth_token,
        })
    }

    /// Build an `AnthropicProvider` for a single turn.
    fn build_provider(&self) -> Result<aura_reasoner::AnthropicProvider, RuntimeError> {
        let routing_mode = match std::env::var("AURA_LLM_ROUTING").as_deref() {
            Ok("direct") => aura_reasoner::RoutingMode::Direct,
            _ => aura_reasoner::RoutingMode::Proxy,
        };

        let (api_key, base_url) = match routing_mode {
            aura_reasoner::RoutingMode::Direct => {
                let key = if self.api_key.is_empty() {
                    std::env::var("AURA_ANTHROPIC_API_KEY")
                        .or_else(|_| std::env::var("ANTHROPIC_API_KEY"))
                        .unwrap_or_default()
                } else {
                    self.api_key.clone()
                };
                let url = std::env::var("AURA_ANTHROPIC_BASE_URL")
                    .unwrap_or_else(|_| "https://api.anthropic.com".to_string());
                (key, url)
            }
            aura_reasoner::RoutingMode::Proxy => {
                let url = std::env::var("AURA_ROUTER_URL")
                    .unwrap_or_else(|_| "https://aura-router.onrender.com".to_string());
                (String::new(), url)
            }
        };

        let config = aura_reasoner::AnthropicConfig {
            api_key,
            default_model: self.model.clone(),
            timeout_ms: 120_000,
            max_retries: 2,
            base_url,
            routing_mode,
            fallback_model: std::env::var("AURA_ANTHROPIC_FALLBACK_MODEL")
                .ok()
                .filter(|s| !s.is_empty()),
        };

        aura_reasoner::AnthropicProvider::new(config)
            .map_err(|e| RuntimeError::Internal(format!("failed to create provider: {e}")))
    }
}

#[async_trait]
impl AgentRuntime for HarnessRuntime {
    async fn execute_turn(&self, request: TurnRequest) -> Result<TurnResult, RuntimeError> {
        let provider = self.build_provider()?;

        let executor_adapter = ExecutorAdapter {
            inner: request.executor.clone(),
        };

        let messages: Vec<aura_reasoner::Message> =
            request.messages.iter().map(convert_message).collect();

        let tools: Vec<aura_reasoner::ToolDefinition> =
            request.tools.iter().map(convert_tool_def).collect();

        let model = request
            .config
            .model_override
            .as_deref()
            .unwrap_or(&self.model);

        let config = aura_agent::AgentLoopConfig {
            max_iterations: request.config.max_iterations,
            max_tokens: request.config.max_tokens,
            stream_timeout: request.config.stream_timeout,
            model_override: request.config.model_override.clone(),
            max_context_tokens: request.config.max_context_tokens,
            exploration_allowance: request.config.exploration_allowance.unwrap_or(12),
            auto_build_cooldown: request.config.auto_build_cooldown.unwrap_or(2),
            system_prompt: request.system_prompt.clone(),
            model: model.to_string(),
            auth_token: self.auth_token.clone(),
            ..aura_agent::AgentLoopConfig::default()
        };

        let agent_loop = aura_agent::AgentLoop::new(config);

        // Only allocate an event channel when the caller wants streaming events.
        let event_tx_for_agent = request.event_tx.as_ref().map(|app_tx| {
            let (agent_tx, agent_rx) = mpsc::unbounded_channel();
            forward_events(agent_rx, app_tx.clone());
            agent_tx
        });

        let result = agent_loop
            .run_with_events(
                &provider,
                &executor_adapter,
                messages,
                tools,
                event_tx_for_agent,
                None,
            )
            .await
            .map_err(|e| {
                let msg = e.to_string();
                if msg.contains("402") {
                    RuntimeError::InsufficientCredits
                } else {
                    RuntimeError::Internal(msg)
                }
            })?;

        Ok(convert_loop_result(result))
    }
}

// ===========================================================================
// Executor Adapter
// ===========================================================================

/// Bridges the crate-local [`ToolExecutor`] trait to
/// `aura_agent::AgentToolExecutor`.
struct ExecutorAdapter {
    inner: Arc<dyn ToolExecutor>,
}

#[async_trait]
impl aura_agent::AgentToolExecutor for ExecutorAdapter {
    async fn execute(
        &self,
        tool_calls: &[aura_agent::ToolCallInfo],
    ) -> Vec<aura_agent::ToolCallResult> {
        let harness_calls: Vec<types::ToolCall> = tool_calls
            .iter()
            .map(|tc| types::ToolCall {
                id: tc.id.clone(),
                name: tc.name.clone(),
                input: tc.input.clone(),
            })
            .collect();

        self.inner
            .execute(&harness_calls)
            .await
            .into_iter()
            .map(|r| aura_agent::ToolCallResult {
                tool_use_id: r.tool_use_id,
                content: r.content,
                is_error: r.is_error,
                stop_loop: r.stop_loop,
            })
            .collect()
    }

    async fn auto_build_check(&self) -> Option<aura_agent::AutoBuildResult> {
        self.inner
            .auto_build_check()
            .await
            .map(|r| aura_agent::AutoBuildResult {
                success: r.success,
                output: r.output,
                error_count: 0,
            })
    }

    async fn capture_build_baseline(&self) -> Option<aura_agent::BuildBaseline> {
        self.inner
            .capture_build_baseline()
            .await
            .map(|b| aura_agent::BuildBaseline {
                error_signatures: b.error_signatures,
            })
    }
}

// ===========================================================================
// Event Forwarding
// ===========================================================================

/// Spawn a task that maps `AgentLoopEvent`s to `RuntimeEvent`s.
fn forward_events(
    mut agent_rx: mpsc::UnboundedReceiver<aura_agent::AgentLoopEvent>,
    app_tx: mpsc::UnboundedSender<RuntimeEvent>,
) {
    tokio::spawn(async move {
        while let Some(event) = agent_rx.recv().await {
            let mapped = match event {
                aura_agent::AgentLoopEvent::TextDelta(t) => RuntimeEvent::Delta(t),

                aura_agent::AgentLoopEvent::ThinkingDelta(t) => RuntimeEvent::ThinkingDelta(t),

                aura_agent::AgentLoopEvent::ToolStart { id, name } => {
                    RuntimeEvent::ToolUseStarted { id, name }
                }

                aura_agent::AgentLoopEvent::ToolInputSnapshot { id, name, input } => {
                    let parsed = serde_json::from_str(&input)
                        .unwrap_or_else(|_| serde_json::Value::String(input));
                    RuntimeEvent::ToolInputSnapshot {
                        id,
                        name,
                        input: parsed,
                    }
                }

                aura_agent::AgentLoopEvent::ToolResult {
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

                aura_agent::AgentLoopEvent::IterationComplete {
                    iteration,
                    input_tokens,
                    output_tokens,
                } => {
                    let _ = app_tx.send(RuntimeEvent::IterationTokenUsage {
                        input_tokens,
                        output_tokens,
                    });
                    RuntimeEvent::IterationComplete { iteration }
                }

                aura_agent::AgentLoopEvent::Error { message, .. } => {
                    RuntimeEvent::Error(message)
                }

                // ToolComplete and Warning have no RuntimeEvent counterpart.
                aura_agent::AgentLoopEvent::ToolComplete { .. }
                | aura_agent::AgentLoopEvent::Warning(_) => continue,
            };

            if app_tx.send(mapped).is_err() {
                break;
            }
        }
    });
}

// ===========================================================================
// Type Conversions: harness → aura-reasoner
// ===========================================================================

fn convert_message(msg: &types::Message) -> aura_reasoner::Message {
    let role = match msg.role {
        types::Role::User => aura_reasoner::Role::User,
        types::Role::Assistant => aura_reasoner::Role::Assistant,
    };

    let content = match &msg.content {
        types::MessageContent::Text(s) => {
            vec![aura_reasoner::ContentBlock::Text { text: s.clone() }]
        }
        types::MessageContent::Blocks(blocks) => blocks.iter().map(convert_content_block).collect(),
    };

    aura_reasoner::Message { role, content }
}

fn convert_content_block(block: &types::ContentBlock) -> aura_reasoner::ContentBlock {
    match block {
        types::ContentBlock::Text { text } => aura_reasoner::ContentBlock::Text {
            text: text.clone(),
        },
        types::ContentBlock::Image { source } => aura_reasoner::ContentBlock::Image {
            source: aura_reasoner::ImageSource {
                source_type: source.source_type.clone(),
                media_type: source.media_type.clone(),
                data: source.data.clone(),
            },
        },
        types::ContentBlock::ToolUse { id, name, input } => aura_reasoner::ContentBlock::ToolUse {
            id: id.clone(),
            name: name.clone(),
            input: input.clone(),
        },
        types::ContentBlock::ToolResult {
            tool_use_id,
            content,
            is_error,
        } => aura_reasoner::ContentBlock::ToolResult {
            tool_use_id: tool_use_id.clone(),
            content: aura_reasoner::ToolResultContent::Text(content.clone()),
            is_error: is_error.unwrap_or(false),
        },
    }
}

fn convert_tool_def(tool: &types::ToolDefinition) -> aura_reasoner::ToolDefinition {
    aura_reasoner::ToolDefinition {
        name: tool.name.clone(),
        description: tool.description.clone(),
        input_schema: tool.input_schema.clone(),
        cache_control: tool.cache_control.as_ref().map(|cc| {
            aura_reasoner::CacheControl {
                cache_type: cc.cache_type.clone(),
            }
        }),
    }
}

// ===========================================================================
// Type Conversions: aura-agent → harness
// ===========================================================================

fn convert_loop_result(r: aura_agent::AgentLoopResult) -> TurnResult {
    TurnResult {
        text: r.total_text,
        thinking: r.total_thinking,
        usage: TotalUsage {
            input_tokens: r.total_input_tokens,
            output_tokens: r.total_output_tokens,
        },
        iterations_run: r.iterations,
        timed_out: r.timed_out,
        insufficient_credits: r.insufficient_credits,
        llm_error: r.llm_error,
    }
}
