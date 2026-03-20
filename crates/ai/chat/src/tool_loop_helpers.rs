use std::collections::HashMap;

use tokio::sync::mpsc;

use aura_claude::{ContentBlock, ToolCall};
use crate::compaction;
use crate::channel_ext::send_or_log;
use crate::constants::{MAX_WRITE_FAILURES_PER_FILE, MAX_READS_PER_FILE, MAX_CONSECUTIVE_CMD_FAILURES, CMD_FAILURE_WARNING_THRESHOLD};
use crate::tool_loop::{ToolCallResult, ToolLoopEvent};

pub(crate) fn detect_blocked_writes(
    tool_calls: &[ToolCall],
    tracker: &mut HashMap<String, usize>,
) -> Vec<usize> {
    // Only track full-rewrite write_file calls for consecutive-duplicate
    // blocking. edit_file calls (targeted appends/patches) to the same file
    // in a single batch are legitimate incremental building, not stalls.
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

/// Block `read_file` calls when the same file has been read 3+ times total
/// (any combination of full/partial reads).
pub(crate) fn detect_blocked_reads(
    tool_calls: &[ToolCall],
    file_read_counts: &mut HashMap<String, usize>,
) -> Vec<usize> {
    for tc in tool_calls {
        if tc.name == "read_file" {
            if let Some(path) = tc.input.get("path").and_then(|v| v.as_str()) {
                *file_read_counts.entry(path.to_string()).or_insert(0) += 1;
            }
        }
    }

    tool_calls
        .iter()
        .enumerate()
        .filter_map(|(i, tc)| {
            if tc.name == "read_file" {
                let path = tc.input.get("path").and_then(|v| v.as_str()).unwrap_or("");
                if file_read_counts.get(path).copied().unwrap_or(0) >= MAX_READS_PER_FILE {
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

/// Update the consecutive failure counter and append hints to results.
/// Resets on any successful tool call; increments on `run_command` errors.
/// At 3+ consecutive failures, appends guidance to use built-in tools.
pub(crate) fn apply_cmd_failure_tracking(
    tool_calls: &[ToolCall],
    mut results: Vec<ToolCallResult>,
    consecutive_failures: &mut usize,
) -> Vec<ToolCallResult> {
    for (tc, result) in tool_calls.iter().zip(results.iter_mut()) {
        if tc.name == "run_command" && result.is_error {
            *consecutive_failures += 1;
            if *consecutive_failures >= CMD_FAILURE_WARNING_THRESHOLD {
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

pub(crate) fn build_tool_result_blocks(
    tool_calls: &[ToolCall],
    results: &[ToolCallResult],
    file_read_cache: &mut HashMap<String, u64>,
    event_tx: &mpsc::UnboundedSender<ToolLoopEvent>,
) -> (Vec<ContentBlock>, bool) {
    let mut should_stop = false;
    let mut result_blocks: Vec<ContentBlock> = Vec::new();

    for (tc, result) in tool_calls.iter().zip(results) {
        send_or_log(&event_tx, ToolLoopEvent::ToolResult {
            tool_use_id: result.tool_use_id.clone(),
            tool_name: tc.name.clone(),
            content: result.content.clone(),
            is_error: result.is_error,
        });

        let write_truncation_warning = if (tc.name == "write_file" || tc.name == "edit_file")
            && !result.is_error
        {
            let written = tc.input.get("content").and_then(|v| v.as_str()).unwrap_or("");
            if looks_truncated(written) {
                Some(
                    "[WARNING: The file content appears to have been truncated during generation. \
                     Use read_file to check what was actually written. Consider breaking large \
                     files into smaller writes.]"
                )
            } else {
                None
            }
        } else {
            None
        };

        let content_for_llm = if tc.name == "read_file" && !result.is_error {
            let path = tc.input.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let has_line_range = tc.input.get("start_line").is_some()
                || tc.input.get("end_line").is_some();

            if has_line_range {
                compaction::smart_compact(&tc.name, &result.content)
            } else {
                let hash = content_hash(&result.content);
                if let Some(&prev_hash) = file_read_cache.get(path) {
                    if prev_hash == hash {
                        format!(
                            "STOP: File already read with identical content ({} chars). \
                             Do NOT re-read the full file. Use read_file with start_line/end_line \
                             to read specific line ranges, or use the previously read content.",
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

        let final_content = if let Some(warning) = write_truncation_warning {
            format!("{content_for_llm}\n\n{warning}")
        } else {
            content_for_llm
        };

        result_blocks.push(ContentBlock::ToolResult {
            tool_use_id: result.tool_use_id.clone(),
            content: final_content,
            is_error: if result.is_error { Some(true) } else { None },
        });
        if result.stop_loop {
            should_stop = true;
        }
    }

    (result_blocks, should_stop)
}

pub(crate) fn summarize_write_file_input(input: &serde_json::Value) -> serde_json::Value {
    let path = input.get("path").and_then(|v| v.as_str()).unwrap_or("unknown");
    let content = input.get("content").and_then(|v| v.as_str()).unwrap_or("");
    let content_len = content.len();
    let lines: Vec<&str> = content.lines().collect();
    let line_count = lines.len();

    const HEAD_LINES: usize = 20;
    const TAIL_LINES: usize = 5;

    let summary = if line_count <= HEAD_LINES + TAIL_LINES + 2 {
        content.to_string()
    } else {
        let head: Vec<&str> = lines[..HEAD_LINES].to_vec();
        let tail: Vec<&str> = lines[line_count - TAIL_LINES..].to_vec();
        format!(
            "{}\n\
             // [CONTEXT COMPACTED: {} lines omitted from this tool_use block to save tokens.\n\
             //  The FULL content ({} lines, {} chars) was successfully written to disk at '{}'.\n\
             //  This is NOT an error. Use read_file if you need to see the omitted lines.]\n\
             {}",
            head.join("\n"),
            line_count - HEAD_LINES - TAIL_LINES,
            line_count,
            content_len,
            path,
            tail.join("\n"),
        )
    };

    serde_json::json!({
        "path": path,
        "content": summary,
    })
}

/// Heuristic check for truncated file content: unbalanced braces/brackets
/// or content that ends mid-line without a newline.
pub(crate) fn looks_truncated(content: &str) -> bool {
    if content.len() < 200 {
        return false;
    }

    let mut brace_depth: i64 = 0;
    let mut bracket_depth: i64 = 0;
    let mut paren_depth: i64 = 0;
    for ch in content.chars() {
        match ch {
            '{' => brace_depth += 1,
            '}' => brace_depth -= 1,
            '[' => bracket_depth += 1,
            ']' => bracket_depth -= 1,
            '(' => paren_depth += 1,
            ')' => paren_depth -= 1,
            _ => {}
        }
    }

    let significantly_unbalanced =
        brace_depth.abs() > 2 || bracket_depth.abs() > 2 || paren_depth.abs() > 2;

    let ends_abruptly = !content.ends_with('\n')
        && !content.ends_with('}')
        && !content.ends_with(';')
        && !content.ends_with('\r');

    significantly_unbalanced || ends_abruptly
}

fn content_hash(content: &str) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in content.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}
