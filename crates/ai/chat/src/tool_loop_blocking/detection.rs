use std::collections::HashMap;

use aura_claude::ToolCall;

use crate::constants::{MAX_WRITE_FAILURES_PER_FILE, MAX_CONSECUTIVE_CMD_FAILURES};
use crate::tool_loop_read_guard as read_guard;
use super::{BlockedSets, BlockingContext};
use tracing::info;

pub(crate) fn detect_blocked_writes(
    tool_calls: &[ToolCall],
    tracker: &mut HashMap<String, usize>,
) -> Vec<usize> {
    let write_paths: Vec<Option<String>> = tool_calls
        .iter()
        .map(|tc| {
            if tc.name == "write_file" {
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
            if tc.name == "write_file" {
                let path = tc.input.get("path").and_then(|v| v.as_str()).unwrap_or("");
                if tracker.get(path).copied().unwrap_or(0) >= 2 {
                    return Some(i);
                }
            }
            None
        })
        .collect()
}

/// Block write/edit calls on files that have accumulated 3+ failures across
/// the session (unlike `detect_blocked_writes` which tracks consecutive batches,
/// this tracks total error outcomes per file and is only reset on success).
pub(crate) fn detect_blocked_write_failures(
    tool_calls: &[ToolCall],
    file_write_failures: &HashMap<String, usize>,
) -> Vec<usize> {
    tool_calls
        .iter()
        .enumerate()
        .filter_map(|(i, tc)| {
            if matches!(tc.name.as_str(), "write_file" | "edit_file") {
                let path = tc.input.get("path").and_then(|v| v.as_str()).unwrap_or("");
                if file_write_failures.get(path).copied().unwrap_or(0) >= MAX_WRITE_FAILURES_PER_FILE {
                    return Some(i);
                }
            }
            None
        })
        .collect()
}

/// Block all exploration tool calls when the hard limit has been reached.
pub(crate) fn detect_blocked_exploration(
    tool_calls: &[ToolCall],
    blocked: bool,
) -> Vec<usize> {
    if !blocked {
        return vec![];
    }
    tool_calls
        .iter()
        .enumerate()
        .filter_map(|(i, tc)| {
            if matches!(tc.name.as_str(), "read_file" | "search_code" | "find_files" | "list_files") {
                Some(i)
            } else {
                None
            }
        })
        .collect()
}

/// Block `run_command` calls when consecutive failures reach the hard limit (5+).
pub(crate) fn detect_blocked_commands(tool_calls: &[ToolCall], consecutive_failures: usize) -> Vec<usize> {
    if consecutive_failures < MAX_CONSECUTIVE_CMD_FAILURES {
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

pub(crate) fn detect_write_file_cooldowns(
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

pub(crate) fn collect_duplicate_write_paths(tool_calls: &[ToolCall], blocked_indices: &[usize]) -> Vec<String> {
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

pub(crate) fn decrement_write_file_cooldowns(cooldowns: &mut HashMap<String, usize>) {
    cooldowns.retain(|_, remaining| {
        if *remaining == 0 {
            return false;
        }
        *remaining -= 1;
        *remaining > 0
    });
}

pub(crate) fn detect_all_blocked(
    tool_calls: &[ToolCall],
    ctx: &mut BlockingContext<'_>,
) -> (Vec<usize>, BlockedSets, Vec<String>) {
    const FULL_REWRITE_BLOCK_ITERS: usize = 3;

    let duplicate_write = detect_blocked_writes(tool_calls, ctx.consecutive_write_tracker);
    let cooldown = detect_write_file_cooldowns(tool_calls, ctx.cooldowns);
    let write_fail = detect_blocked_write_failures(tool_calls, ctx.file_write_failures);
    let cmd = detect_blocked_commands(tool_calls, ctx.consecutive_cmd_failures);
    let read = read_guard::detect_blocked_reads(tool_calls, ctx.read_guard);
    let shell_read = read_guard::detect_shell_read_workaround(tool_calls);
    let exploration_is_blocked = ctx.exploration.total_calls >= ctx.exploration.allowance;
    let exploration = detect_blocked_exploration(tool_calls, exploration_is_blocked);

    let all_blocked: Vec<usize> = {
        let mut v = duplicate_write.clone();
        for i in write_fail.iter()
            .chain(cooldown.iter())
            .chain(cmd.iter())
            .chain(read.iter())
            .chain(shell_read.iter())
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
        ctx.cooldowns.insert(path.clone(), FULL_REWRITE_BLOCK_ITERS);
        let recovery = format!(
            "[STALL RECOVERY] Repeated full-file write_file attempts detected for '{path}'. \
             For the next {FULL_REWRITE_BLOCK_ITERS} iterations, write_file is blocked for this path. \
             Use edit_file instead: (1) read_file with a line range, (2) edit_file for one small \
             section/function at a time, (3) verify before the next edit. Do NOT rewrite the full file."
        );
        info!(path = path.as_str(), "Injecting adaptive rewrite recovery instruction");
        deferred_recovery_msgs.push(recovery);
    }

    let sets = BlockedSets { duplicate_write, write_fail, cooldown, cmd, read, shell_read, exploration };
    (all_blocked, sets, deferred_recovery_msgs)
}
