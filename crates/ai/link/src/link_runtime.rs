//! `LinkRuntime` — default [`AgentRuntime`] implementation wrapping
//! `aura-agent::AgentLoop` from the external harness workspace.
//!
//! This module is the **only** place in `aura-app` that imports from the
//! external `aura-agent` / `aura-reasoner` crates.  All other code interacts
//! through the re-exported types in [`crate::types`], [`crate::events`],
//! and [`crate::executor`].

use async_trait::async_trait;
use tokio::sync::mpsc;

use crate::error::RuntimeError;
use crate::events::RuntimeEvent;
use crate::runtime::AgentRuntime;
use crate::turn_types::{TotalUsage, TurnRequest, TurnResult};

/// Default [`AgentRuntime`] that delegates to `aura_agent::AgentLoop`.
///
/// Holds the credentials and model name needed to construct an
/// `AnthropicProvider` per turn.
pub struct LinkRuntime {
    api_key: String,
    model: String,
    auth_token: Option<String>,
}

impl LinkRuntime {
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
    /// | `AURA_MODEL`          | `claude-opus-4-6`             |
    /// | `AURA_AUTH_TOKEN`     | `None`                        |
    pub fn from_env() -> anyhow::Result<Self> {
        let api_key = std::env::var("ANTHROPIC_API_KEY")
            .or_else(|_| std::env::var("AURA_API_KEY"))
            .unwrap_or_default();
        let model =
            std::env::var("AURA_MODEL").unwrap_or_else(|_| "claude-opus-4-6".to_string());
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
impl AgentRuntime for LinkRuntime {
    async fn execute_turn(&self, request: TurnRequest) -> Result<TurnResult, RuntimeError> {
        let provider = self.build_provider()?;

        let messages: Vec<aura_reasoner::Message> =
            request.messages.iter().map(|m| m.to_reasoner()).collect();

        let tools: Vec<aura_reasoner::ToolDefinition> = request.tools.to_vec();

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
            auth_token: request.auth_token.clone().or_else(|| self.auth_token.clone()),
            ..aura_agent::AgentLoopConfig::default()
        };

        let agent_loop = aura_agent::AgentLoop::new(config);

        let event_tx_for_agent = request.event_tx.as_ref().map(|app_tx| {
            let (agent_tx, agent_rx) = mpsc::unbounded_channel();
            forward_events(agent_rx, app_tx.clone());
            agent_tx
        });

        let result = agent_loop
            .run_with_events(
                &provider,
                request.executor.as_ref(),
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
// Event Forwarding
// ===========================================================================

/// Spawn a task that maps `AgentLoopEvent`s to `RuntimeEvent`s.
fn forward_events(
    mut agent_rx: mpsc::UnboundedReceiver<aura_agent::AgentLoopEvent>,
    app_tx: mpsc::UnboundedSender<RuntimeEvent>,
) {
    tokio::spawn(async move {
        let mut detected_tool_ids: std::collections::HashSet<String> =
            std::collections::HashSet::new();
        while let Some(event) = agent_rx.recv().await {
            let mapped = match event {
                aura_agent::AgentLoopEvent::TextDelta(t) => RuntimeEvent::Delta(t),

                aura_agent::AgentLoopEvent::ThinkingDelta(t) => RuntimeEvent::ThinkingDelta(t),

                aura_agent::AgentLoopEvent::ToolStart { id, name } => {
                    RuntimeEvent::ToolUseStarted { id, name }
                }

                aura_agent::AgentLoopEvent::ToolInputSnapshot { id, name, input } => {
                    let parsed = serde_json::from_str(&input)
                        .unwrap_or(serde_json::Value::String(input));
                    if !matches!(parsed, serde_json::Value::String(_))
                        && detected_tool_ids.insert(id.clone())
                    {
                        let _ = app_tx.send(RuntimeEvent::ToolUseDetected {
                            id: id.clone(),
                            name: name.clone(),
                            input: parsed.clone(),
                        });
                    }
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

                aura_agent::AgentLoopEvent::Warning(warning) => RuntimeEvent::Warning(warning),

                aura_agent::AgentLoopEvent::ToolComplete { .. } => continue,
            };

            if app_tx.send(mapped).is_err() {
                break;
            }
        }
    });
}

// ===========================================================================
// Type Conversion: aura-agent → link
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
