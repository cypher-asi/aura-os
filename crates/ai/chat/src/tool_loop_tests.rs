use super::*;
use std::collections::HashMap;
use std::time::Duration;
use async_trait::async_trait;
use aura_claude::mock::{MockLlmProvider, MockResponse};
use aura_billing::testutil;
use crate::tool_loop_blocking::{
    apply_cmd_failure_tracking, build_tool_result_blocks, collect_duplicate_write_paths,
    detect_blocked_commands, detect_blocked_exploration,
    detect_blocked_write_failures, detect_blocked_writes, detect_same_target_stall,
    detect_write_file_cooldowns, looks_truncated, summarize_write_file_input,
};
use crate::tool_loop_read_guard::{self as read_guard, ReadGuardState};

// ---------------------------------------------------------------------------
// Shared test fixtures and builders
// ---------------------------------------------------------------------------

fn default_config(max_iterations: usize) -> ToolLoopConfig {
    ToolLoopConfig {
        max_iterations,
        max_tokens: 4096,
        thinking: None,
        stream_timeout: Duration::from_secs(30),
        billing_reason: "test",
        max_context_tokens: None,
        credit_budget: None,
        exploration_allowance: None,
        model_override: None,
        auto_build_cooldown: None,
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

fn ok_executor() -> SimpleExecutor {
    SimpleExecutor {
        handler: Box::new(|calls| {
            calls.iter().map(|tc| ToolCallResult {
                tool_use_id: tc.id.clone(),
                content: "ok".into(),
                is_error: false,
                stop_loop: false,
            }).collect()
        }),
    }
}

// ===========================================================================
// Basic tool loop integration tests
// ===========================================================================

mod basic_tests {
    use super::*;

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

    #[tokio::test]
    async fn test_stop_loop_flag_exits_after_first_iteration() {
        let mock = Arc::new(MockLlmProvider::with_responses(vec![
            MockResponse::tool_use(vec![ToolCall {
                id: "t1".into(),
                name: "task_done".into(),
                input: serde_json::json!({"result": "finished"}),
            }])
            .with_tokens(100, 50),
            MockResponse::text("Should not be reached").with_tokens(50, 50),
        ]));

        let (llm, _tmp) = testutil::make_test_llm(mock).await;
        let (event_tx, _event_rx) = mpsc::unbounded_channel();
        let config = default_config(10);

        let executor = SimpleExecutor {
            handler: Box::new(|calls| {
                calls
                    .iter()
                    .map(|tc| ToolCallResult {
                        tool_use_id: tc.id.clone(),
                        content: "done".into(),
                        is_error: false,
                        stop_loop: true,
                    })
                    .collect()
            }),
        };

        let result = run_tool_loop(
            llm, "test-key", "test", vec![RichMessage::user("Do it")],
            Arc::from(Vec::<ToolDefinition>::new()), &config, &executor, &event_tx,
        ).await;

        assert_eq!(result.iterations_run, 1);
        assert!(!result.timed_out);
    }

    #[tokio::test]
    async fn test_multiple_tool_calls_in_single_iteration() {
        let mock = Arc::new(MockLlmProvider::with_responses(vec![
            MockResponse::tool_use(vec![
                ToolCall { id: "t1".into(), name: "read_file".into(), input: serde_json::json!({"path": "a.rs"}) },
                ToolCall { id: "t2".into(), name: "read_file".into(), input: serde_json::json!({"path": "b.rs"}) },
                ToolCall { id: "t3".into(), name: "read_file".into(), input: serde_json::json!({"path": "c.rs"}) },
            ]).with_tokens(100, 80),
            MockResponse::text("All three read.").with_tokens(80, 40),
        ]));

        let (llm, _tmp) = testutil::make_test_llm(mock).await;
        let (event_tx, mut event_rx) = mpsc::unbounded_channel();
        let config = default_config(5);

        let executor = SimpleExecutor {
            handler: Box::new(|calls| {
                calls.iter().map(|tc| ToolCallResult {
                    tool_use_id: tc.id.clone(),
                    content: format!("content of {}", tc.input["path"].as_str().unwrap_or("")),
                    is_error: false,
                    stop_loop: false,
                }).collect()
            }),
        };

        let result = run_tool_loop(
            llm, "test-key", "test", vec![RichMessage::user("Read three files")],
            Arc::from(Vec::<ToolDefinition>::new()), &config, &executor, &event_tx,
        ).await;

        assert_eq!(result.iterations_run, 2);

        let mut tool_result_count = 0;
        while let Ok(evt) = event_rx.try_recv() {
            if matches!(evt, ToolLoopEvent::ToolResult { .. }) {
                tool_result_count += 1;
            }
        }
        assert_eq!(tool_result_count, 3, "should have 3 tool results from the batch");
    }

    #[tokio::test]
    async fn test_text_accumulation_across_iterations() {
        let mock = Arc::new(MockLlmProvider::with_responses(vec![{
            let mut r = MockResponse::tool_use(vec![ToolCall {
                id: "t1".into(),
                name: "do_thing".into(),
                input: serde_json::json!({}),
            }]);
            r.text = "First part".into();
            r.input_tokens = 50;
            r.output_tokens = 30;
            r
        }, MockResponse::text("Second part").with_tokens(50, 30)]));

        let (llm, _tmp) = testutil::make_test_llm(mock).await;
        let (event_tx, _) = mpsc::unbounded_channel();
        let config = default_config(5);
        let executor = ok_executor();

        let result = run_tool_loop(
            llm, "test-key", "test", vec![RichMessage::user("go")],
            Arc::from(Vec::<ToolDefinition>::new()), &config, &executor, &event_tx,
        ).await;

        assert!(result.text.contains("First part"));
        assert!(result.text.contains("Second part"));
    }

    #[tokio::test]
    async fn test_empty_tool_call_list_with_tool_use_stop_reason() {
        let mut resp = MockResponse::tool_use(vec![]);
        resp.stop_reason = "tool_use".into();
        resp.input_tokens = 100;
        resp.output_tokens = 50;

        let mock = Arc::new(MockLlmProvider::with_responses(vec![resp]));
        let (llm, _tmp) = testutil::make_test_llm(mock).await;
        let (event_tx, _) = mpsc::unbounded_channel();
        let config = default_config(5);
        let executor = noop_executor();

        let result = run_tool_loop(
            llm, "test-key", "test", vec![RichMessage::user("go")],
            Arc::from(Vec::<ToolDefinition>::new()), &config, &executor, &event_tx,
        ).await;

        assert_eq!(result.iterations_run, 1);
        assert!(!result.timed_out);
    }

    #[tokio::test]
    async fn test_max_tokens_truncation_handling() {
        let mut resp = MockResponse::tool_use(vec![ToolCall {
            id: "t1".into(),
            name: "write_file".into(),
            input: serde_json::json!({"path": "out.rs", "content": "fn main() {}"}),
        }]);
        resp.stop_reason = "max_tokens".into();
        resp.input_tokens = 100;
        resp.output_tokens = 50;

        let mock = Arc::new(MockLlmProvider::with_responses(vec![
            resp,
            MockResponse::text("Done after truncation").with_tokens(80, 40),
        ]));

        let (llm, _tmp) = testutil::make_test_llm(mock).await;
        let (event_tx, mut event_rx) = mpsc::unbounded_channel();
        let config = default_config(5);
        let executor = noop_executor();

        let result = run_tool_loop(
            llm, "test-key", "test", vec![RichMessage::user("write")],
            Arc::from(Vec::<ToolDefinition>::new()), &config, &executor, &event_tx,
        ).await;

        assert_eq!(result.iterations_run, 2);

        let mut found_truncation_error = false;
        while let Ok(evt) = event_rx.try_recv() {
            if let ToolLoopEvent::ToolResult { content, is_error, .. } = evt {
                if is_error && content.contains("truncated") {
                    found_truncation_error = true;
                }
            }
        }
        assert!(found_truncation_error, "should emit truncation error for tool calls with max_tokens");
    }

    #[tokio::test]
    async fn test_zero_iterations_config() {
        let mock = Arc::new(MockLlmProvider::with_responses(vec![
            MockResponse::text("Should not run").with_tokens(100, 50),
        ]));

        let (llm, _tmp) = testutil::make_test_llm(mock).await;
        let (event_tx, _) = mpsc::unbounded_channel();
        let config = default_config(0);
        let executor = noop_executor();

        let result = run_tool_loop(
            llm, "test-key", "test", vec![RichMessage::user("go")],
            Arc::from(Vec::<ToolDefinition>::new()), &config, &executor, &event_tx,
        ).await;

        assert_eq!(result.iterations_run, 0);
    }

    #[tokio::test]
    async fn test_event_emission_delta_tool_use_tool_result_token_usage() {
        let mock = Arc::new(MockLlmProvider::with_responses(vec![
            MockResponse::tool_use(vec![ToolCall {
                id: "t1".into(),
                name: "read_file".into(),
                input: serde_json::json!({"path": "a.rs"}),
            }]).with_tokens(100, 50),
            MockResponse::text("Done").with_tokens(80, 40),
        ]));

        let (llm, _tmp) = testutil::make_test_llm(mock).await;
        let (event_tx, mut event_rx) = mpsc::unbounded_channel();
        let config = default_config(5);
        let executor = SimpleExecutor {
            handler: Box::new(|calls| {
                calls.iter().map(|tc| ToolCallResult {
                    tool_use_id: tc.id.clone(),
                    content: "fn main() {}".into(),
                    is_error: false,
                    stop_loop: false,
                }).collect()
            }),
        };

        let _result = run_tool_loop(
            llm, "test-key", "test", vec![RichMessage::user("read")],
            Arc::from(Vec::<ToolDefinition>::new()), &config, &executor, &event_tx,
        ).await;

        let mut has_delta = false;
        let mut has_tool_use = false;
        let mut has_tool_result = false;
        let mut has_token_usage = false;

        while let Ok(evt) = event_rx.try_recv() {
            match evt {
                ToolLoopEvent::Delta(_) => has_delta = true,
                ToolLoopEvent::ToolUseDetected { .. } => has_tool_use = true,
                ToolLoopEvent::ToolResult { .. } => has_tool_result = true,
                ToolLoopEvent::IterationTokenUsage { .. } => has_token_usage = true,
                _ => {}
            }
        }

        assert!(has_delta, "should emit Delta event for 'Done' text");
        assert!(has_tool_use, "should emit ToolUseDetected");
        assert!(has_tool_result, "should emit ToolResult");
        assert!(has_token_usage, "should emit IterationTokenUsage");
    }
}

// ===========================================================================
// Blocking detection and stall tests
// ===========================================================================

mod blocking_tests {
    use super::*;

    // -- Read guard ----------------------------------------------------------

    #[test]
    fn test_detect_blocked_reads_allows_first_two() {
        let mut state = ReadGuardState::new();
        let calls = vec![
            ToolCall { id: "t1".into(), name: "read_file".into(), input: serde_json::json!({"path": "src/lib.rs"}) },
        ];

        let blocked = read_guard::detect_blocked_reads(&calls, &mut state);
        assert!(blocked.is_empty(), "1st read should not be blocked");
        assert_eq!(state.full_reads["src/lib.rs"], 1);

        let blocked = read_guard::detect_blocked_reads(&calls, &mut state);
        assert!(blocked.is_empty(), "2nd read should not be blocked");
        assert_eq!(state.full_reads["src/lib.rs"], 2);
    }

    #[test]
    fn test_detect_blocked_reads_blocks_third() {
        let mut state = ReadGuardState::new();
        let calls = vec![
            ToolCall { id: "t1".into(), name: "read_file".into(), input: serde_json::json!({"path": "src/lib.rs"}) },
        ];

        read_guard::detect_blocked_reads(&calls, &mut state);
        read_guard::detect_blocked_reads(&calls, &mut state);
        let blocked = read_guard::detect_blocked_reads(&calls, &mut state);
        assert_eq!(blocked, vec![0], "3rd full read of same file should be blocked");
        assert_eq!(state.full_reads["src/lib.rs"], 3);
    }

    #[test]
    fn test_detect_blocked_reads_different_files_independent() {
        let mut state = ReadGuardState::new();
        let calls_a = vec![
            ToolCall { id: "t1".into(), name: "read_file".into(), input: serde_json::json!({"path": "a.rs"}) },
        ];
        let calls_b = vec![
            ToolCall { id: "t2".into(), name: "read_file".into(), input: serde_json::json!({"path": "b.rs"}) },
        ];

        read_guard::detect_blocked_reads(&calls_a, &mut state);
        read_guard::detect_blocked_reads(&calls_a, &mut state);
        read_guard::detect_blocked_reads(&calls_b, &mut state);

        assert_eq!(state.full_reads["a.rs"], 2);
        assert_eq!(state.full_reads["b.rs"], 1);

        let blocked_a = read_guard::detect_blocked_reads(&calls_a, &mut state);
        assert_eq!(blocked_a, vec![0], "3rd read of a.rs should be blocked");

        let blocked_b = read_guard::detect_blocked_reads(&calls_b, &mut state);
        assert!(blocked_b.is_empty(), "2nd read of b.rs should not be blocked");
    }

    // -- Write blocking ------------------------------------------------------

    #[test]
    fn test_detect_blocked_writes_blocks_second_attempt_same_file() {
        let mut tracker: HashMap<String, usize> = HashMap::new();
        let calls = vec![ToolCall {
            id: "w1".into(),
            name: "write_file".into(),
            input: serde_json::json!({"path": "src/lib.rs"}),
        }];

        let first = detect_blocked_writes(&calls, &mut tracker);
        assert!(first.is_empty(), "first write should be allowed");

        let second = detect_blocked_writes(&calls, &mut tracker);
        assert_eq!(second, vec![0], "second consecutive write should be blocked");
    }

    #[test]
    fn test_detect_write_file_cooldowns_blocks_write_only() {
        let mut cooldowns: HashMap<String, usize> = HashMap::new();
        cooldowns.insert("src/lib.rs".into(), 2);
        let calls = vec![
            ToolCall {
                id: "w1".into(),
                name: "write_file".into(),
                input: serde_json::json!({"path": "src/lib.rs"}),
            },
            ToolCall {
                id: "e1".into(),
                name: "edit_file".into(),
                input: serde_json::json!({"path": "src/lib.rs"}),
            },
        ];

        let blocked = detect_write_file_cooldowns(&calls, &cooldowns);
        assert_eq!(blocked, vec![0], "cooldown should block write_file but not edit_file");
    }

    #[test]
    fn test_decrement_write_file_cooldowns_removes_expired_entries() {
        let mut cooldowns: HashMap<String, usize> = HashMap::new();
        cooldowns.insert("a.rs".into(), 1);
        cooldowns.insert("b.rs".into(), 3);

        decrement_write_file_cooldowns(&mut cooldowns);
        assert!(!cooldowns.contains_key("a.rs"));
        assert_eq!(cooldowns.get("b.rs"), Some(&2));
    }

    #[test]
    fn test_collect_duplicate_write_paths_deduplicates_paths() {
        let calls = vec![
            ToolCall {
                id: "w1".into(),
                name: "write_file".into(),
                input: serde_json::json!({"path": "x.rs"}),
            },
            ToolCall {
                id: "e1".into(),
                name: "edit_file".into(),
                input: serde_json::json!({"path": "x.rs"}),
            },
            ToolCall {
                id: "w2".into(),
                name: "write_file".into(),
                input: serde_json::json!({"path": "y.rs"}),
            },
        ];

        let paths = collect_duplicate_write_paths(&calls, &[0, 1, 2]);
        assert_eq!(paths, vec!["x.rs".to_string(), "y.rs".to_string()]);
    }

    // -- Write failure blocking ----------------------------------------------

    #[test]
    fn test_detect_blocked_write_failures_allows_first_two() {
        let mut failures: HashMap<String, usize> = HashMap::new();
        let calls = vec![
            ToolCall { id: "t1".into(), name: "write_file".into(), input: serde_json::json!({"path": "src/lib.rs"}) },
        ];

        failures.insert("src/lib.rs".into(), 1);
        let blocked = detect_blocked_write_failures(&calls, &failures);
        assert!(blocked.is_empty(), "1 failure should not block");

        failures.insert("src/lib.rs".into(), 2);
        let blocked = detect_blocked_write_failures(&calls, &failures);
        assert!(blocked.is_empty(), "2 failures should not block");
    }

    #[test]
    fn test_detect_blocked_write_failures_blocks_at_three() {
        let mut failures: HashMap<String, usize> = HashMap::new();
        failures.insert("src/lib.rs".into(), 3);

        let calls = vec![
            ToolCall { id: "t1".into(), name: "write_file".into(), input: serde_json::json!({"path": "src/lib.rs"}) },
            ToolCall { id: "t2".into(), name: "edit_file".into(), input: serde_json::json!({"path": "src/lib.rs"}) },
        ];

        let blocked = detect_blocked_write_failures(&calls, &failures);
        assert_eq!(blocked, vec![0, 1], "3 failures should block both write and edit");
    }

    #[test]
    fn test_detect_blocked_write_failures_independent_per_file() {
        let mut failures: HashMap<String, usize> = HashMap::new();
        failures.insert("a.rs".into(), 3);
        failures.insert("b.rs".into(), 1);

        let calls = vec![
            ToolCall { id: "t1".into(), name: "write_file".into(), input: serde_json::json!({"path": "a.rs"}) },
            ToolCall { id: "t2".into(), name: "write_file".into(), input: serde_json::json!({"path": "b.rs"}) },
        ];

        let blocked = detect_blocked_write_failures(&calls, &failures);
        assert_eq!(blocked, vec![0], "only a.rs (3 failures) should be blocked, not b.rs (1 failure)");
    }

    // -- Exploration blocking ------------------------------------------------

    #[test]
    fn test_detect_blocked_exploration_not_blocked() {
        let calls = vec![
            ToolCall { id: "t1".into(), name: "read_file".into(), input: serde_json::json!({"path": "a.rs"}) },
            ToolCall { id: "t2".into(), name: "search_code".into(), input: serde_json::json!({"query": "fn main"}) },
            ToolCall { id: "t3".into(), name: "write_file".into(), input: serde_json::json!({"path": "b.rs"}) },
        ];

        let blocked = detect_blocked_exploration(&calls, false);
        assert!(blocked.is_empty());
    }

    #[test]
    fn test_detect_blocked_exploration_blocks_only_exploration() {
        let calls = vec![
            ToolCall { id: "t1".into(), name: "read_file".into(), input: serde_json::json!({"path": "a.rs"}) },
            ToolCall { id: "t2".into(), name: "write_file".into(), input: serde_json::json!({"path": "b.rs"}) },
            ToolCall { id: "t3".into(), name: "search_code".into(), input: serde_json::json!({"query": "fn main"}) },
            ToolCall { id: "t4".into(), name: "find_files".into(), input: serde_json::json!({"pattern": "*.rs"}) },
            ToolCall { id: "t5".into(), name: "list_files".into(), input: serde_json::json!({"dir": "src"}) },
            ToolCall { id: "t6".into(), name: "run_command".into(), input: serde_json::json!({"command": "cargo build"}) },
        ];

        let blocked = detect_blocked_exploration(&calls, true);
        assert_eq!(blocked, vec![0, 2, 3, 4], "should block read_file, search_code, find_files, list_files but not write_file or run_command");
    }

    #[tokio::test]
    async fn test_exploration_hard_block_at_limit() {
        let mut responses: Vec<MockResponse> = Vec::new();
        for i in 0..14 {
            responses.push(
                MockResponse::tool_use(vec![ToolCall {
                    id: format!("t{i}"),
                    name: "read_file".into(),
                    input: serde_json::json!({"path": format!("file{i}.rs")}),
                }])
                .with_tokens(50, 30),
            );
        }
        responses.push(MockResponse::text("Done").with_tokens(50, 30));

        let mock = Arc::new(MockLlmProvider::with_responses(responses));
        let (llm, _tmp) = testutil::make_test_llm(mock).await;
        let (event_tx, mut event_rx) = mpsc::unbounded_channel();
        let config = default_config(20);

        let executor = SimpleExecutor {
            handler: Box::new(|calls| {
                calls.iter().map(|tc| ToolCallResult {
                    tool_use_id: tc.id.clone(),
                    content: "file content".into(),
                    is_error: false,
                    stop_loop: false,
                }).collect()
            }),
        };

        let result = run_tool_loop(
            llm, "test-key", "test", vec![RichMessage::user("read")],
            Arc::from(Vec::<ToolDefinition>::new()), &config, &executor, &event_tx,
        ).await;

        assert!(!result.timed_out);

        let mut blocked_count = 0;
        while let Ok(evt) = event_rx.try_recv() {
            if let ToolLoopEvent::ToolResult { content, is_error, .. } = evt {
                if is_error && content.contains("Exploration blocked") {
                    blocked_count += 1;
                }
            }
        }
        assert!(blocked_count > 0, "should have blocked at least one exploration call after limit");
    }

    #[tokio::test]
    async fn test_exploration_unblocks_after_write() {
        let responses = vec![
            MockResponse::tool_use(vec![
                ToolCall { id: "r1".into(), name: "read_file".into(), input: serde_json::json!({"path": "f1.rs"}) },
                ToolCall { id: "r2".into(), name: "read_file".into(), input: serde_json::json!({"path": "f2.rs"}) },
                ToolCall { id: "r3".into(), name: "read_file".into(), input: serde_json::json!({"path": "f3.rs"}) },
                ToolCall { id: "r4".into(), name: "read_file".into(), input: serde_json::json!({"path": "f4.rs"}) },
            ]).with_tokens(50, 30),
            MockResponse::tool_use(vec![
                ToolCall { id: "r5".into(), name: "read_file".into(), input: serde_json::json!({"path": "f5.rs"}) },
                ToolCall { id: "r6".into(), name: "read_file".into(), input: serde_json::json!({"path": "f6.rs"}) },
                ToolCall { id: "r7".into(), name: "read_file".into(), input: serde_json::json!({"path": "f7.rs"}) },
                ToolCall { id: "r8".into(), name: "read_file".into(), input: serde_json::json!({"path": "f8.rs"}) },
            ]).with_tokens(50, 30),
            MockResponse::tool_use(vec![
                ToolCall { id: "r9".into(), name: "read_file".into(), input: serde_json::json!({"path": "f9.rs"}) },
                ToolCall { id: "r10".into(), name: "read_file".into(), input: serde_json::json!({"path": "f10.rs"}) },
                ToolCall { id: "r11".into(), name: "read_file".into(), input: serde_json::json!({"path": "f11.rs"}) },
                ToolCall { id: "r12".into(), name: "read_file".into(), input: serde_json::json!({"path": "f12.rs"}) },
            ]).with_tokens(50, 30),
            MockResponse::tool_use(vec![
                ToolCall { id: "w1".into(), name: "write_file".into(), input: serde_json::json!({"path": "out.rs", "content": "done"}) },
            ]).with_tokens(50, 30),
            MockResponse::tool_use(vec![
                ToolCall { id: "r13".into(), name: "read_file".into(), input: serde_json::json!({"path": "f13.rs"}) },
            ]).with_tokens(50, 30),
            MockResponse::text("Done").with_tokens(50, 30),
        ];

        let mock = Arc::new(MockLlmProvider::with_responses(responses));
        let (llm, _tmp) = testutil::make_test_llm(mock).await;
        let (event_tx, mut event_rx) = mpsc::unbounded_channel();
        let config = default_config(20);
        let executor = ok_executor();

        let result = run_tool_loop(
            llm, "test-key", "test", vec![RichMessage::user("read then write")],
            Arc::from(Vec::<ToolDefinition>::new()), &config, &executor, &event_tx,
        ).await;

        assert!(!result.timed_out);

        let mut post_write_read_succeeded = false;
        while let Ok(evt) = event_rx.try_recv() {
            if let ToolLoopEvent::ToolResult { tool_use_id, is_error, .. } = evt {
                if tool_use_id == "r13" && !is_error {
                    post_write_read_succeeded = true;
                }
            }
        }
        assert!(post_write_read_succeeded, "read after write should succeed (exploration unblocked)");
    }

    // -- Write failure tracking (integration) --------------------------------

    #[tokio::test]
    async fn test_write_failure_tracking_blocks_after_repeated_errors() {
        let responses = vec![
            MockResponse::tool_use(vec![
                ToolCall { id: "e1".into(), name: "edit_file".into(),
                    input: serde_json::json!({"path": "f.rs", "old_text": "x", "new_text": "y"}) },
                ToolCall { id: "d1".into(), name: "do_thing".into(), input: serde_json::json!({}) },
            ]).with_tokens(50, 30),
            MockResponse::tool_use(vec![
                ToolCall { id: "e2".into(), name: "edit_file".into(),
                    input: serde_json::json!({"path": "f.rs", "old_text": "x", "new_text": "y"}) },
                ToolCall { id: "d2".into(), name: "do_thing".into(), input: serde_json::json!({}) },
                ToolCall { id: "w2".into(), name: "write_file".into(),
                    input: serde_json::json!({"path": "reset.rs", "content": "ok"}) },
            ]).with_tokens(50, 30),
            MockResponse::tool_use(vec![
                ToolCall { id: "e3".into(), name: "edit_file".into(),
                    input: serde_json::json!({"path": "f.rs", "old_text": "x", "new_text": "y"}) },
                ToolCall { id: "d3".into(), name: "do_thing".into(), input: serde_json::json!({}) },
            ]).with_tokens(50, 30),
            MockResponse::tool_use(vec![
                ToolCall { id: "e4".into(), name: "edit_file".into(),
                    input: serde_json::json!({"path": "f.rs", "old_text": "x", "new_text": "y"}) },
                ToolCall { id: "d4".into(), name: "do_thing".into(), input: serde_json::json!({}) },
            ]).with_tokens(50, 30),
            MockResponse::text("Gave up").with_tokens(50, 30),
        ];

        let mock = Arc::new(MockLlmProvider::with_responses(responses));
        let (llm, _tmp) = testutil::make_test_llm(mock).await;
        let (event_tx, mut event_rx) = mpsc::unbounded_channel();
        let config = default_config(10);

        let executor = SimpleExecutor {
            handler: Box::new(|calls| {
                calls.iter().map(|tc| {
                    if tc.name == "edit_file" {
                        ToolCallResult {
                            tool_use_id: tc.id.clone(),
                            content: "edit failed: old_text not found".into(),
                            is_error: true,
                            stop_loop: false,
                        }
                    } else {
                        ToolCallResult {
                            tool_use_id: tc.id.clone(),
                            content: "ok".into(),
                            is_error: false,
                            stop_loop: false,
                        }
                    }
                }).collect()
            }),
        };

        let result = run_tool_loop(
            llm, "test-key", "test", vec![RichMessage::user("edit")],
            Arc::from(Vec::<ToolDefinition>::new()), &config, &executor, &event_tx,
        ).await;

        assert!(!result.timed_out);

        let mut blocked_on_e4 = false;
        while let Ok(evt) = event_rx.try_recv() {
            if let ToolLoopEvent::ToolResult { tool_use_id, content, is_error, .. } = evt {
                if tool_use_id == "e4" && is_error && content.contains("blocked after") {
                    blocked_on_e4 = true;
                }
            }
        }
        assert!(blocked_on_e4, "4th edit attempt should be blocked after 3 failures");
    }

    // -- Stall fail-fast -----------------------------------------------------

    #[tokio::test]
    async fn test_stall_fail_fast_after_three_consecutive_failed_edits() {
        let responses: Vec<MockResponse> = (0..5)
            .map(|i| {
                MockResponse::tool_use(vec![ToolCall {
                    id: format!("e{i}"),
                    name: "edit_file".into(),
                    input: serde_json::json!({"path": "src/lib.rs", "old_text": "x", "new_text": "y"}),
                }]).with_tokens(50, 30)
            })
            .chain(std::iter::once(MockResponse::text("fallback").with_tokens(50, 30)))
            .collect();

        let mock = Arc::new(MockLlmProvider::with_responses(responses));
        let (llm, _tmp) = testutil::make_test_llm(mock).await;
        let (event_tx, mut event_rx) = mpsc::unbounded_channel();
        let config = default_config(10);

        let executor = SimpleExecutor {
            handler: Box::new(|calls| {
                calls.iter().map(|tc| ToolCallResult {
                    tool_use_id: tc.id.clone(),
                    content: "edit failed: old_text not found".into(),
                    is_error: true,
                    stop_loop: false,
                }).collect()
            }),
        };

        let result = run_tool_loop(
            llm, "test-key", "test", vec![RichMessage::user("edit")],
            Arc::from(Vec::<ToolDefinition>::new()), &config, &executor, &event_tx,
        ).await;

        assert!(result.iterations_run <= 4, "should stop early due to stall fail-fast");

        let mut found_stall_error = false;
        while let Ok(evt) = event_rx.try_recv() {
            if let ToolLoopEvent::Error(msg) = evt {
                if msg.contains("STALL FAIL-FAST") {
                    found_stall_error = true;
                }
            }
        }
        assert!(found_stall_error, "should emit stall fail-fast error");
    }

    // -- Mixed blocked / allowed ---------------------------------------------

    #[tokio::test]
    async fn test_mixed_tool_calls_some_blocked_some_allowed() {
        let mock = Arc::new(MockLlmProvider::with_responses(vec![
            MockResponse::tool_use(vec![
                ToolCall { id: "r1".into(), name: "read_file".into(), input: serde_json::json!({"path": "a.rs"}) },
            ]).with_tokens(50, 30),
            MockResponse::tool_use(vec![
                ToolCall { id: "r2".into(), name: "read_file".into(), input: serde_json::json!({"path": "a.rs"}) },
            ]).with_tokens(50, 30),
            MockResponse::tool_use(vec![
                ToolCall { id: "r3".into(), name: "read_file".into(), input: serde_json::json!({"path": "a.rs"}) },
                ToolCall { id: "t1".into(), name: "do_thing".into(), input: serde_json::json!({}) },
            ]).with_tokens(50, 30),
            MockResponse::text("Done").with_tokens(50, 30),
        ]));

        let (llm, _tmp) = testutil::make_test_llm(mock).await;
        let (event_tx, mut event_rx) = mpsc::unbounded_channel();
        let config = default_config(10);
        let executor = ok_executor();

        let result = run_tool_loop(
            llm, "test-key", "test", vec![RichMessage::user("read then read more")],
            Arc::from(Vec::<ToolDefinition>::new()), &config, &executor, &event_tx,
        ).await;

        assert_eq!(result.iterations_run, 4);

        let mut r3_blocked = false;
        let mut t1_ok = false;
        while let Ok(evt) = event_rx.try_recv() {
            if let ToolLoopEvent::ToolResult { tool_use_id, is_error, content, .. } = evt {
                if tool_use_id == "r3" && is_error && content.contains("BLOCKED") {
                    r3_blocked = true;
                }
                if tool_use_id == "t1" && !is_error {
                    t1_ok = true;
                }
            }
        }
        assert!(r3_blocked, "3rd read of a.rs should be blocked");
        assert!(t1_ok, "do_thing in same batch should still execute");
    }

    // -- detect_blocked_commands ---------------------------------------------

    #[test]
    fn test_detect_blocked_commands_returns_empty_when_failures_under_5() {
        let calls = vec![
            ToolCall { id: "t1".into(), name: "run_command".into(), input: serde_json::json!({"command": "ls"}) },
        ];
        let blocked = detect_blocked_commands(&calls, 4);
        assert!(blocked.is_empty(), "4 failures should not block");
    }

    #[test]
    fn test_detect_blocked_commands_blocks_at_exactly_5() {
        let calls = vec![
            ToolCall { id: "t1".into(), name: "run_command".into(), input: serde_json::json!({"command": "ls"}) },
        ];
        let blocked = detect_blocked_commands(&calls, 5);
        assert_eq!(blocked, vec![0]);
    }

    #[test]
    fn test_detect_blocked_commands_does_not_block_non_run_command() {
        let calls = vec![
            ToolCall { id: "t1".into(), name: "read_file".into(), input: serde_json::json!({"path": "a.rs"}) },
            ToolCall { id: "t2".into(), name: "write_file".into(), input: serde_json::json!({"path": "b.rs"}) },
        ];
        let blocked = detect_blocked_commands(&calls, 10);
        assert!(blocked.is_empty());
    }

    #[test]
    fn test_detect_blocked_commands_blocks_multiple_run_commands() {
        let calls = vec![
            ToolCall { id: "t1".into(), name: "run_command".into(), input: serde_json::json!({"command": "ls"}) },
            ToolCall { id: "t2".into(), name: "read_file".into(), input: serde_json::json!({"path": "a.rs"}) },
            ToolCall { id: "t3".into(), name: "run_command".into(), input: serde_json::json!({"command": "pwd"}) },
        ];
        let blocked = detect_blocked_commands(&calls, 5);
        assert_eq!(blocked, vec![0, 2]);
    }

    // -- apply_cmd_failure_tracking ------------------------------------------

    #[test]
    fn test_apply_cmd_failure_tracking_increments_on_run_command_error() {
        let calls = vec![
            ToolCall { id: "t1".into(), name: "run_command".into(), input: serde_json::json!({"command": "bad"}) },
        ];
        let results = vec![ToolCallResult {
            tool_use_id: "t1".into(),
            content: "command not found".into(),
            is_error: true,
            stop_loop: false,
        }];
        let mut failures = 0;
        apply_cmd_failure_tracking(&calls, results, &mut failures);
        assert_eq!(failures, 1);
    }

    #[test]
    fn test_apply_cmd_failure_tracking_resets_on_success() {
        let calls = vec![
            ToolCall { id: "t1".into(), name: "read_file".into(), input: serde_json::json!({"path": "a.rs"}) },
        ];
        let results = vec![ToolCallResult {
            tool_use_id: "t1".into(),
            content: "file content".into(),
            is_error: false,
            stop_loop: false,
        }];
        let mut failures = 3;
        apply_cmd_failure_tracking(&calls, results, &mut failures);
        assert_eq!(failures, 0);
    }

    #[test]
    fn test_apply_cmd_failure_tracking_appends_warning_at_3_plus() {
        let calls = vec![
            ToolCall { id: "t1".into(), name: "run_command".into(), input: serde_json::json!({"command": "bad"}) },
        ];
        let results = vec![ToolCallResult {
            tool_use_id: "t1".into(),
            content: "command not found".into(),
            is_error: true,
            stop_loop: false,
        }];
        let mut failures = 2;
        let updated = apply_cmd_failure_tracking(&calls, results, &mut failures);
        assert_eq!(failures, 3);
        assert!(updated[0].content.contains("WARNING"), "should append warning at 3 consecutive failures");
        assert!(updated[0].content.contains("3 consecutive"));
    }

    #[test]
    fn test_apply_cmd_failure_tracking_does_not_modify_non_error() {
        let calls = vec![
            ToolCall { id: "t1".into(), name: "run_command".into(), input: serde_json::json!({"command": "ls"}) },
        ];
        let results = vec![ToolCallResult {
            tool_use_id: "t1".into(),
            content: "file1 file2".into(),
            is_error: false,
            stop_loop: false,
        }];
        let mut failures = 2;
        let updated = apply_cmd_failure_tracking(&calls, results, &mut failures);
        assert_eq!(updated[0].content, "file1 file2");
        assert_eq!(failures, 0);
    }

    // -- detect_same_target_stall --------------------------------------------

    #[test]
    fn test_detect_same_target_stall_triggers_after_three_no_progress_rounds() {
        let calls = vec![ToolCall {
            id: "e1".into(),
            name: "edit_file".into(),
            input: serde_json::json!({"path": "src/lib.rs"}),
        }];
        let results = vec![ToolCallResult {
            tool_use_id: "e1".into(),
            content: "failed".into(),
            is_error: true,
            stop_loop: false,
        }];
        let mut signature = None;
        let mut streak = 0usize;

        assert!(!detect_same_target_stall(&calls, &results, &mut signature, &mut streak));
        assert_eq!(streak, 1);
        assert!(!detect_same_target_stall(&calls, &results, &mut signature, &mut streak));
        assert_eq!(streak, 2);
        assert!(detect_same_target_stall(&calls, &results, &mut signature, &mut streak));
        assert_eq!(streak, 3);
    }

    #[test]
    fn test_detect_same_target_stall_resets_on_success() {
        let calls = vec![ToolCall {
            id: "e1".into(),
            name: "edit_file".into(),
            input: serde_json::json!({"path": "src/lib.rs"}),
        }];
        let fail = vec![ToolCallResult {
            tool_use_id: "e1".into(),
            content: "failed".into(),
            is_error: true,
            stop_loop: false,
        }];
        let ok = vec![ToolCallResult {
            tool_use_id: "e1".into(),
            content: "ok".into(),
            is_error: false,
            stop_loop: false,
        }];
        let mut signature = None;
        let mut streak = 0usize;

        assert!(!detect_same_target_stall(&calls, &fail, &mut signature, &mut streak));
        assert_eq!(streak, 1);
        assert!(!detect_same_target_stall(&calls, &ok, &mut signature, &mut streak));
        assert_eq!(streak, 0, "successful write should reset stall tracking");
    }

    #[test]
    fn test_detect_same_target_stall_resets_on_edit_file_success() {
        let calls = vec![ToolCall {
            id: "e1".into(),
            name: "edit_file".into(),
            input: serde_json::json!({"path": "src/lib.rs", "old_text": "a", "new_text": "b"}),
        }];
        let fail = vec![ToolCallResult {
            tool_use_id: "e1".into(), content: "failed".into(), is_error: true, stop_loop: false,
        }];
        let ok = vec![ToolCallResult {
            tool_use_id: "e1".into(), content: "ok".into(), is_error: false, stop_loop: false,
        }];
        let mut sig = None;
        let mut streak = 0usize;

        detect_same_target_stall(&calls, &fail, &mut sig, &mut streak);
        assert_eq!(streak, 1);
        detect_same_target_stall(&calls, &fail, &mut sig, &mut streak);
        assert_eq!(streak, 2);

        detect_same_target_stall(&calls, &ok, &mut sig, &mut streak);
        assert_eq!(streak, 0, "successful edit_file should reset streak");
    }

    #[test]
    fn test_detect_same_target_stall_different_write_content_resets() {
        let calls1 = vec![ToolCall {
            id: "w1".into(), name: "write_file".into(),
            input: serde_json::json!({"path": "a.rs", "content": "version 1"}),
        }];
        let calls2 = vec![ToolCall {
            id: "w2".into(), name: "write_file".into(),
            input: serde_json::json!({"path": "a.rs", "content": "version 2"}),
        }];
        let ok = vec![ToolCallResult {
            tool_use_id: "w1".into(), content: "ok".into(), is_error: false, stop_loop: false,
        }];
        let ok2 = vec![ToolCallResult {
            tool_use_id: "w2".into(), content: "ok".into(), is_error: false, stop_loop: false,
        }];
        let mut sig = None;
        let mut streak = 0usize;

        detect_same_target_stall(&calls1, &ok, &mut sig, &mut streak);
        assert_eq!(streak, 0);
        detect_same_target_stall(&calls2, &ok2, &mut sig, &mut streak);
        assert_eq!(streak, 0, "different content should not increment streak");
    }

    #[test]
    fn test_detect_same_target_stall_no_writes_resets() {
        let calls_write = vec![ToolCall {
            id: "e1".into(), name: "edit_file".into(),
            input: serde_json::json!({"path": "a.rs", "old_text": "x", "new_text": "y"}),
        }];
        let fail = vec![ToolCallResult {
            tool_use_id: "e1".into(), content: "failed".into(), is_error: true, stop_loop: false,
        }];
        let mut sig = None;
        let mut streak = 0usize;
        detect_same_target_stall(&calls_write, &fail, &mut sig, &mut streak);
        assert_eq!(streak, 1);

        let calls_read = vec![ToolCall {
            id: "r1".into(), name: "read_file".into(),
            input: serde_json::json!({"path": "b.rs"}),
        }];
        let ok = vec![ToolCallResult {
            tool_use_id: "r1".into(), content: "data".into(), is_error: false, stop_loop: false,
        }];
        detect_same_target_stall(&calls_read, &ok, &mut sig, &mut streak);
        assert_eq!(streak, 0, "non-write/edit calls should reset streak");
    }

    #[test]
    fn test_detect_same_target_stall_mixed_write_edit_same_batch() {
        let calls = vec![
            ToolCall { id: "w1".into(), name: "write_file".into(),
                input: serde_json::json!({"path": "a.rs", "content": "x"}) },
            ToolCall { id: "e1".into(), name: "edit_file".into(),
                input: serde_json::json!({"path": "a.rs", "old_text": "a", "new_text": "b"}) },
        ];
        let results = vec![
            ToolCallResult { tool_use_id: "w1".into(), content: "failed".into(), is_error: true, stop_loop: false },
            ToolCallResult { tool_use_id: "e1".into(), content: "ok".into(), is_error: false, stop_loop: false },
        ];
        let mut sig = None;
        let mut streak = 0usize;

        let stalled = detect_same_target_stall(&calls, &results, &mut sig, &mut streak);
        assert!(!stalled);
        assert_eq!(streak, 0, "successful edit in mixed batch should reset streak");
    }
}

// ===========================================================================
// Tool result blocks and serialization tests
// ===========================================================================

mod tool_result_tests {
    use super::*;

    // -- build_tool_result_blocks --------------------------------------------

    #[test]
    fn test_build_tool_result_blocks_emits_events() {
        let (event_tx, mut event_rx) = mpsc::unbounded_channel();
        let calls = vec![
            ToolCall { id: "t1".into(), name: "read_file".into(), input: serde_json::json!({"path": "a.rs"}) },
            ToolCall { id: "t2".into(), name: "do_thing".into(), input: serde_json::json!({}) },
        ];
        let results = vec![
            ToolCallResult { tool_use_id: "t1".into(), content: "fn main()".into(), is_error: false, stop_loop: false },
            ToolCallResult { tool_use_id: "t2".into(), content: "ok".into(), is_error: false, stop_loop: false },
        ];
        let mut cache = HashMap::new();

        let (blocks, should_stop) = build_tool_result_blocks(&calls, &results, &mut cache, &event_tx);
        assert_eq!(blocks.len(), 2);
        assert!(!should_stop);

        let mut event_count = 0;
        while let Ok(ToolLoopEvent::ToolResult { .. }) = event_rx.try_recv() {
            event_count += 1;
        }
        assert_eq!(event_count, 2);
    }

    #[test]
    fn test_build_tool_result_blocks_should_stop_on_stop_loop() {
        let (event_tx, _) = mpsc::unbounded_channel();
        let calls = vec![
            ToolCall { id: "t1".into(), name: "task_done".into(), input: serde_json::json!({}) },
        ];
        let results = vec![
            ToolCallResult { tool_use_id: "t1".into(), content: "done".into(), is_error: false, stop_loop: true },
        ];
        let mut cache = HashMap::new();

        let (_, should_stop) = build_tool_result_blocks(&calls, &results, &mut cache, &event_tx);
        assert!(should_stop);
    }

    #[test]
    fn test_build_tool_result_blocks_duplicate_read_returns_stop_message() {
        let (event_tx, _) = mpsc::unbounded_channel();
        let calls = vec![
            ToolCall { id: "t1".into(), name: "read_file".into(), input: serde_json::json!({"path": "a.rs"}) },
        ];
        let results = vec![
            ToolCallResult { tool_use_id: "t1".into(), content: "fn main() {}".into(), is_error: false, stop_loop: false },
        ];
        let mut cache = HashMap::new();

        build_tool_result_blocks(&calls, &results, &mut cache, &event_tx);
        let calls2 = vec![
            ToolCall { id: "t2".into(), name: "read_file".into(), input: serde_json::json!({"path": "a.rs"}) },
        ];
        let results2 = vec![
            ToolCallResult { tool_use_id: "t2".into(), content: "fn main() {}".into(), is_error: false, stop_loop: false },
        ];
        let (blocks, _) = build_tool_result_blocks(&calls2, &results2, &mut cache, &event_tx);

        let content = match &blocks[0] {
            ContentBlock::ToolResult { content, .. } => content.clone(),
            _ => String::new(),
        };
        assert!(content.contains("STOP: File already read"), "duplicate read should return STOP message");
    }

    #[test]
    fn test_build_tool_result_blocks_write_invalidates_cache() {
        let (event_tx, _) = mpsc::unbounded_channel();
        let calls = vec![
            ToolCall { id: "t1".into(), name: "read_file".into(), input: serde_json::json!({"path": "a.rs"}) },
        ];
        let results = vec![
            ToolCallResult { tool_use_id: "t1".into(), content: "old content".into(), is_error: false, stop_loop: false },
        ];
        let mut cache = HashMap::new();
        build_tool_result_blocks(&calls, &results, &mut cache, &event_tx);
        assert!(cache.contains_key("a.rs"));

        let write_calls = vec![
            ToolCall { id: "w1".into(), name: "write_file".into(), input: serde_json::json!({"path": "a.rs", "content": "new content"}) },
        ];
        let write_results = vec![
            ToolCallResult { tool_use_id: "w1".into(), content: "ok".into(), is_error: false, stop_loop: false },
        ];
        build_tool_result_blocks(&write_calls, &write_results, &mut cache, &event_tx);
        assert!(!cache.contains_key("a.rs"), "write_file should invalidate read cache");
    }

    #[test]
    fn test_build_tool_result_blocks_edit_invalidates_cache() {
        let (event_tx, _) = mpsc::unbounded_channel();
        let mut cache = HashMap::new();
        cache.insert("a.rs".to_string(), 12345u64);

        let edit_calls = vec![
            ToolCall { id: "e1".into(), name: "edit_file".into(), input: serde_json::json!({"path": "a.rs"}) },
        ];
        let edit_results = vec![
            ToolCallResult { tool_use_id: "e1".into(), content: "ok".into(), is_error: false, stop_loop: false },
        ];
        build_tool_result_blocks(&edit_calls, &edit_results, &mut cache, &event_tx);
        assert!(!cache.contains_key("a.rs"), "edit_file should invalidate read cache");
    }

    // -- summarize_write_file_input ------------------------------------------

    #[test]
    fn test_summarize_write_file_input_short_content_unchanged() {
        let input = serde_json::json!({"path": "a.rs", "content": "fn main() {}"});
        let summary = summarize_write_file_input(&input);
        assert_eq!(summary["content"].as_str().unwrap(), "fn main() {}");
        assert_eq!(summary["path"].as_str().unwrap(), "a.rs");
    }

    #[test]
    fn test_summarize_write_file_input_long_content_truncated() {
        let lines: Vec<String> = (0..50).map(|i| format!("line {i}")).collect();
        let content = lines.join("\n");
        let input = serde_json::json!({"path": "big.rs", "content": content});
        let summary = summarize_write_file_input(&input);
        let summarized = summary["content"].as_str().unwrap();
        assert!(summarized.contains("CONTEXT COMPACTED"));
        assert!(summarized.contains("big.rs"));
        assert!(summarized.contains("line 0"));
        assert!(summarized.contains("line 49"));
    }

    // -- looks_truncated -----------------------------------------------------

    #[test]
    fn test_looks_truncated_short_content_never_truncated() {
        assert!(!looks_truncated("short"));
        assert!(!looks_truncated("a { b }"));
        assert!(!looks_truncated(""));
    }

    #[test]
    fn test_looks_truncated_balanced_braces_not_truncated() {
        let content = format!("{}{}", "x".repeat(200), "fn main() { let x = { 1 }; }");
        assert!(!looks_truncated(&content));
    }

    #[test]
    fn test_looks_truncated_significantly_unbalanced_braces() {
        let content = format!("{}fn main() {{{{ {{{{ {{{{\n", "x".repeat(200));
        assert!(looks_truncated(&content));
    }

    #[test]
    fn test_looks_truncated_content_ending_abruptly() {
        let content = format!("{}let x = some_func(", "x".repeat(200));
        assert!(looks_truncated(&content));
    }

    #[test]
    fn test_looks_truncated_content_ending_with_brace_ok() {
        let content = format!("{}}}", "x".repeat(200));
        assert!(!looks_truncated(&content));
    }

    #[test]
    fn test_looks_truncated_content_ending_with_newline_ok() {
        let content = format!("{}\n", "x".repeat(200));
        assert!(!looks_truncated(&content));
    }

    #[test]
    fn test_looks_truncated_content_ending_with_semicolon_ok() {
        let content = format!("{};", "x".repeat(200));
        assert!(!looks_truncated(&content));
    }
}

// ===========================================================================
// Token accumulation and credit budget tests
// ===========================================================================

mod budget_tests {
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

        let result = run_tool_loop(
            llm, "test-key", "test", vec![RichMessage::user("go")],
            Arc::from(Vec::<ToolDefinition>::new()), &config, &executor, &event_tx,
        ).await;

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

        let _result = run_tool_loop(
            llm, "test-key", "test", vec![RichMessage::user("go")],
            Arc::from(Vec::<ToolDefinition>::new()), &config, &executor, &event_tx,
        ).await;

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

        let result = run_tool_loop(
            llm, "test-key", "test", vec![RichMessage::user("go")],
            Arc::from(Vec::<ToolDefinition>::new()), &config, &executor, &event_tx,
        ).await;

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

        let result = run_tool_loop(
            llm, "test-key", "test", vec![RichMessage::user("go")],
            Arc::from(Vec::<ToolDefinition>::new()), &config, &executor, &event_tx,
        ).await;

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

        let state = Arc::new(tokio::sync::Mutex::new(MockBillingState::new(100)));
        let mock = Arc::new(MockLlmProvider::with_responses(vec![
            MockResponse::tool_use(vec![ToolCall {
                id: "t0".into(),
                name: "do_thing".into(),
                input: serde_json::json!({}),
            }]).with_tokens(10_000, 5_000),
            MockResponse::tool_use(vec![ToolCall {
                id: "t1".into(),
                name: "do_thing".into(),
                input: serde_json::json!({}),
            }]).with_tokens(10_000, 5_000),
            MockResponse::text("unreachable").with_tokens(50, 20),
        ]));

        let (llm, _tmp) = make_test_llm_stateful(mock, state).await;
        let (event_tx, _) = mpsc::unbounded_channel();
        let config = default_config(10);
        let executor = ok_executor();

        let result = run_tool_loop(
            llm, "test-key", "test", vec![RichMessage::user("go")],
            Arc::from(Vec::<ToolDefinition>::new()), &config, &executor, &event_tx,
        ).await;

        assert!(result.insufficient_credits, "should flag insufficient_credits");
        assert!(result.iterations_run >= 1, "at least 1 iteration should have run");
    }
}
