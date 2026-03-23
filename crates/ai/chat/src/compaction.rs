use aura_link::{ContentBlock, Message, MessageContent, Role};

pub use aura_link::compaction::{
    CompactConfig, AGGRESSIVE, HISTORY, MICRO,
    microcompact, truncate,
};

/// Smart compaction: for `read_file` results that look like Rust source,
/// extract public signatures instead of doing head/tail truncation. Falls
/// back to `microcompact` for non-Rust or when extraction doesn't help.
pub fn smart_compact(tool_name: &str, content: &str) -> String {
    smart_compact_inner(tool_name, content, false)
}

/// Like `smart_compact` but uses aggressive thresholds for error output,
/// since failed command stderr is mostly noise (shell errors, not code).
pub fn smart_compact_error(tool_name: &str, content: &str) -> String {
    smart_compact_inner(tool_name, content, true)
}

fn smart_compact_inner(tool_name: &str, content: &str, is_error: bool) -> String {
    let cfg = if is_error { &AGGRESSIVE } else { &MICRO };
    if content.len() <= cfg.threshold {
        return content.to_string();
    }
    if !is_error && tool_name == "read_file" && aura_core::rust_signatures::looks_like_rust(content)
    {
        let sigs = aura_core::rust_signatures::extract_signatures(content);
        if !sigs.is_empty() && sigs.len() < content.len() / 2 {
            return format!(
                "[Compacted: {} -> {} chars. Struct/enum definitions are COMPLETE below (all fields included). \
                 Only function/method bodies are replaced with {{ ... }}. Line numbers (L123:) are exact -- \
                 use read_file with start_line/end_line to read full implementations. \
                 Do NOT re-read this file without a line range.]\n{}",
                content.len(),
                sigs.len(),
                sigs,
            );
        }
    }
    if is_error {
        truncate(content, &AGGRESSIVE)
    } else {
        microcompact(content)
    }
}

/// Try to compact Rust source by extracting public signatures.
/// Returns `None` when the content isn't Rust or signatures wouldn't shrink enough.
fn try_signature_compact(content: &str) -> Option<String> {
    if !aura_core::rust_signatures::looks_like_rust(content) {
        return None;
    }
    let sigs = aura_core::rust_signatures::extract_signatures(content);
    if sigs.is_empty() || sigs.len() >= content.len() / 2 {
        return None;
    }
    Some(format!(
        "[Compacted to signatures ({} -> {} chars)]\n{}",
        content.len(),
        sigs.len(),
        sigs,
    ))
}

/// Retroactively compact tool results in older messages when the context
/// window is under pressure. Skips the last `keep_recent` messages to
/// avoid losing fresh context.  Uses `AGGRESSIVE` thresholds.
pub fn compact_older_tool_results(messages: &mut [Message], keep_recent: usize) {
    compact_older_tool_results_tiered(messages, keep_recent, &AGGRESSIVE);
}

/// Like `compact_older_tool_results` but uses a caller-supplied `CompactConfig`
/// so the compaction aggressiveness can be tuned based on context pressure.
pub fn compact_older_tool_results_tiered(
    messages: &mut [Message],
    keep_recent: usize,
    cfg: &CompactConfig,
) {
    let len = messages.len();
    let cutoff = len.saturating_sub(keep_recent);
    // Skip messages[0] (initial task context) to preserve the cache anchor.
    let start = 1.min(cutoff);
    for msg in &mut messages[start..cutoff] {
        if msg.role != Role::User {
            continue;
        }
        if let MessageContent::Blocks(blocks) = &mut msg.content {
            for block in blocks.iter_mut() {
                if let ContentBlock::ToolResult { content, .. } = block {
                    if let Some(text) = aura_link::tool_result_text_mut(content) {
                        if text.len() > cfg.threshold {
                            *text = try_signature_compact(text)
                                .unwrap_or_else(|| truncate(text, cfg));
                        }
                    }
                }
            }
        }
    }
}

/// Compact plain text content in older messages (not just tool results).
/// This is used under severe context pressure and during detected stalls.
pub fn compact_older_message_text_tiered(
    messages: &mut [Message],
    keep_recent: usize,
    cfg: &CompactConfig,
) {
    let len = messages.len();
    let cutoff = len.saturating_sub(keep_recent);
    // Skip messages[0] (initial task context) to preserve the cache anchor.
    let start = 1.min(cutoff);
    for msg in &mut messages[start..cutoff] {
        match &mut msg.content {
            MessageContent::Text(text) => {
                if text.len() > cfg.threshold {
                    *text = truncate(text, cfg);
                }
            }
            MessageContent::Blocks(blocks) => {
                for block in blocks.iter_mut() {
                    if let ContentBlock::Text { text } = block {
                        if text.len() > cfg.threshold {
                            *text = truncate(text, cfg);
                        }
                    }
                }
            }
        }
    }
}

/// Compact tool results in conversation history using the HISTORY config.
/// Used during context window management before summarization.
pub fn compact_tool_results_in_history(
    mut messages: Vec<Message>,
    keep_recent: usize,
) -> Vec<Message> {
    let cutoff = messages.len().saturating_sub(keep_recent);
    // Skip messages[0] (initial task context) to preserve the cache anchor.
    let start = 1.min(cutoff);
    for msg in &mut messages[start..cutoff] {
        if msg.role != Role::User {
            continue;
        }
        if let MessageContent::Blocks(blocks) = &mut msg.content {
            for block in blocks.iter_mut() {
                if let ContentBlock::ToolResult { content, .. } = block {
                    if let Some(text) = aura_link::tool_result_text_mut(content) {
                        if text.len() > HISTORY.threshold {
                            *text = truncate(text, &HISTORY);
                        }
                    }
                }
            }
        }
    }
    messages
}

#[cfg(test)]
#[path = "compaction_tests.rs"]
mod tests;
