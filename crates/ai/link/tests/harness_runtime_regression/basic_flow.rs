use std::sync::Arc;

use tokio::sync::mpsc;

use aura_os_link::{RuntimeEvent, ToolExecutor};

use super::{
    default_config, make_request, make_request_with_events, tool_call, MockExecutor,
    SimulatedStep, SimulatingRuntime,
};

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
