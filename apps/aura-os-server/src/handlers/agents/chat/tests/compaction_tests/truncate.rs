//! Truncation-helper tests: `truncate_for_history` byte cap behaviour and `render_conversation_text`'s oversized-tool-result trimming.

use aura_os_core::ChatContentBlock;

use super::super::super::compaction::{render_conversation_text, truncate_for_history};

#[test]
fn truncate_for_history_is_noop_below_cap() {
    let s = "hello world";
    assert_eq!(truncate_for_history(s, 2048), s);
}

#[test]
fn truncate_for_history_keeps_prefix_and_marker() {
    let big = "X".repeat(10_000);
    let truncated = truncate_for_history(&big, 128);
    assert!(truncated.len() < 512);
    assert!(truncated.starts_with("XXXX"));
    assert!(truncated.contains("[truncated 10000 bytes]"));
}

#[test]
fn truncate_for_history_respects_char_boundary() {
    // A 4-byte UTF-8 char right at the cap must not split.
    let s = format!("abc{}", "🦀".repeat(10));
    let truncated = truncate_for_history(&s, 5);
    assert!(truncated.starts_with("abc"));
    assert!(truncated.contains("[truncated"));
}

#[test]
fn render_conversation_text_truncates_oversized_tool_result() {
    let big = "Z".repeat(10_000);
    let blocks = vec![
        ChatContentBlock::ToolUse {
            id: "tool-1".into(),
            name: "list_agents".into(),
            input: serde_json::json!({}),
        },
        ChatContentBlock::ToolResult {
            tool_use_id: "tool-1".into(),
            content: big.clone(),
            is_error: Some(false),
        },
    ];
    let referenced: std::collections::HashSet<String> =
        std::iter::once("tool-1".to_string()).collect();
    let rendered = render_conversation_text("", Some(&blocks), &referenced, 512);
    assert!(
        rendered.len() < 2_000,
        "rendered still large: {}",
        rendered.len()
    );
    assert!(rendered.contains("[truncated 10000 bytes]"));
    assert!(!rendered.contains(&big));
}
