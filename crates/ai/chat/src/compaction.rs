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

/// Head/tail truncation with an omission marker in the middle.
pub fn truncate(content: &str, cfg: &CompactConfig) -> String {
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
    format!("{head}\n[...{omitted} chars omitted...]\n{tail}")
}

/// Microcompact: moderate truncation for tool results sent to the LLM.
pub fn microcompact(content: &str) -> String {
    if content.len() <= MICRO.threshold {
        return content.to_string();
    }
    let head: String = content.chars().take(MICRO.keep_head).collect();
    let tail: String = content
        .chars()
        .rev()
        .take(MICRO.keep_tail)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    let omitted = content.len() - MICRO.keep_head - MICRO.keep_tail;
    format!(
        "{head}\n\n[... {omitted} characters omitted — use read_file with start_line/end_line for specific sections, or re-run the command if you need the full output ...]\n\n{tail}"
    )
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

/// Aggressive smart compaction: tries signature extraction, falls back to
/// aggressive head/tail truncation.
fn aggressive_smart_compact(content: &str) -> String {
    if content.len() <= AGGRESSIVE.threshold {
        return content.to_string();
    }
    if aura_core::rust_signatures::looks_like_rust(content) {
        let sigs = aura_core::rust_signatures::extract_signatures(content);
        if !sigs.is_empty() && sigs.len() < content.len() / 2 {
            return format!(
                "[Compacted to signatures ({} -> {} chars)]\n{}",
                content.len(),
                sigs.len(),
                sigs,
            );
        }
    }
    truncate(content, &AGGRESSIVE)
}

/// Retroactively compact tool results in older messages when the context
/// window is under pressure. Skips the last `keep_recent` messages to
/// avoid losing fresh context.
pub fn compact_older_tool_results(messages: &mut [RichMessage], keep_recent: usize) {
    let len = messages.len();
    let cutoff = len.saturating_sub(keep_recent);
    for msg in &mut messages[..cutoff] {
        if msg.role != "user" {
            continue;
        }
        if let MessageContent::Blocks(blocks) = &mut msg.content {
            for block in blocks.iter_mut() {
                if let ContentBlock::ToolResult { content, .. } = block {
                    if content.len() > AGGRESSIVE.threshold {
                        *content = aggressive_smart_compact(content);
                    }
                }
            }
        }
    }
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
    for msg in &mut messages[..cutoff] {
        if msg.role != "user" {
            continue;
        }
        if let MessageContent::Blocks(blocks) = &mut msg.content {
            for block in blocks.iter_mut() {
                if let ContentBlock::ToolResult { content, .. } = block {
                    if content.len() > cfg.threshold {
                        if aura_core::rust_signatures::looks_like_rust(content) {
                            let sigs = aura_core::rust_signatures::extract_signatures(content);
                            if !sigs.is_empty() && sigs.len() < content.len() / 2 {
                                *content = format!(
                                    "[Compacted to signatures ({} -> {} chars)]\n{}",
                                    content.len(),
                                    sigs.len(),
                                    sigs,
                                );
                                continue;
                            }
                        }
                        *content = truncate(content, cfg);
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
    for msg in &mut messages[..cutoff] {
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
    for msg in &mut messages[..cutoff] {
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
mod tests {
    use super::*;

    #[test]
    fn compact_older_message_text_tiered_truncates_old_text_blocks() {
        let long_text = "x".repeat(5000);
        let mut messages = vec![
            RichMessage::assistant_text(&long_text),
            RichMessage::assistant_text("recent"),
        ];

        compact_older_message_text_tiered(&mut messages, 1, &AGGRESSIVE);

        let older_text = match &messages[0].content {
            MessageContent::Text(t) => t.clone(),
            _ => String::new(),
        };
        assert!(older_text.contains("omitted"), "older text should be truncated");
        let recent_text = match &messages[1].content {
            MessageContent::Text(t) => t.clone(),
            _ => String::new(),
        };
        assert_eq!(recent_text, "recent");
    }

    #[test]
    fn compact_older_message_text_tiered_skips_tool_result_blocks() {
        let mut messages = vec![RichMessage::tool_results(vec![ContentBlock::ToolResult {
            tool_use_id: "t1".into(),
            content: "x".repeat(5000),
            is_error: Some(false),
        }])];

        compact_older_message_text_tiered(&mut messages, 0, &AGGRESSIVE);

        let content = match &messages[0].content {
            MessageContent::Blocks(blocks) => match &blocks[0] {
                ContentBlock::ToolResult { content, .. } => content.clone(),
                _ => String::new(),
            },
            _ => String::new(),
        };
        assert_eq!(content.len(), 5000, "tool results are compacted by dedicated routines");
    }
}
