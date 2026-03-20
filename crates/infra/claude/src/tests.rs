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
    let result = sse::parse_sse_events(sse_stream(raw), &tx).await.unwrap();
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

    assert!(
        events.iter().any(|e| matches!(
            e,
            ClaudeStreamEvent::Done {
                stop_reason,
                input_tokens: 100,
                output_tokens: 50,
                ..
            } if stop_reason == "end_turn"
        ))
    );
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
    let result = sse::parse_sse_events(sse_stream(raw), &tx).await.unwrap();
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

    assert!(events.iter().any(|e| matches!(
        e,
        ClaudeStreamEvent::ToolUse { name, .. } if name == "read_file"
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
    let result = sse::parse_sse_events(sse_stream(raw), &tx).await.unwrap();
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
    let err = result.unwrap_err();
    assert!(err.is_overloaded(), "Should be classified as overloaded: {err}");
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
    assert!(!err.is_overloaded(), "Should NOT be classified as overloaded: {err}");
    assert!(err.to_string().contains("Bad request"));

    assert!(events
        .iter()
        .any(|e| matches!(e, ClaudeStreamEvent::Error(msg) if msg == "Bad request")));
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
    let result =
        sse::parse_sse_events(sse_stream_chunked(vec![chunk1, chunk2, chunk3]), &tx)
            .await
            .unwrap();
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
