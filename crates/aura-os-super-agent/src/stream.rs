#[allow(dead_code)]
mod types {
    use serde::Deserialize;

    #[derive(Debug, Deserialize)]
    pub(super) struct StreamEvent {
        #[serde(rename = "type")]
        pub event_type: String,
        #[serde(default)]
        pub index: Option<usize>,
        #[serde(default)]
        pub message: Option<StreamMessage>,
        #[serde(default)]
        pub content_block: Option<ContentBlock>,
        #[serde(default)]
        pub delta: Option<DeltaPayload>,
        #[serde(default)]
        pub usage: Option<UsagePayload>,
    }

    #[derive(Debug, Deserialize)]
    pub(super) struct StreamMessage {
        pub id: String,
        #[serde(default)]
        pub usage: Option<UsagePayload>,
    }

    #[derive(Debug, Clone, Deserialize)]
    pub(super) struct ContentBlock {
        #[serde(rename = "type")]
        pub block_type: String,
        #[serde(default)]
        pub id: Option<String>,
        #[serde(default)]
        pub name: Option<String>,
        #[serde(default)]
        pub text: Option<String>,
    }

    #[derive(Debug, Deserialize)]
    pub(super) struct DeltaPayload {
        #[serde(rename = "type", default)]
        pub delta_type: Option<String>,
        #[serde(default)]
        pub text: Option<String>,
        #[serde(default)]
        pub thinking: Option<String>,
        #[serde(default)]
        pub partial_json: Option<String>,
        #[serde(default)]
        pub stop_reason: Option<String>,
    }

    #[derive(Debug, Clone, Default, Deserialize)]
    pub(super) struct UsagePayload {
        #[serde(default)]
        pub input_tokens: u64,
        #[serde(default)]
        pub output_tokens: u64,
    }
}

use std::sync::Arc;

use reqwest::Client;
use serde::Serialize;
use serde_json::{json, Value};
use tokio::sync::broadcast;
use tracing::{info, warn};

use aura_os_link::{
    AssistantMessageEnd, AssistantMessageStart, ErrorMsg, FilesChanged, HarnessOutbound,
    SessionUsage, TextDelta, ThinkingDelta, ToolResultMsg, ToolUseStart,
};

use crate::tools::{SuperAgentContext, ToolRegistry};
use types::*;

const DEFAULT_MAX_TOOL_TURNS: usize = 25;
const DEFAULT_MAX_TOKENS: u32 = 16_384;
const DEFAULT_MODEL: &str = "claude-sonnet-4-5-20250514";
const MAX_CONSECUTIVE_TRUNCATIONS: usize = 3;

#[derive(Serialize)]
struct MessagesRequest {
    model: String,
    max_tokens: u32,
    system: String,
    tools: Vec<Value>,
    messages: Vec<Value>,
    stream: bool,
}

struct ToolUseAccumulator {
    id: String,
    name: String,
    input_json: String,
}

// ---------------------------------------------------------------------------
// SuperAgentStream
// ---------------------------------------------------------------------------

pub struct SuperAgentStream {
    router_url: String,
    http: Client,
    system_prompt: String,
    tool_defs: Vec<Value>,
    messages: Vec<Value>,
    ctx: Arc<SuperAgentContext>,
    registry: Arc<ToolRegistry>,
    tx: broadcast::Sender<HarnessOutbound>,
    model: String,
    max_turns: usize,
    max_tokens: u32,
}

impl SuperAgentStream {
    pub fn new(
        router_url: String,
        http: Client,
        system_prompt: String,
        tool_defs: Vec<Value>,
        conversation_history: Vec<Value>,
        ctx: Arc<SuperAgentContext>,
        registry: Arc<ToolRegistry>,
        tx: broadcast::Sender<HarnessOutbound>,
        model: Option<String>,
    ) -> Self {
        Self {
            router_url,
            http,
            system_prompt,
            tool_defs,
            messages: conversation_history,
            ctx,
            registry,
            tx,
            model: model.unwrap_or_else(|| DEFAULT_MODEL.to_string()),
            max_turns: DEFAULT_MAX_TOOL_TURNS,
            max_tokens: DEFAULT_MAX_TOKENS,
        }
    }

    pub fn with_max_turns(mut self, max_turns: Option<u32>) -> Self {
        if let Some(n) = max_turns {
            self.max_turns = n as usize;
        }
        self
    }

    pub fn with_max_tokens(mut self, max_tokens: Option<u32>) -> Self {
        if let Some(n) = max_tokens {
            self.max_tokens = n;
        }
        self
    }

    fn emit(&self, evt: HarnessOutbound) {
        let _ = self.tx.send(evt);
    }

    /// Run the full multi-turn tool loop for a single user message.
    ///
    /// Returns the accumulated conversation messages (full Claude API format
    /// with tool_use / tool_result blocks) so the caller can cache them for
    /// subsequent turns.
    ///
    /// `image_blocks` is an optional list of pre-formatted Anthropic image
    /// content blocks (each `{ "type": "image", "source": { ... } }`).
    pub async fn run(
        mut self,
        user_message: String,
        image_blocks: Option<Vec<Value>>,
    ) -> Vec<Value> {
        let user_content = match image_blocks {
            Some(images) if !images.is_empty() => {
                let mut blocks: Vec<Value> = Vec::new();
                if !user_message.is_empty() {
                    blocks.push(json!({ "type": "text", "text": user_message }));
                }
                blocks.extend(images);
                Value::Array(blocks)
            }
            _ => Value::String(user_message),
        };
        self.messages.push(json!({
            "role": "user",
            "content": user_content,
        }));

        let msg_id = uuid::Uuid::new_v4().to_string();
        self.emit(HarnessOutbound::AssistantMessageStart(
            AssistantMessageStart {
                message_id: msg_id.clone(),
            },
        ));

        let mut cumulative_input: u64 = 0;
        let mut cumulative_output: u64 = 0;
        let mut consecutive_truncations: usize = 0;

        for _turn in 0..self.max_turns {
            let req = MessagesRequest {
                model: self.model.clone(),
                max_tokens: self.max_tokens,
                system: self.system_prompt.clone(),
                tools: self.tool_defs.clone(),
                messages: self.messages.clone(),
                stream: true,
            };

            let resp = match self
                .http
                .post(format!("{}/v1/messages", self.router_url))
                .bearer_auth(&self.ctx.jwt)
                .json(&req)
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => {
                    self.emit(HarnessOutbound::Error(ErrorMsg {
                        code: "llm_request_failed".into(),
                        message: format!("Claude API request failed: {e}"),
                        recoverable: false,
                    }));
                    return self.messages;
                }
            };

            if !resp.status().is_success() {
                let status = resp.status().as_u16();
                let body = resp.text().await.unwrap_or_default();
                self.emit(HarnessOutbound::Error(ErrorMsg {
                    code: format!("llm_http_{status}"),
                    message: format!("Claude API returned {status}: {body}"),
                    recoverable: false,
                }));
                return self.messages;
            }

            let (stop_reason, usage) = match self.process_stream_response(resp).await {
                Ok(outcome) => outcome,
                Err(e) => {
                    self.emit(HarnessOutbound::Error(ErrorMsg {
                        code: "stream_parse_error".into(),
                        message: format!("Failed to parse Claude stream: {e}"),
                        recoverable: false,
                    }));
                    return self.messages;
                }
            };

            cumulative_input += usage.input_tokens;
            cumulative_output += usage.output_tokens;

            match stop_reason.as_deref() {
                Some("tool_use") => {
                    consecutive_truncations = 0;
                }
                Some("max_tokens") => {
                    consecutive_truncations += 1;
                    warn!(
                        consecutive = consecutive_truncations,
                        "Response truncated by max_tokens, continuing tool loop"
                    );
                    let has_tool_results = self
                        .messages
                        .last()
                        .and_then(|m| m.get("content"))
                        .and_then(|c| c.as_array())
                        .map(|arr| {
                            arr.iter().any(|v| {
                                v.get("type").and_then(|t| t.as_str()) == Some("tool_result")
                            })
                        })
                        .unwrap_or(false);
                    if !has_tool_results {
                        self.messages.push(json!({
                            "role": "user",
                            "content": "Your response was truncated due to length limits. Please continue.",
                        }));
                    }
                    if consecutive_truncations >= MAX_CONSECUTIVE_TRUNCATIONS {
                        self.messages.push(json!({
                            "role": "user",
                            "content": "Your responses are repeatedly being truncated. Break large file writes into smaller chunks or use shorter responses.",
                        }));
                    }
                }
                _ => {
                    self.emit(HarnessOutbound::AssistantMessageEnd(AssistantMessageEnd {
                        message_id: msg_id,
                        stop_reason: stop_reason.unwrap_or_else(|| "end_turn".into()),
                        usage: SessionUsage {
                            input_tokens: usage.input_tokens,
                            output_tokens: usage.output_tokens,
                            cache_creation_input_tokens: 0,
                            cache_read_input_tokens: 0,
                            cumulative_input_tokens: cumulative_input,
                            cumulative_output_tokens: cumulative_output,
                            cumulative_cache_creation_input_tokens: 0,
                            cumulative_cache_read_input_tokens: 0,
                            estimated_context_tokens: 0,
                            context_utilization: 0.0,
                            model: self.model.clone(),
                            provider: "anthropic".into(),
                        },
                        files_changed: FilesChanged::default(),
                    }));
                    return self.messages;
                }
            }
        }

        warn!("Super Agent hit max tool turns ({})", self.max_turns);
        self.emit(HarnessOutbound::AssistantMessageEnd(AssistantMessageEnd {
            message_id: msg_id,
            stop_reason: "max_turns".into(),
            usage: SessionUsage {
                input_tokens: 0,
                output_tokens: 0,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
                cumulative_input_tokens: cumulative_input,
                cumulative_output_tokens: cumulative_output,
                cumulative_cache_creation_input_tokens: 0,
                cumulative_cache_read_input_tokens: 0,
                estimated_context_tokens: 0,
                context_utilization: 0.0,
                model: self.model.clone(),
                provider: "anthropic".into(),
            },
            files_changed: FilesChanged::default(),
        }));
        self.messages
    }

    /// Parse a streaming response, emit events, execute tools if needed,
    /// and return (stop_reason, usage). Appends the assistant turn + tool
    /// results to `self.messages` when tools are used.
    async fn process_stream_response(
        &mut self,
        resp: reqwest::Response,
    ) -> Result<(Option<String>, UsagePayload), String> {
        use futures_util::StreamExt;

        let mut byte_stream = resp.bytes_stream();
        let mut buffer = String::new();
        let mut stop_reason: Option<String> = None;
        let mut usage = UsagePayload::default();

        let mut text_buf = String::new();
        let mut tool_accumulators: Vec<ToolUseAccumulator> = Vec::new();
        let mut completed_tool_count: usize = 0;
        let mut current_block_type: Option<String> = None;
        let mut assistant_content_blocks: Vec<Value> = Vec::new();

        while let Some(chunk_result) = byte_stream.next().await {
            let chunk = chunk_result.map_err(|e| e.to_string())?;
            buffer.push_str(&String::from_utf8_lossy(&chunk));

            while let Some(pos) = buffer.find("\n\n") {
                let frame = buffer[..pos].to_string();
                buffer = buffer[pos + 2..].to_string();

                let data_line = frame
                    .lines()
                    .find(|l| l.starts_with("data: "))
                    .map(|l| &l[6..]);

                let data = match data_line {
                    Some(d) if d.trim() != "[DONE]" => d,
                    _ => continue,
                };

                let evt: StreamEvent = match serde_json::from_str(data) {
                    Ok(e) => e,
                    Err(_) => continue,
                };

                match evt.event_type.as_str() {
                    "message_start" => {
                        if let Some(ref msg) = evt.message {
                            if let Some(ref u) = msg.usage {
                                usage.input_tokens = u.input_tokens;
                            }
                        }
                    }
                    "content_block_start" => {
                        if let Some(ref block) = evt.content_block {
                            current_block_type = Some(block.block_type.clone());
                            match block.block_type.as_str() {
                                "tool_use" => {
                                    let id = block.id.clone().unwrap_or_default();
                                    let name = block.name.clone().unwrap_or_default();
                                    self.emit(HarnessOutbound::ToolUseStart(ToolUseStart {
                                        id: id.clone(),
                                        name: name.clone(),
                                    }));
                                    tool_accumulators.push(ToolUseAccumulator {
                                        id,
                                        name,
                                        input_json: String::new(),
                                    });
                                }
                                "thinking" => {}
                                _ => {}
                            }
                        }
                    }
                    "content_block_delta" => {
                        if let Some(ref delta) = evt.delta {
                            match delta.delta_type.as_deref() {
                                Some("text_delta") => {
                                    if let Some(ref text) = delta.text {
                                        text_buf.push_str(text);
                                        self.emit(HarnessOutbound::TextDelta(TextDelta {
                                            text: text.clone(),
                                        }));
                                    }
                                }
                                Some("thinking_delta") => {
                                    if let Some(ref thinking) = delta.thinking {
                                        self.emit(HarnessOutbound::ThinkingDelta(ThinkingDelta {
                                            thinking: thinking.clone(),
                                        }));
                                    }
                                }
                                Some("input_json_delta") => {
                                    if let Some(ref pj) = delta.partial_json {
                                        if let Some(acc) = tool_accumulators.last_mut() {
                                            acc.input_json.push_str(pj);
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                    "content_block_stop" => {
                        match current_block_type.as_deref() {
                            Some("text") => {
                                if !text_buf.is_empty() {
                                    assistant_content_blocks.push(json!({
                                        "type": "text",
                                        "text": &text_buf,
                                    }));
                                }
                            }
                            Some("tool_use") => {
                                if let Some(acc) = tool_accumulators.last() {
                                    let input: Value =
                                        serde_json::from_str(&acc.input_json).unwrap_or(json!({}));
                                    assistant_content_blocks.push(json!({
                                        "type": "tool_use",
                                        "id": acc.id,
                                        "name": acc.name,
                                        "input": input,
                                    }));
                                }
                                completed_tool_count += 1;
                            }
                            Some("thinking") => {
                                assistant_content_blocks.push(json!({
                                    "type": "thinking",
                                    "thinking": "",
                                }));
                            }
                            _ => {}
                        }
                        current_block_type = None;
                    }
                    "message_delta" => {
                        if let Some(ref delta) = evt.delta {
                            if let Some(ref sr) = delta.stop_reason {
                                stop_reason = Some(sr.clone());
                            }
                        }
                        if let Some(ref u) = evt.usage {
                            usage.output_tokens = u.output_tokens;
                        }
                    }
                    "message_stop" => {}
                    _ => {}
                }
            }
        }

        // Recover partial tool_use blocks truncated by max_tokens.
        let has_partial_tools = tool_accumulators.len() > completed_tool_count;
        if has_partial_tools && current_block_type.as_deref() == Some("tool_use") {
            if let Some(acc) = tool_accumulators.last() {
                warn!(
                    tool_name = %acc.name,
                    tool_id = %acc.id,
                    json_len = acc.input_json.len(),
                    "Stream ended with in-progress tool_use block — recovering partial tool call"
                );
                let input: Value = serde_json::from_str(&acc.input_json).unwrap_or(json!({}));
                assistant_content_blocks.push(json!({
                    "type": "tool_use",
                    "id": acc.id,
                    "name": acc.name,
                    "input": input,
                }));
            }
        }

        // Append the assistant message to conversation
        self.messages.push(json!({
            "role": "assistant",
            "content": assistant_content_blocks,
        }));

        // Execute tools for tool_use, or inject errors for max_tokens with pending tools.
        let should_process_tools = stop_reason.as_deref() == Some("tool_use")
            || (stop_reason.as_deref() == Some("max_tokens") && !tool_accumulators.is_empty());

        if should_process_tools {
            if has_partial_tools {
                warn!(
                    pending = tool_accumulators.len() - completed_tool_count,
                    "MaxTokens with pending tool_use blocks — injecting error results"
                );
            }

            let mut tool_results: Vec<Value> = Vec::new();

            for (idx, acc) in tool_accumulators.iter().enumerate() {
                let is_partial = idx >= completed_tool_count;

                if is_partial {
                    let error_msg = "Error: Your response was truncated due to length limits. \
                        This tool call was incomplete and not executed. \
                        Please retry with a shorter response or break the task into smaller steps.";

                    self.emit(HarnessOutbound::ToolResult(ToolResultMsg {
                        name: acc.name.clone(),
                        result: error_msg.to_string(),
                        is_error: true,
                        tool_use_id: Some(acc.id.clone()),
                    }));

                    tool_results.push(json!({
                        "type": "tool_result",
                        "tool_use_id": acc.id,
                        "content": error_msg,
                        "is_error": true,
                    }));
                    continue;
                }

                let input: Value = serde_json::from_str(&acc.input_json).unwrap_or(json!({}));

                info!(tool = %acc.name, id = %acc.id, "Executing super agent tool");

                let result = if let Some(tool) = self.registry.get(&acc.name) {
                    match tool.execute(input, &self.ctx).await {
                        Ok(r) => r,
                        Err(e) => crate::tools::ToolResult {
                            content: json!({ "error": e.to_string() }),
                            is_error: true,
                        },
                    }
                } else {
                    crate::tools::ToolResult {
                        content: json!({ "error": format!("Unknown tool: {}", acc.name) }),
                        is_error: true,
                    }
                };

                let result_str =
                    serde_json::to_string(&result.content).unwrap_or_else(|_| "{}".to_string());

                self.emit(HarnessOutbound::ToolResult(ToolResultMsg {
                    name: acc.name.clone(),
                    result: result_str.clone(),
                    is_error: result.is_error,
                    tool_use_id: Some(acc.id.clone()),
                }));

                tool_results.push(json!({
                    "type": "tool_result",
                    "tool_use_id": acc.id,
                    "content": result_str,
                    "is_error": result.is_error,
                }));
            }

            self.messages.push(json!({
                "role": "user",
                "content": tool_results,
            }));
        }

        Ok((stop_reason, usage))
    }
}
