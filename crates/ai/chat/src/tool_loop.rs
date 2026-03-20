use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::mpsc;
use tracing::{info, warn};

use aura_claude::{ContentBlock, RichMessage, ToolCall, ToolDefinition};
use aura_billing::MeteredLlm;
use crate::compaction;

pub use crate::tool_loop_types::*;
use crate::channel_ext::send_or_log;
use crate::chat_sanitize;
use crate::tool_loop_helpers::{
    detect_blocked_writes, detect_blocked_commands, detect_blocked_reads,
    detect_blocked_exploration, detect_blocked_write_failures,
    apply_cmd_failure_tracking,
    build_tool_result_blocks, summarize_write_file_input,
};
use crate::tool_loop_streaming::{
    run_single_iteration, IterationOutcome, IterationCompleted,
};

pub(crate) struct ExplorationState {
    pub(crate) total_calls: usize,
    pub(crate) allowance: usize,
    pub(crate) warning_mild_sent: bool,
    pub(crate) warning_strong_sent: bool,
}

pub(crate) struct BudgetState {
    pub(crate) cumulative_credits: u64,
    pub(crate) warning_30_sent: bool,
    pub(crate) warning_60_sent: bool,
}

pub(crate) struct WriteTrackingState {
    pub(crate) consecutive_write_tracker: HashMap<String, usize>,
    pub(crate) file_write_failures: HashMap<String, usize>,
    pub(crate) cooldowns: HashMap<String, usize>,
    pub(crate) last_target_signature: Option<String>,
    pub(crate) no_progress_streak: usize,
}

pub(crate) struct BuildState {
    pub(crate) auto_build_cooldown: usize,
    pub(crate) baseline: Option<BuildBaseline>,
    pub(crate) plan_checkpoint_sent: bool,
}

pub(crate) struct LoopState {
    pub(crate) api_messages: Vec<RichMessage>,
    pub(crate) total_text: String,
    pub(crate) total_thinking: String,
    pub(crate) total_input_tokens: u64,
    pub(crate) total_output_tokens: u64,
    pub(crate) file_read_cache: HashMap<String, u64>,
    pub(crate) consecutive_cmd_failures: usize,
    pub(crate) file_read_counts: HashMap<String, usize>,
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
        file_read_counts: HashMap::new(),
        exploration: ExplorationState {
            total_calls: 0,
            allowance: config.exploration_allowance.unwrap_or(12),
            warning_mild_sent: false,
            warning_strong_sent: false,
        },
        budget: BudgetState {
            cumulative_credits: 0,
            warning_30_sent: false,
            warning_60_sent: false,
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

fn inject_exploration_warnings(
    exploration: &mut ExplorationState,
    api_messages: &mut Vec<RichMessage>,
) {
    let strong_threshold = exploration.allowance.saturating_sub(2);
    let mild_threshold = exploration.allowance.saturating_sub(4);

    if exploration.total_calls >= strong_threshold && !exploration.warning_strong_sent {
        exploration.warning_strong_sent = true;
        let warning = format!(
            "[EXPLORATION WARNING] {} of ~{} exploration calls used. Further reads will be limited. \
             Begin writing immediately.",
            exploration.total_calls, exploration.allowance,
        );
        info!(total_exploration = exploration.total_calls, allowance = exploration.allowance, "Injecting strong exploration warning");
        api_messages.push(RichMessage::user(&warning));
    } else if exploration.total_calls >= mild_threshold && !exploration.warning_mild_sent {
        exploration.warning_mild_sent = true;
        let warning = format!(
            "[EXPLORATION WARNING] You have done {} of ~{} exploration calls. \
             Start implementing now.",
            exploration.total_calls, exploration.allowance,
        );
        info!(total_exploration = exploration.total_calls, allowance = exploration.allowance, "Injecting exploration warning");
        api_messages.push(RichMessage::user(&warning));
    }
}

/// Check credit budget utilization and inject warnings or stop the loop.
/// Returns `None` to continue, `Some(None)` to stop with insufficient_credits,
/// or `Some(Some(result))` to return a specific result.
fn check_budget_warnings(
    budget_state: &mut BudgetState,
    budget: u64,
    billing_model: &str,
    iter_input_tokens: u64,
    llm: &MeteredLlm,
    event_tx: &mpsc::UnboundedSender<ToolLoopEvent>,
    api_messages: &mut Vec<RichMessage>,
) -> Option<Option<ToolLoopResult>> {
    let utilization = if budget > 0 {
        budget_state.cumulative_credits as f64 / budget as f64
    } else {
        0.0
    };

    if utilization >= 0.60 && !budget_state.warning_60_sent {
        budget_state.warning_60_sent = true;
        let warning = format!(
            "[BUDGET WARNING] You have used ~{:.0}% of your credit budget. \
             Wrap up immediately: finish the current edit, verify it compiles, \
             and call task_done. Do NOT start new explorations.",
            utilization * 100.0,
        );
        info!(utilization_pct = (utilization * 100.0) as u32, "Injecting 60% budget warning");
        api_messages.push(RichMessage::user(&warning));
    } else if utilization >= 0.30 && !budget_state.warning_30_sent {
        budget_state.warning_30_sent = true;
        let warning = format!(
            "[BUDGET WARNING] You have used ~{:.0}% of your credit budget. \
             Prioritize completing the implementation over further exploration. \
             Focus on writing and verifying code.",
            utilization * 100.0,
        );
        info!(utilization_pct = (utilization * 100.0) as u32, "Injecting 30% budget warning");
        api_messages.push(RichMessage::user(&warning));
    }

    let next_estimate = llm.estimate_credits(billing_model, iter_input_tokens, 0);
    if budget_state.cumulative_credits + next_estimate > budget {
        warn!(
            budget_state.cumulative_credits, next_estimate, budget,
            "Credit budget would be exceeded, stopping tool loop"
        );
        send_or_log(&event_tx, ToolLoopEvent::Error(
            "Stopping: credit budget for this session would be exceeded.".to_string(),
        ));
        return Some(None);
    }

    None
}

fn check_context_compaction(
    config: &ToolLoopConfig,
    iteration_input_tokens: u64,
    duplicate_stall_active: bool,
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

async fn process_tool_calls(
    iter: &IterationCompleted,
    executor: &dyn ToolExecutor,
    event_tx: &mpsc::UnboundedSender<ToolLoopEvent>,
    state: &mut LoopState,
) -> bool {
    const STALL_FAIL_FAST_STREAK: usize = 3;

    push_assistant_tool_message(&iter.iter_tool_calls, &iter.iter_text, &mut state.api_messages);

    let (all_blocked, blocked_sets, deferred_recovery_msgs) =
        detect_all_blocked(&iter.iter_tool_calls, state);

    let results = execute_with_blocked(
        &iter.iter_tool_calls, executor, &all_blocked, &blocked_sets, state,
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

struct BlockedSets {
    duplicate_write: Vec<usize>,
    write_fail: Vec<usize>,
    cooldown: Vec<usize>,
    cmd: Vec<usize>,
    read: Vec<usize>,
    exploration: Vec<usize>,
}

fn detect_all_blocked(
    tool_calls: &[ToolCall],
    state: &mut LoopState,
) -> (Vec<usize>, BlockedSets, Vec<String>) {
    const FULL_REWRITE_BLOCK_ITERS: usize = 3;

    let duplicate_write = detect_blocked_writes(tool_calls, &mut state.writes.consecutive_write_tracker);
    let cooldown = detect_write_file_cooldowns(tool_calls, &state.writes.cooldowns);
    let write_fail = detect_blocked_write_failures(tool_calls, &state.writes.file_write_failures);
    let cmd = detect_blocked_commands(tool_calls, state.consecutive_cmd_failures);
    let read = detect_blocked_reads(tool_calls, &mut state.file_read_counts);
    let exploration_is_blocked = state.exploration.total_calls >= state.exploration.allowance;
    let exploration = detect_blocked_exploration(tool_calls, exploration_is_blocked);

    let all_blocked: Vec<usize> = {
        let mut v = duplicate_write.clone();
        for i in write_fail.iter()
            .chain(cooldown.iter())
            .chain(cmd.iter())
            .chain(read.iter())
            .chain(exploration.iter())
        {
            if !v.contains(i) {
                v.push(*i);
            }
        }
        v
    };

    let duplicate_paths = collect_duplicate_write_paths(tool_calls, &duplicate_write);
    let mut deferred_recovery_msgs: Vec<String> = Vec::new();
    for path in &duplicate_paths {
        state.writes.cooldowns.insert(path.clone(), FULL_REWRITE_BLOCK_ITERS);
        let recovery = format!(
            "[STALL RECOVERY] Repeated full-file write_file attempts detected for '{path}'. \
             For the next {FULL_REWRITE_BLOCK_ITERS} iterations, write_file is blocked for this path. \
             Use edit_file instead: (1) read_file with a line range, (2) edit_file for one small \
             section/function at a time, (3) verify before the next edit. Do NOT rewrite the full file."
        );
        info!(path = path.as_str(), "Injecting adaptive rewrite recovery instruction");
        deferred_recovery_msgs.push(recovery);
    }

    let sets = BlockedSets { duplicate_write, write_fail, cooldown, cmd, read, exploration };
    (all_blocked, sets, deferred_recovery_msgs)
}

async fn execute_with_blocked(
    tool_calls: &[ToolCall],
    executor: &dyn ToolExecutor,
    all_blocked: &[usize],
    sets: &BlockedSets,
    state: &LoopState,
) -> Vec<ToolCallResult> {
    let allowed_calls: Vec<ToolCall> = tool_calls
        .iter()
        .enumerate()
        .filter(|(i, _)| !all_blocked.contains(i))
        .map(|(_, tc)| tc.clone())
        .collect();
    let allowed_results = executor.execute(&allowed_calls).await;

    let mut allowed_iter = allowed_results.into_iter();
    tool_calls
        .iter()
        .enumerate()
        .map(|(i, tc)| {
            if let Some(blocked) = build_blocked_result(i, tc, sets, state) {
                blocked
            } else {
                allowed_iter.next().unwrap_or_else(|| ToolCallResult {
                    tool_use_id: tc.id.clone(),
                    content: "internal error: result count mismatch".to_string(),
                    is_error: true,
                    stop_loop: false,
                })
            }
        })
        .collect()
}

enum BlockReason<'a> {
    DuplicateWrite { path: &'a str },
    WriteFail { path: &'a str, count: usize },
    Cooldown { path: &'a str, remaining: usize },
    CommandBlocked { consecutive_failures: usize },
    ReadBlocked { path: &'a str, count: usize },
    ExplorationBlocked { total_calls: usize },
}

fn classify_block<'a>(index: usize, tc: &'a ToolCall, sets: &BlockedSets, state: &LoopState) -> Option<BlockReason<'a>> {
    let path = || tc.input.get("path").and_then(|v| v.as_str()).unwrap_or("unknown");

    if sets.duplicate_write.contains(&index) {
        Some(BlockReason::DuplicateWrite { path: path() })
    } else if sets.write_fail.contains(&index) {
        Some(BlockReason::WriteFail { path: path(), count: state.writes.file_write_failures.get(path()).copied().unwrap_or(0) })
    } else if sets.cooldown.contains(&index) {
        Some(BlockReason::Cooldown { path: path(), remaining: state.writes.cooldowns.get(path()).copied().unwrap_or(0) })
    } else if sets.cmd.contains(&index) {
        Some(BlockReason::CommandBlocked { consecutive_failures: state.consecutive_cmd_failures })
    } else if sets.read.contains(&index) {
        Some(BlockReason::ReadBlocked { path: path(), count: state.file_read_counts.get(path()).copied().unwrap_or(0) })
    } else if sets.exploration.contains(&index) {
        Some(BlockReason::ExplorationBlocked { total_calls: state.exploration.total_calls })
    } else {
        None
    }
}

fn build_blocked_result(
    index: usize,
    tc: &ToolCall,
    sets: &BlockedSets,
    state: &LoopState,
) -> Option<ToolCallResult> {
    let reason = classify_block(index, tc, sets, state)?;

    let content = match reason {
        BlockReason::DuplicateWrite { path } => {
            warn!(path, tool = %tc.name, "Blocked consecutive duplicate write/edit (2+ in a row)");
            serde_json::json!({
                "error": format!(
                    "You have called {} on '{}' repeatedly without success. \
                     Your output is likely being truncated due to context pressure. \
                     Break the file into smaller writes: write a skeleton first with \
                     function signatures, then use edit_file to fill in one function \
                     body at a time.",
                    tc.name, path
                )
            }).to_string()
        }
        BlockReason::WriteFail { path, count } => {
            warn!(path, count, tool = %tc.name, "Blocked write after repeated failures");
            format!(
                "Writes to '{path}' blocked after {count} failures. STOP trying to write this file. \
                 Run `git checkout -- {path}` to restore it, then read_file to see the recovered content, \
                 and try a fundamentally different approach with small targeted edits."
            )
        }
        BlockReason::Cooldown { path, remaining } => {
            warn!(path, remaining, "Blocked write_file during adaptive cooldown");
            format!(
                "write_file on '{path}' is temporarily blocked for {remaining} more iterations \
                 due to repeated rewrite stalls. Use edit_file with small, targeted chunks instead \
                 of rewriting the full file."
            )
        }
        BlockReason::CommandBlocked { consecutive_failures } => {
            warn!(tool = %tc.name, consecutive_failures,
                "Blocked run_command after 5+ consecutive failures");
            "run_command is temporarily blocked after 5+ consecutive failures. \
             Use search_code, read_file, find_files, or list_files instead. \
             run_command will be unblocked after you successfully use another tool."
                .to_string()
        }
        BlockReason::ReadBlocked { path, count } => {
            warn!(path, count, "Blocked fragmented re-read of same file");
            format!(
                "BLOCKED: You have read '{}' {} times. Use the content you already have. \
                 If you need a specific section, use search_code to find the exact lines.",
                path, count
            )
        }
        BlockReason::ExplorationBlocked { total_calls } => {
            warn!(tool = %tc.name, total_calls, "Blocked exploration call (hard limit reached)");
            format!(
                "Exploration blocked after {} calls. Use the context you have and start \
                 implementing. Reads will unblock after you use write_file or edit_file.",
                total_calls
            )
        }
    };

    Some(ToolCallResult {
        tool_use_id: tc.id.clone(),
        content,
        is_error: true,
        stop_loop: false,
    })
}

fn track_write_failures(
    tool_calls: &[ToolCall],
    results: &[ToolCallResult],
    file_write_failures: &mut HashMap<String, usize>,
) {
    for (tc, result) in tool_calls.iter().zip(results.iter()) {
        if matches!(tc.name.as_str(), "write_file" | "edit_file") {
            if let Some(path) = tc.input.get("path").and_then(|v| v.as_str()) {
                if result.is_error {
                    *file_write_failures.entry(path.to_string()).or_insert(0) += 1;
                } else {
                    file_write_failures.remove(path);
                }
            }
        }
    }
}

fn detect_stall_fail_fast(
    tool_calls: &[ToolCall],
    results: &[ToolCallResult],
    writes: &mut WriteTrackingState,
    streak_threshold: usize,
    event_tx: &mpsc::UnboundedSender<ToolLoopEvent>,
    api_messages: &mut Vec<RichMessage>,
) -> bool {
    let fail_fast_stall = detect_same_target_stall(
        tool_calls,
        results,
        &mut writes.last_target_signature,
        &mut writes.no_progress_streak,
    );
    if fail_fast_stall && writes.no_progress_streak >= streak_threshold {
        let recovery = format!(
            "[STALL FAIL-FAST] Repeated write/edit attempts are targeting the same file set \
             without successful progress for {} iterations. Stop this loop now and restart with \
             a recovery strategy: (1) read a narrow line range, (2) apply a single small edit_file \
             change, (3) verify, then continue incrementally.",
            writes.no_progress_streak
        );
        warn!(
            streak = writes.no_progress_streak,
            "Fail-fast triggered due to same-target no-progress stall"
        );
        send_or_log(&event_tx, ToolLoopEvent::Error(recovery.clone()));
        api_messages.push(RichMessage::user(&recovery));
        return true;
    }
    false
}

fn update_exploration_counts(
    tool_calls: &[ToolCall],
    all_blocked: &[usize],
    exploration: &mut ExplorationState,
) {
    let count = tool_calls
        .iter()
        .enumerate()
        .filter(|(i, tc)| {
            !all_blocked.contains(i)
                && matches!(tc.name.as_str(), "read_file" | "search_code" | "find_files" | "list_files")
        })
        .count();
    exploration.total_calls += count;
}

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

fn detect_write_file_cooldowns(
    tool_calls: &[ToolCall],
    cooldowns: &HashMap<String, usize>,
) -> Vec<usize> {
    tool_calls
        .iter()
        .enumerate()
        .filter_map(|(i, tc)| {
            if tc.name != "write_file" {
                return None;
            }
            let path = tc.input.get("path").and_then(|v| v.as_str()).unwrap_or("");
            if cooldowns.get(path).copied().unwrap_or(0) > 0 {
                Some(i)
            } else {
                None
            }
        })
        .collect()
}

fn collect_duplicate_write_paths(tool_calls: &[ToolCall], blocked_indices: &[usize]) -> Vec<String> {
    let mut paths: Vec<String> = Vec::new();
    for i in blocked_indices {
        if let Some(tc) = tool_calls.get(*i) {
            if tc.name == "write_file" {
                if let Some(path) = tc.input.get("path").and_then(|v| v.as_str()) {
                    if !paths.contains(&path.to_string()) {
                        paths.push(path.to_string());
                    }
                }
            }
        }
    }
    paths
}

fn decrement_write_file_cooldowns(cooldowns: &mut HashMap<String, usize>) {
    cooldowns.retain(|_, remaining| {
        if *remaining == 0 {
            return false;
        }
        *remaining -= 1;
        *remaining > 0
    });
}

fn detect_same_target_stall(
    tool_calls: &[ToolCall],
    results: &[ToolCallResult],
    last_signature: &mut Option<String>,
    no_progress_streak: &mut usize,
) -> bool {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut write_paths: Vec<String> = Vec::new();
    let mut had_write_success = false;
    let mut had_edit_success = false;
    let mut content_hasher = DefaultHasher::new();

    for (tc, result) in tool_calls.iter().zip(results.iter()) {
        if matches!(tc.name.as_str(), "write_file" | "edit_file") {
            if let Some(path) = tc.input.get("path").and_then(|v| v.as_str()) {
                write_paths.push(path.to_string());
            }
            if !result.is_error {
                if tc.name == "edit_file" {
                    had_edit_success = true;
                }
                had_write_success = true;
            }
            if let Some(c) = tc.input.get("content").and_then(|v| v.as_str()) {
                c.hash(&mut content_hasher);
            }
            if let Some(c) = tc.input.get("new_text").and_then(|v| v.as_str()) {
                c.hash(&mut content_hasher);
            }
        }
    }

    if write_paths.is_empty() {
        *last_signature = None;
        *no_progress_streak = 0;
        return false;
    }

    // Successful edit_file calls always represent forward progress (appending
    // new code sections, patching different spots), so reset the streak.
    // Only successful write_file to different content also resets.
    if had_edit_success {
        *last_signature = None;
        *no_progress_streak = 0;
        return false;
    }

    // Any successful write_file with different content = progress
    if had_write_success {
        write_paths.sort();
        write_paths.dedup();
        let content_hash = content_hasher.finish();
        let signature = format!("{}#{:x}", write_paths.join("|"), content_hash);
        if last_signature.as_deref() != Some(signature.as_str()) {
            *last_signature = Some(signature);
            *no_progress_streak = 0;
            return false;
        }
    }

    // All writes failed, or successful but identical content = no progress
    write_paths.sort();
    write_paths.dedup();
    let content_hash = content_hasher.finish();
    let signature = format!("{}#{:x}", write_paths.join("|"), content_hash);

    if last_signature.as_deref() == Some(signature.as_str()) {
        *no_progress_streak += 1;
    } else {
        *last_signature = Some(signature);
        *no_progress_streak = 1;
    }

    *no_progress_streak >= 3
}

#[cfg(test)]
#[path = "tool_loop_tests.rs"]
mod tests;
