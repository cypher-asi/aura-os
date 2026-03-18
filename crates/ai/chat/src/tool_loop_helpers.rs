use std::collections::HashMap;

use tokio::sync::mpsc;

use aura_claude::{ContentBlock, ToolCall};
use crate::compaction;
use crate::tool_loop::{ToolCallResult, ToolLoopEvent};

pub(crate) fn detect_blocked_writes(
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

/// Block `run_command` calls when consecutive failures reach the hard limit (5+).
pub(crate) fn detect_blocked_commands(tool_calls: &[ToolCall], consecutive_failures: usize) -> Vec<usize> {
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
pub(crate) fn apply_cmd_failure_tracking(
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

pub(crate) fn build_tool_result_blocks(
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

pub(crate) fn summarize_write_file_input(input: &serde_json::Value) -> serde_json::Value {
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
