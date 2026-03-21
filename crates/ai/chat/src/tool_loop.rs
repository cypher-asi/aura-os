use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::mpsc;
use tracing::{info, warn};

use aura_claude::{ContentBlock, RichMessage, ToolCall, ToolDefinition};
use aura_billing::MeteredLlm;
use crate::compaction;
use crate::constants::DEFAULT_EXPLORATION_ALLOWANCE;

pub use crate::tool_loop_types::*;
use crate::channel_ext::send_or_log;
use crate::chat_sanitize;
use crate::tool_loop_blocking::{
    BlockedResultContext, BlockingContext, WriteTrackingState,
    apply_cmd_failure_tracking, build_tool_result_blocks, decrement_write_file_cooldowns,
    detect_all_blocked, detect_stall_fail_fast, execute_with_blocked,
    summarize_write_file_input, track_write_failures,
};
use crate::tool_loop_read_guard::{self as read_guard, ReadGuardState};
use crate::tool_loop_budget::{
    BudgetState, ExplorationState,
    check_budget_warnings, inject_exploration_warnings, update_exploration_counts,
};
use crate::tool_loop_streaming::{
    run_single_iteration, IterationOutcome, IterationCompleted,
};

// ---------------------------------------------------------------------------
// Build state (auto-build cooldown and checkpoint tracking)
// ---------------------------------------------------------------------------

pub(crate) struct BuildState {
    pub(crate) auto_build_cooldown: usize,
    pub(crate) baseline: Option<BuildBaseline>,
    pub(crate) plan_checkpoint_sent: bool,
}

// ---------------------------------------------------------------------------
// Composite loop state
// ---------------------------------------------------------------------------

pub(crate) struct LoopState {
    pub(crate) api_messages: Vec<RichMessage>,
    pub(crate) total_text: String,
    pub(crate) total_thinking: String,
    pub(crate) total_input_tokens: u64,
    pub(crate) total_output_tokens: u64,
    pub(crate) file_read_cache: HashMap<String, u64>,
    pub(crate) consecutive_cmd_failures: usize,
    pub(crate) read_guard: ReadGuardState,
    pub(crate) exploration: ExplorationState,
    pub(crate) budget: BudgetState,
    pub(crate) writes: WriteTrackingState,
    pub(crate) build: BuildState,
}

impl LoopState {
    pub(crate) fn build_result(
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

// ---------------------------------------------------------------------------
// Main tool loop
// ---------------------------------------------------------------------------

/// Run the LLM tool loop, iterating between LLM calls and tool execution.
///
/// ## State machine
///
/// ```text
///  ┌──────────────────────────────────────────────────────────┐
///  │                     run_tool_loop                        │
///  │                                                         │
///  │   ┌─────────────┐    tool_use     ┌──────────────────┐  │
///  │   │ LLM call    │───────────────▶│ process_tool_calls│  │
///  │   │ (iteration) │                │ (execute+block)   │  │
///  │   └──────┬──────┘                └────────┬─────────┘  │
///  │          │                                 │            │
///  │          │ end_turn/                       │ continue   │
///  │          │ max_tokens/                     │            │
///  │          │ timeout/error                   ▼            │
///  │          │                       ┌──────────────────┐  │
///  │          │                       │ compaction +     │  │
///  │          │                       │ budget/explore   │  │
///  │          │                       │ warnings         │  │
///  │          │                       └────────┬─────────┘  │
///  │          │                                 │            │
///  │          │         ┌──────────────────────┘            │
///  │          │         │ next iteration                    │
///  │          │         ▼                                    │
///  │          │   ┌─────────────┐                           │
///  │          │   │ LLM call    │ (loop continues)          │
///  │          ▼   └─────────────┘                           │
///  │   ┌─────────────┐                                      │
///  │   │ Return      │                                      │
///  │   │ ToolLoop    │                                      │
///  │   │ Result      │                                      │
///  │   └─────────────┘                                      │
///  └──────────────────────────────────────────────────────────┘
///
/// Invariants:
///   - Each iteration calls LLM exactly once (via run_single_iteration)
///   - Tool calls are only executed when stop_reason == "tool_use"
///   - Blocked tools return error results without execution
///   - Exploration, write, and command counters are monotonically updated
///   - Context compaction only removes older messages, never the latest
///   - Budget check runs after every tool execution round
///   - Loop exits on: end_turn, max_iterations, timeout, budget exceeded,
///     stop_loop flag from executor, stall fail-fast, or LLM error
/// ```
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
    let build_baseline = executor.capture_build_baseline().await;
    let mut state = LoopState {
        api_messages: initial_messages,
        total_text: String::new(),
        total_thinking: String::new(),
        total_input_tokens: 0,
        total_output_tokens: 0,
        file_read_cache: HashMap::new(),
        consecutive_cmd_failures: 0,
        read_guard: ReadGuardState::new(),
        exploration: ExplorationState {
            total_calls: 0,
            allowance: config.exploration_allowance.unwrap_or(DEFAULT_EXPLORATION_ALLOWANCE),
            warning_mild_sent: false,
            warning_strong_sent: false,
        },
        budget: BudgetState {
            cumulative_credits: 0,
            warning_30_sent: false,
            warning_60_sent: false,
            warning_no_write_sent: false,
        },
        writes: WriteTrackingState {
            consecutive_write_tracker: HashMap::new(),
            file_write_failures: HashMap::new(),
            cooldowns: HashMap::new(),
            last_target_signature: None,
            no_progress_streak: 0,
        },
        build: BuildState {
            auto_build_cooldown: 0,
            baseline: build_baseline,
            plan_checkpoint_sent: false,
        },
    };

    for iteration in 0..config.max_iterations {
        info!(iteration, billing_reason = config.billing_reason, "tool_loop_iteration start");

        decrement_write_file_cooldowns(&mut state.writes.cooldowns);
        state.build.auto_build_cooldown = state.build.auto_build_cooldown.saturating_sub(1);
        let iter = match run_single_iteration(
            &llm, api_key, system_prompt, &tools, config, event_tx, &mut state, iteration,
        ).await {
            IterationOutcome::EarlyReturn(r) => return r,
            IterationOutcome::Completed(c) => c,
        };

        state.total_input_tokens += iter.input_tokens;
        state.total_output_tokens += iter.output_tokens;
        send_or_log(&event_tx, ToolLoopEvent::IterationTokenUsage {
            input_tokens: state.total_input_tokens,
            output_tokens: state.total_output_tokens,
        });

        let billing_model = if iter.model_used.is_empty() {
            aura_claude::DEFAULT_MODEL
        } else {
            &iter.model_used
        };
        let iter_credits = llm.estimate_credits(billing_model, iter.input_tokens, iter.output_tokens);
        state.budget.cumulative_credits += iter_credits;

        check_context_compaction(
            config,
            iter.input_tokens,
            !state.writes.cooldowns.is_empty(),
            &mut state.api_messages,
        );
        sanitize_after_compaction(&mut state.api_messages);
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
            sanitize_after_compaction(&mut state.api_messages);
            continue;
        }

        if iter.stop_reason != "tool_use" || iter.iter_tool_calls.is_empty() {
            return state.build_result(iteration + 1, false, false, None);
        }

        let should_stop = process_tool_calls(&iter, executor, event_tx, &mut state).await;
        if should_stop {
            return state.build_result(iteration + 1, false, false, None);
        }

        inject_exploration_warnings(&mut state.exploration, &mut state.api_messages);

        if let Some(budget) = config.credit_budget {
            if let Some(result) = check_budget_warnings(
                &mut state.budget, budget, billing_model, iter.input_tokens,
                &llm, event_tx, &mut state.api_messages,
            ) {
                return result.unwrap_or_else(|| state.build_result(iteration + 1, false, true, None));
            }
        }

        if iteration + 1 >= config.max_iterations {
            warn!(config.max_iterations, "Tool-use loop hit max iterations, stopping");
        }
    }

    state.build_result(config.max_iterations, false, false, None)
}

// ---------------------------------------------------------------------------
// Per-iteration tool call processing
// ---------------------------------------------------------------------------

async fn process_tool_calls(
    iter: &IterationCompleted,
    executor: &dyn ToolExecutor,
    event_tx: &mpsc::UnboundedSender<ToolLoopEvent>,
    state: &mut LoopState,
) -> bool {
    const STALL_FAIL_FAST_STREAK: usize = 3;

    let tool_names: Vec<&str> = iter.iter_tool_calls.iter().map(|tc| tc.name.as_str()).collect();
    info!(num_calls = iter.iter_tool_calls.len(), tools = ?tool_names, "process_tool_calls start");

    push_assistant_tool_message(&iter.iter_tool_calls, &iter.iter_text, &mut state.api_messages);

    let (all_blocked, blocked_sets, deferred_recovery_msgs) = {
        let mut ctx = BlockingContext {
            consecutive_write_tracker: &mut state.writes.consecutive_write_tracker,
            cooldowns: &mut state.writes.cooldowns,
            file_write_failures: &state.writes.file_write_failures,
            consecutive_cmd_failures: state.consecutive_cmd_failures,
            read_guard: &mut state.read_guard,
            exploration: &state.exploration,
        };
        detect_all_blocked(&iter.iter_tool_calls, &mut ctx)
    };

    let combined_reads = read_guard::combined_read_counts(&state.read_guard);
    let blocked_ctx = BlockedResultContext {
        file_write_failures: &state.writes.file_write_failures,
        cooldowns: &state.writes.cooldowns,
        consecutive_cmd_failures: state.consecutive_cmd_failures,
        file_read_counts: &combined_reads,
        exploration_total_calls: state.exploration.total_calls,
    };
    let results = execute_with_blocked(
        &iter.iter_tool_calls, executor, &all_blocked, &blocked_sets, &blocked_ctx,
    ).await;

    track_write_failures(&iter.iter_tool_calls, &results, &mut state.writes.file_write_failures);

    let results = apply_cmd_failure_tracking(
        &iter.iter_tool_calls,
        results,
        &mut state.consecutive_cmd_failures,
    );

    let (result_blocks, should_stop) = build_tool_result_blocks(
        &iter.iter_tool_calls, &results, &mut state.file_read_cache, event_tx,
    );
    state.api_messages.push(RichMessage::tool_results(result_blocks));

    for recovery in deferred_recovery_msgs {
        state.api_messages.push(RichMessage::user(&recovery));
    }

    if detect_stall_fail_fast(
        &iter.iter_tool_calls, &results, &mut state.writes,
        STALL_FAIL_FAST_STREAK, event_tx, &mut state.api_messages,
    ) {
        return true;
    }

    update_exploration_counts(&iter.iter_tool_calls, &all_blocked, &mut state.exploration);

    let had_write = iter.iter_tool_calls
        .iter()
        .enumerate()
        .any(|(i, tc)| {
            !all_blocked.contains(&i)
                && matches!(tc.name.as_str(), "write_file" | "edit_file")
        });
    if had_write {
        state.exploration.allowance = state.exploration.total_calls + 4;
        maybe_emit_checkpoint(&mut state.build, &mut state.api_messages);
        maybe_run_auto_build(executor, &mut state.build, &mut state.api_messages).await;
    }

    maybe_compact_after_exploration(
        &state.exploration,
        &state.writes.cooldowns,
        &mut state.api_messages,
    );

    should_stop
}

// ---------------------------------------------------------------------------
// Compaction and sanitization helpers
// ---------------------------------------------------------------------------

fn check_context_compaction(
    config: &ToolLoopConfig,
    iteration_input_tokens: u64,
    duplicate_stall_active: bool,
    api_messages: &mut Vec<RichMessage>,
) {
    if let Some(max_ctx) = config.max_context_tokens {
        let utilization = iteration_input_tokens as f64 / max_ctx as f64;
        info!(
            input_tokens = iteration_input_tokens,
            max_context = max_ctx,
            utilization_pct = (utilization * 100.0) as u32,
            message_count = api_messages.len(),
            "context_compaction check"
        );
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
            compaction::compact_older_message_text_tiered(
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
            compaction::compact_older_message_text_tiered(
                api_messages, 3, &compaction::AGGRESSIVE,
            );
        } else if utilization > 0.60 {
            info!(
                input_tokens = iteration_input_tokens,
                max_context = max_ctx,
                utilization_pct = (utilization * 100.0) as u32,
                "Context >60% full, moderate compaction (keep last 4)"
            );
            compaction::compact_older_tool_results(api_messages, 4);
        } else if utilization > 0.30 {
            info!(
                input_tokens = iteration_input_tokens,
                max_context = max_ctx,
                utilization_pct = (utilization * 100.0) as u32,
                "Context >30% full, early compaction (keep last 5)"
            );
            compaction::compact_older_tool_results_tiered(
                api_messages, 5, &compaction::MICRO,
            );
        }

        if duplicate_stall_active && utilization > 0.45 {
            info!(
                input_tokens = iteration_input_tokens,
                max_context = max_ctx,
                utilization_pct = (utilization * 100.0) as u32,
                "Duplicate-write stall active, compacting non-tool text as well"
            );
            compaction::compact_older_message_text_tiered(
                api_messages, 4, &compaction::AGGRESSIVE,
            );
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
        send_or_log(&event_tx, ToolLoopEvent::ToolResult {
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

fn push_assistant_tool_message(
    tool_calls: &[ToolCall],
    iter_text: &str,
    api_messages: &mut Vec<RichMessage>,
) {
    let mut assistant_blocks: Vec<ContentBlock> = Vec::new();
    if !iter_text.is_empty() {
        assistant_blocks.push(ContentBlock::Text { text: iter_text.to_string() });
    }
    for tc in tool_calls {
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
}

// ---------------------------------------------------------------------------
// Build and exploration post-processing
// ---------------------------------------------------------------------------

fn maybe_emit_checkpoint(build: &mut BuildState, api_messages: &mut Vec<RichMessage>) {
    if !build.plan_checkpoint_sent {
        build.plan_checkpoint_sent = true;
        api_messages.push(RichMessage::user(
            "[IMPLEMENTATION CHECKPOINT] You just made your first write. Before continuing, verify:\n\
             1. Exact struct/type definitions for types you reference\n\
             2. Method signatures for functions you call\n\
             3. Required imports\n\
             If any of these are uncertain, use one more read_file or search_code call to confirm \
             before proceeding with further writes."
        ));
    }
}

async fn maybe_run_auto_build(
    executor: &dyn ToolExecutor,
    build: &mut BuildState,
    api_messages: &mut Vec<RichMessage>,
) {
    if build.auto_build_cooldown == 0 {
        if let Some(build_result) = executor.auto_build_check().await {
            build.auto_build_cooldown = 2;
            let status = if build_result.success { "PASSED" } else { "FAILED" };
            let output = if let Some(ref baseline) = build.baseline {
                baseline.annotate(&build_result.output)
            } else {
                build_result.output
            };
            let msg = format!("[AUTO-BUILD] Build check {status}:\n{output}");
            info!(success = build_result.success, "Auto-build check after write batch");
            api_messages.push(RichMessage::user(&msg));
        }
    }
}

fn maybe_compact_after_exploration(
    exploration: &ExplorationState,
    write_cooldowns: &HashMap<String, usize>,
    api_messages: &mut Vec<RichMessage>,
) {
    let compaction_threshold = (exploration.allowance * 2) / 3;
    if exploration.total_calls >= compaction_threshold {
        info!(
            total_exploration = exploration.total_calls,
            threshold = compaction_threshold,
            "High exploration accumulation, proactively compacting older tool results"
        );
        compaction::compact_older_tool_results(api_messages, 4);
        if !write_cooldowns.is_empty() {
            compaction::compact_older_message_text_tiered(
                api_messages, 4, &compaction::AGGRESSIVE,
            );
        }
        sanitize_after_compaction(api_messages);
    }
}

/// Re-run message sanitization after any compaction pass to fix orphaned
/// tool_use / tool_result pairs and broken role alternation that
/// compaction may have created.
fn sanitize_after_compaction(messages: &mut Vec<RichMessage>) {
    let msgs = std::mem::take(messages);
    let msgs = chat_sanitize::sanitize_orphan_tool_results(msgs);
    let msgs = chat_sanitize::sanitize_tool_use_results(msgs);
    let msgs = chat_sanitize::merge_consecutive_same_role_pub(msgs);
    *messages = msgs;
}

pub(crate) fn append_text(total: &mut String, new: &str) {
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
