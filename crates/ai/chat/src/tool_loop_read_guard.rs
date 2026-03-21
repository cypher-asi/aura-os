use std::collections::HashMap;

use aura_claude::ToolCall;

use crate::constants::{MAX_READS_PER_FILE, MAX_RANGE_READS_PER_FILE};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

pub(crate) struct ReadGuardState {
    pub(crate) full_reads: HashMap<String, usize>,
    pub(crate) range_reads: HashMap<String, usize>,
}

impl ReadGuardState {
    pub(crate) fn new() -> Self {
        Self {
            full_reads: HashMap::new(),
            range_reads: HashMap::new(),
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

pub(crate) fn is_range_read(tc: &ToolCall) -> bool {
    tc.name == "read_file"
        && (tc.input.get("start_line").is_some() || tc.input.get("end_line").is_some())
}

/// Detect `run_command` calls that are actually trying to read files via
/// shell (Get-Content, cat, type, head, tail, findstr, Select-String, python open).
pub(crate) fn is_shell_read_cmd(command: &str) -> bool {
    let lower = command.to_lowercase();
    let patterns = [
        "get-content", "cat ", "type ", "head ", "tail ",
        "findstr", "select-string", "python -c",
        "python3 -c", "more ", "less ",
    ];
    patterns.iter().any(|p| lower.contains(p))
}

// ---------------------------------------------------------------------------
// Detection: blocked reads (split full vs range)
// ---------------------------------------------------------------------------

/// Block `read_file` calls when per-path limits are exceeded.
/// Full reads are limited to `MAX_READS_PER_FILE` and range reads to
/// `MAX_RANGE_READS_PER_FILE`, tracked independently so compaction-advised
/// range reads don't exhaust the full-read budget.
pub(crate) fn detect_blocked_reads(
    tool_calls: &[ToolCall],
    state: &mut ReadGuardState,
) -> Vec<usize> {
    for tc in tool_calls {
        if tc.name != "read_file" {
            continue;
        }
        let path = match tc.input.get("path").and_then(|v| v.as_str()) {
            Some(p) => p.to_string(),
            None => continue,
        };
        if is_range_read(tc) {
            *state.range_reads.entry(path).or_insert(0) += 1;
        } else {
            *state.full_reads.entry(path).or_insert(0) += 1;
        }
    }

    tool_calls
        .iter()
        .enumerate()
        .filter_map(|(i, tc)| {
            if tc.name != "read_file" {
                return None;
            }
            let path = tc.input.get("path").and_then(|v| v.as_str()).unwrap_or("");
            if is_range_read(tc) {
                if state.range_reads.get(path).copied().unwrap_or(0) >= MAX_RANGE_READS_PER_FILE {
                    return Some(i);
                }
            } else if state.full_reads.get(path).copied().unwrap_or(0) >= MAX_READS_PER_FILE {
                return Some(i);
            }
            None
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Detection: shell-read workarounds
// ---------------------------------------------------------------------------

/// Find `run_command` calls that look like file-read workarounds.
pub(crate) fn detect_shell_read_workaround(tool_calls: &[ToolCall]) -> Vec<usize> {
    tool_calls
        .iter()
        .enumerate()
        .filter_map(|(i, tc)| {
            if tc.name != "run_command" {
                return None;
            }
            let cmd = tc.input.get("command").and_then(|v| v.as_str()).unwrap_or("");
            if is_shell_read_cmd(cmd) { Some(i) } else { None }
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Reset after writes
// ---------------------------------------------------------------------------

pub(crate) fn reset_reads_for_path(state: &mut ReadGuardState, path: &str) {
    state.full_reads.remove(path);
    state.range_reads.remove(path);
}

// ---------------------------------------------------------------------------
// Blocked messages
// ---------------------------------------------------------------------------

pub(crate) fn build_shell_read_blocked_msg() -> String {
    "BLOCKED: Using shell commands to read files is not allowed. \
     Use read_file (with start_line/end_line for specific sections) \
     or search_code to find the content you need."
        .to_string()
}

pub(crate) fn build_read_blocked_msg(path: &str, full_count: usize, range_count: usize) -> String {
    format!(
        "BLOCKED: You have read '{path}' {full_count} full time(s) and {range_count} \
         range read(s). Use the content you already have. If you need a specific \
         section, use search_code to find the exact lines.",
    )
}

/// Combine full + range counts into a single value for backward-compatible
/// `BlockedResultContext::file_read_counts` usage.
pub(crate) fn combined_read_counts(state: &ReadGuardState) -> HashMap<String, usize> {
    let mut combined = state.full_reads.clone();
    for (path, count) in &state.range_reads {
        *combined.entry(path.clone()).or_insert(0) += count;
    }
    combined
}
