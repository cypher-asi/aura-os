use std::collections::HashMap;

use tokio::sync::mpsc;
use tracing::warn;

use aura_claude::{RichMessage, ToolCall};
use crate::channel_ext::send_or_log;
use crate::constants::CMD_FAILURE_WARNING_THRESHOLD;
use crate::tool_loop_types::{ToolCallResult, ToolLoopEvent};
use super::WriteTrackingState;

pub(crate) fn track_write_failures(
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

pub(crate) fn detect_stall_fail_fast(
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
        send_or_log(event_tx, ToolLoopEvent::Error(recovery.clone()));
        api_messages.push(RichMessage::user(&recovery));
        return true;
    }
    false
}

pub(crate) fn detect_same_target_stall(
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
