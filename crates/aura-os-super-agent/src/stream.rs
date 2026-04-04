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

const MAX_TOOL_TURNS: usize = 25;
const DEFAULT_MODEL: &str = "claude-sonnet-4-5-20250514";

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
        }
    }

    fn emit(&self, evt: HarnessOutbound) {
        let _ = self.tx.send(evt);
    }

    /// Run the full multi-turn tool loop for a single user message.
    ///
    /// Returns the accumulated conversation messages (full Claude API format
    /// with tool_use / tool_result blocks) so the caller can cache them for
    /// subsequent turns.
    pub async fn run(mut self, user_message: String) -> Vec<Value> {
        self.messages.push(json!({
            "role": "user",
            "content": user_message,
        }));

        let msg_id = uuid::Uuid::new_v4().to_string();
        self.emit(HarnessOutbound::AssistantMessageStart(
            AssistantMessageStart {
                message_id: msg_id.clone(),
            },
        ));

        let mut cumulative_input: u64 = 0;
        let mut cumulative_output: u64 = 0;

        for _turn in 0..MAX_TOOL_TURNS {
            let req = MessagesRequest {
                model: self.model.clone(),
                max_tokens: 8192,
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

            if stop_reason.as_deref() != Some("tool_use") {
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

            // stop_reason == tool_use: continue the loop
        }

        warn!("Super Agent hit max tool turns ({MAX_TOOL_TURNS})");
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

        // Append the assistant message to conversation
        self.messages.push(json!({
            "role": "assistant",
            "content": assistant_content_blocks,
        }));

        // If stop_reason is tool_use, execute tools and append results
        if stop_reason.as_deref() == Some("tool_use") {
            let mut tool_results: Vec<Value> = Vec::new();

            for acc in &tool_accumulators {
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
