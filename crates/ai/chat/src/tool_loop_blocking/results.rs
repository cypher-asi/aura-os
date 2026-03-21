use std::collections::HashMap;

use tracing::warn;

use aura_claude::ToolCall;
use crate::tool_loop_types::ToolCallResult;
use crate::tool_loop_read_guard as read_guard;
use super::BlockedSets;

enum BlockReason<'a> {
    DuplicateWrite { path: &'a str },
    WriteFail { path: &'a str, count: usize },
    Cooldown { path: &'a str, remaining: usize },
    CommandBlocked { consecutive_failures: usize },
    ReadBlocked { path: &'a str, count: usize },
    ShellReadBlocked,
    ExplorationBlocked { total_calls: usize },
}

/// State needed to classify and generate blocked results.
pub(crate) struct BlockedResultContext<'a> {
    pub(crate) file_write_failures: &'a HashMap<String, usize>,
    pub(crate) cooldowns: &'a HashMap<String, usize>,
    pub(crate) consecutive_cmd_failures: usize,
    pub(crate) file_read_counts: &'a HashMap<String, usize>,
    pub(crate) exploration_total_calls: usize,
}

fn classify_block<'a>(
    index: usize,
    tc: &'a ToolCall,
    sets: &BlockedSets,
    ctx: &BlockedResultContext<'_>,
) -> Option<BlockReason<'a>> {
    let path = || tc.input.get("path").and_then(|v| v.as_str()).unwrap_or("unknown");

    if sets.duplicate_write.contains(&index) {
        Some(BlockReason::DuplicateWrite { path: path() })
    } else if sets.write_fail.contains(&index) {
        Some(BlockReason::WriteFail { path: path(), count: ctx.file_write_failures.get(path()).copied().unwrap_or(0) })
    } else if sets.cooldown.contains(&index) {
        Some(BlockReason::Cooldown { path: path(), remaining: ctx.cooldowns.get(path()).copied().unwrap_or(0) })
    } else if sets.cmd.contains(&index) {
        Some(BlockReason::CommandBlocked { consecutive_failures: ctx.consecutive_cmd_failures })
    } else if sets.read.contains(&index) {
        Some(BlockReason::ReadBlocked { path: path(), count: ctx.file_read_counts.get(path()).copied().unwrap_or(0) })
    } else if sets.shell_read.contains(&index) {
        Some(BlockReason::ShellReadBlocked)
    } else if sets.exploration.contains(&index) {
        Some(BlockReason::ExplorationBlocked { total_calls: ctx.exploration_total_calls })
    } else {
        None
    }
}

pub(crate) fn build_blocked_result(
    index: usize,
    tc: &ToolCall,
    sets: &BlockedSets,
    ctx: &BlockedResultContext<'_>,
) -> Option<ToolCallResult> {
    let reason = classify_block(index, tc, sets, ctx)?;

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
        BlockReason::ShellReadBlocked => {
            warn!(tool = %tc.name, "Blocked shell-based file read workaround");
            read_guard::build_shell_read_blocked_msg()
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

pub(crate) async fn execute_with_blocked(
    tool_calls: &[ToolCall],
    executor: &dyn crate::tool_loop_types::ToolExecutor,
    all_blocked: &[usize],
    sets: &BlockedSets,
    ctx: &BlockedResultContext<'_>,
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
            if let Some(blocked) = build_blocked_result(i, tc, sets, ctx) {
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
