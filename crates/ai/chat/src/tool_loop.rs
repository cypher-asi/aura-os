use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use tokio::sync::mpsc;
use tracing::{info, warn};

use aura_claude::{
    ClaudeStreamEvent, ContentBlock, MessageContent, RichMessage, ThinkingConfig, ToolCall,
    ToolDefinition,
};
use aura_billing::MeteredLlm;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

pub struct ToolLoopConfig {
    pub max_iterations: usize,
    pub max_tokens: u32,
    pub thinking: Option<ThinkingConfig>,
    pub stream_timeout: Duration,
    pub billing_reason: &'static str,
    /// When set, the loop uses API-reported input_tokens (not the chars/4
    /// heuristic) to detect context window pressure and retroactively compact
    /// older tool results before the next iteration.
    pub max_context_tokens: Option<u64>,
}

// ---------------------------------------------------------------------------
// Tool execution trait -- callers implement this
// ---------------------------------------------------------------------------

pub struct ToolCallResult {
    pub tool_use_id: String,
    pub content: String,
    pub is_error: bool,
    /// When true the loop will break after processing all results in this batch.
    pub stop_loop: bool,
}

#[async_trait]
pub trait ToolExecutor: Send + Sync {
    async fn execute(&self, tool_calls: &[ToolCall]) -> Vec<ToolCallResult>;
}

// ---------------------------------------------------------------------------
// Stream events emitted by the loop
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub enum ToolLoopEvent {
    Delta(String),
    ThinkingDelta(String),
    ToolUseDetected {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    ToolResult {
        tool_use_id: String,
        tool_name: String,
        content: String,
        is_error: bool,
    },
    IterationTokenUsage {
        input_tokens: u64,
        output_tokens: u64,
    },
    Error(String),
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

pub struct ToolLoopResult {
    pub text: String,
    pub thinking: String,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub iterations_run: usize,
    pub timed_out: bool,
    pub insufficient_credits: bool,
    /// Set when the LLM returned a non-billing API error (e.g. provider
    /// credit exhaustion, rate limit, auth failure). Callers should treat
    /// this as a hard failure rather than a successful completion.
    pub llm_error: Option<String>,
}

// ---------------------------------------------------------------------------
// The loop itself
// ---------------------------------------------------------------------------

pub async fn run_tool_loop(
    llm: Arc<MeteredLlm>,
    api_key: &str,
    system_prompt: &str,
    initial_messages: Vec<RichMessage>,
    tools: Vec<ToolDefinition>,
    config: &ToolLoopConfig,
    executor: &dyn ToolExecutor,
    event_tx: &mpsc::UnboundedSender<ToolLoopEvent>,
) -> ToolLoopResult {
    let mut api_messages = initial_messages;
    let mut total_text = String::new();
    let mut total_thinking = String::new();
    let mut total_input_tokens: u64 = 0;
    let mut total_output_tokens: u64 = 0;

    for iteration in 0..config.max_iterations {
        let (claude_tx, mut claude_rx) = mpsc::unbounded_channel::<ClaudeStreamEvent>();

        let llm_clone = llm.clone();
        let api_key_owned = api_key.to_string();
        let system_owned = system_prompt.to_string();
        let msgs_owned = api_messages.clone();
        let tools_owned = tools.clone();
        let max_tokens = config.max_tokens;
        let thinking = config.thinking.clone();
        let reason = config.billing_reason;

        let stream_handle = tokio::spawn(async move {
            if let Some(thinking) = thinking {
                llm_clone
                    .complete_stream_with_tools_thinking(
                        &api_key_owned,
                        &system_owned,
                        msgs_owned,
                        tools_owned,
                        max_tokens,
                        thinking,
                        claude_tx,
                        reason,
                        None,
                    )
                    .await
            } else {
                llm_clone
                    .complete_stream_with_tools(
                        &api_key_owned,
                        &system_owned,
                        msgs_owned,
                        tools_owned,
                        max_tokens,
                        claude_tx,
                        reason,
                        None,
                    )
                    .await
            }
        });

        let mut iter_text = String::new();
        let mut iter_tool_calls: Vec<ToolCall> = Vec::new();

        let iter_timed_out = loop {
            match tokio::time::timeout(config.stream_timeout, claude_rx.recv()).await {
                Ok(Some(evt)) => match evt {
                    ClaudeStreamEvent::Delta(text) => {
                        iter_text.push_str(&text);
                        let _ = event_tx.send(ToolLoopEvent::Delta(text));
                    }
                    ClaudeStreamEvent::ToolUse { id, name, input } => {
                        let _ = event_tx.send(ToolLoopEvent::ToolUseDetected {
                            id: id.clone(),
                            name: name.clone(),
                            input: input.clone(),
                        });
                        iter_tool_calls.push(ToolCall { id, name, input });
                    }
                    ClaudeStreamEvent::ThinkingDelta(text) => {
                        total_thinking.push_str(&text);
                        let _ = event_tx.send(ToolLoopEvent::ThinkingDelta(text));
                    }
                    ClaudeStreamEvent::Done { stop_reason, .. } => {
                        info!(iteration, stop_reason = %stop_reason, tool_calls = iter_tool_calls.len(), "Tool loop iteration done");
                    }
                    ClaudeStreamEvent::Error(msg) => {
                        let _ = event_tx.send(ToolLoopEvent::Error(msg));
                    }
                },
                Ok(None) => break false,
                Err(_) => {
                    warn!(iteration, "Tool loop streaming timed out after {}s", config.stream_timeout.as_secs());
                    stream_handle.abort();
                    break true;
                }
            }
        };

        if iter_timed_out {
            let _ = event_tx.send(ToolLoopEvent::Error(
                "LLM streaming timed out".to_string(),
            ));
            append_text(&mut total_text, &iter_text);
            return ToolLoopResult {
                text: total_text,
                thinking: total_thinking,
                total_input_tokens,
                total_output_tokens,
                iterations_run: iteration + 1,
                timed_out: true,
                insufficient_credits: false,
                llm_error: None,
            };
        }

        let stream_result = match stream_handle.await {
            Ok(Ok(r)) => r,
            Ok(Err(e)) => {
                let is_billing = e.is_billing_error();
                let error_msg = format!("{e}");
                if e.is_insufficient_credits() {
                    let _ = event_tx.send(ToolLoopEvent::Error(
                        "Insufficient credits — please top up to continue.".to_string(),
                    ));
                } else if is_billing {
                    let _ = event_tx.send(ToolLoopEvent::Error(
                        format!("Billing error — stopping to prevent unbilled usage: {e}"),
                    ));
                } else if iter_text.is_empty() && iter_tool_calls.is_empty() {
                    let _ = event_tx.send(ToolLoopEvent::Error(format!("LLM error: {e}")));
                }
                append_text(&mut total_text, &iter_text);
                let llm_error = if is_billing { None } else { Some(error_msg) };
                return ToolLoopResult {
                    text: total_text,
                    thinking: total_thinking,
                    total_input_tokens,
                    total_output_tokens,
                    iterations_run: iteration + 1,
                    timed_out: false,
                    insufficient_credits: is_billing,
                    llm_error,
                };
            }
            Err(e) => {
                let error_msg = format!("Stream task error: {e}");
                if iter_text.is_empty() && iter_tool_calls.is_empty() {
                    let _ = event_tx.send(ToolLoopEvent::Error(error_msg.clone()));
                }
                append_text(&mut total_text, &iter_text);
                return ToolLoopResult {
                    text: total_text,
                    thinking: total_thinking,
                    total_input_tokens,
                    total_output_tokens,
                    iterations_run: iteration + 1,
                    timed_out: false,
                    insufficient_credits: false,
                    llm_error: Some(error_msg),
                };
            }
        };

        total_input_tokens += stream_result.input_tokens;
        total_output_tokens += stream_result.output_tokens;
        let _ = event_tx.send(ToolLoopEvent::IterationTokenUsage {
            input_tokens: total_input_tokens,
            output_tokens: total_output_tokens,
        });

        // Use API-reported input_tokens to detect context window pressure.
        // stream_result.input_tokens is the exact count for this call.
        if let Some(max_ctx) = config.max_context_tokens {
            let utilization = stream_result.input_tokens as f64 / max_ctx as f64;
            if utilization > 0.40 {
                info!(
                    input_tokens = stream_result.input_tokens,
                    max_context = max_ctx,
                    utilization_pct = (utilization * 100.0) as u32,
                    "Context utilization elevated, compacting older tool results in-flight"
                );
                compact_older_tool_results(&mut api_messages);
            }
        }

        append_text(&mut total_text, &iter_text);

        if stream_result.stop_reason != "tool_use" || iter_tool_calls.is_empty() {
            return ToolLoopResult {
                text: total_text,
                thinking: total_thinking,
                total_input_tokens,
                total_output_tokens,
                iterations_run: iteration + 1,
                timed_out: false,
                insufficient_credits: false,
                llm_error: None,
            };
        }

        // -- Build assistant blocks for the conversation ----------------------
        let mut assistant_blocks: Vec<ContentBlock> = Vec::new();
        if !iter_text.is_empty() {
            assistant_blocks.push(ContentBlock::Text {
                text: iter_text.clone(),
            });
        }
        for tc in &iter_tool_calls {
            assistant_blocks.push(ContentBlock::ToolUse {
                id: tc.id.clone(),
                name: tc.name.clone(),
                input: tc.input.clone(),
            });
        }
        api_messages.push(RichMessage::assistant_blocks(assistant_blocks));

        // -- Execute tool calls -----------------------------------------------
        let results = executor.execute(&iter_tool_calls).await;

        let mut should_stop = false;
        let mut result_blocks: Vec<ContentBlock> = Vec::new();
        for (tc, result) in iter_tool_calls.iter().zip(&results) {
            let _ = event_tx.send(ToolLoopEvent::ToolResult {
                tool_use_id: result.tool_use_id.clone(),
                tool_name: tc.name.clone(),
                content: result.content.clone(),
                is_error: result.is_error,
            });
            let compacted = microcompact(&result.content);
            result_blocks.push(ContentBlock::ToolResult {
                tool_use_id: result.tool_use_id.clone(),
                content: compacted,
                is_error: if result.is_error { Some(true) } else { None },
            });
            if result.stop_loop {
                should_stop = true;
            }
        }
        api_messages.push(RichMessage::tool_results(result_blocks));

        if should_stop {
            return ToolLoopResult {
                text: total_text,
                thinking: total_thinking,
                total_input_tokens,
                total_output_tokens,
                iterations_run: iteration + 1,
                timed_out: false,
                insufficient_credits: false,
                llm_error: None,
            };
        }

        if iteration + 1 >= config.max_iterations {
            warn!(
                config.max_iterations,
                "Tool-use loop hit max iterations, stopping"
            );
        }
    }

    ToolLoopResult {
        text: total_text,
        thinking: total_thinking,
        total_input_tokens,
        total_output_tokens,
        iterations_run: config.max_iterations,
        timed_out: false,
        insufficient_credits: false,
        llm_error: None,
    }
}

fn append_text(total: &mut String, new: &str) {
    if !new.is_empty() {
        if !total.is_empty() {
            total.push_str("\n\n");
        }
        total.push_str(new);
    }
}

/// Retroactively compact tool results in older messages when the context
/// window is under pressure. Skips the last 4 messages (the most recent
/// assistant turn + tool results pair) to avoid losing fresh context.
fn compact_older_tool_results(messages: &mut [RichMessage]) {
    let len = messages.len();
    let cutoff = len.saturating_sub(4);
    for msg in &mut messages[..cutoff] {
        if msg.role != "user" {
            continue;
        }
        if let MessageContent::Blocks(blocks) = &mut msg.content {
            for block in blocks.iter_mut() {
                if let ContentBlock::ToolResult { content, .. } = block {
                    if content.len() > AGGRESSIVE_COMPACT_THRESHOLD {
                        *content = aggressive_compact(content);
                    }
                }
            }
        }
    }
}

const AGGRESSIVE_COMPACT_THRESHOLD: usize = 2_000;
const AGGRESSIVE_KEEP_HEAD: usize = 800;
const AGGRESSIVE_KEEP_TAIL: usize = 400;

fn aggressive_compact(content: &str) -> String {
    if content.len() <= AGGRESSIVE_COMPACT_THRESHOLD {
        return content.to_string();
    }
    let head: String = content.chars().take(AGGRESSIVE_KEEP_HEAD).collect();
    let tail: String = content
        .chars()
        .rev()
        .take(AGGRESSIVE_KEEP_TAIL)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    let omitted = content.len() - AGGRESSIVE_KEEP_HEAD - AGGRESSIVE_KEEP_TAIL;
    format!(
        "{head}\n[...{omitted} chars omitted...]\n{tail}"
    )
}

const MICROCOMPACT_CHAR_THRESHOLD: usize = 8_000;
const MICROCOMPACT_KEEP_HEAD: usize = 3_000;
const MICROCOMPACT_KEEP_TAIL: usize = 1_500;

/// Truncate large tool results to keep the conversation history lean.
/// The full result is still sent to the UI via events; this only affects
/// what the LLM sees on the next turn.
fn microcompact(content: &str) -> String {
    if content.len() <= MICROCOMPACT_CHAR_THRESHOLD {
        return content.to_string();
    }
    let total_chars = content.len();
    let head: String = content.chars().take(MICROCOMPACT_KEEP_HEAD).collect();
    let tail: String = content
        .chars()
        .rev()
        .take(MICROCOMPACT_KEEP_TAIL)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    let omitted = total_chars - MICROCOMPACT_KEEP_HEAD - MICROCOMPACT_KEEP_TAIL;
    format!(
        "{head}\n\n[... {omitted} characters omitted — re-read the file or re-run the command if you need the full output ...]\n\n{tail}"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_claude::mock::{MockLlmProvider, MockResponse};
    use aura_billing::{BillingClient, MeteredLlm};
    use aura_store::RocksStore;

    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    async fn start_mock_billing_server() -> String {
        use axum::{routing::{get, post}, Json, Router};
        use tokio::net::TcpListener;

        let app = Router::new()
            .route(
                "/api/credits/balance",
                get(|| async {
                    Json(serde_json::json!({"balance": 999999, "purchases": []}))
                }),
            )
            .route(
                "/api/credits/debit",
                post(|| async {
                    Json(serde_json::json!({
                        "success": true,
                        "balance": 999998,
                        "transactionId": "tx-1"
                    }))
                }),
            );

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.ok() });
        url
    }

    async fn make_test_llm(
        mock: Arc<MockLlmProvider>,
    ) -> (Arc<MeteredLlm>, tempfile::TempDir) {
        let url = start_mock_billing_server().await;
        let billing = {
            let _guard = ENV_LOCK.lock().unwrap();
            std::env::set_var("BILLING_SERVER_URL", &url);
            Arc::new(BillingClient::new())
        };

        let tmp = tempfile::TempDir::new().unwrap();
        let store = Arc::new(RocksStore::open(tmp.path()).unwrap());

        let session = serde_json::to_vec(&aura_core::ZeroAuthSession {
            user_id: "u1".into(),
            display_name: "Test".into(),
            profile_image: String::new(),
            primary_zid: "zid-1".into(),
            zero_wallet: "w1".into(),
            wallets: vec![],
            access_token: "test-token".into(),
            created_at: chrono::Utc::now(),
            validated_at: chrono::Utc::now(),
        })
        .unwrap();
        store.put_setting("zero_auth_session", &session).unwrap();

        let llm = Arc::new(MeteredLlm::new(mock, billing, store));
        (llm, tmp)
    }

    fn default_config(max_iterations: usize) -> ToolLoopConfig {
        ToolLoopConfig {
            max_iterations,
            max_tokens: 4096,
            thinking: None,
            stream_timeout: Duration::from_secs(30),
            billing_reason: "test",
            max_context_tokens: None,
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

        let (llm, _tmp) = make_test_llm(mock).await;
        let (event_tx, _event_rx) = mpsc::unbounded_channel();
        let executor = noop_executor();
        let config = default_config(5);

        let result = run_tool_loop(
            llm,
            "test-key",
            "You are a test assistant.",
            vec![RichMessage::user("Say done")],
            vec![],
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

        let (llm, _tmp) = make_test_llm(mock).await;
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
            vec![],
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
        let (llm, _tmp) = make_test_llm(mock).await;
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
            vec![],
            &config,
            &executor,
            &event_tx,
        )
        .await;

        assert_eq!(result.iterations_run, 3);
        assert!(!result.timed_out);
    }
}
