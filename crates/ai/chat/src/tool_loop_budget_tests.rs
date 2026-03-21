use super::*;

#[tokio::test]
async fn test_token_accumulation_across_many_iterations() {
    let token_pairs: Vec<(u64, u64)> = vec![
        (100, 50), (200, 80), (150, 60), (300, 120), (250, 100),
    ];
    let mut responses: Vec<MockResponse> = token_pairs.iter().enumerate().map(|(i, (inp, out))| {
        MockResponse::tool_use(vec![ToolCall {
            id: format!("t{i}"),
            name: "do_thing".into(),
            input: serde_json::json!({"step": i}),
        }]).with_tokens(*inp, *out)
    }).collect();
    responses.push(MockResponse::text("Done").with_tokens(50, 20));

    let mock = Arc::new(MockLlmProvider::with_responses(responses));
    let (llm, _tmp) = testutil::make_test_llm(mock).await;
    let (event_tx, _) = mpsc::unbounded_channel();
    let config = default_config(10);
    let executor = ok_executor();

    let result = run_tool_loop(ToolLoopInput {
        llm, api_key: "test-key", system_prompt: "test",
        initial_messages: vec![RichMessage::user("go")],
        tools: Arc::from(Vec::<ToolDefinition>::new()), config: &config,
        executor: &executor, event_tx: &event_tx,
    }).await;

    assert_eq!(result.iterations_run, 6);
    let expected_input: u64 = token_pairs.iter().map(|(i, _)| i).sum::<u64>() + 50;
    let expected_output: u64 = token_pairs.iter().map(|(_, o)| o).sum::<u64>() + 20;
    assert_eq!(result.total_input_tokens, expected_input);
    assert_eq!(result.total_output_tokens, expected_output);
}

#[tokio::test]
async fn test_iteration_token_usage_events_match_mock_responses() {
    let token_pairs: Vec<(u64, u64)> = vec![(100, 50), (200, 80)];
    let responses = vec![
        MockResponse::tool_use(vec![ToolCall {
            id: "t0".into(),
            name: "do_thing".into(),
            input: serde_json::json!({}),
        }]).with_tokens(100, 50),
        MockResponse::text("Done").with_tokens(200, 80),
    ];

    let mock = Arc::new(MockLlmProvider::with_responses(responses));
    let (llm, _tmp) = testutil::make_test_llm(mock).await;
    let (event_tx, mut event_rx) = mpsc::unbounded_channel();
    let config = default_config(5);
    let executor = SimpleExecutor {
        handler: Box::new(|calls| {
            calls.iter().map(|tc| ToolCallResult {
                tool_use_id: tc.id.clone(), content: "ok".into(), is_error: false, stop_loop: false,
            }).collect()
        }),
    };

    let _result = run_tool_loop(ToolLoopInput {
        llm, api_key: "test-key", system_prompt: "test",
        initial_messages: vec![RichMessage::user("go")],
        tools: Arc::from(Vec::<ToolDefinition>::new()), config: &config,
        executor: &executor, event_tx: &event_tx,
    }).await;

    let mut usage_events: Vec<(u64, u64)> = vec![];
    while let Ok(evt) = event_rx.try_recv() {
        if let ToolLoopEvent::IterationTokenUsage { input_tokens, output_tokens } = evt {
            usage_events.push((input_tokens, output_tokens));
        }
    }
    assert_eq!(usage_events.len(), token_pairs.len());
    let mut cumulative_input = 0u64;
    let mut cumulative_output = 0u64;
    for (i, (inp, out)) in token_pairs.iter().enumerate() {
        cumulative_input += inp;
        cumulative_output += out;
        assert_eq!(usage_events[i].0, cumulative_input, "iteration {i} cumulative input mismatch");
        assert_eq!(usage_events[i].1, cumulative_output, "iteration {i} cumulative output mismatch");
    }
}

#[tokio::test]
async fn test_credit_budget_stops_loop() {
    let responses: Vec<MockResponse> = (0..10).map(|i| {
        MockResponse::tool_use(vec![ToolCall {
            id: format!("t{i}"),
            name: "do_thing".into(),
            input: serde_json::json!({}),
        }]).with_tokens(100_000, 50_000)
    }).collect();

    let mock = Arc::new(MockLlmProvider::with_responses(responses));
    let (llm, _tmp) = testutil::make_test_llm(mock).await;
    let (event_tx, mut event_rx) = mpsc::unbounded_channel();

    let mut config = default_config(10);
    config.credit_budget = Some(2000);

    let executor = ok_executor();

    let result = run_tool_loop(ToolLoopInput {
        llm, api_key: "test-key", system_prompt: "test",
        initial_messages: vec![RichMessage::user("go")],
        tools: Arc::from(Vec::<ToolDefinition>::new()), config: &config,
        executor: &executor, event_tx: &event_tx,
    }).await;

    assert!(result.iterations_run < 10, "should have stopped early due to credit budget");
    assert!(result.insufficient_credits, "credit budget exceeded should set insufficient_credits");

    let mut found_budget_error = false;
    while let Ok(evt) = event_rx.try_recv() {
        if let ToolLoopEvent::Error(msg) = evt {
            if msg.contains("credit budget") {
                found_budget_error = true;
            }
        }
    }
    assert!(found_budget_error, "should emit credit budget error event");
}

#[tokio::test]
async fn test_credit_budget_warnings_emitted() {
    let responses: Vec<MockResponse> = (0..10).map(|i| {
        MockResponse::tool_use(vec![ToolCall {
            id: format!("t{i}"),
            name: "do_thing".into(),
            input: serde_json::json!({}),
        }]).with_tokens(10_000, 5_000)
    }).collect();

    let mock = Arc::new(MockLlmProvider::with_responses(responses));
    let (llm, _tmp) = testutil::make_test_llm(mock).await;
    let (event_tx, mut event_rx) = mpsc::unbounded_channel();

    let mut config = default_config(10);
    config.credit_budget = Some(1000);

    let executor = ok_executor();

    let result = run_tool_loop(ToolLoopInput {
        llm, api_key: "test-key", system_prompt: "test",
        initial_messages: vec![RichMessage::user("go")],
        tools: Arc::from(Vec::<ToolDefinition>::new()), config: &config,
        executor: &executor, event_tx: &event_tx,
    }).await;

    assert!(result.iterations_run > 0);

    let mut has_budget_stop = false;
    while let Ok(evt) = event_rx.try_recv() {
        if let ToolLoopEvent::Error(msg) = evt {
            if msg.contains("credit budget") {
                has_budget_stop = true;
            }
        }
    }
    assert!(has_budget_stop, "budget should eventually trigger a stop");
}

#[tokio::test]
async fn test_insufficient_credits_mid_loop() {
    use aura_billing::testutil::{MockBillingState, make_test_llm_stateful};

    let state = Arc::new(tokio::sync::Mutex::new(MockBillingState::new(0)));
    let mock = Arc::new(MockLlmProvider::with_responses(vec![
        MockResponse::text("unreachable").with_tokens(50, 20),
    ]));

    let (llm, _tmp) = make_test_llm_stateful(mock, state).await;
    let (event_tx, _) = mpsc::unbounded_channel();
    let config = default_config(10);
    let executor = ok_executor();

    let result = run_tool_loop(ToolLoopInput {
        llm, api_key: "test-key", system_prompt: "test",
        initial_messages: vec![RichMessage::user("go")],
        tools: Arc::from(Vec::<ToolDefinition>::new()), config: &config,
        executor: &executor, event_tx: &event_tx,
    }).await;

    assert!(result.insufficient_credits, "should flag insufficient_credits");
    assert!(result.iterations_run >= 1, "at least 1 iteration should have run");
}
