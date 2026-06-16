//! Truncation-helper tests: `truncate_for_history` byte cap behaviour and `render_conversation_text`'s oversized-tool-result trimming.

use aura_os_core::ChatContentBlock;

use super::super::super::compaction::{
    render_conversation_text, session_events_to_conversation_history, truncate_for_history,
};
use super::super::super::constants::CONVERSATION_HISTORY_MAX_BYTES;
use super::user_event;

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
            extra: Default::default(),
        },
        ChatContentBlock::ToolResult {
            tool_use_id: "tool-1".into(),
            content: big.clone(),
            is_error: Some(false),
            image_media_type: None,
            image_data: None,
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

#[test]
fn conversation_history_cap_keeps_recent_suffix() {
    let mut events = Vec::new();
    for i in 0..80 {
        events.push(user_event(&format!("old-{i}:{}", "A".repeat(1024))));
    }
    events.push(user_event("recent-turn-keep-me"));

    let history = session_events_to_conversation_history(&events);
    let total_bytes: usize = history.iter().map(|m| m.content.len()).sum();

    assert!(
        total_bytes <= CONVERSATION_HISTORY_MAX_BYTES,
        "history should be capped below the provider/WAF risk band, got {total_bytes}"
    );
    assert!(
        history.iter().any(|m| m.content == "recent-turn-keep-me"),
        "newest context must survive trimming"
    );
    assert!(
        history.iter().all(|m| !m.content.contains("old-0:")),
        "oldest context should be trimmed first"
    );
}

#[test]
fn conversation_history_cap_truncates_single_oversized_newest_message() {
    let big = "B".repeat(CONVERSATION_HISTORY_MAX_BYTES + 10_000);
    let history = session_events_to_conversation_history(&[user_event(&big)]);
    let total_bytes: usize = history.iter().map(|m| m.content.len()).sum();

    assert_eq!(history.len(), 1, "the newest message should be kept");
    assert!(
        total_bytes <= CONVERSATION_HISTORY_MAX_BYTES,
        "single-message truncation must respect the hard cap, got {total_bytes}"
    );
    assert!(history[0].content.starts_with("BBBB"));
    assert!(history[0].content.contains("[truncated"));
    assert_ne!(history[0].content, big);
}
