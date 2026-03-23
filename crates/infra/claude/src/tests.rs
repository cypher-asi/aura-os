use super::*;
use tokio::sync::mpsc;

fn sse_stream(
    raw: &str,
) -> impl tokio_stream::Stream<Item = Result<bytes::Bytes, ClaudeClientError>> + Unpin {
    let chunks: Vec<Result<bytes::Bytes, ClaudeClientError>> =
        vec![Ok(bytes::Bytes::from(raw.to_string()))];
    tokio_stream::iter(chunks)
}

fn sse_stream_chunked(
    parts: Vec<&str>,
) -> impl tokio_stream::Stream<Item = Result<bytes::Bytes, ClaudeClientError>> + Unpin {
    let chunks: Vec<Result<bytes::Bytes, ClaudeClientError>> = parts
        .into_iter()
        .map(|s| Ok(bytes::Bytes::from(s.to_string())))
        .collect();
    tokio_stream::iter(chunks)
}

fn drain_events(rx: &mut mpsc::UnboundedReceiver<ClaudeStreamEvent>) -> Vec<ClaudeStreamEvent> {
    let mut events = Vec::new();
    while let Ok(evt) = rx.try_recv() {
        events.push(evt);
    }
    events
}

#[tokio::test]
async fn test_parse_simple_text_stream() {
    let raw = r#"event: message_start
data: {"type":"message_start","message":{"usage":{"input_tokens":100}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello "}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"world"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":50}}

event: message_stop
data: {"type":"message_stop"}

"#;

    let (tx, mut rx) = mpsc::unbounded_channel();
    let result = sse::parse_sse_events(sse_stream(raw), &tx)
        .await
        .expect("parse simple text stream");
    drop(tx);
    let events = drain_events(&mut rx);

    assert_eq!(result.text, "Hello world");
    assert_eq!(result.stop_reason, "end_turn");
    assert_eq!(result.input_tokens, 100);
    assert_eq!(result.output_tokens, 50);

    let delta_texts: Vec<&str> = events
        .iter()
        .filter_map(|e| match e {
            ClaudeStreamEvent::Delta(s) => Some(s.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(delta_texts, vec!["Hello ", "world"]);

    assert!(events.iter().any(|e| matches!(
        e,
        ClaudeStreamEvent::Done {
            stop_reason,
            input_tokens: 100,
            output_tokens: 50,
            ..
        } if stop_reason == "end_turn"
    )));
}

#[tokio::test]
async fn test_parse_tool_use_stream() {
    let raw = "event: message_start\n\
data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":200}}}\n\
\n\
event: content_block_start\n\
data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_01\",\"name\":\"read_file\"}}\n\
\n\
event: content_block_delta\n\
data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"path\\\":\"}}\n\
\n\
event: content_block_delta\n\
data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"\\\"src/main.rs\\\"}\"}}\n\
\n\
event: content_block_stop\n\
data: {\"type\":\"content_block_stop\",\"index\":0}\n\
\n\
event: message_delta\n\
data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"tool_use\"},\"usage\":{\"output_tokens\":30}}\n\
\n\
event: message_stop\n\
data: {\"type\":\"message_stop\"}\n\
\n";

    let (tx, mut rx) = mpsc::unbounded_channel();
    let result = sse::parse_sse_events(sse_stream(raw), &tx)
        .await
        .expect("parse tool use stream");
    drop(tx);
    let events = drain_events(&mut rx);

    assert_eq!(result.tool_calls.len(), 1);
    assert_eq!(result.tool_calls[0].name, "read_file");
    assert_eq!(
        result.tool_calls[0].input,
        serde_json::json!({"path": "src/main.rs"})
    );
    assert_eq!(result.stop_reason, "tool_use");
    assert_eq!(result.input_tokens, 200);
    assert_eq!(result.output_tokens, 30);

    let input_deltas: Vec<_> = events
        .iter()
        .filter(|e| matches!(e, ClaudeStreamEvent::ToolInputDelta { .. }))
        .collect();
    assert_eq!(
        input_deltas.len(),
        2,
        "should emit ToolInputDelta for each input_json_delta"
    );
    assert!(matches!(
        &input_deltas[0],
        ClaudeStreamEvent::ToolInputDelta { id, partial_json }
            if id == "toolu_01" && partial_json == "{\"path\":"
    ));

    assert!(events.iter().any(|e| matches!(
        e,
        ClaudeStreamEvent::ToolUse { name, .. } if name == "read_file"
    )));
    assert!(events.iter().any(|e| matches!(
        e,
        ClaudeStreamEvent::ToolInputSnapshot { id, name, input }
            if id == "toolu_01"
                && name == "read_file"
                && *input == serde_json::json!({"path": "src/main.rs"})
    )));

    assert!(events.iter().any(|e| matches!(
        e,
        ClaudeStreamEvent::Done {
            stop_reason,
            ..
        } if stop_reason == "tool_use"
    )));
}

#[tokio::test]
async fn test_parse_tool_use_stream_emits_multiple_input_snapshots() {
    let raw = "event: message_start\n\
data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":200}}}\n\
\n\
event: content_block_start\n\
data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_01\",\"name\":\"create_spec\"}}\n\
\n\
event: content_block_delta\n\
data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"title\\\":\\\"Spec\\\",\\\"markdown_contents\\\":\\\"Hello\"}}\n\
\n\
event: content_block_delta\n\
data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\" world\\\"}\"}}\n\
\n\
event: content_block_stop\n\
data: {\"type\":\"content_block_stop\",\"index\":0}\n\
\n\
event: message_delta\n\
data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"tool_use\"},\"usage\":{\"output_tokens\":30}}\n\
\n\
event: message_stop\n\
data: {\"type\":\"message_stop\"}\n\
\n";

    let (tx, mut rx) = mpsc::unbounded_channel();
    let _ = sse::parse_sse_events(sse_stream(raw), &tx)
        .await
        .expect("parse streaming snapshots");
    drop(tx);
    let events = drain_events(&mut rx);

    let snapshots: Vec<serde_json::Value> = events
        .iter()
        .filter_map(|e| match e {
            ClaudeStreamEvent::ToolInputSnapshot { input, .. } => Some(input.clone()),
            _ => None,
        })
        .collect();
    assert!(
        snapshots.len() >= 2,
        "expected at least two snapshots while input_json_delta streams, got {}",
        snapshots.len()
    );
    assert!(snapshots.iter().any(|v| *v
        == serde_json::json!({
            "title": "Spec",
            "markdown_contents": "Hello"
        })));
    assert!(snapshots.iter().any(|v| *v
        == serde_json::json!({
            "title": "Spec",
            "markdown_contents": "Hello world"
        })));
}

#[tokio::test]
async fn test_parse_thinking_stream() {
    let raw = r#"event: message_start
data: {"type":"message_start","message":{"usage":{"input_tokens":50}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Let me think..."}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Here is the answer."}}

event: content_block_stop
data: {"type":"content_block_stop","index":1}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":10}}

event: message_stop
data: {"type":"message_stop"}

"#;

    let (tx, mut rx) = mpsc::unbounded_channel();
    let result = sse::parse_sse_events(sse_stream(raw), &tx)
        .await
        .expect("parse thinking stream");
    drop(tx);
    let events = drain_events(&mut rx);

    assert_eq!(result.text, "Here is the answer.");
    assert!(!result.text.contains("think"));

    let thinking_texts: Vec<&str> = events
        .iter()
        .filter_map(|e| match e {
            ClaudeStreamEvent::ThinkingDelta(s) => Some(s.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(thinking_texts, vec!["Let me think..."]);

    let delta_texts: Vec<&str> = events
        .iter()
        .filter_map(|e| match e {
            ClaudeStreamEvent::Delta(s) => Some(s.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(delta_texts, vec!["Here is the answer."]);
}

#[tokio::test]
async fn test_parse_overloaded_error_event() {
    let raw = r#"event: message_start
data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}

event: error
data: {"type":"error","error":{"type":"overloaded_error","message":"API is overloaded"}}

"#;

    let (tx, mut rx) = mpsc::unbounded_channel();
    let result = sse::parse_sse_events(sse_stream(raw), &tx).await;
    drop(tx);
    let events = drain_events(&mut rx);

    assert!(result.is_err());
    let err = result.expect_err("should be error for overloaded");
    assert!(
        err.is_overloaded(),
        "Should be classified as overloaded: {err}"
    );
    assert!(err.to_string().contains("overloaded"));

    assert!(events
        .iter()
        .any(|e| matches!(e, ClaudeStreamEvent::Error(_))));
}

#[tokio::test]
async fn test_parse_non_overloaded_error_event() {
    let raw = r#"event: message_start
data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}

event: error
data: {"type":"error","error":{"type":"invalid_request_error","message":"Bad request"}}

"#;

    let (tx, mut rx) = mpsc::unbounded_channel();
    let result = sse::parse_sse_events(sse_stream(raw), &tx).await;
    drop(tx);
    let events = drain_events(&mut rx);

    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(
        !err.is_overloaded(),
        "Should NOT be classified as overloaded: {err}"
    );
    assert!(err.to_string().contains("Bad request"));

    assert!(events
        .iter()
        .any(|e| matches!(e, ClaudeStreamEvent::Error(msg) if msg == "Bad request")));
}

#[tokio::test]
async fn test_parse_frame_fields_multiline_data() {
    // When multiple `data:` lines appear, the parser keeps the last one.
    let raw = "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":5}}}\n\nevent: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\nevent: content_block_delta\ndata: first_line\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hi\"}}\n\nevent: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":0}\n\nevent: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":1}}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n";

    let (tx, _rx) = mpsc::unbounded_channel();
    let result = sse::parse_sse_events(sse_stream(raw), &tx)
        .await
        .expect("multiline data");
    assert_eq!(result.text, "Hi");
}

#[tokio::test]
async fn test_parse_frame_fields_missing_event() {
    // A frame with no `event:` prefix is skipped (empty event_type).
    let raw = "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":0}}}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n";

    let (tx, _rx) = mpsc::unbounded_channel();
    let result = sse::parse_sse_events(sse_stream(raw), &tx)
        .await
        .expect("missing event");
    assert_eq!(result.text, "");
    assert_eq!(result.stop_reason, "end_turn"); // default, never overwritten
}

#[tokio::test]
async fn test_handle_message_start_with_cache_tokens() {
    let raw = "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":10,\"cache_creation_input_tokens\":500,\"cache_read_input_tokens\":300}}}\n\nevent: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\nevent: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"cached\"}}\n\nevent: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":0}\n\nevent: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":2}}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n";

    let (tx, mut rx) = mpsc::unbounded_channel();
    let result = sse::parse_sse_events(sse_stream(raw), &tx)
        .await
        .expect("cache tokens");
    drop(tx);
    let events = drain_events(&mut rx);

    assert_eq!(result.input_tokens, 10);
    assert_eq!(result.cache_creation_input_tokens, 500);
    assert_eq!(result.cache_read_input_tokens, 300);

    assert!(events.iter().any(|e| matches!(
        e,
        ClaudeStreamEvent::Done {
            cache_creation_input_tokens: 500,
            cache_read_input_tokens: 300,
            ..
        }
    )));
}

#[tokio::test]
async fn test_handle_content_block_stop_malformed_json() {
    // Malformed tool JSON falls back to empty object.
    let raw = "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":1}}}\n\nevent: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"tool_use\",\"id\":\"t1\",\"name\":\"bad_tool\"}}\n\nevent: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{broken\"}}\n\nevent: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":0}\n\nevent: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"tool_use\"},\"usage\":{\"output_tokens\":1}}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n";

    let (tx, mut rx) = mpsc::unbounded_channel();
    let result = sse::parse_sse_events(sse_stream(raw), &tx)
        .await
        .expect("malformed tool json");
    drop(tx);
    let events = drain_events(&mut rx);

    assert_eq!(result.tool_calls.len(), 1);
    assert_eq!(result.tool_calls[0].name, "bad_tool");
    assert_eq!(result.tool_calls[0].input, serde_json::json!({}));

    assert!(events.iter().any(|e| matches!(
        e,
        ClaudeStreamEvent::ToolUse { name, input, .. }
            if name == "bad_tool" && *input == serde_json::json!({})
    )));
}

#[tokio::test]
async fn test_dispatch_frame_unknown_event_type() {
    // Unknown event types are silently ignored.
    let raw = "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":1}}}\n\nevent: ping\ndata: {}\n\nevent: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\nevent: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"ok\"}}\n\nevent: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":0}\n\nevent: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":1}}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n";

    let (tx, _rx) = mpsc::unbounded_channel();
    let result = sse::parse_sse_events(sse_stream(raw), &tx)
        .await
        .expect("unknown event type");
    assert_eq!(result.text, "ok");
}

#[tokio::test]
async fn test_overloaded_error_sets_is_overloaded() {
    let raw = "event: error\ndata: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}\n\n";

    let (tx, mut rx) = mpsc::unbounded_channel();
    let result = sse::parse_sse_events(sse_stream(raw), &tx).await;
    drop(tx);
    let events = drain_events(&mut rx);

    assert!(result.is_err());
    assert!(result.unwrap_err().is_overloaded());
    assert!(events
        .iter()
        .any(|e| matches!(e, ClaudeStreamEvent::Error(_))));
}

#[tokio::test]
async fn test_parse_frame_fields_standard() {
    // Straightforward frame yields correct event type and data.
    let raw = "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":42}}}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n";

    let (tx, _rx) = mpsc::unbounded_channel();
    let result = sse::parse_sse_events(sse_stream(raw), &tx)
        .await
        .expect("standard frame");
    assert_eq!(result.input_tokens, 42);
}

#[tokio::test]
async fn test_parse_chunked_delivery() {
    let full = r#"event: message_start
data: {"type":"message_start","message":{"usage":{"input_tokens":100}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello "}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"world"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":50}}

event: message_stop
data: {"type":"message_stop"}

"#;

    let split1 = full.len() / 3;
    let split2 = 2 * full.len() / 3;
    let chunk1 = &full[..split1];
    let chunk2 = &full[split1..split2];
    let chunk3 = &full[split2..];

    let (tx, mut rx) = mpsc::unbounded_channel();
    let result = sse::parse_sse_events(sse_stream_chunked(vec![chunk1, chunk2, chunk3]), &tx)
        .await
        .expect("parse chunked delivery");
    drop(tx);
    let events = drain_events(&mut rx);

    assert_eq!(result.text, "Hello world");
    assert_eq!(result.stop_reason, "end_turn");
    assert_eq!(result.input_tokens, 100);
    assert_eq!(result.output_tokens, 50);

    let delta_texts: Vec<&str> = events
        .iter()
        .filter_map(|e| match e {
            ClaudeStreamEvent::Delta(s) => Some(s.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(delta_texts, vec!["Hello ", "world"]);
}

// -- inject_message_cache_breakpoint -------------------------------------

#[test]
fn cache_breakpoint_on_last_user_message_array_content() {
    let mut body = serde_json::json!({
        "messages": [
            {"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": "t1", "content": "ok"}
            ]},
            {"role": "assistant", "content": [{"type": "text", "text": "done"}]},
            {"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": "t2", "content": "result"}
            ]}
        ]
    });
    inject_message_cache_breakpoint(&mut body);

    let last_user = &body["messages"][2]["content"][0];
    assert_eq!(
        last_user["cache_control"],
        serde_json::json!({"type": "ephemeral"}),
    );
    assert!(body["messages"][0]["content"][0]
        .get("cache_control")
        .is_none());
}

#[test]
fn cache_breakpoint_on_string_content_promotes_to_array() {
    let mut body = serde_json::json!({
        "messages": [
            {"role": "user", "content": "hello world"}
        ]
    });
    inject_message_cache_breakpoint(&mut body);

    let content = &body["messages"][0]["content"];
    assert!(
        content.is_array(),
        "string content should be promoted to array"
    );
    assert_eq!(content[0]["type"], "text");
    assert_eq!(content[0]["text"], "hello world");
    assert_eq!(
        content[0]["cache_control"],
        serde_json::json!({"type": "ephemeral"})
    );
}

#[test]
fn cache_breakpoint_skips_trailing_assistant_messages() {
    let mut body = serde_json::json!({
        "messages": [
            {"role": "user", "content": [{"type": "text", "text": "task"}]},
            {"role": "assistant", "content": [{"type": "text", "text": "thinking..."}]},
            {"role": "assistant", "content": [{"type": "text", "text": "more"}]}
        ]
    });
    inject_message_cache_breakpoint(&mut body);

    let first_user_block = &body["messages"][0]["content"][0];
    assert_eq!(
        first_user_block["cache_control"],
        serde_json::json!({"type": "ephemeral"}),
        "should fall back to the only user message"
    );
}

#[test]
fn cache_breakpoint_noop_on_empty_messages() {
    let mut body = serde_json::json!({"messages": []});
    inject_message_cache_breakpoint(&mut body);
    assert_eq!(body["messages"].as_array().unwrap().len(), 0);
}

#[test]
fn cache_breakpoint_noop_on_missing_messages() {
    let mut body = serde_json::json!({"model": "test"});
    inject_message_cache_breakpoint(&mut body);
    assert!(body.get("messages").is_none());
}
