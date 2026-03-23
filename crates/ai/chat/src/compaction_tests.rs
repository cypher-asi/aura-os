use super::*;
use aura_link::ToolResultContent;

#[test]
fn compact_older_message_text_tiered_truncates_old_text_blocks() {
    let long_text = "x".repeat(5000);
    let mut messages = vec![
        Message::user("initial context"),
        Message::assistant_text(&long_text),
        Message::assistant_text("recent"),
    ];

    compact_older_message_text_tiered(&mut messages, 1, &AGGRESSIVE);

    let initial = match &messages[0].content {
        MessageContent::Text(t) => t.clone(),
        _ => String::new(),
    };
    assert_eq!(
        initial, "initial context",
        "messages[0] should be protected"
    );
    let older_text = match &messages[1].content {
        MessageContent::Text(t) => t.clone(),
        _ => String::new(),
    };
    assert!(
        older_text.contains("omitted"),
        "older text should be truncated"
    );
    let recent_text = match &messages[2].content {
        MessageContent::Text(t) => t.clone(),
        _ => String::new(),
    };
    assert_eq!(recent_text, "recent");
}

#[test]
fn compact_older_message_text_tiered_skips_tool_result_blocks() {
    let mut messages = vec![Message::tool_results(vec![ContentBlock::ToolResult {
        tool_use_id: "t1".into(),
        content: ToolResultContent::Text("x".repeat(5000)),
        is_error: false,
    }])];

    compact_older_message_text_tiered(&mut messages, 0, &AGGRESSIVE);

    let content_len = match &messages[0].content {
        MessageContent::Blocks(blocks) => match &blocks[0] {
            ContentBlock::ToolResult { content, .. } => {
                aura_link::tool_result_as_str(content).len()
            }
            _ => 0,
        },
        _ => 0,
    };
    assert_eq!(
        content_len,
        5000,
        "tool results are compacted by dedicated routines"
    );
}

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
    assert!(result.starts_with("aaa"));
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

#[test]
fn smart_compact_error_uses_aggressive_thresholds() {
    let content = "e".repeat(5_000);
    let result = smart_compact_error("run_command", &content);
    assert!(
        result.len() < content.len(),
        "should truncate at aggressive threshold"
    );
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
    assert!(
        result.len() < expected_max,
        "should be aggressively truncated"
    );
}

#[test]
fn compact_older_tool_results_skips_last_n_messages() {
    let big_content = "x".repeat(10_000);
    let mut messages = vec![
        Message::user("initial context"),
        Message::tool_results(vec![ContentBlock::ToolResult {
            tool_use_id: "t1".into(),
            content: ToolResultContent::Text(big_content.clone()),
            is_error: false,
        }]),
        Message::tool_results(vec![ContentBlock::ToolResult {
            tool_use_id: "t2".into(),
            content: ToolResultContent::Text(big_content.clone()),
            is_error: false,
        }]),
        Message::tool_results(vec![ContentBlock::ToolResult {
            tool_use_id: "t3".into(),
            content: ToolResultContent::Text(big_content.clone()),
            is_error: false,
        }]),
    ];

    compact_older_tool_results(&mut messages, 2);

    let c1 = match &messages[1].content {
        MessageContent::Blocks(b) => match &b[0] {
            ContentBlock::ToolResult { content, .. } => {
                aura_link::tool_result_as_str(content).len()
            }
            _ => 0,
        },
        _ => 0,
    };
    let c3 = match &messages[3].content {
        MessageContent::Blocks(b) => match &b[0] {
            ContentBlock::ToolResult { content, .. } => {
                aura_link::tool_result_as_str(content).len()
            }
            _ => 0,
        },
        _ => 0,
    };
    assert!(c1 < big_content.len(), "old message should be compacted");
    assert_eq!(c3, big_content.len(), "recent message should be untouched");
}

#[test]
fn compact_older_tool_results_only_compacts_user_messages() {
    let big_content = "x".repeat(10_000);
    let mut messages = vec![
        Message::assistant_text(&big_content),
        Message::tool_results(vec![ContentBlock::ToolResult {
            tool_use_id: "t1".into(),
            content: ToolResultContent::Text(big_content.clone()),
            is_error: false,
        }]),
    ];

    compact_older_tool_results(&mut messages, 0);

    let assistant_len = match &messages[0].content {
        MessageContent::Text(t) => t.len(),
        _ => 0,
    };
    assert_eq!(
        assistant_len,
        big_content.len(),
        "assistant messages should not be compacted by this function"
    );
}

#[test]
fn compact_older_tool_results_skips_assistant_messages() {
    let big = "y".repeat(10_000);
    let mut messages = vec![
        Message::assistant_blocks(vec![ContentBlock::Text { text: big.clone() }]),
        Message::user("recent"),
    ];

    compact_older_tool_results(&mut messages, 1);

    let len = match &messages[0].content {
        MessageContent::Blocks(b) => match &b[0] {
            ContentBlock::Text { text } => text.len(),
            _ => 0,
        },
        _ => 0,
    };
    assert_eq!(len, big.len());
}

#[test]
fn compact_older_tool_results_small_results_untouched() {
    let small = "small content";
    let mut messages = vec![Message::tool_results(vec![ContentBlock::ToolResult {
        tool_use_id: "t1".into(),
        content: ToolResultContent::Text(small.into()),
        is_error: false,
    }])];

    compact_older_tool_results(&mut messages, 0);

    let content = match &messages[0].content {
        MessageContent::Blocks(b) => match &b[0] {
            ContentBlock::ToolResult { content, .. } => aura_link::tool_result_as_str(content),
            _ => "",
        },
        _ => "",
    };
    assert_eq!(content, small);
}

#[test]
fn compact_older_tool_results_tiered_uses_custom_thresholds() {
    let content = "z".repeat(5_000);
    let mut messages = vec![
        Message::user("initial context"),
        Message::tool_results(vec![ContentBlock::ToolResult {
            tool_use_id: "t1".into(),
            content: ToolResultContent::Text(content.clone()),
            is_error: false,
        }]),
        Message::user("recent"),
    ];

    compact_older_tool_results_tiered(&mut messages, 1, &AGGRESSIVE);

    let compacted = match &messages[1].content {
        MessageContent::Blocks(b) => match &b[0] {
            ContentBlock::ToolResult { content, .. } => {
                aura_link::tool_result_as_str(content).to_string()
            }
            _ => String::new(),
        },
        _ => String::new(),
    };
    assert!(
        compacted.len() < content.len(),
        "should be compacted with aggressive config"
    );
}

#[test]
fn compact_tool_results_in_history_uses_history_config() {
    let big = "h".repeat(5_000);
    let messages = vec![
        Message::user("initial context"),
        Message::tool_results(vec![ContentBlock::ToolResult {
            tool_use_id: "t1".into(),
            content: ToolResultContent::Text(big.clone()),
            is_error: false,
        }]),
        Message::user("recent"),
    ];

    let result = compact_tool_results_in_history(messages, 1);

    let compacted = match &result[1].content {
        MessageContent::Blocks(b) => match &b[0] {
            ContentBlock::ToolResult { content, .. } => {
                aura_link::tool_result_as_str(content).to_string()
            }
            _ => String::new(),
        },
        _ => String::new(),
    };
    assert!(
        compacted.len() < big.len(),
        "should compact with HISTORY config"
    );
    assert!(compacted.contains("omitted"));
}

#[test]
fn compact_tool_results_in_history_returns_new_vec() {
    let messages = vec![
        Message::user("hello"),
        Message::assistant_text("world"),
    ];
    let result = compact_tool_results_in_history(messages, 0);
    assert_eq!(result.len(), 2);
}

#[test]
fn compact_tool_results_in_history_preserves_recent() {
    let big = "r".repeat(5_000);
    let messages = vec![Message::tool_results(vec![ContentBlock::ToolResult {
        tool_use_id: "t1".into(),
        content: ToolResultContent::Text(big.clone()),
        is_error: false,
    }])];

    let result = compact_tool_results_in_history(messages, 1);

    let content = match &result[0].content {
        MessageContent::Blocks(b) => match &b[0] {
            ContentBlock::ToolResult { content, .. } => {
                aura_link::tool_result_as_str(content).to_string()
            }
            _ => String::new(),
        },
        _ => String::new(),
    };
    assert_eq!(
        content.len(),
        big.len(),
        "keep_recent=1 should preserve the only message"
    );
}
