use super::*;
use aura_claude::ContentBlock;

// -- build_tool_result_blocks --------------------------------------------

#[test]
fn test_build_tool_result_blocks_emits_events() {
    let (event_tx, mut event_rx) = mpsc::unbounded_channel();
    let calls = vec![
        ToolCall { id: "t1".into(), name: "read_file".into(), input: serde_json::json!({"path": "a.rs"}) },
        ToolCall { id: "t2".into(), name: "do_thing".into(), input: serde_json::json!({}) },
    ];
    let results = vec![
        ToolCallResult { tool_use_id: "t1".into(), content: "fn main()".into(), is_error: false, stop_loop: false },
        ToolCallResult { tool_use_id: "t2".into(), content: "ok".into(), is_error: false, stop_loop: false },
    ];
    let mut cache = HashMap::new();

    let (blocks, should_stop) = build_tool_result_blocks(&calls, &results, &mut cache, &event_tx);
    assert_eq!(blocks.len(), 2);
    assert!(!should_stop);

    let mut event_count = 0;
    while let Ok(ToolLoopEvent::ToolResult { .. }) = event_rx.try_recv() {
        event_count += 1;
    }
    assert_eq!(event_count, 2);
}

#[test]
fn test_build_tool_result_blocks_should_stop_on_stop_loop() {
    let (event_tx, _) = mpsc::unbounded_channel();
    let calls = vec![
        ToolCall { id: "t1".into(), name: "task_done".into(), input: serde_json::json!({}) },
    ];
    let results = vec![
        ToolCallResult { tool_use_id: "t1".into(), content: "done".into(), is_error: false, stop_loop: true },
    ];
    let mut cache = HashMap::new();

    let (_, should_stop) = build_tool_result_blocks(&calls, &results, &mut cache, &event_tx);
    assert!(should_stop);
}

#[test]
fn test_build_tool_result_blocks_duplicate_read_returns_stop_message() {
    let (event_tx, _) = mpsc::unbounded_channel();
    let calls = vec![
        ToolCall { id: "t1".into(), name: "read_file".into(), input: serde_json::json!({"path": "a.rs"}) },
    ];
    let results = vec![
        ToolCallResult { tool_use_id: "t1".into(), content: "fn main() {}".into(), is_error: false, stop_loop: false },
    ];
    let mut cache = HashMap::new();

    build_tool_result_blocks(&calls, &results, &mut cache, &event_tx);
    let calls2 = vec![
        ToolCall { id: "t2".into(), name: "read_file".into(), input: serde_json::json!({"path": "a.rs"}) },
    ];
    let results2 = vec![
        ToolCallResult { tool_use_id: "t2".into(), content: "fn main() {}".into(), is_error: false, stop_loop: false },
    ];
    let (blocks, _) = build_tool_result_blocks(&calls2, &results2, &mut cache, &event_tx);

    let content = match &blocks[0] {
        ContentBlock::ToolResult { content, .. } => content.clone(),
        _ => String::new(),
    };
    assert!(content.contains("STOP: File already read"), "duplicate read should return STOP message");
}

#[test]
fn test_build_tool_result_blocks_write_invalidates_cache() {
    let (event_tx, _) = mpsc::unbounded_channel();
    let calls = vec![
        ToolCall { id: "t1".into(), name: "read_file".into(), input: serde_json::json!({"path": "a.rs"}) },
    ];
    let results = vec![
        ToolCallResult { tool_use_id: "t1".into(), content: "old content".into(), is_error: false, stop_loop: false },
    ];
    let mut cache = HashMap::new();
    build_tool_result_blocks(&calls, &results, &mut cache, &event_tx);
    assert!(cache.contains_key("a.rs"));

    let write_calls = vec![
        ToolCall { id: "w1".into(), name: "write_file".into(), input: serde_json::json!({"path": "a.rs", "content": "new content"}) },
    ];
    let write_results = vec![
        ToolCallResult { tool_use_id: "w1".into(), content: "ok".into(), is_error: false, stop_loop: false },
    ];
    build_tool_result_blocks(&write_calls, &write_results, &mut cache, &event_tx);
    assert!(!cache.contains_key("a.rs"), "write_file should invalidate read cache");
}

#[test]
fn test_build_tool_result_blocks_edit_invalidates_cache() {
    let (event_tx, _) = mpsc::unbounded_channel();
    let mut cache = HashMap::new();
    cache.insert("a.rs".to_string(), 12345u64);

    let edit_calls = vec![
        ToolCall { id: "e1".into(), name: "edit_file".into(), input: serde_json::json!({"path": "a.rs"}) },
    ];
    let edit_results = vec![
        ToolCallResult { tool_use_id: "e1".into(), content: "ok".into(), is_error: false, stop_loop: false },
    ];
    build_tool_result_blocks(&edit_calls, &edit_results, &mut cache, &event_tx);
    assert!(!cache.contains_key("a.rs"), "edit_file should invalidate read cache");
}

// -- summarize_write_file_input ------------------------------------------

#[test]
fn test_summarize_write_file_input_short_content_unchanged() {
    let input = serde_json::json!({"path": "a.rs", "content": "fn main() {}"});
    let summary = summarize_write_file_input(&input);
    assert_eq!(summary["content"].as_str().unwrap(), "fn main() {}");
    assert_eq!(summary["path"].as_str().unwrap(), "a.rs");
}

#[test]
fn test_summarize_write_file_input_long_content_truncated() {
    let lines: Vec<String> = (0..50).map(|i| format!("line {i}")).collect();
    let content = lines.join("\n");
    let input = serde_json::json!({"path": "big.rs", "content": content});
    let summary = summarize_write_file_input(&input);
    let summarized = summary["content"].as_str().unwrap();
    assert!(summarized.contains("CONTEXT COMPACTED"));
    assert!(summarized.contains("big.rs"));
    assert!(summarized.contains("line 0"));
    assert!(summarized.contains("line 49"));
}

// -- summarize_edit_file_input --------------------------------------------

#[test]
fn test_summarize_edit_file_input_short_content_unchanged() {
    let input = serde_json::json!({
        "path": "a.rs",
        "old_text": "fn foo() {}",
        "new_text": "fn bar() {}",
        "replace_all": false
    });
    let summary = summarize_edit_file_input(&input);
    assert_eq!(summary["path"].as_str().unwrap(), "a.rs");
    assert_eq!(summary["old_text"].as_str().unwrap(), "fn foo() {}");
    assert_eq!(summary["new_text"].as_str().unwrap(), "fn bar() {}");
    assert_eq!(summary["replace_all"], false);
}

#[test]
fn test_summarize_edit_file_input_long_content_truncated() {
    let long_text = "x".repeat(600);
    let input = serde_json::json!({
        "path": "big.rs",
        "old_text": long_text,
        "new_text": "short replacement"
    });
    let summary = summarize_edit_file_input(&input);
    let old = summary["old_text"].as_str().unwrap();
    assert!(old.contains("chars omitted"), "long old_text should be truncated");
    assert_eq!(summary["new_text"].as_str().unwrap(), "short replacement");
    assert_eq!(summary["path"].as_str().unwrap(), "big.rs");
}

#[test]
fn test_summarize_edit_file_input_missing_optional_fields() {
    let input = serde_json::json!({"path": "x.rs"});
    let summary = summarize_edit_file_input(&input);
    assert_eq!(summary["path"].as_str().unwrap(), "x.rs");
    assert!(summary.get("old_text").is_none());
    assert!(summary.get("new_text").is_none());
    assert!(summary.get("replace_all").is_none());
}

// -- looks_truncated -----------------------------------------------------

#[test]
fn test_looks_truncated_short_content_never_truncated() {
    assert!(!looks_truncated("short"));
    assert!(!looks_truncated("a { b }"));
    assert!(!looks_truncated(""));
}

#[test]
fn test_looks_truncated_balanced_braces_not_truncated() {
    let content = format!("{}{}", "x".repeat(200), "fn main() { let x = { 1 }; }");
    assert!(!looks_truncated(&content));
}

#[test]
fn test_looks_truncated_significantly_unbalanced_braces() {
    let content = format!("{}fn main() {{{{ {{{{ {{{{\n", "x".repeat(200));
    assert!(looks_truncated(&content));
}

#[test]
fn test_looks_truncated_content_ending_abruptly() {
    let content = format!("{}let x = some_func(", "x".repeat(200));
    assert!(looks_truncated(&content));
}

#[test]
fn test_looks_truncated_content_ending_with_brace_ok() {
    let content = format!("{}}}", "x".repeat(200));
    assert!(!looks_truncated(&content));
}

#[test]
fn test_looks_truncated_content_ending_with_newline_ok() {
    let content = format!("{}\n", "x".repeat(200));
    assert!(!looks_truncated(&content));
}

#[test]
fn test_looks_truncated_content_ending_with_semicolon_ok() {
    let content = format!("{};", "x".repeat(200));
    assert!(!looks_truncated(&content));
}
