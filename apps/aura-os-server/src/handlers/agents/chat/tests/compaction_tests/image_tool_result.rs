//! Tests for image-carrying `tool_result` blocks in the Anthropic
//! history rebuild (`session_events_to_agent_history`). A computer-use
//! screenshot persisted as the `image_media_type` / `image_data`
//! sibling fields on [`ChatContentBlock::ToolResult`] must replay as an
//! Anthropic `tool_result` whose `content` is an ARRAY of the text plus
//! an `image` base64 source block. The string-only path must keep a
//! plain-string `content` so the existing wire shape is unchanged.

use aura_os_core::ChatContentBlock;

use super::super::super::compaction::session_events_to_agent_history;
use super::{
    assert_anthropic_messages_valid, assistant_event, extract_tool_result_blocks, user_event,
};

#[test]
fn agent_history_keeps_legacy_inline_images_even_with_a_source_url() {
    let mut user = user_event("");
    user.content_blocks = Some(vec![ChatContentBlock::Image {
        media_type: "image/png".into(),
        data: "aGVsbG8=".into(),
        source_url: Some("https://cdn.example/legacy.png".into()),
    }]);
    let history = session_events_to_agent_history(&[user]);
    let source = &history[0]["content"][0]["source"];
    assert_eq!(source["type"], "base64");
    assert_eq!(source["media_type"], "image/png");
    assert_eq!(source["data"], "aGVsbG8=");
    assert!(source.get("url").is_none());
}

#[test]
fn agent_history_emits_image_block_for_image_tool_result() {
    let assistant = assistant_event(
        "",
        Some(vec![
            ChatContentBlock::ToolUse {
                id: "toolu_shot".into(),
                name: "computer".into(),
                input: serde_json::json!({ "action": "screenshot" }),
                extra: Default::default(),
            },
            ChatContentBlock::ToolResult {
                tool_use_id: "toolu_shot".into(),
                content: "screenshot taken".into(),
                is_error: Some(false),
                image_media_type: Some("image/png".into()),
                image_data: Some("aGVsbG8=".into()),
            },
        ]),
    );

    let history = session_events_to_agent_history(&[user_event("take a screenshot"), assistant]);
    assert_anthropic_messages_valid(&history);

    let blocks = extract_tool_result_blocks(&history);
    let tool_result = blocks
        .iter()
        .find(|b| b.get("tool_use_id").and_then(|v| v.as_str()) == Some("toolu_shot"))
        .expect("image tool_result must be present in rebuilt history");

    let content = tool_result
        .get("content")
        .and_then(|c| c.as_array())
        .expect("image tool_result content must be an array, not a plain string");

    assert!(
        content
            .iter()
            .any(|b| b.get("type").and_then(|t| t.as_str()) == Some("text")
                && b.get("text").and_then(|t| t.as_str()) == Some("screenshot taken")),
        "image tool_result must keep the text block alongside the image, got: {content:?}"
    );

    let image = content
        .iter()
        .find(|b| b.get("type").and_then(|t| t.as_str()) == Some("image"))
        .expect("image tool_result must emit an image content block");
    let source = image
        .get("source")
        .expect("image block must carry a source");
    assert_eq!(source.get("type").and_then(|v| v.as_str()), Some("base64"));
    assert_eq!(
        source.get("media_type").and_then(|v| v.as_str()),
        Some("image/png")
    );
    assert_eq!(
        source.get("data").and_then(|v| v.as_str()),
        Some("aGVsbG8="),
        "the base64 payload must round-trip into the Anthropic image source"
    );
}

#[test]
fn agent_history_keeps_string_content_when_tool_result_has_no_image() {
    // The string-only path must stay a plain-string `content` so the
    // pre-image wire shape is byte-identical.
    let assistant = assistant_event(
        "",
        Some(vec![
            ChatContentBlock::ToolUse {
                id: "toolu_txt".into(),
                name: "read_file".into(),
                input: serde_json::json!({ "path": "src/lib.rs" }),
                extra: Default::default(),
            },
            ChatContentBlock::ToolResult {
                tool_use_id: "toolu_txt".into(),
                content: "file body".into(),
                is_error: Some(false),
                image_media_type: None,
                image_data: None,
            },
        ]),
    );

    let history = session_events_to_agent_history(&[user_event("read it"), assistant]);
    assert_anthropic_messages_valid(&history);

    let blocks = extract_tool_result_blocks(&history);
    let tool_result = blocks
        .iter()
        .find(|b| b.get("tool_use_id").and_then(|v| v.as_str()) == Some("toolu_txt"))
        .expect("text tool_result must be present");
    assert_eq!(
        tool_result.get("content").and_then(|v| v.as_str()),
        Some("file body"),
        "string-only tool_result content must remain a plain string"
    );
}
