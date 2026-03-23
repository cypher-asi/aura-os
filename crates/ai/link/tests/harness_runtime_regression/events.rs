use std::sync::Arc;

use tokio::sync::mpsc;
use tokio::sync::Mutex;

use aura_os_link::{RuntimeEvent, ToolCall, ToolExecutor};

use super::{
    default_config, make_request, make_request_with_events, tool_call as tc, CapturingExecutor,
    MockExecutor, SimulatedStep, SimulatingRuntime,
};

/// Regression: event emission (cf. `test_event_emission_delta_tool_use_tool_result_token_usage`).
#[tokio::test]
async fn events_are_forwarded_in_correct_order() {
    let rt = SimulatingRuntime::new(vec![
        SimulatedStep::ToolCalls(vec![tc("t1", "read_file")]),
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

/// Verify token usage is accumulated correctly across iterations.
#[tokio::test]
async fn token_usage_accumulates_across_iterations() {
    let rt = SimulatingRuntime::new(vec![
        SimulatedStep::ToolCalls(vec![tc("t1", "a")]),
        SimulatedStep::ToolCalls(vec![tc("t2", "b")]),
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
        SimulatedStep::ToolCalls(vec![tc("t1", "read_file")]),
        SimulatedStep::Text("Done".into()),
    ]);
    let executor: Arc<dyn ToolExecutor> = Arc::new(MockExecutor::echo());
    let req = make_request(executor, default_config(5));

    let result = rt.execute_turn(req).await.unwrap();
    assert_eq!(result.iterations_run, 2);
    assert_eq!(result.text, "Done");
}
