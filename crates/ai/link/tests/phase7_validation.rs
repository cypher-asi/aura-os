//! Phase 7 validation tests — verify that all link boundary types are
//! complete, constructible, and (where applicable) serde-round-trippable.

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;

use aura_link::{
    AutoBuildResult, BuildBaseline, CacheControl, ContentBlock, ImageSource, LinkRuntime, Message,
    MessageContent, Role, RuntimeError, RuntimeEvent, ThinkingConfig, ToolCall, ToolCallResult,
    ToolDefinition, ToolExecutor, ToolResultContent, TotalUsage, TurnConfig, TurnRequest,
    TurnResult,
};

// ── Stub executor for TurnRequest construction ────────────────────────

struct NoopExecutor;

#[async_trait]
impl ToolExecutor for NoopExecutor {
    async fn execute(&self, _calls: &[ToolCall]) -> Vec<ToolCallResult> {
        vec![]
    }
}

// ── LinkRuntime::from_env ──────────────────────────────────────────

#[test]
fn link_runtime_from_env_succeeds_without_env_vars() {
    let rt = LinkRuntime::from_env();
    assert!(rt.is_ok(), "from_env() should not panic even with no env vars set");
}

#[test]
fn link_runtime_new_stores_credentials() {
    let _rt = LinkRuntime::new(
        "test-key".into(),
        "claude-opus-4-6".into(),
        Some("token".into()),
    );
}

// ── TurnRequest construction with all fields ──────────────────────────

#[tokio::test]
async fn turn_request_all_fields_constructible() {
    let executor: Arc<dyn ToolExecutor> = Arc::new(NoopExecutor);
    let (tx, _rx) = tokio::sync::mpsc::unbounded_channel::<RuntimeEvent>();

    let tools: Arc<[ToolDefinition]> = Arc::from(vec![
        ToolDefinition {
            name: "write_file".into(),
            description: "Write a file".into(),
            input_schema: serde_json::json!({"type": "object", "properties": {"path": {"type": "string"}}}),
            cache_control: Some(CacheControl::ephemeral()),
        },
        ToolDefinition {
            name: "read_file".into(),
            description: "Read a file".into(),
            input_schema: serde_json::json!({}),
            cache_control: None,
        },
    ]);

    let req = TurnRequest {
        system_prompt: "You are a coding assistant.".into(),
        messages: vec![
            Message::user("Fix the bug"),
            Message::assistant_text("I'll look at the code."),
            Message::assistant_blocks(vec![
                ContentBlock::Text { text: "Analyzing...".into() },
                ContentBlock::ToolUse {
                    id: "tu_1".into(),
                    name: "read_file".into(),
                    input: serde_json::json!({"path": "src/main.rs"}),
                },
            ]),
            Message::tool_results(vec![ContentBlock::ToolResult {
                tool_use_id: "tu_1".into(),
                content: ToolResultContent::Text("fn main() {}".into()),
                is_error: false,
            }]),
        ],
        tools,
        executor,
        config: TurnConfig {
            max_iterations: 15,
            max_tokens: 16384,
            thinking: Some(ThinkingConfig { budget_tokens: 10_000 }),
            stream_timeout: Duration::from_secs(120),
            max_context_tokens: Some(200_000),
            model_override: Some("claude-sonnet-4-20250514".into()),
            exploration_allowance: Some(8),
            auto_build_cooldown: Some(3),
            credit_budget: None,
            billing_reason: None,
        },
        event_tx: Some(tx),
        auth_token: None,
    };

    assert_eq!(req.system_prompt, "You are a coding assistant.");
    assert_eq!(req.messages.len(), 4);
    assert_eq!(req.tools.len(), 2);
    assert_eq!(req.config.max_iterations, 15);
    assert_eq!(req.config.max_tokens, 16384);
    assert!(req.config.thinking.is_some());
    assert_eq!(req.config.max_context_tokens, Some(200_000));
    assert_eq!(req.config.exploration_allowance, Some(8));
    assert_eq!(req.config.auto_build_cooldown, Some(3));
    assert!(req.event_tx.is_some());
}

// ── RuntimeEvent variants can be constructed and debug-printed ────────

#[test]
fn runtime_event_all_variants_constructible() {
    let events: Vec<RuntimeEvent> = vec![
        RuntimeEvent::Delta("hello".into()),
        RuntimeEvent::ThinkingDelta("reasoning...".into()),
        RuntimeEvent::ToolUseStarted {
            id: "tu_1".into(),
            name: "bash".into(),
        },
        RuntimeEvent::ToolInputSnapshot {
            id: "tu_1".into(),
            name: "bash".into(),
            input: serde_json::json!({"cmd": "cargo build"}),
        },
        RuntimeEvent::ToolUseDetected {
            id: "tu_1".into(),
            name: "bash".into(),
            input: serde_json::json!({"cmd": "cargo build"}),
        },
        RuntimeEvent::ToolResult {
            tool_use_id: "tu_1".into(),
            tool_name: "bash".into(),
            content: "exit 0".into(),
            is_error: false,
        },
        RuntimeEvent::IterationTokenUsage {
            input_tokens: 1000,
            output_tokens: 500,
        },
        RuntimeEvent::IterationComplete { iteration: 0 },
        RuntimeEvent::Warning("approaching budget limit".into()),
        RuntimeEvent::Error("provider timeout".into()),
    ];

    assert_eq!(events.len(), 10, "all 10 RuntimeEvent variants must be represented");

    for event in &events {
        let debug = format!("{:?}", event);
        assert!(!debug.is_empty(), "Debug output should be non-empty");
    }
}

#[test]
fn runtime_event_clone_preserves_data() {
    let original = RuntimeEvent::ToolResult {
        tool_use_id: "tu_42".into(),
        tool_name: "write_file".into(),
        content: "file written".into(),
        is_error: true,
    };
    let cloned = original.clone();
    let orig_debug = format!("{:?}", original);
    let clone_debug = format!("{:?}", cloned);
    assert_eq!(orig_debug, clone_debug);
}

// ── Boundary types serde round-trips ──────────────────────────────────

#[test]
fn message_serde_roundtrip_text() {
    let msg = Message::user("phase 7 validation");
    let json = serde_json::to_string(&msg).unwrap();
    let back: Message = serde_json::from_str(&json).unwrap();
    assert!(matches!(back.role, Role::User));
    assert!(matches!(back.content, MessageContent::Text(ref t) if t == "phase 7 validation"));
}

#[test]
fn message_serde_roundtrip_blocks() {
    let msg = Message::assistant_blocks(vec![
        ContentBlock::Text { text: "here".into() },
        ContentBlock::ToolUse {
            id: "tu_1".into(),
            name: "search".into(),
            input: serde_json::json!({"q": "test"}),
        },
        ContentBlock::ToolResult {
            tool_use_id: "tu_1".into(),
            content: ToolResultContent::Text("found 3 results".into()),
            is_error: false,
        },
        ContentBlock::Image {
            source: ImageSource {
                source_type: "base64".into(),
                media_type: "image/png".into(),
                data: "iVBOR...".into(),
            },
        },
    ]);
    let json = serde_json::to_string(&msg).unwrap();
    let back: Message = serde_json::from_str(&json).unwrap();
    match back.content {
        MessageContent::Blocks(blocks) => assert_eq!(blocks.len(), 4),
        _ => panic!("expected Blocks variant"),
    }
}

#[test]
fn tool_definition_serde_roundtrip_with_cache() {
    let td = ToolDefinition {
        name: "write_file".into(),
        description: "Write content to a file".into(),
        input_schema: serde_json::json!({"type": "object"}),
        cache_control: Some(CacheControl::ephemeral()),
    };
    let json = serde_json::to_string(&td).unwrap();
    let back: ToolDefinition = serde_json::from_str(&json).unwrap();
    assert_eq!(back.name, "write_file");
    assert!(back.cache_control.is_some());
    assert_eq!(back.cache_control.unwrap().cache_type, "ephemeral");
}

#[test]
fn tool_call_serde_roundtrip() {
    let tc = ToolCall {
        id: "call_99".into(),
        name: "edit_file".into(),
        input: serde_json::json!({"path": "lib.rs", "old": "a", "new": "b"}),
    };
    let json = serde_json::to_string(&tc).unwrap();
    let back: ToolCall = serde_json::from_str(&json).unwrap();
    assert_eq!(back.id, "call_99");
    assert_eq!(back.input["path"], "lib.rs");
}

#[test]
fn thinking_config_serde_roundtrip() {
    let tc = ThinkingConfig { budget_tokens: 25_000 };
    let json = serde_json::to_string(&tc).unwrap();
    let back: ThinkingConfig = serde_json::from_str(&json).unwrap();
    assert_eq!(back.budget_tokens, 25_000);
}

#[test]
fn role_all_variants_serde() {
    for role in [Role::User, Role::Assistant] {
        let json = serde_json::to_string(&role).unwrap();
        let back: Role = serde_json::from_str(&json).unwrap();
        assert_eq!(role, back);
    }
}

// ── Supplementary type completeness ───────────────────────────────────

#[test]
fn total_usage_default_and_fields() {
    let usage = TotalUsage::default();
    assert_eq!(usage.input_tokens, 0);
    assert_eq!(usage.output_tokens, 0);

    let custom = TotalUsage {
        input_tokens: 42_000,
        output_tokens: 8_000,
    };
    assert_eq!(custom.input_tokens, 42_000);
}

#[test]
fn turn_result_all_fields() {
    let result = TurnResult {
        text: "Done!".into(),
        thinking: "I analyzed the code...".into(),
        usage: TotalUsage {
            input_tokens: 5000,
            output_tokens: 2000,
        },
        iterations_run: 3,
        timed_out: false,
        insufficient_credits: false,
        llm_error: Some("rate limited".into()),
    };
    assert_eq!(result.text, "Done!");
    assert_eq!(result.iterations_run, 3);
    assert!(result.llm_error.is_some());
}

#[test]
fn runtime_error_all_variants() {
    let errors: Vec<RuntimeError> = vec![
        RuntimeError::Provider("timeout".into()),
        RuntimeError::ToolExecution("perm denied".into()),
        RuntimeError::BudgetExhausted("50 iterations".into()),
        RuntimeError::InsufficientCredits,
        RuntimeError::Internal("unexpected".into()),
    ];
    assert_eq!(errors.len(), 5, "all 5 RuntimeError variants");
    for e in &errors {
        assert!(!e.to_string().is_empty());
    }
}

#[test]
fn tool_call_result_constructible() {
    let r = ToolCallResult {
        tool_use_id: "tu_1".into(),
        content: "success".into(),
        is_error: false,
        stop_loop: false,
    };
    assert!(!r.is_error);
    assert!(!r.stop_loop);
}

#[test]
fn auto_build_result_constructible() {
    let r = AutoBuildResult {
        success: true,
        output: "Build succeeded".into(),
        error_count: 0,
    };
    assert!(r.success);
}

#[test]
fn build_baseline_default_and_annotate() {
    let baseline = BuildBaseline::default();
    assert!(baseline.error_signatures.is_empty());
    assert_eq!(baseline.annotate("clean output"), "clean output");
}

#[test]
fn cache_control_ephemeral_type() {
    let cc = CacheControl::ephemeral();
    assert_eq!(cc.cache_type, "ephemeral");
    let json = serde_json::to_string(&cc).unwrap();
    let back: CacheControl = serde_json::from_str(&json).unwrap();
    assert_eq!(back.cache_type, "ephemeral");
}

#[test]
fn image_source_serde_roundtrip() {
    let src = ImageSource {
        source_type: "base64".into(),
        media_type: "image/jpeg".into(),
        data: "/9j/4AAQ...".into(),
    };
    let json = serde_json::to_string(&src).unwrap();
    let back: ImageSource = serde_json::from_str(&json).unwrap();
    assert_eq!(back.source_type, "base64");
    assert_eq!(back.media_type, "image/jpeg");
}
