use super::*;
use std::collections::HashMap;
use std::time::Duration;
use async_trait::async_trait;
use aura_claude::mock::{MockLlmProvider, MockResponse};
use aura_billing::testutil;
use crate::tool_loop_helpers::{detect_blocked_reads, detect_blocked_exploration, detect_blocked_write_failures};

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

#[test]
fn test_detect_blocked_reads_allows_first_two() {
    let mut counts: HashMap<String, usize> = HashMap::new();
    let calls = vec![
        ToolCall { id: "t1".into(), name: "read_file".into(), input: serde_json::json!({"path": "src/lib.rs"}) },
    ];

    let blocked = detect_blocked_reads(&calls, &mut counts);
    assert!(blocked.is_empty(), "1st read should not be blocked");
    assert_eq!(counts["src/lib.rs"], 1);

    let blocked = detect_blocked_reads(&calls, &mut counts);
    assert!(blocked.is_empty(), "2nd read should not be blocked");
    assert_eq!(counts["src/lib.rs"], 2);
}

#[test]
fn test_detect_blocked_reads_blocks_third() {
    let mut counts: HashMap<String, usize> = HashMap::new();
    let calls = vec![
        ToolCall { id: "t1".into(), name: "read_file".into(), input: serde_json::json!({"path": "src/lib.rs"}) },
    ];

    detect_blocked_reads(&calls, &mut counts);
    detect_blocked_reads(&calls, &mut counts);
    let blocked = detect_blocked_reads(&calls, &mut counts);
    assert_eq!(blocked, vec![0], "3rd read of same file should be blocked");
    assert_eq!(counts["src/lib.rs"], 3);
}

#[test]
fn test_detect_blocked_reads_different_files_independent() {
    let mut counts: HashMap<String, usize> = HashMap::new();
    let calls_a = vec![
        ToolCall { id: "t1".into(), name: "read_file".into(), input: serde_json::json!({"path": "a.rs"}) },
    ];
    let calls_b = vec![
        ToolCall { id: "t2".into(), name: "read_file".into(), input: serde_json::json!({"path": "b.rs"}) },
    ];

    detect_blocked_reads(&calls_a, &mut counts);
    detect_blocked_reads(&calls_a, &mut counts);
    detect_blocked_reads(&calls_b, &mut counts);

    assert_eq!(counts["a.rs"], 2);
    assert_eq!(counts["b.rs"], 1);

    let blocked_a = detect_blocked_reads(&calls_a, &mut counts);
    assert_eq!(blocked_a, vec![0], "3rd read of a.rs should be blocked");

    let blocked_b = detect_blocked_reads(&calls_b, &mut counts);
    assert!(blocked_b.is_empty(), "2nd read of b.rs should not be blocked");
}

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
        // Now at 12 calls, exploration blocked. LLM writes:
        MockResponse::tool_use(vec![
            ToolCall { id: "w1".into(), name: "write_file".into(), input: serde_json::json!({"path": "out.rs", "content": "done"}) },
        ]).with_tokens(50, 30),
        // After write, 4 more reads should be allowed:
        MockResponse::tool_use(vec![
            ToolCall { id: "r13".into(), name: "read_file".into(), input: serde_json::json!({"path": "f13.rs"}) },
        ]).with_tokens(50, 30),
        MockResponse::text("Done").with_tokens(50, 30),
    ];

    let mock = Arc::new(MockLlmProvider::with_responses(responses));
    let (llm, _tmp) = testutil::make_test_llm(mock).await;
    let (event_tx, mut event_rx) = mpsc::unbounded_channel();
    let config = default_config(20);

    let executor = SimpleExecutor {
        handler: Box::new(|calls| {
            calls.iter().map(|tc| ToolCallResult {
                tool_use_id: tc.id.clone(),
                content: "ok".into(),
                is_error: false,
                stop_loop: false,
            }).collect()
        }),
    };

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

#[tokio::test]
async fn test_write_failure_tracking_blocks_after_repeated_errors() {
    // Each batch pairs an edit_file with a do_thing so the consecutive-write
    // tracker resets, isolating the per-file failure tracker.
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
