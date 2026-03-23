//! Regression tests for the `AgentRuntime` behavioral contract.
//!
//! These tests exercise the behavioral contract that consumers depend on
//! using a `SimulatingRuntime` that mimics `LinkRuntime` / `AgentLoop`
//! without any network or LLM dependency.
//!
//! Each test maps to a scenario from the old `tool_loop_*_tests.rs` suite
//! to ensure no behavioral regressions as the codebase migrates to the
//! link abstraction.

use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use tokio::sync::{mpsc, Mutex};

use aura_os_link::{
    AgentRuntime, Message, RuntimeError, RuntimeEvent, ToolCall, ToolCallResult, ToolExecutor,
    TotalUsage, TurnConfig, TurnRequest, TurnResult,
};

mod basic_flow;
mod error_handling;
mod events;
mod iteration_limits;

// ── Simulated model responses ───────────────────────────────────────────

enum SimulatedStep {
    /// Model returns text and ends the turn.
    Text(String),
    /// Model requests tool calls; loop continues after executor returns.
    ToolCalls(Vec<ToolCall>),
}

/// A deterministic [`AgentRuntime`] that replays a sequence of simulated model
/// responses, calling the executor for tool-call steps and respecting
/// `stop_loop`, `max_iterations`, and the event channel — the same behavioral
/// contract that `LinkRuntime` (via `AgentLoop`) fulfills.
struct SimulatingRuntime {
    steps: Mutex<VecDeque<SimulatedStep>>,
}

impl SimulatingRuntime {
    fn new(steps: Vec<SimulatedStep>) -> Self {
        Self {
            steps: Mutex::new(steps.into()),
        }
    }
}

#[async_trait]
impl AgentRuntime for SimulatingRuntime {
    async fn execute_turn(&self, request: TurnRequest) -> Result<TurnResult, RuntimeError> {
        let mut steps = self.steps.lock().await;
        let mut text = String::new();
        let mut iterations = 0usize;
        let mut total_input = 0u64;
        let mut total_output = 0u64;

        while iterations < request.config.max_iterations {
            let step = match steps.pop_front() {
                Some(s) => s,
                None => break,
            };

            iterations += 1;
            total_input += 100;
            total_output += 50;

            if let Some(tx) = &request.event_tx {
                let _ = tx.send(RuntimeEvent::IterationTokenUsage {
                    input_tokens: 100,
                    output_tokens: 50,
                });
            }

            match step {
                SimulatedStep::Text(t) => {
                    if let Some(tx) = &request.event_tx {
                        let _ = tx.send(RuntimeEvent::Delta(t.clone()));
                    }
                    text.push_str(&t);
                    if let Some(tx) = &request.event_tx {
                        let _ = tx.send(RuntimeEvent::IterationComplete {
                            iteration: iterations - 1,
                        });
                    }
                    break;
                }
                SimulatedStep::ToolCalls(calls) => {
                    for tc in &calls {
                        if let Some(tx) = &request.event_tx {
                            let _ = tx.send(RuntimeEvent::ToolUseStarted {
                                id: tc.id.clone(),
                                name: tc.name.clone(),
                            });
                            let _ = tx.send(RuntimeEvent::ToolUseDetected {
                                id: tc.id.clone(),
                                name: tc.name.clone(),
                                input: tc.input.clone(),
                            });
                        }
                    }

                    let results = request.executor.execute(&calls).await;

                    for (tc, result) in calls.iter().zip(results.iter()) {
                        if let Some(tx) = &request.event_tx {
                            let _ = tx.send(RuntimeEvent::ToolResult {
                                tool_use_id: result.tool_use_id.clone(),
                                tool_name: tc.name.clone(),
                                content: result.content.clone(),
                                is_error: result.is_error,
                            });
                        }
                    }

                    let should_stop = results.iter().any(|r| r.stop_loop);

                    if let Some(tx) = &request.event_tx {
                        let _ = tx.send(RuntimeEvent::IterationComplete {
                            iteration: iterations - 1,
                        });
                    }

                    if should_stop {
                        break;
                    }
                }
            }
        }

        let timed_out =
            iterations >= request.config.max_iterations && steps.front().is_some();

        Ok(TurnResult {
            text,
            thinking: String::new(),
            usage: TotalUsage {
                input_tokens: total_input,
                output_tokens: total_output,
            },
            iterations_run: iterations,
            timed_out,
            insufficient_credits: false,
            llm_error: None,
        })
    }
}

/// A runtime that always fails with the given error.
struct FailingRuntime {
    error: Mutex<Option<RuntimeError>>,
}

impl FailingRuntime {
    fn new(error: RuntimeError) -> Self {
        Self {
            error: Mutex::new(Some(error)),
        }
    }
}

#[async_trait]
impl AgentRuntime for FailingRuntime {
    async fn execute_turn(&self, _request: TurnRequest) -> Result<TurnResult, RuntimeError> {
        Err(self
            .error
            .lock()
            .await
            .take()
            .expect("FailingRuntime error already consumed"))
    }
}

// ── Mock executor ───────────────────────────────────────────────────────

struct MockExecutor {
    batches: Mutex<VecDeque<Vec<ToolCallResult>>>,
}

impl MockExecutor {
    fn with_batches(batches: Vec<Vec<ToolCallResult>>) -> Self {
        Self {
            batches: Mutex::new(batches.into()),
        }
    }

    /// Echo executor: returns a success result for each tool call.
    fn echo() -> Self {
        Self {
            batches: Mutex::new(VecDeque::new()),
        }
    }
}

#[async_trait]
impl ToolExecutor for MockExecutor {
    async fn execute(&self, tool_calls: &[ToolCall]) -> Vec<ToolCallResult> {
        let mut queue = self.batches.lock().await;
        if let Some(batch) = queue.pop_front() {
            batch
        } else {
            tool_calls
                .iter()
                .map(|tc| ToolCallResult {
                    tool_use_id: tc.id.clone(),
                    content: format!("executed {}", tc.name),
                    is_error: false,
                    stop_loop: false,
                })
                .collect()
        }
    }
}

/// Executor that records every tool call it receives.
struct CapturingExecutor {
    captured: Arc<Mutex<Vec<ToolCall>>>,
}

#[async_trait]
impl ToolExecutor for CapturingExecutor {
    async fn execute(&self, tool_calls: &[ToolCall]) -> Vec<ToolCallResult> {
        self.captured
            .lock()
            .await
            .extend(tool_calls.iter().cloned());
        tool_calls
            .iter()
            .map(|tc| ToolCallResult {
                tool_use_id: tc.id.clone(),
                content: "ok".into(),
                is_error: false,
                stop_loop: false,
            })
            .collect()
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────

fn default_config(max_iterations: usize) -> TurnConfig {
    TurnConfig {
        max_iterations,
        max_tokens: 4096,
        thinking: None,
        stream_timeout: Duration::from_secs(30),
        max_context_tokens: None,
        model_override: None,
        exploration_allowance: None,
        auto_build_cooldown: None,
        credit_budget: None,
        billing_reason: None,
    }
}

fn make_request(executor: Arc<dyn ToolExecutor>, config: TurnConfig) -> TurnRequest {
    TurnRequest {
        system_prompt: "You are a test assistant.".into(),
        messages: vec![Message::user("hello")],
        tools: Arc::from(vec![]),
        executor,
        config,
        event_tx: None,
        auth_token: None,
    }
}

fn make_request_with_events(
    executor: Arc<dyn ToolExecutor>,
    config: TurnConfig,
    tx: mpsc::UnboundedSender<RuntimeEvent>,
) -> TurnRequest {
    TurnRequest {
        system_prompt: "You are a test assistant.".into(),
        messages: vec![Message::user("hello")],
        tools: Arc::from(vec![]),
        executor,
        config,
        event_tx: Some(tx),
        auth_token: None,
    }
}

fn tool_call(id: &str, name: &str) -> ToolCall {
    ToolCall {
        id: id.into(),
        name: name.into(),
        input: serde_json::json!({}),
    }
}
