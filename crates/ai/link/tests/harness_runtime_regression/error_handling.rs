use std::sync::Arc;

use tokio::sync::mpsc;

use aura_os_link::{RuntimeError, RuntimeEvent, ToolCallResult, ToolExecutor};

use super::{
    default_config, make_request, make_request_with_events, tool_call, FailingRuntime,
    MockExecutor, SimulatedStep, SimulatingRuntime,
};

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
