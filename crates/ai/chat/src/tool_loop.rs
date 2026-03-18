use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::mpsc;
use tracing::{error, info, warn};

use aura_claude::{
    ClaudeStreamEvent, ContentBlock, RichMessage, ToolCall,
    ToolDefinition, ToolStreamResponse,
};
use aura_billing::{MeteredLlm, MeteredLlmError};
use crate::compaction;

pub use crate::tool_loop_types::*;

struct LoopState {
    api_messages: Vec<RichMessage>,
    total_text: String,
    total_thinking: String,
    total_input_tokens: u64,
    total_output_tokens: u64,
    cumulative_credits: u64,
    file_read_cache: HashMap<String, u64>,
    consecutive_write_tracker: HashMap<String, usize>,
    consecutive_cmd_failures: usize,
}

impl LoopState {
    fn build_result(
        &self,
        iterations_run: usize,
        timed_out: bool,
        insufficient_credits: bool,
        llm_error: Option<String>,
    ) -> ToolLoopResult {
        ToolLoopResult {
            text: self.total_text.clone(),
            thinking: self.total_thinking.clone(),
            total_input_tokens: self.total_input_tokens,
            total_output_tokens: self.total_output_tokens,
            iterations_run,
            timed_out,
            insufficient_credits,
            llm_error,
        }
    }
}

enum IterationOutcome {
    EarlyReturn(ToolLoopResult),
    Completed(IterationCompleted),
}

struct IterationCompleted {
    iter_text: String,
    iter_tool_calls: Vec<ToolCall>,
    input_tokens: u64,
    output_tokens: u64,
    stop_reason: String,
    model_used: String,
}

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
    let mut state = LoopState {
        api_messages: initial_messages,
        total_text: String::new(),
        total_thinking: String::new(),
        total_input_tokens: 0,
        total_output_tokens: 0,
        cumulative_credits: 0,
        file_read_cache: HashMap::new(),
        consecutive_write_tracker: HashMap::new(),
        consecutive_cmd_failures: 0,
    };

    for iteration in 0..config.max_iterations {
        let iter = match run_single_iteration(
            &llm, api_key, system_prompt, &tools, config, event_tx, &mut state, iteration,
        ).await {
            IterationOutcome::EarlyReturn(r) => return r,
            IterationOutcome::Completed(c) => c,
        };

        state.total_input_tokens += iter.input_tokens;
        state.total_output_tokens += iter.output_tokens;
        let _ = event_tx.send(ToolLoopEvent::IterationTokenUsage {
            input_tokens: state.total_input_tokens,
            output_tokens: state.total_output_tokens,
        });

        let billing_model = if iter.model_used.is_empty() {
            aura_claude::DEFAULT_MODEL
        } else {
            &iter.model_used
        };
        let iter_credits = llm.estimate_credits(billing_model, iter.input_tokens, iter.output_tokens);
        state.cumulative_credits += iter_credits;

        check_context_compaction(config, iter.input_tokens, &mut state.api_messages);
        append_text(&mut state.total_text, &iter.iter_text);

        if iter.stop_reason != "tool_use" || iter.iter_tool_calls.is_empty() {
            return state.build_result(iteration + 1, false, false, None);
        }

        let should_stop = process_tool_calls(&iter, executor, event_tx, &mut state).await;
        if should_stop {
            return state.build_result(iteration + 1, false, false, None);
        }

        if let Some(budget) = config.credit_budget {
            let next_estimate = llm.estimate_credits(billing_model, iter.input_tokens, 0);
            if state.cumulative_credits + next_estimate > budget {
                warn!(
                    state.cumulative_credits, next_estimate, budget,
                    "Credit budget would be exceeded, stopping tool loop"
                );
                let _ = event_tx.send(ToolLoopEvent::Error(
                    "Stopping: credit budget for this session would be exceeded.".to_string(),
                ));
                return state.build_result(iteration + 1, false, true, None);
            }
        }

        if iteration + 1 >= config.max_iterations {
            warn!(config.max_iterations, "Tool-use loop hit max iterations, stopping");
        }
    }

    state.build_result(config.max_iterations, false, false, None)
}

async fn run_single_iteration(
    llm: &Arc<MeteredLlm>,
    api_key: &str,
    system_prompt: &str,
    tools: &Arc<[ToolDefinition]>,
    config: &ToolLoopConfig,
    event_tx: &mpsc::UnboundedSender<ToolLoopEvent>,
    state: &mut LoopState,
    iteration: usize,
) -> IterationOutcome {
    let (claude_tx, mut claude_rx) = mpsc::unbounded_channel::<ClaudeStreamEvent>();

    let llm_clone = llm.clone();
    let api_key_owned = api_key.to_string();
    let system_owned = system_prompt.to_string();
    let msgs_owned = state.api_messages.clone();
    let tools_owned = tools.to_vec();
    let max_tokens = config.max_tokens;
    let thinking = config.thinking.clone();
    let reason = config.billing_reason;

    let stream_handle = tokio::spawn(async move {
        llm_clone
            .complete_stream_with_tools(
                &api_key_owned, &system_owned, msgs_owned, tools_owned,
                max_tokens, thinking, claude_tx, reason, None,
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
                    state.total_thinking.push_str(&text);
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
        let _ = event_tx.send(ToolLoopEvent::Error("LLM streaming timed out".to_string()));
        append_text(&mut state.total_text, &iter_text);
        return IterationOutcome::EarlyReturn(state.build_result(iteration + 1, true, false, None));
    }

    handle_stream_result(
        stream_handle, iter_text, iter_tool_calls,
        stream_error_forwarded, event_tx, state, iteration,
    )
    .await
}

async fn handle_stream_result(
    stream_handle: tokio::task::JoinHandle<Result<ToolStreamResponse, MeteredLlmError>>,
    iter_text: String,
    iter_tool_calls: Vec<ToolCall>,
    stream_error_forwarded: bool,
    event_tx: &mpsc::UnboundedSender<ToolLoopEvent>,
    state: &mut LoopState,
    iteration: usize,
) -> IterationOutcome {
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
            append_text(&mut state.total_text, &iter_text);
            let llm_error = if is_billing { None } else { Some(error_msg) };
            return IterationOutcome::EarlyReturn(
                state.build_result(iteration + 1, false, is_billing, llm_error),
            );
        }
        Err(e) => {
            error!(iteration, error = %e, "Stream task panicked or was cancelled");
            let error_msg = format!("Stream task error: {e}");
            if iter_text.is_empty() && iter_tool_calls.is_empty() {
                let _ = event_tx.send(ToolLoopEvent::Error(error_msg.clone()));
            }
            append_text(&mut state.total_text, &iter_text);
            return IterationOutcome::EarlyReturn(
                state.build_result(iteration + 1, false, false, Some(error_msg)),
            );
        }
    };

    IterationOutcome::Completed(IterationCompleted {
        iter_text,
        iter_tool_calls,
        input_tokens: stream_result.input_tokens,
        output_tokens: stream_result.output_tokens,
        stop_reason: stream_result.stop_reason,
        model_used: stream_result.model_used,
    })
}

fn check_context_compaction(
    config: &ToolLoopConfig,
    iteration_input_tokens: u64,
    api_messages: &mut Vec<RichMessage>,
) {
    if let Some(max_ctx) = config.max_context_tokens {
        let utilization = iteration_input_tokens as f64 / max_ctx as f64;
        if utilization > 0.60 {
            info!(
                input_tokens = iteration_input_tokens,
                max_context = max_ctx,
                utilization_pct = (utilization * 100.0) as u32,
                "Context utilization elevated, compacting older tool results in-flight"
            );
            compaction::compact_older_tool_results(api_messages, 4);
        }
    }
}

async fn process_tool_calls(
    iter: &IterationCompleted,
    executor: &dyn ToolExecutor,
    event_tx: &mpsc::UnboundedSender<ToolLoopEvent>,
    state: &mut LoopState,
) -> bool {
    let mut assistant_blocks: Vec<ContentBlock> = Vec::new();
    if !iter.iter_text.is_empty() {
        assistant_blocks.push(ContentBlock::Text { text: iter.iter_text.clone() });
    }
    for tc in &iter.iter_tool_calls {
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
    state.api_messages.push(RichMessage::assistant_blocks(assistant_blocks));

    let blocked_indices = detect_blocked_writes(&iter.iter_tool_calls, &mut state.consecutive_write_tracker);
    let cmd_blocked_indices = detect_blocked_commands(&iter.iter_tool_calls, state.consecutive_cmd_failures);

    let all_blocked: Vec<usize> = {
        let mut v = blocked_indices.clone();
        for i in &cmd_blocked_indices {
            if !v.contains(i) {
                v.push(*i);
            }
        }
        v
    };

    let allowed_calls: Vec<ToolCall> = iter.iter_tool_calls
        .iter()
        .enumerate()
        .filter(|(i, _)| !all_blocked.contains(i))
        .map(|(_, tc)| tc.clone())
        .collect();
    let allowed_results = executor.execute(&allowed_calls).await;

    let mut allowed_iter = allowed_results.into_iter();
    let results: Vec<ToolCallResult> = iter.iter_tool_calls
        .iter()
        .enumerate()
        .map(|(i, tc)| {
            if blocked_indices.contains(&i) {
                let path = tc.input.get("path").and_then(|v| v.as_str()).unwrap_or("unknown");
                warn!(path, tool = %tc.name, "Blocked consecutive duplicate write/edit (3+ in a row)");
                ToolCallResult {
                    tool_use_id: tc.id.clone(),
                    content: serde_json::json!({
                        "error": format!(
                            "You have called {} on '{}' 3+ times consecutively. \
                             The file was already written successfully. Use read_file to \
                             verify the contents, or try a different approach.",
                            tc.name, path
                        )
                    }).to_string(),
                    is_error: true,
                    stop_loop: false,
                }
            } else if cmd_blocked_indices.contains(&i) {
                warn!(tool = %tc.name, consecutive_failures = state.consecutive_cmd_failures,
                    "Blocked run_command after 5+ consecutive failures");
                ToolCallResult {
                    tool_use_id: tc.id.clone(),
                    content: "run_command is temporarily blocked after 5+ consecutive failures. \
                              Use search_code, read_file, find_files, or list_files instead. \
                              run_command will be unblocked after you successfully use another tool."
                        .to_string(),
                    is_error: true,
                    stop_loop: false,
                }
            } else {
                allowed_iter.next().expect("allowed_results count mismatch")
            }
        })
        .collect();

    let results = apply_cmd_failure_tracking(
        &iter.iter_tool_calls,
        results,
        &mut state.consecutive_cmd_failures,
    );

    let (result_blocks, should_stop) = build_tool_result_blocks(
        &iter.iter_tool_calls, &results, &mut state.file_read_cache, event_tx,
    );
    state.api_messages.push(RichMessage::tool_results(result_blocks));
    should_stop
}

fn detect_blocked_writes(
    tool_calls: &[ToolCall],
    tracker: &mut HashMap<String, usize>,
) -> Vec<usize> {
    let write_paths: Vec<Option<String>> = tool_calls
        .iter()
        .map(|tc| {
            if tc.name == "write_file" || tc.name == "edit_file" {
                tc.input.get("path").and_then(|v| v.as_str()).map(String::from)
            } else {
                None
            }
        })
        .collect();

    if write_paths.iter().any(|p| p.is_none()) {
        tracker.clear();
    }
    for path in write_paths.iter().flatten() {
        *tracker.entry(path.clone()).or_insert(0) += 1;
    }

    tool_calls
        .iter()
        .enumerate()
        .filter_map(|(i, tc)| {
            if tc.name == "write_file" || tc.name == "edit_file" {
                let path = tc.input.get("path").and_then(|v| v.as_str()).unwrap_or("");
                if tracker.get(path).copied().unwrap_or(0) >= 3 {
                    return Some(i);
                }
            }
            None
        })
        .collect()
}

fn build_tool_result_blocks(
    tool_calls: &[ToolCall],
    results: &[ToolCallResult],
    file_read_cache: &mut HashMap<String, u64>,
    event_tx: &mpsc::UnboundedSender<ToolLoopEvent>,
) -> (Vec<ContentBlock>, bool) {
    let mut should_stop = false;
    let mut result_blocks: Vec<ContentBlock> = Vec::new();

    for (tc, result) in tool_calls.iter().zip(results) {
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
            if result.is_error && tc.name == "run_command" {
                compaction::smart_compact_error(&tc.name, &result.content)
            } else {
                compaction::smart_compact(&tc.name, &result.content)
            }
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

    (result_blocks, should_stop)
}

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

// ---------------------------------------------------------------------------
// Consecutive run_command failure circuit breaker
// ---------------------------------------------------------------------------

/// Block `run_command` calls when consecutive failures reach the hard limit (5+).
fn detect_blocked_commands(tool_calls: &[ToolCall], consecutive_failures: usize) -> Vec<usize> {
    if consecutive_failures < 5 {
        return vec![];
    }
    tool_calls
        .iter()
        .enumerate()
        .filter_map(|(i, tc)| {
            if tc.name == "run_command" {
                Some(i)
            } else {
                None
            }
        })
        .collect()
}

/// Update the consecutive failure counter and append hints to results.
/// Resets on any successful tool call; increments on `run_command` errors.
/// At 3+ consecutive failures, appends guidance to use built-in tools.
fn apply_cmd_failure_tracking(
    tool_calls: &[ToolCall],
    mut results: Vec<ToolCallResult>,
    consecutive_failures: &mut usize,
) -> Vec<ToolCallResult> {
    for (tc, result) in tool_calls.iter().zip(results.iter_mut()) {
        if tc.name == "run_command" && result.is_error {
            *consecutive_failures += 1;
            if *consecutive_failures >= 3 {
                result.content.push_str(&format!(
                    "\n\n[WARNING: {} consecutive run_command failures. \
                     Use search_code, read_file, find_files, or list_files instead \
                     of shell commands for code exploration.]",
                    *consecutive_failures,
                ));
            }
        } else if !result.is_error {
            *consecutive_failures = 0;
        }
    }
    results
}

#[cfg(test)]
#[path = "tool_loop_tests.rs"]
mod tests;
