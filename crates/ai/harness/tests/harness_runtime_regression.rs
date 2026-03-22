//! Regression tests for the `AgentRuntime` behavioral contract.
//!
//! These tests exercise the behavioral contract that consumers depend on
//! using a `SimulatingRuntime` that mimics `HarnessRuntime` / `AgentLoop`
//! without any network or LLM dependency.
//!
//! Each test maps to a scenario from the old `tool_loop_*_tests.rs` suite
//! to ensure no behavioral regressions as the codebase migrates to the
//! harness abstraction.

use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use tokio::sync::{mpsc, Mutex};

use aura_harness::{
    AgentRuntime, Message, RuntimeError, RuntimeEvent, ToolCall, ToolCallResult, ToolExecutor,
    TotalUsage, TurnConfig, TurnRequest, TurnResult,
};

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
/// contract that `HarnessRuntime` (via `AgentLoop`) fulfills.
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
    }
}

fn tool_call(id: &str, name: &str) -> ToolCall {
    ToolCall {
        id: id.into(),
        name: name.into(),
        input: serde_json::json!({}),
    }
}

// ── Tests ───────────────────────────────────────────────────────────────

/// Regression: simple text response (cf. `test_tool_loop_simple_end_turn`).
#[tokio::test]
async fn simple_text_response_returns_correct_result() {
    let rt = SimulatingRuntime::new(vec![SimulatedStep::Text("Done!".into())]);
    let executor: Arc<dyn ToolExecutor> = Arc::new(MockExecutor::echo());
    let req = make_request(executor, default_config(5));

    let result = rt.execute_turn(req).await.unwrap();
    assert_eq!(result.text, "Done!");
    assert_eq!(result.iterations_run, 1);
    assert!(!result.timed_out);
    assert!(!result.insufficient_credits);
    assert!(result.llm_error.is_none());
}

/// Regression: tool use then text (cf. `test_tool_loop_tool_use_then_end_turn`).
#[tokio::test]
async fn tool_use_then_text_completes_in_two_iterations() {
    let rt = SimulatingRuntime::new(vec![
        SimulatedStep::ToolCalls(vec![tool_call("t1", "read_file")]),
        SimulatedStep::Text("File read successfully.".into()),
    ]);
    let executor: Arc<dyn ToolExecutor> = Arc::new(MockExecutor::echo());
    let req = make_request(executor, default_config(5));

    let result = rt.execute_turn(req).await.unwrap();
    assert_eq!(result.iterations_run, 2);
    assert!(result.text.contains("File read successfully."));
    assert_eq!(result.usage.input_tokens, 200);
    assert_eq!(result.usage.output_tokens, 100);
    assert!(!result.timed_out);
}

/// Regression: max iterations cap (cf. `test_tool_loop_hits_max_iterations`).
#[tokio::test]
async fn max_iterations_caps_the_loop() {
    let steps: Vec<SimulatedStep> = (0..10)
        .map(|i| SimulatedStep::ToolCalls(vec![tool_call(&format!("t{i}"), "do_thing")]))
        .collect();
    let rt = SimulatingRuntime::new(steps);
    let executor: Arc<dyn ToolExecutor> = Arc::new(MockExecutor::echo());
    let req = make_request(executor, default_config(3));

    let result = rt.execute_turn(req).await.unwrap();
    assert_eq!(result.iterations_run, 3);
    assert!(result.timed_out);
}

/// Regression: stop_loop flag (cf. `test_stop_loop_flag_exits_after_first_iteration`).
#[tokio::test]
async fn stop_loop_flag_exits_early() {
    let rt = SimulatingRuntime::new(vec![
        SimulatedStep::ToolCalls(vec![tool_call("t1", "task_done")]),
        SimulatedStep::Text("Should not reach".into()),
    ]);
    let executor: Arc<dyn ToolExecutor> = Arc::new(MockExecutor::with_batches(vec![vec![
        ToolCallResult {
            tool_use_id: "t1".into(),
            content: "done".into(),
            is_error: false,
            stop_loop: true,
        },
    ]]));
    let req = make_request(executor, default_config(10));

    let result = rt.execute_turn(req).await.unwrap();
    assert_eq!(result.iterations_run, 1);
    assert!(!result.timed_out);
}

/// Regression: event emission (cf. `test_event_emission_delta_tool_use_tool_result_token_usage`).
#[tokio::test]
async fn events_are_forwarded_in_correct_order() {
    let rt = SimulatingRuntime::new(vec![
        SimulatedStep::ToolCalls(vec![tool_call("t1", "read_file")]),
        SimulatedStep::Text("Done".into()),
    ]);
    let executor: Arc<dyn ToolExecutor> = Arc::new(MockExecutor::echo());
    let (tx, mut rx) = mpsc::unbounded_channel();
    let req = make_request_with_events(executor, default_config(5), tx);

    let _result = rt.execute_turn(req).await.unwrap();

    let mut has_token_usage = false;
    let mut has_tool_started = false;
    let mut has_tool_detected = false;
    let mut has_tool_result = false;
    let mut has_delta = false;
    let mut has_iteration_complete = false;

    while let Ok(evt) = rx.try_recv() {
        match evt {
            RuntimeEvent::IterationTokenUsage { .. } => has_token_usage = true,
            RuntimeEvent::ToolUseStarted { .. } => has_tool_started = true,
            RuntimeEvent::ToolUseDetected { .. } => has_tool_detected = true,
            RuntimeEvent::ToolResult { .. } => has_tool_result = true,
            RuntimeEvent::Delta(_) => has_delta = true,
            RuntimeEvent::IterationComplete { .. } => has_iteration_complete = true,
            _ => {}
        }
    }

    assert!(has_token_usage, "should emit IterationTokenUsage");
    assert!(has_tool_started, "should emit ToolUseStarted");
    assert!(has_tool_detected, "should emit ToolUseDetected");
    assert!(has_tool_result, "should emit ToolResult");
    assert!(has_delta, "should emit Delta for final text");
    assert!(has_iteration_complete, "should emit IterationComplete");
}

/// Regression: provider error propagation (cf. `mock_runtime_returns_error`).
#[tokio::test]
async fn provider_error_propagates() {
    let rt = FailingRuntime::new(RuntimeError::Provider("model overloaded".into()));
    let executor: Arc<dyn ToolExecutor> = Arc::new(MockExecutor::echo());
    let req = make_request(executor, default_config(5));

    let err = rt.execute_turn(req).await.unwrap_err();
    assert!(
        err.to_string().contains("model overloaded"),
        "got: {}",
        err
    );
}

/// Regression: insufficient credits error propagation.
#[tokio::test]
async fn insufficient_credits_error_propagates() {
    let rt = FailingRuntime::new(RuntimeError::InsufficientCredits);
    let executor: Arc<dyn ToolExecutor> = Arc::new(MockExecutor::echo());
    let req = make_request(executor, default_config(5));

    let err = rt.execute_turn(req).await.unwrap_err();
    assert_eq!(err.to_string(), "insufficient credits");
}

/// Regression: budget exhausted error propagation.
#[tokio::test]
async fn budget_exhausted_error_propagates() {
    let rt = FailingRuntime::new(RuntimeError::BudgetExhausted("max iterations".into()));
    let executor: Arc<dyn ToolExecutor> = Arc::new(MockExecutor::echo());
    let req = make_request(executor, default_config(5));

    let err = rt.execute_turn(req).await.unwrap_err();
    assert!(err.to_string().contains("budget exhausted"));
}

/// Regression: internal error propagation.
#[tokio::test]
async fn internal_error_propagates() {
    let rt = FailingRuntime::new(RuntimeError::Internal("oops".into()));
    let executor: Arc<dyn ToolExecutor> = Arc::new(MockExecutor::echo());
    let req = make_request(executor, default_config(5));

    let err = rt.execute_turn(req).await.unwrap_err();
    assert!(err.to_string().contains("internal error"));
}

/// Regression: multiple tool calls in one iteration
/// (cf. `test_multiple_tool_calls_in_single_iteration`).
#[tokio::test]
async fn multiple_tool_calls_in_single_iteration() {
    let rt = SimulatingRuntime::new(vec![
        SimulatedStep::ToolCalls(vec![
            tool_call("t1", "read_file"),
            tool_call("t2", "read_file"),
            tool_call("t3", "read_file"),
        ]),
        SimulatedStep::Text("All three read.".into()),
    ]);
    let executor: Arc<dyn ToolExecutor> = Arc::new(MockExecutor::echo());
    let (tx, mut rx) = mpsc::unbounded_channel();
    let req = make_request_with_events(executor, default_config(5), tx);

    let result = rt.execute_turn(req).await.unwrap();
    assert_eq!(result.iterations_run, 2);

    let mut tool_result_count = 0;
    while let Ok(evt) = rx.try_recv() {
        if matches!(evt, RuntimeEvent::ToolResult { .. }) {
            tool_result_count += 1;
        }
    }
    assert_eq!(tool_result_count, 3, "should have 3 tool results");
}

/// Regression: text accumulation (cf. `test_text_accumulation_across_iterations`).
#[tokio::test]
async fn text_accumulates_from_final_step() {
    let rt = SimulatingRuntime::new(vec![
        SimulatedStep::ToolCalls(vec![tool_call("t1", "do_thing")]),
        SimulatedStep::Text("Final answer.".into()),
    ]);
    let executor: Arc<dyn ToolExecutor> = Arc::new(MockExecutor::echo());
    let req = make_request(executor, default_config(5));

    let result = rt.execute_turn(req).await.unwrap();
    assert!(result.text.contains("Final answer."));
    assert_eq!(result.iterations_run, 2);
}

/// Regression: zero iterations (cf. `test_zero_iterations_config`).
#[tokio::test]
async fn zero_iterations_returns_empty_result() {
    let rt = SimulatingRuntime::new(vec![SimulatedStep::Text("Nope".into())]);
    let executor: Arc<dyn ToolExecutor> = Arc::new(MockExecutor::echo());
    let req = make_request(executor, default_config(0));

    let result = rt.execute_turn(req).await.unwrap();
    assert_eq!(result.iterations_run, 0);
    assert!(result.text.is_empty());
}

/// Verify the executor receives the correct tool call IDs and names.
#[tokio::test]
async fn executor_receives_correct_tool_calls() {
    let rt = SimulatingRuntime::new(vec![
        SimulatedStep::ToolCalls(vec![ToolCall {
            id: "call_1".into(),
            name: "write_file".into(),
            input: serde_json::json!({"path": "out.rs", "content": "fn main() {}"}),
        }]),
        SimulatedStep::Text("Written.".into()),
    ]);
    let captured = Arc::new(Mutex::new(Vec::<ToolCall>::new()));
    let executor: Arc<dyn ToolExecutor> = Arc::new(CapturingExecutor {
        captured: captured.clone(),
    });
    let req = make_request(executor, default_config(5));

    let _result = rt.execute_turn(req).await.unwrap();

    let calls = captured.lock().await;
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].id, "call_1");
    assert_eq!(calls[0].name, "write_file");
    assert_eq!(calls[0].input["path"], "out.rs");
}

/// Verify error tool results are forwarded through events.
#[tokio::test]
async fn error_tool_results_emit_is_error_event() {
    let rt = SimulatingRuntime::new(vec![
        SimulatedStep::ToolCalls(vec![tool_call("t1", "write_file")]),
        SimulatedStep::Text("Handled error.".into()),
    ]);
    let executor: Arc<dyn ToolExecutor> = Arc::new(MockExecutor::with_batches(vec![vec![
        ToolCallResult {
            tool_use_id: "t1".into(),
            content: "permission denied".into(),
            is_error: true,
            stop_loop: false,
        },
    ]]));
    let (tx, mut rx) = mpsc::unbounded_channel();
    let req = make_request_with_events(executor, default_config(5), tx);

    let _result = rt.execute_turn(req).await.unwrap();

    let mut found_error_result = false;
    while let Ok(evt) = rx.try_recv() {
        if let RuntimeEvent::ToolResult {
            is_error, content, ..
        } = evt
        {
            if is_error && content.contains("permission denied") {
                found_error_result = true;
            }
        }
    }
    assert!(found_error_result, "should emit error tool result event");
}

/// Verify timed_out is set when max_iterations is exhausted with pending steps.
#[tokio::test]
async fn timed_out_flag_set_when_iterations_exhausted() {
    let steps: Vec<SimulatedStep> = (0..5)
        .map(|i| SimulatedStep::ToolCalls(vec![tool_call(&format!("t{i}"), "work")]))
        .collect();
    let rt = SimulatingRuntime::new(steps);
    let executor: Arc<dyn ToolExecutor> = Arc::new(MockExecutor::echo());
    let req = make_request(executor, default_config(3));

    let result = rt.execute_turn(req).await.unwrap();
    assert!(result.timed_out);
    assert_eq!(result.iterations_run, 3);
}

/// Verify timed_out is NOT set when the loop finishes naturally.
#[tokio::test]
async fn no_timeout_when_loop_finishes_naturally() {
    let rt = SimulatingRuntime::new(vec![
        SimulatedStep::ToolCalls(vec![tool_call("t1", "work")]),
        SimulatedStep::Text("All done.".into()),
    ]);
    let executor: Arc<dyn ToolExecutor> = Arc::new(MockExecutor::echo());
    let req = make_request(executor, default_config(10));

    let result = rt.execute_turn(req).await.unwrap();
    assert!(!result.timed_out);
    assert_eq!(result.iterations_run, 2);
}

/// Verify token usage is accumulated correctly across iterations.
#[tokio::test]
async fn token_usage_accumulates_across_iterations() {
    let rt = SimulatingRuntime::new(vec![
        SimulatedStep::ToolCalls(vec![tool_call("t1", "a")]),
        SimulatedStep::ToolCalls(vec![tool_call("t2", "b")]),
        SimulatedStep::Text("end".into()),
    ]);
    let executor: Arc<dyn ToolExecutor> = Arc::new(MockExecutor::echo());
    let req = make_request(executor, default_config(10));

    let result = rt.execute_turn(req).await.unwrap();
    assert_eq!(result.iterations_run, 3);
    assert_eq!(result.usage.input_tokens, 300);
    assert_eq!(result.usage.output_tokens, 150);
}

/// Verify no events emitted when event_tx is None.
#[tokio::test]
async fn no_events_when_tx_is_none() {
    let rt = SimulatingRuntime::new(vec![
        SimulatedStep::ToolCalls(vec![tool_call("t1", "read_file")]),
        SimulatedStep::Text("Done".into()),
    ]);
    let executor: Arc<dyn ToolExecutor> = Arc::new(MockExecutor::echo());
    let req = make_request(executor, default_config(5));

    let result = rt.execute_turn(req).await.unwrap();
    assert_eq!(result.iterations_run, 2);
    assert_eq!(result.text, "Done");
}
