use std::collections::HashMap;

use tokio::sync::mpsc;
use tracing::info;

use aura_claude::{ContentBlock, MessageContent, RichMessage, ToolCall};

use crate::compaction;
use crate::chat_sanitize;
use crate::channel_ext::send_or_log;
use crate::tool_loop::{BuildState, LoopState, ToolExecutor, ToolLoopConfig, ToolLoopEvent};
use crate::tool_loop_blocking::{summarize_edit_file_input, summarize_write_file_input};
use crate::tool_loop_budget::ExplorationState;
use crate::tool_loop_streaming::IterationCompleted;

// ---------------------------------------------------------------------------
// Compaction and sanitization helpers
// ---------------------------------------------------------------------------

const COMPACTION_TIERS: [(f64, usize, &compaction::CompactConfig, bool); 5] = [
    (0.85, 2, &compaction::HISTORY,    true),
    (0.70, 3, &compaction::AGGRESSIVE, true),
    (0.60, 4, &compaction::AGGRESSIVE, false),
    (0.30, 5, &compaction::MICRO,      false),
    (0.15, 8, &compaction::MICRO,      false),
];

pub(crate) fn check_context_compaction(
    config: &ToolLoopConfig,
    iteration_input_tokens: u64,
    duplicate_stall_active: bool,
    api_messages: &mut [RichMessage],
) {
    let Some(max_ctx) = config.max_context_tokens else { return };
    let utilization = iteration_input_tokens as f64 / max_ctx as f64;
    info!(
        input_tokens = iteration_input_tokens,
        max_context = max_ctx,
        utilization_pct = (utilization * 100.0) as u32,
        message_count = api_messages.len(),
        "context_compaction check"
    );

    for &(threshold, keep_recent, cfg, also_text) in &COMPACTION_TIERS {
        if utilization > threshold {
            info!(
                input_tokens = iteration_input_tokens,
                max_context = max_ctx,
                utilization_pct = (utilization * 100.0) as u32,
                threshold_pct = (threshold * 100.0) as u32,
                keep_recent,
                "Context compaction triggered"
            );
            compaction::compact_older_tool_results_tiered(api_messages, keep_recent, cfg);
            if also_text {
                compaction::compact_older_message_text_tiered(api_messages, keep_recent, cfg);
            }
            break;
        }
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

fn build_assistant_content_blocks(
    tool_calls: &[ToolCall],
    iter_text: &str,
) -> Vec<ContentBlock> {
    let mut blocks: Vec<ContentBlock> = Vec::new();
    if !iter_text.is_empty() {
        blocks.push(ContentBlock::Text { text: iter_text.to_string() });
    }
    for tc in tool_calls {
        let input = match tc.name.as_str() {
            "write_file" => summarize_write_file_input(&tc.input),
            "edit_file" => summarize_edit_file_input(&tc.input),
            _ => tc.input.clone(),
        };
        blocks.push(ContentBlock::ToolUse {
            id: tc.id.clone(),
            name: tc.name.clone(),
            input,
        });
    }
    blocks
}

pub(crate) fn handle_truncated_tool_calls(
    iter: &IterationCompleted,
    event_tx: &mpsc::UnboundedSender<ToolLoopEvent>,
    state: &mut LoopState,
) {
    let assistant_blocks = build_assistant_content_blocks(&iter.iter_tool_calls, &iter.iter_text);
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
        send_or_log(event_tx, ToolLoopEvent::ToolResult {
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

pub(crate) fn push_assistant_tool_message(
    tool_calls: &[ToolCall],
    iter_text: &str,
    api_messages: &mut Vec<RichMessage>,
) {
    let assistant_blocks = build_assistant_content_blocks(tool_calls, iter_text);
    api_messages.push(RichMessage::assistant_blocks(assistant_blocks));
}

/// Replace an existing standalone warning user message (matched by `prefix`) with
/// updated content, or append a new one if no prior warning of this type exists.
/// This prevents warning messages from accumulating as separate entries.
/// `content` must start with `prefix` so the replacement is findable on the next call.
pub(crate) fn push_or_replace_warning(
    api_messages: &mut Vec<RichMessage>,
    prefix: &str,
    content: &str,
) {
    debug_assert!(
        content.starts_with(prefix),
        "push_or_replace_warning: content must start with prefix for future matching"
    );
    for msg in api_messages.iter_mut().rev() {
        if msg.role != "user" {
            continue;
        }
        if let MessageContent::Text(text) = &mut msg.content {
            if text.starts_with(prefix) {
                *text = content.to_string();
                return;
            }
        }
    }
    api_messages.push(RichMessage::user(content));
}

// ---------------------------------------------------------------------------
// Build and exploration post-processing
// ---------------------------------------------------------------------------

pub(crate) fn maybe_emit_checkpoint(build: &mut BuildState, api_messages: &mut Vec<RichMessage>) {
    if !build.plan_checkpoint_sent {
        build.plan_checkpoint_sent = true;
        push_or_replace_warning(
            api_messages,
            "[IMPLEMENTATION CHECKPOINT]",
            "[IMPLEMENTATION CHECKPOINT] You just made your first write. Before continuing, verify:\n\
             1. Exact struct/type definitions for types you reference\n\
             2. Method signatures for functions you call\n\
             3. Required imports\n\
             If any of these are uncertain, use one more read_file or search_code call to confirm \
             before proceeding with further writes.",
        );
    }
}

pub(crate) async fn maybe_run_auto_build(
    executor: &dyn ToolExecutor,
    build: &mut BuildState,
    api_messages: &mut Vec<RichMessage>,
) {
    if build.auto_build_cooldown == 0 {
        if let Some(build_result) = executor.auto_build_check().await {
            build.auto_build_cooldown = build.auto_build_reset;
            let status = if build_result.success { "PASSED" } else { "FAILED" };
            let output = if let Some(ref baseline) = build.baseline {
                baseline.annotate(&build_result.output)
            } else {
                build_result.output
            };
            let msg = format!("[AUTO-BUILD] Build check {status}:\n{output}");
            info!(success = build_result.success, "Auto-build check after write batch");
            push_or_replace_warning(api_messages, "[AUTO-BUILD]", &msg);
        }
    }
}

pub(crate) fn maybe_compact_after_exploration(
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
pub(crate) fn sanitize_after_compaction(messages: &mut Vec<RichMessage>) {
    let msgs = std::mem::take(messages);
    let msgs = chat_sanitize::sanitize_orphan_tool_results(msgs);
    let msgs = chat_sanitize::sanitize_tool_use_results(msgs);
    let msgs = chat_sanitize::merge_consecutive_same_role_pub(msgs);
    *messages = msgs;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_or_replace_warning_appends_when_no_match() {
        let mut msgs = vec![RichMessage::user("hello")];
        push_or_replace_warning(&mut msgs, "[WARN]", "[WARN] something");
        assert_eq!(msgs.len(), 2);
        match &msgs[1].content {
            MessageContent::Text(t) => assert_eq!(t, "[WARN] something"),
            _ => panic!("expected text"),
        }
    }

    #[test]
    fn push_or_replace_warning_replaces_existing_by_prefix() {
        let mut msgs = vec![
            RichMessage::user("[WARN] old value"),
            RichMessage::assistant_text("reply"),
            RichMessage::user("unrelated"),
        ];
        push_or_replace_warning(&mut msgs, "[WARN]", "[WARN] new value");
        assert_eq!(msgs.len(), 3, "should not append a new message");
        match &msgs[0].content {
            MessageContent::Text(t) => assert_eq!(t, "[WARN] new value"),
            _ => panic!("expected text"),
        }
    }

    #[test]
    fn push_or_replace_warning_skips_non_text_content() {
        let mut msgs = vec![
            RichMessage::tool_results(vec![ContentBlock::ToolResult {
                tool_use_id: "t1".into(),
                content: "[WARN] inside tool result".into(),
                is_error: None,
            }]),
        ];
        push_or_replace_warning(&mut msgs, "[WARN]", "[WARN] new");
        assert_eq!(msgs.len(), 2, "should append since tool_result content doesn't match");
    }
}
