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

    // -------------------------------------------------------------------
    // truncate
    // -------------------------------------------------------------------

    #[test]
    fn truncate_content_below_threshold_unchanged() {
        let content = "short content";
        let result = truncate(content, &MICRO);
        assert_eq!(result, content);
    }

    #[test]
    fn truncate_content_above_threshold_has_head_tail_and_marker() {
        let content = "a".repeat(20_000);
        let result = truncate(&content, &MICRO);
        assert!(result.len() < content.len());
        assert!(result.contains("omitted"));
        // Head part
        assert!(result.starts_with("aaa"));
        // Tail part
        assert!(result.ends_with("aaa"));
    }

    #[test]
    fn truncate_marker_contains_correct_char_count() {
        let content = "b".repeat(20_000);
        let result = truncate(&content, &MICRO);
        let omitted_count = 20_000 - MICRO.keep_head - MICRO.keep_tail;
        let expected_marker = format!("...{} chars omitted...", omitted_count);
        assert!(result.contains(&expected_marker));
    }

    // -------------------------------------------------------------------
    // microcompact
    // -------------------------------------------------------------------

    #[test]
    fn microcompact_below_16k_unchanged() {
        let content = "x".repeat(15_000);
        let result = microcompact(&content);
        assert_eq!(result, content);
    }

    #[test]
    fn microcompact_above_16k_truncated_with_guidance() {
        let content = "y".repeat(20_000);
        let result = microcompact(&content);
        assert!(result.len() < content.len());
        assert!(result.contains("characters omitted"));
        assert!(result.contains("read_file"));
    }

    // -------------------------------------------------------------------
    // smart_compact
    // -------------------------------------------------------------------

    #[test]
    fn smart_compact_non_read_file_uses_microcompact() {
        let content = "z".repeat(20_000);
        let result = smart_compact("run_command", &content);
        assert!(result.contains("characters omitted"));
    }

    #[test]
    fn smart_compact_small_content_passed_through() {
        let content = "fn main() {}";
        let result = smart_compact("read_file", content);
        assert_eq!(result, content);
    }

    #[test]
    fn smart_compact_large_non_rust_falls_back_to_microcompact() {
        let content = "console.log('hello');\n".repeat(2000);
        let result = smart_compact("read_file", &content);
        assert!(result.len() < content.len());
        assert!(result.contains("characters omitted") || result.contains("Compacted"));
    }

    // -------------------------------------------------------------------
    // smart_compact_error
    // -------------------------------------------------------------------

    #[test]
    fn smart_compact_error_uses_aggressive_thresholds() {
        let content = "e".repeat(5_000);
        let result = smart_compact_error("run_command", &content);
        assert!(result.len() < content.len(), "should truncate at aggressive threshold");
        assert!(result.contains("omitted"));
    }

    #[test]
    fn smart_compact_error_small_content_unchanged() {
        let content = "error: not found";
        let result = smart_compact_error("run_command", content);
        assert_eq!(result, content);
    }

    #[test]
    fn smart_compact_error_large_content_truncated_aggressively() {
        let content = "f".repeat(10_000);
        let result = smart_compact_error("run_command", &content);
        let expected_max = AGGRESSIVE.keep_head + AGGRESSIVE.keep_tail + 100;
        assert!(result.len() < expected_max, "should be aggressively truncated");
    }

    // -------------------------------------------------------------------
    // compact_older_tool_results
    // -------------------------------------------------------------------

    #[test]
    fn compact_older_tool_results_skips_last_n_messages() {
        let big_content = "x".repeat(10_000);
        let mut messages = vec![
            RichMessage::tool_results(vec![ContentBlock::ToolResult {
                tool_use_id: "t1".into(), content: big_content.clone(), is_error: None,
            }]),
            RichMessage::tool_results(vec![ContentBlock::ToolResult {
                tool_use_id: "t2".into(), content: big_content.clone(), is_error: None,
            }]),
            RichMessage::tool_results(vec![ContentBlock::ToolResult {
                tool_use_id: "t3".into(), content: big_content.clone(), is_error: None,
            }]),
        ];

        compact_older_tool_results(&mut messages, 2);

        // First message should be compacted, last two should be untouched
        let c0 = match &messages[0].content {
            MessageContent::Blocks(b) => match &b[0] { ContentBlock::ToolResult { content, .. } => content.len(), _ => 0 },
            _ => 0,
        };
        let c2 = match &messages[2].content {
            MessageContent::Blocks(b) => match &b[0] { ContentBlock::ToolResult { content, .. } => content.len(), _ => 0 },
            _ => 0,
        };
        assert!(c0 < big_content.len(), "old message should be compacted");
        assert_eq!(c2, big_content.len(), "recent message should be untouched");
    }

    #[test]
    fn compact_older_tool_results_only_compacts_user_messages() {
        let big_content = "x".repeat(10_000);
        let mut messages = vec![
            RichMessage::assistant_text(&big_content),
            RichMessage::tool_results(vec![ContentBlock::ToolResult {
                tool_use_id: "t1".into(), content: big_content.clone(), is_error: None,
            }]),
        ];

        compact_older_tool_results(&mut messages, 0);

        let assistant_len = match &messages[0].content {
            MessageContent::Text(t) => t.len(),
            _ => 0,
        };
        assert_eq!(assistant_len, big_content.len(), "assistant messages should not be compacted by this function");
    }

    #[test]
    fn compact_older_tool_results_skips_assistant_messages() {
        let big = "y".repeat(10_000);
        let mut messages = vec![
            RichMessage::assistant_blocks(vec![ContentBlock::Text { text: big.clone() }]),
            RichMessage::user("recent"),
        ];

        compact_older_tool_results(&mut messages, 1);

        let len = match &messages[0].content {
            MessageContent::Blocks(b) => match &b[0] { ContentBlock::Text { text } => text.len(), _ => 0 },
            _ => 0,
        };
        assert_eq!(len, big.len());
    }

    #[test]
    fn compact_older_tool_results_small_results_untouched() {
        let small = "small content";
        let mut messages = vec![
            RichMessage::tool_results(vec![ContentBlock::ToolResult {
                tool_use_id: "t1".into(), content: small.into(), is_error: None,
            }]),
        ];

        compact_older_tool_results(&mut messages, 0);

        let content = match &messages[0].content {
            MessageContent::Blocks(b) => match &b[0] { ContentBlock::ToolResult { content, .. } => content.as_str(), _ => "" },
            _ => "",
        };
        assert_eq!(content, small);
    }

    // -------------------------------------------------------------------
    // compact_older_tool_results_tiered
    // -------------------------------------------------------------------

    #[test]
    fn compact_older_tool_results_tiered_uses_custom_thresholds() {
        let content = "z".repeat(5_000);
        let mut messages = vec![
            RichMessage::tool_results(vec![ContentBlock::ToolResult {
                tool_use_id: "t1".into(), content: content.clone(), is_error: None,
            }]),
            RichMessage::user("recent"),
        ];

        compact_older_tool_results_tiered(&mut messages, 1, &AGGRESSIVE);

        let compacted = match &messages[0].content {
            MessageContent::Blocks(b) => match &b[0] { ContentBlock::ToolResult { content, .. } => content.clone(), _ => String::new() },
            _ => String::new(),
        };
        assert!(compacted.len() < content.len(), "should be compacted with aggressive config");
    }

    // -------------------------------------------------------------------
    // compact_tool_results_in_history
    // -------------------------------------------------------------------

    #[test]
    fn compact_tool_results_in_history_uses_history_config() {
        let big = "h".repeat(5_000);
        let messages = vec![
            RichMessage::tool_results(vec![ContentBlock::ToolResult {
                tool_use_id: "t1".into(), content: big.clone(), is_error: None,
            }]),
            RichMessage::user("recent"),
        ];

        let result = compact_tool_results_in_history(messages, 1);

        let compacted = match &result[0].content {
            MessageContent::Blocks(b) => match &b[0] { ContentBlock::ToolResult { content, .. } => content.clone(), _ => String::new() },
            _ => String::new(),
        };
        assert!(compacted.len() < big.len(), "should compact with HISTORY config");
        assert!(compacted.contains("omitted"));
    }

    #[test]
    fn compact_tool_results_in_history_returns_new_vec() {
        let messages = vec![
            RichMessage::user("hello"),
            RichMessage::assistant_text("world"),
        ];
        let result = compact_tool_results_in_history(messages, 0);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn compact_tool_results_in_history_preserves_recent() {
        let big = "r".repeat(5_000);
        let messages = vec![
            RichMessage::tool_results(vec![ContentBlock::ToolResult {
                tool_use_id: "t1".into(), content: big.clone(), is_error: None,
            }]),
        ];

        let result = compact_tool_results_in_history(messages, 1);

        let content = match &result[0].content {
            MessageContent::Blocks(b) => match &b[0] { ContentBlock::ToolResult { content, .. } => content.clone(), _ => String::new() },
            _ => String::new(),
        };
        assert_eq!(content.len(), big.len(), "keep_recent=1 should preserve the only message");
    }
}
