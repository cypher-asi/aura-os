use super::*;
use aura_claude::mock::{MockLlmProvider, MockResponse};
use aura_billing::testutil;

fn default_config(max_iterations: usize) -> ToolLoopConfig {
    ToolLoopConfig {
        max_iterations,
        max_tokens: 4096,
        thinking: None,
        stream_timeout: Duration::from_secs(30),
        billing_reason: "test",
        max_context_tokens: None,
        credit_budget: None,
    }
}

struct SimpleExecutor {
    handler: Box<dyn Fn(&[ToolCall]) -> Vec<ToolCallResult> + Send + Sync>,
}

#[async_trait]
impl ToolExecutor for SimpleExecutor {
    async fn execute(&self, tool_calls: &[ToolCall]) -> Vec<ToolCallResult> {
        (self.handler)(tool_calls)
    }
}

fn noop_executor() -> SimpleExecutor {
    SimpleExecutor {
        handler: Box::new(|_| vec![]),
    }
}

#[tokio::test]
async fn test_tool_loop_simple_end_turn() {
    let mock = Arc::new(MockLlmProvider::with_responses(vec![
        MockResponse::text("Done!").with_tokens(100, 50),
    ]));

    let (llm, _tmp) = testutil::make_test_llm(mock).await;
    let (event_tx, _event_rx) = mpsc::unbounded_channel();
    let executor = noop_executor();
    let config = default_config(5);

    let result = run_tool_loop(
        llm,
        "test-key",
        "You are a test assistant.",
        vec![RichMessage::user("Say done")],
        Arc::from(Vec::<ToolDefinition>::new()),
        &config,
        &executor,
        &event_tx,
    )
    .await;

    assert_eq!(result.text, "Done!");
    assert_eq!(result.iterations_run, 1);
    assert!(!result.timed_out);
    assert!(!result.insufficient_credits);
}

#[tokio::test]
async fn test_tool_loop_tool_use_then_end_turn() {
    let mock = Arc::new(MockLlmProvider::with_responses(vec![
        MockResponse::tool_use(vec![ToolCall {
            id: "t1".into(),
            name: "read_file".into(),
            input: serde_json::json!({"path": "src/main.rs"}),
        }])
        .with_tokens(100, 50),
        MockResponse::text("File contents shown.").with_tokens(80, 40),
    ]));

    let (llm, _tmp) = testutil::make_test_llm(mock).await;
    let (event_tx, _event_rx) = mpsc::unbounded_channel();
    let config = default_config(5);

    let executor = SimpleExecutor {
        handler: Box::new(|calls| {
            calls
                .iter()
                .map(|tc| ToolCallResult {
                    tool_use_id: tc.id.clone(),
                    content: "fn main() {}".into(),
                    is_error: false,
                    stop_loop: false,
                })
                .collect()
        }),
    };

    let result = run_tool_loop(
        llm,
        "test-key",
        "You are a test assistant.",
        vec![RichMessage::user("Read the file")],
        Arc::from(Vec::<ToolDefinition>::new()),
        &config,
        &executor,
        &event_tx,
    )
    .await;

    assert_eq!(result.iterations_run, 2);
    assert!(result.text.contains("File contents shown."));
    assert_eq!(result.total_input_tokens, 180);
    assert_eq!(result.total_output_tokens, 90);
    assert!(!result.timed_out);
}

#[tokio::test]
async fn test_tool_loop_hits_max_iterations() {
    let responses: Vec<MockResponse> = (0..10)
        .map(|i| {
            MockResponse::tool_use(vec![ToolCall {
                id: format!("t{}", i),
                name: "do_thing".into(),
                input: serde_json::json!({"step": i}),
            }])
            .with_tokens(50, 30)
        })
        .collect();

    let mock = Arc::new(MockLlmProvider::with_responses(responses));
    let (llm, _tmp) = testutil::make_test_llm(mock).await;
    let (event_tx, _event_rx) = mpsc::unbounded_channel();
    let config = default_config(3);

    let executor = SimpleExecutor {
        handler: Box::new(|calls| {
            calls
                .iter()
                .map(|tc| ToolCallResult {
                    tool_use_id: tc.id.clone(),
                    content: "ok".into(),
                    is_error: false,
                    stop_loop: false,
                })
                .collect()
        }),
    };

    let result = run_tool_loop(
        llm,
        "test-key",
        "You are a test assistant.",
        vec![RichMessage::user("Do many things")],
        Arc::from(Vec::<ToolDefinition>::new()),
        &config,
        &executor,
        &event_tx,
    )
    .await;

    assert_eq!(result.iterations_run, 3);
    assert!(!result.timed_out);
}
