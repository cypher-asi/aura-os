#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::time::Duration;

    use async_trait::async_trait;
    use tokio::sync::Mutex;

    use crate::{
        AgentRuntime, BuildBaseline, ContentBlock, ImageSource, Message,
        MessageContent, Role, RuntimeError, ThinkingConfig, ToolCall, ToolCallResult,
        ToolDefinition, ToolExecutor, TotalUsage, TurnConfig, TurnRequest, TurnResult,
    };

    // ── Mock implementations ───────────────────────────────────────────

    struct MockRuntime {
        result: Mutex<Option<Result<TurnResult, RuntimeError>>>,
    }

    impl MockRuntime {
        fn ok(result: TurnResult) -> Self {
            Self {
                result: Mutex::new(Some(Ok(result))),
            }
        }

        fn err(error: RuntimeError) -> Self {
            Self {
                result: Mutex::new(Some(Err(error))),
            }
        }
    }

    #[async_trait]
    impl AgentRuntime for MockRuntime {
        async fn execute_turn(&self, _request: TurnRequest) -> Result<TurnResult, RuntimeError> {
            self.result
                .lock()
                .await
                .take()
                .expect("MockRuntime already consumed")
        }
    }

    struct MockExecutor {
        results: Mutex<Vec<ToolCallResult>>,
    }

    impl MockExecutor {
        fn new(results: Vec<ToolCallResult>) -> Self {
            Self {
                results: Mutex::new(results),
            }
        }
    }

    #[async_trait]
    impl ToolExecutor for MockExecutor {
        async fn execute(&self, _tool_calls: &[ToolCall]) -> Vec<ToolCallResult> {
            std::mem::take(&mut *self.results.lock().await)
        }
    }

    // ── Helpers ────────────────────────────────────────────────────────

    fn default_turn_config() -> TurnConfig {
        TurnConfig {
            max_iterations: 5,
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

    fn make_turn_request(executor: Arc<dyn ToolExecutor>) -> TurnRequest {
        TurnRequest {
            system_prompt: "You are a test assistant.".into(),
            messages: vec![Message::user("hello")],
            tools: Arc::from(vec![]),
            executor,
            config: default_turn_config(),
            event_tx: None,
            auth_token: None,
        }
    }

    fn sample_turn_result() -> TurnResult {
        TurnResult {
            text: "done".into(),
            thinking: String::new(),
            usage: TotalUsage {
                input_tokens: 100,
                output_tokens: 50,
            },
            iterations_run: 1,
            timed_out: false,
            insufficient_credits: false,
            llm_error: None,
        }
    }

    // ── AgentRuntime tests ─────────────────────────────────────────────

    #[tokio::test]
    async fn mock_runtime_returns_turn_result() {
        let rt = MockRuntime::ok(sample_turn_result());
        let executor: Arc<dyn ToolExecutor> = Arc::new(MockExecutor::new(vec![]));
        let req = make_turn_request(executor);

        let result = rt.execute_turn(req).await.unwrap();
        assert_eq!(result.text, "done");
        assert_eq!(result.usage.input_tokens, 100);
        assert_eq!(result.usage.output_tokens, 50);
        assert_eq!(result.iterations_run, 1);
        assert!(!result.timed_out);
    }

    #[tokio::test]
    async fn mock_runtime_returns_error() {
        let rt = MockRuntime::err(RuntimeError::Provider("model overloaded".into()));
        let executor: Arc<dyn ToolExecutor> = Arc::new(MockExecutor::new(vec![]));
        let req = make_turn_request(executor);

        let err = rt.execute_turn(req).await.unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("model overloaded"), "got: {msg}");
    }

    // ── ToolExecutor tests ─────────────────────────────────────────────

    #[tokio::test]
    async fn mock_executor_returns_configured_results() {
        let results = vec![
            ToolCallResult {
                tool_use_id: "t1".into(),
                content: "file written".into(),
                is_error: false,
                stop_loop: false,
            },
            ToolCallResult {
                tool_use_id: "t2".into(),
                content: "command failed".into(),
                is_error: true,
                stop_loop: true,
            },
        ];
        let executor = MockExecutor::new(results);
        let calls = vec![ToolCall {
            id: "t1".into(),
            name: "write".into(),
            input: serde_json::json!({"path": "a.rs"}),
        }];

        let out = executor.execute(&calls).await;
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].tool_use_id, "t1");
        assert!(!out[0].is_error);
        assert!(out[1].is_error);
        assert!(out[1].stop_loop);
    }

    #[tokio::test]
    async fn mock_executor_auto_build_default_is_none() {
        let executor = MockExecutor::new(vec![]);
        assert!(executor.auto_build_check().await.is_none());
    }

    #[tokio::test]
    async fn mock_executor_capture_baseline_default_is_none() {
        let executor = MockExecutor::new(vec![]);
        assert!(executor.capture_build_baseline().await.is_none());
    }

    // ── Serde round-trip tests ─────────────────────────────────────────

    #[test]
    fn role_serde_roundtrip() {
        for role in [Role::User, Role::Assistant] {
            let json = serde_json::to_string(&role).unwrap();
            let back: Role = serde_json::from_str(&json).unwrap();
            assert_eq!(role, back);
        }
    }

    #[test]
    fn message_text_serde_roundtrip() {
        let msg = Message::user("hello world");
        let json = serde_json::to_string(&msg).unwrap();
        let back: Message = serde_json::from_str(&json).unwrap();
        assert!(matches!(back.role, Role::User));
        assert!(matches!(back.content, MessageContent::Text(ref t) if t == "hello world"));
    }

    #[test]
    fn message_blocks_serde_roundtrip() {
        let msg = Message::assistant_blocks(vec![
            ContentBlock::Text {
                text: "hi".into(),
            },
            ContentBlock::ToolUse {
                id: "tu1".into(),
                name: "read".into(),
                input: serde_json::json!({"path": "f.rs"}),
            },
        ]);
        let json = serde_json::to_string(&msg).unwrap();
        let back: Message = serde_json::from_str(&json).unwrap();
        match back.content {
            MessageContent::Blocks(blocks) => {
                assert_eq!(blocks.len(), 2);
                assert!(matches!(&blocks[0], ContentBlock::Text { text } if text == "hi"));
            }
            _ => panic!("expected Blocks"),
        }
    }

    #[test]
    fn content_block_tool_result_serde_roundtrip() {
        let block = ContentBlock::ToolResult {
            tool_use_id: "tu1".into(),
            content: "ok".into(),
            is_error: Some(false),
        };
        let json = serde_json::to_string(&block).unwrap();
        let back: ContentBlock = serde_json::from_str(&json).unwrap();
        match back {
            ContentBlock::ToolResult {
                tool_use_id,
                content,
                is_error,
            } => {
                assert_eq!(tool_use_id, "tu1");
                assert_eq!(content, "ok");
                assert_eq!(is_error, Some(false));
            }
            _ => panic!("expected ToolResult"),
        }
    }

    #[test]
    fn tool_definition_serde_roundtrip() {
        let td = ToolDefinition {
            name: "search".into(),
            description: "Search files".into(),
            input_schema: serde_json::json!({"type": "object"}),
            cache_control: None,
        };
        let json = serde_json::to_string(&td).unwrap();
        let back: ToolDefinition = serde_json::from_str(&json).unwrap();
        assert_eq!(back.name, "search");
        assert!(back.cache_control.is_none());
    }

    #[test]
    fn tool_call_serde_roundtrip() {
        let tc = ToolCall {
            id: "call_1".into(),
            name: "bash".into(),
            input: serde_json::json!({"cmd": "ls"}),
        };
        let json = serde_json::to_string(&tc).unwrap();
        let back: ToolCall = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, "call_1");
        assert_eq!(back.name, "bash");
        assert_eq!(back.input["cmd"], "ls");
    }

    #[test]
    fn thinking_config_serde_roundtrip() {
        let tc = ThinkingConfig::enabled(10_000);
        let json = serde_json::to_string(&tc).unwrap();
        let back: ThinkingConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back.thinking_type, "enabled");
        assert_eq!(back.budget_tokens, 10_000);
    }

    #[test]
    fn image_source_serde_roundtrip() {
        let src = ImageSource {
            source_type: "base64".into(),
            media_type: "image/png".into(),
            data: "abc123==".into(),
        };
        let json = serde_json::to_string(&src).unwrap();
        let back: ImageSource = serde_json::from_str(&json).unwrap();
        assert_eq!(back.source_type, "base64");
        assert_eq!(back.media_type, "image/png");
    }

    // ── BuildBaseline tests ────────────────────────────────────────────

    #[test]
    fn extract_signatures_finds_error_blocks() {
        let stderr = "\
error[E0308]: mismatched types
 --> src/main.rs:10:5
  |
10|     let x: u32 = \"hello\";
  |                  ^^^^^^^ expected `u32`, found `&str`

error[E0599]: no method named `foo` found
 --> src/lib.rs:20:10
  |
20|     x.foo();
  |       ^^^ method not found
";
        let sigs = BuildBaseline::extract_signatures(stderr);
        assert_eq!(sigs.len(), 2, "expected 2 error blocks, got {}", sigs.len());
    }

    #[test]
    fn extract_signatures_empty_for_clean_output() {
        let sigs = BuildBaseline::extract_signatures("Compiling my_crate v0.1.0\n    Finished");
        assert!(sigs.is_empty());
    }

    #[test]
    fn annotate_labels_preexisting_vs_new() {
        let baseline_stderr = "\
error[E0308]: mismatched types
 --> src/main.rs:10:5
";
        let baseline = BuildBaseline {
            error_signatures: BuildBaseline::extract_signatures(baseline_stderr),
        };

        let current = "\
error[E0308]: mismatched types
 --> src/main.rs:10:5

error[E0599]: no method named `bar`
 --> src/lib.rs:30:10
";
        let annotated = baseline.annotate(current);
        assert!(
            annotated.contains("PRE-EXISTING"),
            "should mention pre-existing errors"
        );
        assert!(
            annotated.contains("NEW"),
            "should mention new errors"
        );
    }

    #[test]
    fn annotate_passthrough_when_no_baseline() {
        let baseline = BuildBaseline::default();
        let output = "error[E0308]: something\n";
        assert_eq!(baseline.annotate(output), output);
    }

    #[test]
    fn annotate_passthrough_when_no_current_errors() {
        let baseline = BuildBaseline {
            error_signatures: vec!["sig".into()],
        };
        let output = "Compiling ok\n    Finished";
        assert_eq!(baseline.annotate(output), output);
    }

    // ── RuntimeError display tests ─────────────────────────────────────

    #[test]
    fn runtime_error_display_provider() {
        let e = RuntimeError::Provider("timeout".into());
        assert_eq!(e.to_string(), "provider error: timeout");
    }

    #[test]
    fn runtime_error_display_tool_execution() {
        let e = RuntimeError::ToolExecution("permission denied".into());
        assert_eq!(e.to_string(), "tool execution error: permission denied");
    }

    #[test]
    fn runtime_error_display_budget_exhausted() {
        let e = RuntimeError::BudgetExhausted("max iterations".into());
        assert_eq!(e.to_string(), "turn budget exhausted: max iterations");
    }

    #[test]
    fn runtime_error_display_insufficient_credits() {
        let e = RuntimeError::InsufficientCredits;
        assert_eq!(e.to_string(), "insufficient credits");
    }

    #[test]
    fn runtime_error_display_internal() {
        let e = RuntimeError::Internal("oops".into());
        assert_eq!(e.to_string(), "internal error: oops");
    }

    // ── TurnRequest construction test ──────────────────────────────────

    #[tokio::test]
    async fn turn_request_all_fields() {
        let executor: Arc<dyn ToolExecutor> = Arc::new(MockExecutor::new(vec![]));
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
        let tools: Arc<[ToolDefinition]> = Arc::from(vec![ToolDefinition {
            name: "bash".into(),
            description: "run shell".into(),
            input_schema: serde_json::json!({}),
            cache_control: None,
        }]);

        let req = TurnRequest {
            system_prompt: "sys".into(),
            messages: vec![Message::user("hi"), Message::assistant_text("hey")],
            tools: tools.clone(),
            executor,
            config: TurnConfig {
                max_iterations: 10,
                max_tokens: 8192,
                thinking: Some(ThinkingConfig::enabled(5000)),
                stream_timeout: Duration::from_secs(60),
                max_context_tokens: Some(100_000),
                model_override: Some("fast-model".into()),
                exploration_allowance: Some(3),
                auto_build_cooldown: Some(2),
                credit_budget: None,
                billing_reason: None,
            },
            event_tx: Some(tx),
            auth_token: None,
        };

        assert_eq!(req.system_prompt, "sys");
        assert_eq!(req.messages.len(), 2);
        assert_eq!(req.tools.len(), 1);
        assert_eq!(req.config.max_iterations, 10);
        assert!(req.config.thinking.is_some());
        assert!(req.event_tx.is_some());
    }

    // ── TotalUsage default test ────────────────────────────────────────

    #[test]
    fn total_usage_default_is_zeroed() {
        let usage = TotalUsage::default();
        assert_eq!(usage.input_tokens, 0);
        assert_eq!(usage.output_tokens, 0);
    }

    // ── CacheControl helper test ───────────────────────────────────────

    #[test]
    fn cache_control_ephemeral() {
        let cc = crate::CacheControl::ephemeral();
        assert_eq!(cc.cache_type, "ephemeral");
        let json = serde_json::to_string(&cc).unwrap();
        assert!(json.contains("ephemeral"));
    }
}
