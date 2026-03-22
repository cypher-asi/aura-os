use aura_claude::{ContentBlock, MessageContent, RichMessage};

// ---------------------------------------------------------------------------
// Configurable head/tail truncation
// ---------------------------------------------------------------------------

pub struct CompactConfig {
    pub threshold: usize,
    pub keep_head: usize,
    pub keep_tail: usize,
}

pub const MICRO: CompactConfig = CompactConfig {
    threshold: 16_000,
    keep_head: 6_000,
    keep_tail: 3_000,
};

pub const AGGRESSIVE: CompactConfig = CompactConfig {
    threshold: 4_000,
    keep_head: 1_600,
    keep_tail: 800,
};

pub const HISTORY: CompactConfig = CompactConfig {
    threshold: 2_000,
    keep_head: 500,
    keep_tail: 200,
};

/// Core head/tail truncation with a caller-supplied omission marker.
fn truncate_with_marker(
    content: &str,
    cfg: &CompactConfig,
    marker_fn: impl FnOnce(usize) -> String,
) -> String {
    if content.len() <= cfg.threshold {
        return content.to_string();
    }
    let head: String = content.chars().take(cfg.keep_head).collect();
    let tail: String = content
        .chars()
        .rev()
        .take(cfg.keep_tail)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    let omitted = content.len() - cfg.keep_head - cfg.keep_tail;
    let marker = marker_fn(omitted);
    format!("{head}{marker}{tail}")
}

/// Head/tail truncation with an omission marker in the middle.
pub fn truncate(content: &str, cfg: &CompactConfig) -> String {
    truncate_with_marker(content, cfg, |omitted| {
        format!("\n[...{omitted} chars omitted...]\n")
    })
}

/// Microcompact: moderate truncation for tool results sent to the LLM.
pub fn microcompact(content: &str) -> String {
    truncate_with_marker(content, &MICRO, |omitted| {
        format!(
            "\n\n[... {omitted} characters omitted \
             — use read_file with start_line/end_line for specific sections, \
             or re-run the command if you need the full output ...]\n\n"
        )
    })
}

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
    if !is_error && tool_name == "read_file" && aura_core::rust_signatures::looks_like_rust(content) {
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
pub fn compact_older_tool_results(messages: &mut [RichMessage], keep_recent: usize) {
    compact_older_tool_results_tiered(messages, keep_recent, &AGGRESSIVE);
}

/// Like `compact_older_tool_results` but uses a caller-supplied `CompactConfig`
/// so the compaction aggressiveness can be tuned based on context pressure.
pub fn compact_older_tool_results_tiered(
    messages: &mut [RichMessage],
    keep_recent: usize,
    cfg: &CompactConfig,
) {
    let len = messages.len();
    let cutoff = len.saturating_sub(keep_recent);
    // Skip messages[0] (initial task context) to preserve the cache anchor.
    let start = 1.min(cutoff);
    for msg in &mut messages[start..cutoff] {
        if msg.role != "user" {
            continue;
        }
        if let MessageContent::Blocks(blocks) = &mut msg.content {
            for block in blocks.iter_mut() {
                if let ContentBlock::ToolResult { content, .. } = block {
                    if content.len() > cfg.threshold {
                        *content = try_signature_compact(content)
                            .unwrap_or_else(|| truncate(content, cfg));
                    }
                }
            }
        }
    }
}

/// Compact plain text content in older messages (not just tool results).
/// This is used under severe context pressure and during detected stalls.
pub fn compact_older_message_text_tiered(
    messages: &mut [RichMessage],
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
    mut messages: Vec<RichMessage>,
    keep_recent: usize,
) -> Vec<RichMessage> {
    let cutoff = messages.len().saturating_sub(keep_recent);
    // Skip messages[0] (initial task context) to preserve the cache anchor.
    let start = 1.min(cutoff);
    for msg in &mut messages[start..cutoff] {
        if msg.role != "user" {
            continue;
        }
        if let MessageContent::Blocks(blocks) = &mut msg.content {
            for block in blocks.iter_mut() {
                if let ContentBlock::ToolResult { content, .. } = block {
                    if content.len() > HISTORY.threshold {
                        *content = truncate(content, &HISTORY);
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
