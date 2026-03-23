use tokio::sync::mpsc;
use tracing::{debug, info, warn};

use crate::channel_ext::send_or_log;
use crate::error::ClaudeClientError;
use crate::types::{ClaudeStreamEvent, ToolCall, ToolStreamResponse};

struct SseParserState {
    accumulated_text: String,
    input_tokens: u64,
    output_tokens: u64,
    cache_creation_input_tokens: u64,
    cache_read_input_tokens: u64,
    stop_reason: String,
    tool_calls: Vec<ToolCall>,
    current_tool_id: String,
    current_tool_name: String,
    current_tool_json: String,
    in_tool_block: bool,
    in_thinking_block: bool,
    chunks_received: u64,
    frames_parsed: u64,
}

impl SseParserState {
    fn new() -> Self {
        Self {
            accumulated_text: String::new(),
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            stop_reason: String::from("end_turn"),
            tool_calls: Vec::new(),
            current_tool_id: String::new(),
            current_tool_name: String::new(),
            current_tool_json: String::new(),
            in_tool_block: false,
            in_thinking_block: false,
            chunks_received: 0,
            frames_parsed: 0,
        }
    }

    fn handle_message_start(&mut self, data: &str) {
        if let Ok(data) = serde_json::from_str::<serde_json::Value>(data) {
            if let Some(usage) = data.get("message").and_then(|m| m.get("usage")) {
                if let Some(it) = usage.get("input_tokens").and_then(|v| v.as_u64()) {
                    self.input_tokens = it;
                }
                self.cache_creation_input_tokens = usage
                    .get("cache_creation_input_tokens")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                self.cache_read_input_tokens = usage
                    .get("cache_read_input_tokens")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                if self.cache_creation_input_tokens > 0 || self.cache_read_input_tokens > 0 {
                    info!(
                        cache_creation_input_tokens = self.cache_creation_input_tokens,
                        cache_read_input_tokens = self.cache_read_input_tokens,
                        "Prompt cache metrics"
                    );
                }
            }
        }
    }

    fn handle_content_block_start(
        &mut self,
        data: &str,
        tx: &mpsc::UnboundedSender<ClaudeStreamEvent>,
    ) {
        if let Ok(data) = serde_json::from_str::<serde_json::Value>(data) {
            if let Some(cb) = data.get("content_block") {
                let block_type = cb.get("type").and_then(|v| v.as_str()).unwrap_or("");
                match block_type {
                    "tool_use" => {
                        self.in_tool_block = true;
                        self.in_thinking_block = false;
                        self.current_tool_id = cb
                            .get("id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        self.current_tool_name = cb
                            .get("name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        self.current_tool_json.clear();
                        send_or_log(
                            tx,
                            ClaudeStreamEvent::ToolUseStarted {
                                id: self.current_tool_id.clone(),
                                name: self.current_tool_name.clone(),
                            },
                        );
                    }
                    "thinking" => {
                        self.in_thinking_block = true;
                        self.in_tool_block = false;
                    }
                    _ => {
                        self.in_tool_block = false;
                        self.in_thinking_block = false;
                    }
                }
            }
        }
    }

    fn handle_content_block_delta(
        &mut self,
        data: &str,
        tx: &mpsc::UnboundedSender<ClaudeStreamEvent>,
    ) {
        if let Ok(data) = serde_json::from_str::<serde_json::Value>(data) {
            if let Some(delta) = data.get("delta") {
                let delta_type = delta.get("type").and_then(|v| v.as_str()).unwrap_or("");
                match delta_type {
                    "text_delta" => {
                        if let Some(text) = delta.get("text").and_then(|t| t.as_str()) {
                            self.accumulated_text.push_str(text);
                            send_or_log(tx, ClaudeStreamEvent::Delta(text.to_string()));
                        }
                    }
                    "thinking_delta" => {
                        if let Some(text) = delta.get("thinking").and_then(|t| t.as_str()) {
                            send_or_log(tx, ClaudeStreamEvent::ThinkingDelta(text.to_string()));
                        }
                    }
                    "input_json_delta" => {
                        if let Some(json) = delta.get("partial_json").and_then(|t| t.as_str()) {
                            self.current_tool_json.push_str(json);
                            match parse_best_effort_json_snapshot(&self.current_tool_json) {
                                Some(input) => {
                                    if self.current_tool_name == "create_spec"
                                        || self.current_tool_name == "update_spec"
                                    {
                                        let has_md = input
                                            .get("markdown_contents")
                                            .and_then(|v| v.as_str())
                                            .is_some_and(|s| !s.is_empty());
                                        debug!(
                                            tool = %self.current_tool_name,
                                            buf_len = self.current_tool_json.len(),
                                            has_markdown_contents = has_md,
                                            "spec tool snapshot emitted"
                                        );
                                    }
                                    send_or_log(
                                        tx,
                                        ClaudeStreamEvent::ToolInputSnapshot {
                                            id: self.current_tool_id.clone(),
                                            name: self.current_tool_name.clone(),
                                            input,
                                        },
                                    );
                                }
                                None => {
                                    debug!(
                                        tool = %self.current_tool_name,
                                        buf_len = self.current_tool_json.len(),
                                        "best-effort JSON snapshot parse returned None"
                                    );
                                }
                            }
                            send_or_log(
                                tx,
                                ClaudeStreamEvent::ToolInputDelta {
                                    id: self.current_tool_id.clone(),
                                    partial_json: json.to_string(),
                                },
                            );
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    fn handle_content_block_stop(&mut self, tx: &mpsc::UnboundedSender<ClaudeStreamEvent>) {
        if self.in_thinking_block {
            self.in_thinking_block = false;
        }
        if self.in_tool_block {
            let input: serde_json::Value = serde_json::from_str(&self.current_tool_json)
                .unwrap_or_else(|e| {
                    tracing::warn!(
                        tool_name = %self.current_tool_name,
                        error = %e,
                        json_len = self.current_tool_json.len(),
                        "failed to parse tool call JSON from SSE stream, falling back to empty object"
                    );
                    serde_json::Value::Object(Default::default())
                });
            let tool_call = ToolCall {
                id: self.current_tool_id.clone(),
                name: self.current_tool_name.clone(),
                input: input.clone(),
            };
            send_or_log(
                tx,
                ClaudeStreamEvent::ToolUse {
                    id: self.current_tool_id.clone(),
                    name: self.current_tool_name.clone(),
                    input,
                },
            );
            self.tool_calls.push(tool_call);
            self.in_tool_block = false;
            self.current_tool_id.clear();
            self.current_tool_name.clear();
            self.current_tool_json.clear();
        }
    }

    fn handle_message_delta(&mut self, data: &str) {
        if let Ok(data) = serde_json::from_str::<serde_json::Value>(data) {
            if let Some(sr) = data
                .get("delta")
                .and_then(|d| d.get("stop_reason"))
                .and_then(|v| v.as_str())
            {
                self.stop_reason = sr.to_string();
            }
            if let Some(usage) = data.get("usage") {
                if let Some(ot) = usage.get("output_tokens").and_then(|v| v.as_u64()) {
                    self.output_tokens = ot;
                }
            }
        }
    }

    fn handle_error(
        &self,
        data: &str,
        tx: &mpsc::UnboundedSender<ClaudeStreamEvent>,
    ) -> Result<(), ClaudeClientError> {
        let parsed = serde_json::from_str::<serde_json::Value>(data).ok();
        let error_type = parsed.as_ref().and_then(|v| {
            v.get("error")
                .and_then(|e| e.get("type"))
                .and_then(|t| t.as_str())
        });
        let msg = parsed
            .as_ref()
            .and_then(|v| {
                v.get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(|m| m.as_str())
                    .map(String::from)
            })
            .unwrap_or_else(|| data.to_string());

        if error_type == Some("overloaded_error") {
            send_or_log(
                tx,
                ClaudeStreamEvent::Error("The AI model is temporarily overloaded.".to_string()),
            );
            return Err(ClaudeClientError::Overloaded);
        }

        send_or_log(tx, ClaudeStreamEvent::Error(msg.clone()));
        Err(ClaudeClientError::Parse(msg))
    }

    fn dispatch_frame(
        &mut self,
        event_type: &str,
        data_str: &str,
        tx: &mpsc::UnboundedSender<ClaudeStreamEvent>,
        start: std::time::Instant,
    ) -> Result<(), ClaudeClientError> {
        self.frames_parsed += 1;
        match event_type {
            "message_start" => self.handle_message_start(data_str),
            "content_block_start" => self.handle_content_block_start(data_str, tx),
            "content_block_delta" => self.handle_content_block_delta(data_str, tx),
            "content_block_stop" => self.handle_content_block_stop(tx),
            "message_delta" => self.handle_message_delta(data_str),
            "message_stop" => {
                debug!(
                    elapsed_ms = start.elapsed().as_millis() as u64,
                    "Claude stream completed"
                );
            }
            "error" => {
                self.handle_error(data_str, tx)?;
            }
            _ => {}
        }
        Ok(())
    }

    fn finalize(
        self,
        event_tx: &mpsc::UnboundedSender<ClaudeStreamEvent>,
        start: std::time::Instant,
    ) -> ToolStreamResponse {
        send_or_log(
            event_tx,
            ClaudeStreamEvent::Done {
                stop_reason: self.stop_reason.clone(),
                input_tokens: self.input_tokens,
                output_tokens: self.output_tokens,
                cache_creation_input_tokens: self.cache_creation_input_tokens,
                cache_read_input_tokens: self.cache_read_input_tokens,
            },
        );
        info!(
            stop_reason = %self.stop_reason,
            input_tokens = self.input_tokens,
            output_tokens = self.output_tokens,
            cache_creation_input_tokens = self.cache_creation_input_tokens,
            cache_read_input_tokens = self.cache_read_input_tokens,
            response_len = self.accumulated_text.len(),
            tool_call_count = self.tool_calls.len(),
            chunks_received = self.chunks_received,
            frames_parsed = self.frames_parsed,
            elapsed_ms = start.elapsed().as_millis() as u64,
            "Claude streaming complete"
        );
        ToolStreamResponse {
            text: self.accumulated_text,
            tool_calls: self.tool_calls,
            stop_reason: self.stop_reason,
            input_tokens: self.input_tokens,
            output_tokens: self.output_tokens,
            cache_creation_input_tokens: self.cache_creation_input_tokens,
            cache_read_input_tokens: self.cache_read_input_tokens,
            model_used: String::new(),
        }
    }
}

fn parse_frame_fields(frame: &str) -> (String, String) {
    let mut event_type = String::new();
    let mut data_str = String::new();
    for line in frame.lines() {
        if let Some(val) = line.strip_prefix("event: ") {
            event_type = val.trim().to_string();
        } else if let Some(val) = line.strip_prefix("data: ") {
            data_str = val.trim().to_string();
        }
    }
    (event_type, data_str)
}

fn parse_best_effort_json_snapshot(buf: &str) -> Option<serde_json::Value> {
    let trimmed = buf.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        return Some(value);
    }

    let mut escaped = false;
    let mut in_string = false;
    let mut open_braces = 0usize;
    let mut open_brackets = 0usize;

    for ch in trimmed.chars() {
        if in_string {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }

        match ch {
            '"' => in_string = true,
            '{' => open_braces += 1,
            '}' => open_braces = open_braces.saturating_sub(1),
            '[' => open_brackets += 1,
            ']' => open_brackets = open_brackets.saturating_sub(1),
            _ => {}
        }
    }

    // Controlled close-heuristics for partial JSON fragments.
    let mut candidate = String::from(trimmed);
    if candidate.ends_with(',') {
        candidate.pop();
    }
    if in_string {
        if escaped {
            // Buffer ends mid-escape (e.g. trailing `\` from a `\n` sequence).
            // Drop the dangling backslash so the closing `"` isn't consumed as `\"`.
            candidate.pop();
        }
        candidate.push('"');
    }
    candidate.push_str(&"]".repeat(open_brackets));
    candidate.push_str(&"}".repeat(open_braces));

    serde_json::from_str::<serde_json::Value>(&candidate).ok()
}

/// Standalone SSE frame parser, decoupled from `reqwest::Response` for testability.
pub(crate) async fn parse_sse_events(
    mut stream: impl tokio_stream::Stream<Item = Result<bytes::Bytes, ClaudeClientError>> + Unpin,
    event_tx: &mpsc::UnboundedSender<ClaudeStreamEvent>,
) -> Result<ToolStreamResponse, ClaudeClientError> {
    use tokio_stream::StreamExt;

    let start = std::time::Instant::now();
    let mut state = SseParserState::new();
    let mut line_buf = String::new();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| {
            tracing::error!(error = %e, "Error reading streaming chunk");
            e
        })?;
        state.chunks_received += 1;
        line_buf.push_str(&String::from_utf8_lossy(&chunk).replace('\r', ""));

        while let Some(pos) = line_buf.find("\n\n") {
            let frame = line_buf[..pos].to_string();
            line_buf = line_buf[pos + 2..].to_string();
            let (event_type, data_str) = parse_frame_fields(&frame);
            if event_type.is_empty() || data_str.is_empty() {
                continue;
            }
            state.dispatch_frame(&event_type, &data_str, event_tx, start)?;
        }
    }

    if !line_buf.is_empty() {
        let preview: String = line_buf.chars().take(200).collect();
        warn!(leftover_bytes = line_buf.len(), preview = %preview, "SSE stream ended with unparsed data in buffer");
    }

    Ok(state.finalize(event_tx, start))
}

#[cfg(test)]
mod snapshot_tests {
    use super::parse_best_effort_json_snapshot;

    #[test]
    fn complete_json_parses() {
        let val = parse_best_effort_json_snapshot(r#"{"title": "Spec"}"#).unwrap();
        assert_eq!(val["title"], "Spec");
    }

    #[test]
    fn partial_string_value_is_closed() {
        let val = parse_best_effort_json_snapshot(r#"{"title": "My Sp"#).unwrap();
        assert_eq!(val["title"], "My Sp");
    }

    #[test]
    fn partial_markdown_with_newline_escape() {
        let input = "{\"title\": \"Spec\", \"markdown_contents\": \"# Heading\\nBody";
        let val = parse_best_effort_json_snapshot(input).unwrap();
        assert_eq!(val["title"], "Spec");
        assert!(val["markdown_contents"]
            .as_str()
            .unwrap()
            .contains("Heading"));
    }

    #[test]
    fn dangling_backslash_is_stripped() {
        let input = "{\"title\": \"Spec\", \"markdown_contents\": \"line1\\";
        let val = parse_best_effort_json_snapshot(input).unwrap();
        assert_eq!(val["markdown_contents"], "line1");
    }

    #[test]
    fn double_backslash_at_end_is_complete_escape() {
        let input = "{\"markdown_contents\": \"path\\\\";
        let val = parse_best_effort_json_snapshot(input).unwrap();
        assert_eq!(val["markdown_contents"], "path\\");
    }

    #[test]
    fn trailing_comma_stripped() {
        let val = parse_best_effort_json_snapshot(r#"{"title": "Spec","#).unwrap();
        assert_eq!(val["title"], "Spec");
    }

    #[test]
    fn empty_string_returns_none() {
        assert!(parse_best_effort_json_snapshot("").is_none());
        assert!(parse_best_effort_json_snapshot("  ").is_none());
    }

    #[test]
    fn key_without_value_returns_none() {
        assert!(parse_best_effort_json_snapshot(r#"{"title": "ok", "markd"#).is_none());
    }
}
