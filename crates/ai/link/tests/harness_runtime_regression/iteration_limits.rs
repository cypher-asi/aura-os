use std::sync::Arc;

use aura_os_link::{ToolCallResult, ToolExecutor};

use super::{
    default_config, make_request, tool_call, MockExecutor, SimulatedStep, SimulatingRuntime,
};

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
