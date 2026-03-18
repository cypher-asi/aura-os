use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use tokio::sync::mpsc;
use tracing::{error, info, warn};

use aura_claude::{
    ClaudeStreamEvent, ContentBlock, RichMessage, ThinkingConfig, ToolCall,
    ToolDefinition,
};
use crate::compaction;
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
    /// Maximum credits to spend in this tool loop. The loop stops gracefully
    /// when cumulative debited credits approach this limit. `None` means no cap.
    pub credit_budget: Option<u64>,
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
    tools: Arc<[ToolDefinition]>,
    config: &ToolLoopConfig,
    executor: &dyn ToolExecutor,
    event_tx: &mpsc::UnboundedSender<ToolLoopEvent>,
) -> ToolLoopResult {
    let mut api_messages = initial_messages;
    let mut total_text = String::new();
    let mut total_thinking = String::new();
    let mut total_input_tokens: u64 = 0;
    let mut total_output_tokens: u64 = 0;
    let mut cumulative_credits: u64 = 0;
    let mut file_read_cache: HashMap<String, u64> = HashMap::new();

    for iteration in 0..config.max_iterations {
        let (claude_tx, mut claude_rx) = mpsc::unbounded_channel::<ClaudeStreamEvent>();

        let llm_clone = llm.clone();
        let api_key_owned = api_key.to_string();
        let system_owned = system_prompt.to_string();
        let msgs_owned = api_messages.clone();
        let tools_owned = tools.to_vec();
        let max_tokens = config.max_tokens;
        let thinking = config.thinking.clone();
        let reason = config.billing_reason;

        let stream_handle = tokio::spawn(async move {
            llm_clone
                .complete_stream_with_tools(
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
        });

        let mut iter_text = String::new();
        let mut iter_tool_calls: Vec<ToolCall> = Vec::new();
        let mut stream_error_forwarded = false;

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
                        stream_error_forwarded = true;
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
                error!(iteration, error = %e, "LLM streaming failed");
                let is_billing = e.is_billing_error();
                let error_msg = format!("{e}");
                if !stream_error_forwarded {
                    if e.is_insufficient_credits() {
                        let _ = event_tx.send(ToolLoopEvent::Error(
                            "Insufficient credits — please top up to continue.".to_string(),
                        ));
                    } else if is_billing {
                        let _ = event_tx.send(ToolLoopEvent::Error(
                            format!("Billing error — stopping to prevent unbilled usage: {e}"),
                        ));
                    } else if iter_text.is_empty() && iter_tool_calls.is_empty() {
                        let _ = event_tx.send(ToolLoopEvent::Error(error_msg.clone()));
                    }
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
                error!(iteration, error = %e, "Stream task panicked or was cancelled");
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

        let billing_model = if stream_result.model_used.is_empty() { aura_claude::DEFAULT_MODEL } else { &stream_result.model_used };
        let iter_credits = llm.estimate_credits(
            billing_model,
            stream_result.input_tokens,
            stream_result.output_tokens,
        );
        cumulative_credits += iter_credits;

        // Use API-reported input_tokens to detect context window pressure.
        // stream_result.input_tokens is the exact count for this call.
        if let Some(max_ctx) = config.max_context_tokens {
            let utilization = stream_result.input_tokens as f64 / max_ctx as f64;
            if utilization > 0.60 {
                info!(
                    input_tokens = stream_result.input_tokens,
                    max_context = max_ctx,
                    utilization_pct = (utilization * 100.0) as u32,
                    "Context utilization elevated, compacting older tool results in-flight"
                );
                compaction::compact_older_tool_results(&mut api_messages, 4);
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
            let input = if tc.name == "write_file" {
                summarize_write_file_input(&tc.input)
            } else {
                tc.input.clone()
            };
            assistant_blocks.push(ContentBlock::ToolUse {
                id: tc.id.clone(),
                name: tc.name.clone(),
                input,
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

            let content_for_llm = if tc.name == "read_file" && !result.is_error {
                let path = tc.input.get("path").and_then(|v| v.as_str()).unwrap_or("");
                let hash = content_hash(&result.content);
                if let Some(&prev_hash) = file_read_cache.get(path) {
                    if prev_hash == hash {
                        format!(
                            "File already read earlier in this session with identical content ({} chars). \
                             Use the previously read content.",
                            result.content.len()
                        )
                    } else {
                        file_read_cache.insert(path.to_string(), hash);
                        compaction::smart_compact(&tc.name, &result.content)
                    }
                } else {
                    file_read_cache.insert(path.to_string(), hash);
                    compaction::smart_compact(&tc.name, &result.content)
                }
            } else {
                if tc.name == "write_file" || tc.name == "edit_file" {
                    if let Some(path) = tc.input.get("path").and_then(|v| v.as_str()) {
                        file_read_cache.remove(path);
                    }
                }
                compaction::smart_compact(&tc.name, &result.content)
            };

            result_blocks.push(ContentBlock::ToolResult {
                tool_use_id: result.tool_use_id.clone(),
                content: content_for_llm,
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

        // Check credit budget before starting the next iteration.
        if let Some(budget) = config.credit_budget {
            let next_estimate = llm.estimate_credits(
                billing_model,
                stream_result.input_tokens,
                0,
            );
            if cumulative_credits + next_estimate > budget {
                warn!(
                    cumulative_credits,
                    next_estimate,
                    budget,
                    "Credit budget would be exceeded, stopping tool loop"
                );
                let _ = event_tx.send(ToolLoopEvent::Error(
                    "Stopping: credit budget for this session would be exceeded.".to_string(),
                ));
                return ToolLoopResult {
                    text: total_text,
                    thinking: total_thinking,
                    total_input_tokens,
                    total_output_tokens,
                    iterations_run: iteration + 1,
                    timed_out: false,
                    insufficient_credits: true,
                    llm_error: None,
                };
            }
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

/// Replace the `content` field in a `write_file` tool_use input with a summary
/// to prevent large file contents from persisting in conversation history across
/// subsequent tool loop iterations.
fn summarize_write_file_input(input: &serde_json::Value) -> serde_json::Value {
    let path = input.get("path").and_then(|v| v.as_str()).unwrap_or("unknown");
    let content_len = input
        .get("content")
        .and_then(|v| v.as_str())
        .map(|s| s.len())
        .unwrap_or(0);
    let line_count = input
        .get("content")
        .and_then(|v| v.as_str())
        .map(|s| s.lines().count())
        .unwrap_or(0);
    serde_json::json!({
        "path": path,
        "content": format!("[wrote {line_count} lines, {content_len} chars to {path}]"),
    })
}

fn content_hash(content: &str) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in content.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

fn append_text(total: &mut String, new: &str) {
    if !new.is_empty() {
        if !total.is_empty() {
            total.push_str("\n\n");
        }
        total.push_str(new);
    }
}


#[cfg(test)]
mod tests {
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
}
