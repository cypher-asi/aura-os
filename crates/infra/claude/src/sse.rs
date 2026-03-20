use tokio::sync::mpsc;
use tracing::{debug, info, warn};

use crate::channel_ext::send_or_log;
use crate::error::ClaudeClientError;
use crate::types::{ClaudeStreamEvent, ToolCall, ToolStreamResponse};

/// Standalone SSE frame parser, decoupled from `reqwest::Response` for testability.
pub(crate) async fn parse_sse_events(
    mut stream: impl tokio_stream::Stream<Item = Result<bytes::Bytes, ClaudeClientError>> + Unpin,
    event_tx: &mpsc::UnboundedSender<ClaudeStreamEvent>,
) -> Result<ToolStreamResponse, ClaudeClientError> {
    use tokio_stream::StreamExt;

    let start = std::time::Instant::now();
    let mut line_buf = String::new();
    let mut accumulated_text = String::new();
    let mut input_tokens: u64 = 0;
    let mut output_tokens: u64 = 0;
    let mut cache_creation_input_tokens: u64 = 0;
    let mut cache_read_input_tokens: u64 = 0;
    let mut stop_reason = String::from("end_turn");

    let mut tool_calls: Vec<ToolCall> = Vec::new();
    let mut current_tool_id = String::new();
    let mut current_tool_name = String::new();
    let mut current_tool_json = String::new();
    let mut in_tool_block = false;
    let mut in_thinking_block = false;
    let mut chunks_received: u64 = 0;
    let mut frames_parsed: u64 = 0;

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| {
            tracing::error!(error = %e, "Error reading streaming chunk");
            e
        })?;
        chunks_received += 1;

        let chunk_str = String::from_utf8_lossy(&chunk);
        line_buf.push_str(&chunk_str.replace('\r', ""));

        while let Some(double_newline_pos) = line_buf.find("\n\n") {
            let frame = line_buf[..double_newline_pos].to_string();
            line_buf = line_buf[double_newline_pos + 2..].to_string();

            let mut event_type = String::new();
            let mut data_str = String::new();

            for line in frame.lines() {
                if let Some(val) = line.strip_prefix("event: ") {
                    event_type = val.trim().to_string();
                } else if let Some(val) = line.strip_prefix("data: ") {
                    data_str = val.trim().to_string();
                }
            }

            if event_type.is_empty() || data_str.is_empty() {
                continue;
            }

            frames_parsed += 1;
            match event_type.as_str() {
                "message_start" => {
                    if let Ok(data) = serde_json::from_str::<serde_json::Value>(&data_str) {
                        if let Some(usage) = data.get("message").and_then(|m| m.get("usage")) {
                            if let Some(it) = usage.get("input_tokens").and_then(|v| v.as_u64()) {
                                input_tokens = it;
                            }
                            cache_creation_input_tokens = usage.get("cache_creation_input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                            cache_read_input_tokens = usage.get("cache_read_input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                            if cache_creation_input_tokens > 0 || cache_read_input_tokens > 0 {
                                info!(cache_creation_input_tokens, cache_read_input_tokens, "Prompt cache metrics");
                            }
                        }
                    }
                }
                "content_block_start" => {
                    if let Ok(data) = serde_json::from_str::<serde_json::Value>(&data_str) {
                        if let Some(cb) = data.get("content_block") {
                            let block_type = cb.get("type").and_then(|v| v.as_str()).unwrap_or("");
                            match block_type {
                                "tool_use" => {
                                    in_tool_block = true;
                                    in_thinking_block = false;
                                    current_tool_id = cb.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                    current_tool_name = cb.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                    current_tool_json.clear();
                                    send_or_log(&event_tx, ClaudeStreamEvent::ToolUseStarted {
                                        id: current_tool_id.clone(),
                                        name: current_tool_name.clone(),
                                    });
                                }
                                "thinking" => {
                                    in_thinking_block = true;
                                    in_tool_block = false;
                                }
                                _ => {
                                    in_tool_block = false;
                                    in_thinking_block = false;
                                }
                            }
                        }
                    }
                }
                "content_block_delta" => {
                    if let Ok(data) = serde_json::from_str::<serde_json::Value>(&data_str) {
                        if let Some(delta) = data.get("delta") {
                            let delta_type = delta.get("type").and_then(|v| v.as_str()).unwrap_or("");
                            match delta_type {
                                "text_delta" => {
                                    if let Some(text) = delta.get("text").and_then(|t| t.as_str()) {
                                        accumulated_text.push_str(text);
                                        send_or_log(&event_tx, ClaudeStreamEvent::Delta(text.to_string()));
                                    }
                                }
                                "thinking_delta" => {
                                    if let Some(text) = delta.get("thinking").and_then(|t| t.as_str()) {
                                        send_or_log(&event_tx, ClaudeStreamEvent::ThinkingDelta(text.to_string()));
                                    }
                                }
                                "input_json_delta" => {
                                    if let Some(json) = delta.get("partial_json").and_then(|t| t.as_str()) {
                                        current_tool_json.push_str(json);
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                }
                "content_block_stop" => {
                    if in_thinking_block {
                        in_thinking_block = false;
                    }
                    if in_tool_block {
                        let input: serde_json::Value = serde_json::from_str(&current_tool_json)
                            .unwrap_or_else(|e| {
                                tracing::warn!(
                                    tool_name = %current_tool_name,
                                    error = %e,
                                    json_len = current_tool_json.len(),
                                    "failed to parse tool call JSON from SSE stream, falling back to empty object"
                                );
                                serde_json::Value::Object(Default::default())
                            });
                        let tool_call = ToolCall {
                            id: current_tool_id.clone(),
                            name: current_tool_name.clone(),
                            input: input.clone(),
                        };
                        send_or_log(&event_tx, ClaudeStreamEvent::ToolUse {
                            id: current_tool_id.clone(),
                            name: current_tool_name.clone(),
                            input,
                        });
                        tool_calls.push(tool_call);
                        in_tool_block = false;
                        current_tool_id.clear();
                        current_tool_name.clear();
                        current_tool_json.clear();
                    }
                }
                "message_delta" => {
                    if let Ok(data) = serde_json::from_str::<serde_json::Value>(&data_str) {
                        if let Some(sr) = data.get("delta").and_then(|d| d.get("stop_reason")).and_then(|v| v.as_str()) {
                            stop_reason = sr.to_string();
                        }
                        if let Some(usage) = data.get("usage") {
                            if let Some(ot) = usage.get("output_tokens").and_then(|v| v.as_u64()) {
                                output_tokens = ot;
                            }
                        }
                    }
                }
                "message_stop" => {
                    debug!(elapsed_ms = start.elapsed().as_millis() as u64, "Claude stream completed");
                }
                "error" => {
                    let parsed = serde_json::from_str::<serde_json::Value>(&data_str).ok();
                    let error_type = parsed.as_ref()
                        .and_then(|v| v.get("error").and_then(|e| e.get("type")).and_then(|t| t.as_str()));
                    let msg = parsed.as_ref()
                        .and_then(|v| v.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()).map(String::from))
                        .unwrap_or_else(|| data_str.clone());

                    if error_type == Some("overloaded_error") {
                        send_or_log(&event_tx, ClaudeStreamEvent::Error(
                            "The AI model is temporarily overloaded.".to_string(),
                        ));
                        return Err(ClaudeClientError::Overloaded);
                    }

                    send_or_log(&event_tx, ClaudeStreamEvent::Error(msg.clone()));
                    return Err(ClaudeClientError::Parse(msg));
                }
                _ => {}
            }
        }
    }

    if !line_buf.is_empty() {
        let preview: String = line_buf.chars().take(200).collect();
        warn!(
            leftover_bytes = line_buf.len(),
            preview = %preview,
            "SSE stream ended with unparsed data in buffer"
        );
    }

    send_or_log(&event_tx, ClaudeStreamEvent::Done {
        stop_reason: stop_reason.clone(),
        input_tokens,
        output_tokens,
        cache_creation_input_tokens,
        cache_read_input_tokens,
    });

    info!(
        stop_reason = %stop_reason,
        input_tokens,
        output_tokens,
        cache_creation_input_tokens,
        cache_read_input_tokens,
        response_len = accumulated_text.len(),
        tool_call_count = tool_calls.len(),
        chunks_received,
        frames_parsed,
        elapsed_ms = start.elapsed().as_millis() as u64,
        "Claude streaming complete"
    );

    Ok(ToolStreamResponse {
        text: accumulated_text,
        tool_calls,
        stop_reason,
        input_tokens,
        output_tokens,
        cache_creation_input_tokens,
        cache_read_input_tokens,
        model_used: String::new(),
    })
}
