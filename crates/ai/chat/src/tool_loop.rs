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
use crate::tool_loop_helpers::{
    detect_blocked_writes, detect_blocked_commands, detect_blocked_reads,
    detect_blocked_exploration, apply_cmd_failure_tracking,
    build_tool_result_blocks, summarize_write_file_input,
};

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
    file_read_counts: HashMap<String, usize>,
    total_exploration_calls: usize,
    exploration_allowance: usize,
    exploration_warning_8_sent: bool,
    exploration_warning_10_sent: bool,
    budget_warning_30_sent: bool,
    budget_warning_60_sent: bool,
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
        file_read_counts: HashMap::new(),
        total_exploration_calls: 0,
        exploration_allowance: 12,
        exploration_warning_8_sent: false,
        exploration_warning_10_sent: false,
        budget_warning_30_sent: false,
        budget_warning_60_sent: false,
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

        if iter.stop_reason == "max_tokens" && !iter.iter_tool_calls.is_empty() {
            warn!(
                iteration,
                tool_calls = iter.iter_tool_calls.len(),
                "Output truncated mid-tool-call (stop_reason=max_tokens), skipping execution"
            );
            handle_truncated_tool_calls(&iter, event_tx, &mut state);
            compaction::compact_older_tool_results_tiered(
                &mut state.api_messages, 2, &compaction::HISTORY,
            );
            continue;
        }

        if iter.stop_reason != "tool_use" || iter.iter_tool_calls.is_empty() {
            return state.build_result(iteration + 1, false, false, None);
        }

        let should_stop = process_tool_calls(&iter, executor, event_tx, &mut state).await;
        if should_stop {
            return state.build_result(iteration + 1, false, false, None);
        }

        if state.total_exploration_calls >= 10 && !state.exploration_warning_10_sent {
            state.exploration_warning_10_sent = true;
            let warning = format!(
                "[EXPLORATION WARNING] {} exploration calls. Further reads will be limited. \
                 Begin writing immediately.",
                state.total_exploration_calls,
            );
            info!(total_exploration = state.total_exploration_calls, "Injecting strong exploration warning");
            state.api_messages.push(RichMessage::user(&warning));
        } else if state.total_exploration_calls >= 8 && !state.exploration_warning_8_sent {
            state.exploration_warning_8_sent = true;
            let warning = format!(
                "[EXPLORATION WARNING] You have done {} exploration calls. \
                 Start implementing now.",
                state.total_exploration_calls,
            );
            info!(total_exploration = state.total_exploration_calls, "Injecting exploration warning");
            state.api_messages.push(RichMessage::user(&warning));
        }

        if let Some(budget) = config.credit_budget {
            let utilization = if budget > 0 {
                state.cumulative_credits as f64 / budget as f64
            } else {
                0.0
            };

            if utilization >= 0.60 && !state.budget_warning_60_sent {
                state.budget_warning_60_sent = true;
                let warning = format!(
                    "[BUDGET WARNING] You have used ~{:.0}% of your credit budget. \
                     Wrap up immediately: finish the current edit, verify it compiles, \
                     and call task_done. Do NOT start new explorations.",
                    utilization * 100.0,
                );
                info!(utilization_pct = (utilization * 100.0) as u32, "Injecting 60% budget warning");
                state.api_messages.push(RichMessage::user(&warning));
            } else if utilization >= 0.30 && !state.budget_warning_30_sent {
                state.budget_warning_30_sent = true;
                let warning = format!(
                    "[BUDGET WARNING] You have used ~{:.0}% of your credit budget. \
                     Prioritize completing the implementation over further exploration. \
                     Focus on writing and verifying code.",
                    utilization * 100.0,
                );
                info!(utilization_pct = (utilization * 100.0) as u32, "Injecting 30% budget warning");
                state.api_messages.push(RichMessage::user(&warning));
            }

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
        if utilization > 0.85 {
            info!(
                input_tokens = iteration_input_tokens,
                max_context = max_ctx,
                utilization_pct = (utilization * 100.0) as u32,
                "Context >85% full, emergency compaction (keep last 2)"
            );
            compaction::compact_older_tool_results_tiered(
                api_messages, 2, &compaction::HISTORY,
            );
        } else if utilization > 0.70 {
            info!(
                input_tokens = iteration_input_tokens,
                max_context = max_ctx,
                utilization_pct = (utilization * 100.0) as u32,
                "Context >70% full, aggressive compaction (keep last 3)"
            );
            compaction::compact_older_tool_results_tiered(
                api_messages, 3, &compaction::AGGRESSIVE,
            );
        } else if utilization > 0.50 {
            info!(
                input_tokens = iteration_input_tokens,
                max_context = max_ctx,
                utilization_pct = (utilization * 100.0) as u32,
                "Context >50% full, moderate compaction (keep last 4)"
            );
            compaction::compact_older_tool_results(api_messages, 4);
        }
    }
}

fn handle_truncated_tool_calls(
    iter: &IterationCompleted,
    event_tx: &mpsc::UnboundedSender<ToolLoopEvent>,
    state: &mut LoopState,
) {
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

    let mut result_blocks: Vec<ContentBlock> = Vec::new();
    for tc in &iter.iter_tool_calls {
        let msg = format!(
            "ERROR: Your output was truncated (stop_reason=max_tokens) so this {} call \
             was NOT executed — the arguments were likely incomplete. Context is too large. \
             Break the work into smaller steps: write a skeleton first, then use edit_file \
             to fill in one section at a time.",
            tc.name
        );
        let _ = event_tx.send(ToolLoopEvent::ToolResult {
            tool_use_id: tc.id.clone(),
            tool_name: tc.name.clone(),
            content: msg.clone(),
            is_error: true,
        });
        result_blocks.push(ContentBlock::ToolResult {
            tool_use_id: tc.id.clone(),
            content: msg,
            is_error: Some(true),
        });
    }
    state.api_messages.push(RichMessage::tool_results(result_blocks));
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
    let read_blocked_indices = detect_blocked_reads(&iter.iter_tool_calls, &mut state.file_read_counts);
    let exploration_is_blocked = state.total_exploration_calls >= state.exploration_allowance;
    let exploration_blocked_indices = detect_blocked_exploration(&iter.iter_tool_calls, exploration_is_blocked);

    let all_blocked: Vec<usize> = {
        let mut v = blocked_indices.clone();
        for i in cmd_blocked_indices.iter()
            .chain(read_blocked_indices.iter())
            .chain(exploration_blocked_indices.iter())
        {
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
                            "You have called {} on '{}' 3+ times consecutively without success. \
                             Your output is likely being truncated due to context pressure. \
                             Break the file into smaller writes: write a skeleton first with \
                             function signatures, then use edit_file to fill in one function \
                             body at a time.",
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
            } else if read_blocked_indices.contains(&i) {
                let path = tc.input.get("path").and_then(|v| v.as_str()).unwrap_or("unknown");
                let count = state.file_read_counts.get(path).copied().unwrap_or(0);
                warn!(path, count, "Blocked fragmented re-read of same file");
                ToolCallResult {
                    tool_use_id: tc.id.clone(),
                    content: format!(
                        "BLOCKED: You have read '{}' {} times. Use the content you already have. \
                         If you need a specific section, use search_code to find the exact lines.",
                        path, count
                    ),
                    is_error: true,
                    stop_loop: false,
                }
            } else if exploration_blocked_indices.contains(&i) {
                warn!(tool = %tc.name, total = state.total_exploration_calls,
                    "Blocked exploration call (hard limit reached)");
                ToolCallResult {
                    tool_use_id: tc.id.clone(),
                    content: format!(
                        "Exploration blocked after {} calls. Use the context you have and start \
                         implementing. Reads will unblock after you use write_file or edit_file.",
                        state.total_exploration_calls
                    ),
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

    let exploration_count = iter.iter_tool_calls
        .iter()
        .enumerate()
        .filter(|(i, tc)| {
            !all_blocked.contains(i)
                && matches!(tc.name.as_str(), "read_file" | "search_code" | "find_files" | "list_files")
        })
        .count();
    state.total_exploration_calls += exploration_count;

    let had_write = iter.iter_tool_calls
        .iter()
        .enumerate()
        .any(|(i, tc)| {
            !all_blocked.contains(&i)
                && matches!(tc.name.as_str(), "write_file" | "edit_file")
        });
    if had_write {
        state.exploration_allowance = state.total_exploration_calls + 4;
    }

    if state.total_exploration_calls >= 8 {
        info!(
            total_exploration = state.total_exploration_calls,
            "High exploration accumulation, proactively compacting older tool results"
        );
        compaction::compact_older_tool_results(&mut state.api_messages, 4);
    }

    let (result_blocks, should_stop) = build_tool_result_blocks(
        &iter.iter_tool_calls, &results, &mut state.file_read_cache, event_tx,
    );
    state.api_messages.push(RichMessage::tool_results(result_blocks));
    should_stop
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
#[path = "tool_loop_tests.rs"]
mod tests;
