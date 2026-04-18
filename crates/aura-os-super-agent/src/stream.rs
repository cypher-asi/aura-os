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
        #[serde(default)]
        pub cache_creation_input_tokens: u64,
        #[serde(default)]
        pub cache_read_input_tokens: u64,
    }
}

use std::sync::Arc;
use std::time::Instant;

use reqwest::Client;
use serde::Serialize;
use serde_json::{json, Map, Value};
use tokio::sync::broadcast;
use tokio_util::sync::CancellationToken;
use tracing::{debug, info, warn};

use aura_os_link::{
    AssistantMessageEnd, AssistantMessageStart, ErrorMsg, FilesChanged, HarnessOutbound,
    SessionUsage, TextDelta, ThinkingDelta, ToolCallSnapshot, ToolResultMsg, ToolUseStart,
};

use crate::partial_json::extract_partial_string_field;
use crate::tools::{SuperAgentContext, ToolRegistry};
use types::*;

/// Minimum gap between `tool_call_snapshot` emissions for a single in-flight
/// tool use. Prevents flooding the SSE channel while still keeping the UI
/// visibly responsive as `markdown_contents` streams in.
const SNAPSHOT_THROTTLE_MS: u128 = 50;

/// Whether the harness should emit throttled `tool_call_snapshot` events for
/// a given tool name. Delegates to [`crate::tools::is_streaming_tool_name`]
/// so the streaming set and the `eager_input_streaming` tool-definition flag
/// stay in sync with each other.
fn is_streaming_tool(name: &str) -> bool {
    crate::tools::is_streaming_tool_name(name)
}

fn build_partial_spec_input(input_json: &str) -> Option<Value> {
    let title = extract_partial_string_field(input_json, "title");
    let markdown = extract_partial_string_field(input_json, "markdown_contents");
    if title.is_none() && markdown.is_none() {
        return None;
    }
    let mut obj = Map::new();
    if let Some(t) = title {
        obj.insert("title".into(), Value::String(t));
    }
    if let Some(m) = markdown {
        obj.insert("markdown_contents".into(), Value::String(m));
    }
    Some(Value::Object(obj))
}

/// Extract partial input fields for file-modification tools while the LLM is
/// still streaming the tool-use JSON. The UI uses these to render
/// `FilePreviewCard` live instead of a spinner.
///
/// - `write_file` → `path`, `content`
/// - `edit_file`  → `path`, `old_text`, `new_text`
///
/// Returns `None` when none of the relevant keys have appeared yet.
fn build_partial_file_input(tool_name: &str, input_json: &str) -> Option<Value> {
    let path = extract_partial_string_field(input_json, "path");

    let mut obj = Map::new();
    let mut any = false;
    if let Some(p) = path {
        obj.insert("path".into(), Value::String(p));
        any = true;
    }

    match tool_name {
        "write_file" => {
            if let Some(c) = extract_partial_string_field(input_json, "content") {
                obj.insert("content".into(), Value::String(c));
                any = true;
            }
        }
        "edit_file" => {
            if let Some(o) = extract_partial_string_field(input_json, "old_text") {
                obj.insert("old_text".into(), Value::String(o));
                any = true;
            }
            if let Some(n) = extract_partial_string_field(input_json, "new_text") {
                obj.insert("new_text".into(), Value::String(n));
                any = true;
            }
        }
        _ => {}
    }

    if any { Some(Value::Object(obj)) } else { None }
}

/// Dispatch to the right partial-input builder based on the in-flight tool
/// name. Returns `None` for unknown tools or when nothing can be extracted
/// yet.
fn build_partial_tool_input(tool_name: &str, input_json: &str) -> Option<Value> {
    match tool_name {
        "create_spec" | "update_spec" => build_partial_spec_input(input_json),
        "write_file" | "edit_file" => build_partial_file_input(tool_name, input_json),
        _ => None,
    }
}

const DEFAULT_MAX_TOOL_TURNS: usize = 25;
const DEFAULT_MAX_TOKENS: u32 = 16_384;
const DEFAULT_MODEL: &str = "claude-sonnet-4-5-20250514";
const MAX_CONSECUTIVE_TRUNCATIONS: usize = 3;

/// Effective prompt-window size used to derive `context_utilization` for
/// the SuperAgent. Claude Sonnet / Opus models expose a 200k-token input
/// window; the UI divides the estimated prompt tokens for the most recent
/// turn by this to render the "N%" context indicator.
const MODEL_CONTEXT_WINDOW: u64 = 200_000;

/// Total prompt-side tokens consumed by a turn = fresh input + cache
/// writes + cache hits. Anthropic reports these three separately in
/// `message_start.usage`.
fn estimated_context_tokens(usage: &types::UsagePayload) -> u64 {
    usage
        .input_tokens
        .saturating_add(usage.cache_creation_input_tokens)
        .saturating_add(usage.cache_read_input_tokens)
}

fn context_utilization_for(usage: &types::UsagePayload) -> f32 {
    let est = estimated_context_tokens(usage) as f32;
    let window = MODEL_CONTEXT_WINDOW as f32;
    (est / window).clamp(0.0, 1.0)
}

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
    last_snapshot_emit: Option<Instant>,
}

// ---------------------------------------------------------------------------
// SuperAgentStream
// ---------------------------------------------------------------------------

/// Outcome of [`SuperAgentStream::run`]. `Completed` holds the accumulated
/// conversation messages for the caller to cache. `Cancelled` signals that a
/// reset / superseding run fired mid-flight — the caller MUST discard these
/// messages so they never rejoin the cache.
pub enum SuperAgentRunOutcome {
    Completed(Vec<Value>),
    Cancelled,
}

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
    cancel: CancellationToken,
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
            cancel: CancellationToken::new(),
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

    /// Attach a cancellation token. When signalled, the in-flight `/v1/messages`
    /// stream is dropped mid-chunk (closing the proxy connection) and the
    /// multi-turn loop exits with [`SuperAgentRunOutcome::Cancelled`].
    pub fn with_cancel(mut self, token: CancellationToken) -> Self {
        self.cancel = token;
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
    ) -> SuperAgentRunOutcome {
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
        let mut cumulative_cache_creation: u64 = 0;
        let mut cumulative_cache_read: u64 = 0;
        let mut last_turn_usage = UsagePayload::default();
        let mut consecutive_truncations: usize = 0;

        for _turn in 0..self.max_turns {
            if self.cancel.is_cancelled() {
                info!("super agent: run cancelled before turn start");
                return SuperAgentRunOutcome::Cancelled;
            }

            let req = MessagesRequest {
                model: self.model.clone(),
                max_tokens: self.max_tokens,
                system: self.system_prompt.clone(),
                tools: self.tool_defs.clone(),
                messages: self.messages.clone(),
                stream: true,
            };

            // One-time log of which tools were sent with eager_input_streaming
            // enabled — helps diagnose whether the router/proxy strips the flag
            // before the request reaches Anthropic.
            let eager_tools: Vec<&str> = self
                .tool_defs
                .iter()
                .filter(|t| {
                    t.get("eager_input_streaming")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false)
                })
                .filter_map(|t| t.get("name").and_then(|v| v.as_str()))
                .collect();
            info!(
                model = %self.model,
                eager_input_streaming_tools = ?eager_tools,
                total_tools = self.tool_defs.len(),
                "sending /v1/messages request"
            );

            let send_future = self
                .http
                .post(format!("{}/v1/messages", self.router_url))
                .bearer_auth(&self.ctx.jwt)
                // Opt into Anthropic's fine-grained tool streaming so
                // `input_json_delta` chunks arrive as raw partial strings
                // (enabling live `markdown_contents` / file-content previews
                // in the UI) instead of being buffered until the full tool
                // block completes. Pairs with `eager_input_streaming: true`
                // on the spec/file tool definitions.
                .header("anthropic-beta", "fine-grained-tool-streaming-2025-05-14")
                .json(&req)
                .send();

            let resp = tokio::select! {
                biased;
                _ = self.cancel.cancelled() => {
                    info!("super agent: run cancelled while sending /v1/messages");
                    return SuperAgentRunOutcome::Cancelled;
                }
                res = send_future => match res {
                    Ok(r) => r,
                    Err(e) => {
                        self.emit(HarnessOutbound::Error(ErrorMsg {
                            code: "llm_request_failed".into(),
                            message: format!("Claude API request failed: {e}"),
                            recoverable: false,
                        }));
                        return SuperAgentRunOutcome::Completed(self.messages);
                    }
                },
            };

            if !resp.status().is_success() {
                let status = resp.status().as_u16();
                let body = resp.text().await.unwrap_or_default();
                self.emit(HarnessOutbound::Error(ErrorMsg {
                    code: format!("llm_http_{status}"),
                    message: format!("Claude API returned {status}: {body}"),
                    recoverable: false,
                }));
                return SuperAgentRunOutcome::Completed(self.messages);
            }

            let (stop_reason, usage) = match self.process_stream_response(resp).await {
                Ok(Some(outcome)) => outcome,
                Ok(None) => {
                    info!("super agent: run cancelled during stream");
                    return SuperAgentRunOutcome::Cancelled;
                }
                Err(e) => {
                    self.emit(HarnessOutbound::Error(ErrorMsg {
                        code: "stream_parse_error".into(),
                        message: format!("Failed to parse Claude stream: {e}"),
                        recoverable: false,
                    }));
                    return SuperAgentRunOutcome::Completed(self.messages);
                }
            };

            cumulative_input += usage.input_tokens;
            cumulative_output += usage.output_tokens;
            cumulative_cache_creation += usage.cache_creation_input_tokens;
            cumulative_cache_read += usage.cache_read_input_tokens;
            last_turn_usage = usage.clone();

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
                    let est_ctx = estimated_context_tokens(&last_turn_usage);
                    let ctx_util = context_utilization_for(&last_turn_usage);
                    self.emit(HarnessOutbound::AssistantMessageEnd(AssistantMessageEnd {
                        message_id: msg_id,
                        stop_reason: stop_reason.unwrap_or_else(|| "end_turn".into()),
                        usage: SessionUsage {
                            input_tokens: usage.input_tokens,
                            output_tokens: usage.output_tokens,
                            cache_creation_input_tokens: usage.cache_creation_input_tokens,
                            cache_read_input_tokens: usage.cache_read_input_tokens,
                            cumulative_input_tokens: cumulative_input,
                            cumulative_output_tokens: cumulative_output,
                            cumulative_cache_creation_input_tokens: cumulative_cache_creation,
                            cumulative_cache_read_input_tokens: cumulative_cache_read,
                            estimated_context_tokens: est_ctx,
                            context_utilization: ctx_util,
                            model: self.model.clone(),
                            provider: "anthropic".into(),
                        },
                        files_changed: FilesChanged::default(),
                        originating_user_id: None,
                    }));
                    return SuperAgentRunOutcome::Completed(self.messages);
                }
            }
        }

        warn!("Super Agent hit max tool turns ({})", self.max_turns);
        let est_ctx = estimated_context_tokens(&last_turn_usage);
        let ctx_util = context_utilization_for(&last_turn_usage);
        self.emit(HarnessOutbound::AssistantMessageEnd(AssistantMessageEnd {
            message_id: msg_id,
            stop_reason: "max_turns".into(),
            originating_user_id: None,
            usage: SessionUsage {
                input_tokens: last_turn_usage.input_tokens,
                output_tokens: last_turn_usage.output_tokens,
                cache_creation_input_tokens: last_turn_usage.cache_creation_input_tokens,
                cache_read_input_tokens: last_turn_usage.cache_read_input_tokens,
                cumulative_input_tokens: cumulative_input,
                cumulative_output_tokens: cumulative_output,
                cumulative_cache_creation_input_tokens: cumulative_cache_creation,
                cumulative_cache_read_input_tokens: cumulative_cache_read,
                estimated_context_tokens: est_ctx,
                context_utilization: ctx_util,
                model: self.model.clone(),
                provider: "anthropic".into(),
            },
            files_changed: FilesChanged::default(),
        }));
        SuperAgentRunOutcome::Completed(self.messages)
    }

    /// Parse a streaming response, emit events, execute tools if needed,
    /// and return (stop_reason, usage). Appends the assistant turn + tool
    /// results to `self.messages` when tools are used.
    async fn process_stream_response(
        &mut self,
        resp: reqwest::Response,
    ) -> Result<Option<(Option<String>, UsagePayload)>, String> {
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

        loop {
            let next = tokio::select! {
                biased;
                _ = self.cancel.cancelled() => {
                    // Dropping `byte_stream` + `resp` closes the proxy/router
                    // HTTP/2 stream so no further bytes are pulled from
                    // Anthropic. The caller observes `Ok(None)` and bails.
                    drop(byte_stream);
                    return Ok(None);
                }
                chunk = byte_stream.next() => chunk,
            };
            let Some(chunk_result) = next else { break };
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
                                // Anthropic reports prompt-side tokens in
                                // `message_start` (input + cache hits/
                                // creation). The running assistant-side
                                // `output_tokens` arrives later in
                                // `message_delta`.
                                usage.input_tokens = u.input_tokens;
                                usage.cache_creation_input_tokens =
                                    u.cache_creation_input_tokens;
                                usage.cache_read_input_tokens = u.cache_read_input_tokens;
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
                                    info!(
                                        tool = %name,
                                        tool_id = %id,
                                        streaming = is_streaming_tool(&name),
                                        "tool_use block started"
                                    );
                                    self.emit(HarnessOutbound::ToolUseStart(ToolUseStart {
                                        id: id.clone(),
                                        name: name.clone(),
                                    }));
                                    tool_accumulators.push(ToolUseAccumulator {
                                        id,
                                        name,
                                        input_json: String::new(),
                                        last_snapshot_emit: None,
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
                                            debug!(
                                                tool = %acc.name,
                                                delta_len = pj.len(),
                                                total_len = acc.input_json.len(),
                                                "input_json_delta received"
                                            );
                                            if is_streaming_tool(&acc.name) {
                                                let now = Instant::now();
                                                let should_emit = match acc.last_snapshot_emit {
                                                    None => true,
                                                    Some(t) => {
                                                        now.duration_since(t).as_millis()
                                                            >= SNAPSHOT_THROTTLE_MS
                                                    }
                                                };
                                                if should_emit {
                                                    if let Some(input) = build_partial_tool_input(
                                                        &acc.name,
                                                        &acc.input_json,
                                                    )
                                                    {
                                                        let md_len = input
                                                            .get("markdown_contents")
                                                            .and_then(|v| v.as_str())
                                                            .map(|s| s.len())
                                                            .unwrap_or(0);
                                                        let content_len = input
                                                            .get("content")
                                                            .and_then(|v| v.as_str())
                                                            .map(|s| s.len())
                                                            .unwrap_or(0);
                                                        debug!(
                                                            tool = %acc.name,
                                                            markdown_len = md_len,
                                                            content_len,
                                                            "emitting ToolCallSnapshot"
                                                        );
                                                        self.emit(
                                                            HarnessOutbound::ToolCallSnapshot(
                                                                ToolCallSnapshot {
                                                                    id: acc.id.clone(),
                                                                    name: acc.name.clone(),
                                                                    input,
                                                                },
                                                            ),
                                                        );
                                                        acc.last_snapshot_emit = Some(now);
                                                    }
                                                }
                                            }
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
                                    info!(
                                        tool = %acc.name,
                                        tool_id = %acc.id,
                                        input_bytes = acc.input_json.len(),
                                        snapshots_mid_stream = acc.last_snapshot_emit.is_some(),
                                        "tool_use block completed"
                                    );
                                    let input: Value =
                                        serde_json::from_str(&acc.input_json).unwrap_or(json!({}));
                                    if is_streaming_tool(&acc.name) {
                                        self.emit(HarnessOutbound::ToolCallSnapshot(
                                            ToolCallSnapshot {
                                                id: acc.id.clone(),
                                                name: acc.name.clone(),
                                                input: input.clone(),
                                            },
                                        ));
                                    }
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

        Ok(Some((stop_reason, usage)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_streaming_tool_recognises_spec_and_file_tools() {
        assert!(is_streaming_tool("create_spec"));
        assert!(is_streaming_tool("update_spec"));
        assert!(is_streaming_tool("write_file"));
        assert!(is_streaming_tool("edit_file"));
        assert!(!is_streaming_tool("run_command"));
        assert!(!is_streaming_tool("create_task"));
        assert!(!is_streaming_tool("read_file"));
    }

    #[test]
    fn build_partial_spec_input_returns_none_when_key_absent() {
        assert!(build_partial_spec_input("{\"other\":\"x\"").is_none());
    }

    #[test]
    fn build_partial_spec_input_extracts_title_only() {
        let v = build_partial_spec_input("{\"title\":\"Hello\"").unwrap();
        assert_eq!(v["title"], Value::String("Hello".into()));
        assert!(v.get("markdown_contents").is_none());
    }

    #[test]
    fn build_partial_spec_input_extracts_partial_markdown() {
        let v = build_partial_spec_input(
            "{\"title\":\"T\",\"markdown_contents\":\"# H\\n\\nsome",
        )
        .unwrap();
        assert_eq!(v["title"], Value::String("T".into()));
        assert_eq!(
            v["markdown_contents"],
            Value::String("# H\n\nsome".into())
        );
    }

    #[test]
    fn build_partial_file_input_returns_none_when_no_known_keys() {
        assert!(build_partial_file_input("write_file", "{\"other\":\"x\"").is_none());
        assert!(build_partial_file_input("edit_file", "{").is_none());
    }

    #[test]
    fn build_partial_file_input_extracts_write_file_path_only() {
        let v = build_partial_file_input("write_file", "{\"path\":\"src/a.ts\"").unwrap();
        assert_eq!(v["path"], Value::String("src/a.ts".into()));
        assert!(v.get("content").is_none());
    }

    #[test]
    fn build_partial_file_input_extracts_partial_write_content() {
        let v = build_partial_file_input(
            "write_file",
            "{\"path\":\"src/a.ts\",\"content\":\"export const x = 1;\\nexport const y",
        )
        .unwrap();
        assert_eq!(v["path"], Value::String("src/a.ts".into()));
        assert_eq!(
            v["content"],
            Value::String("export const x = 1;\nexport const y".into())
        );
    }

    #[test]
    fn build_partial_file_input_extracts_partial_edit_fields() {
        let v = build_partial_file_input(
            "edit_file",
            "{\"path\":\"a.ts\",\"old_text\":\"foo\",\"new_text\":\"ba",
        )
        .unwrap();
        assert_eq!(v["path"], Value::String("a.ts".into()));
        assert_eq!(v["old_text"], Value::String("foo".into()));
        assert_eq!(v["new_text"], Value::String("ba".into()));
    }

    #[test]
    fn build_partial_file_input_ignores_edit_fields_for_write_file() {
        let v = build_partial_file_input(
            "write_file",
            "{\"path\":\"a.ts\",\"old_text\":\"foo\",\"new_text\":\"bar\",\"content\":\"hi",
        )
        .unwrap();
        assert_eq!(v["content"], Value::String("hi".into()));
        assert!(v.get("old_text").is_none());
        assert!(v.get("new_text").is_none());
    }

    #[test]
    fn context_utilization_counts_fresh_input_plus_cache_tokens() {
        let mut u = types::UsagePayload::default();
        u.input_tokens = 10_000;
        u.cache_creation_input_tokens = 30_000;
        u.cache_read_input_tokens = 60_000;
        // 100k / 200k window = 0.5
        let util = context_utilization_for(&u);
        assert!((util - 0.5).abs() < 1e-6, "got {util}");
        assert_eq!(estimated_context_tokens(&u), 100_000);
    }

    #[test]
    fn context_utilization_clamps_to_one() {
        let mut u = types::UsagePayload::default();
        u.input_tokens = 250_000;
        let util = context_utilization_for(&u);
        assert_eq!(util, 1.0);
    }

    #[test]
    fn context_utilization_zero_for_empty_usage() {
        let u = types::UsagePayload::default();
        assert_eq!(context_utilization_for(&u), 0.0);
        assert_eq!(estimated_context_tokens(&u), 0);
    }

    #[test]
    fn build_partial_tool_input_dispatches_by_name() {
        let spec = build_partial_tool_input("create_spec", "{\"title\":\"S\"").unwrap();
        assert_eq!(spec["title"], Value::String("S".into()));

        let file = build_partial_tool_input("write_file", "{\"path\":\"p\"").unwrap();
        assert_eq!(file["path"], Value::String("p".into()));

        assert!(build_partial_tool_input("run_command", "{\"cmd\":\"x\"").is_none());
    }

    /// A pre-cancelled token must short-circuit `run` before it ever contacts
    /// the proxy. This is the structural guarantee that makes reset
    /// deterministic: if the handler cancels the token before / at the start
    /// of a run, no messages flow into the router and the outcome is
    /// `Cancelled` so the caller discards any partial state.
    #[tokio::test]
    async fn run_exits_immediately_when_pre_cancelled() {
        use aura_os_agents::{AgentInstanceService, AgentService, RuntimeAgentStateMap};
        use aura_os_billing::BillingClient;
        use aura_os_link::AutomatonClient;
        use aura_os_orgs::OrgService;
        use aura_os_projects::ProjectService;
        use aura_os_sessions::SessionService;
        use aura_os_store::RocksStore;
        use aura_os_tasks::TaskService;
        use tokio::sync::broadcast;

        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(RocksStore::open(dir.path()).unwrap());
        let runtime_state: RuntimeAgentStateMap =
            Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));
        let (evt_tx, _) = broadcast::channel(16);
        let ctx = Arc::new(SuperAgentContext {
            user_id: "u".into(),
            org_id: "o".into(),
            jwt: "j".into(),
            project_service: Arc::new(ProjectService::new(store.clone())),
            agent_service: Arc::new(AgentService::new(store.clone(), None)),
            agent_instance_service: Arc::new(AgentInstanceService::new(
                store.clone(),
                None,
                runtime_state,
                None,
            )),
            task_service: Arc::new(TaskService::new(store.clone(), None)),
            session_service: Arc::new(SessionService::new(store.clone(), 0.8, 200_000)),
            org_service: Arc::new(OrgService::new(store.clone())),
            billing_client: Arc::new(BillingClient::new()),
            automaton_client: Arc::new(AutomatonClient::new("http://localhost:0".into())),
            orbit_client: None,
            network_client: None,
            storage_client: None,
            store: store.clone(),
            event_broadcast: evt_tx,
            local_server_base_url: None,
            local_http_client: reqwest::Client::new(),
        });

        // Router URL points at an unroutable port; if the test ever actually
        // tries to send a request the test would hang for the TCP timeout.
        // Instead we expect the cancelled token to bail out first.
        let router_url = "http://127.0.0.1:1".to_string();
        let (tx, _rx) = broadcast::channel(8);

        let cancel = CancellationToken::new();
        cancel.cancel();

        let stream = SuperAgentStream::new(
            router_url,
            reqwest::Client::new(),
            "system".into(),
            vec![],
            vec![],
            ctx,
            Arc::new(ToolRegistry::with_all_tools()),
            tx,
            None,
        )
        .with_cancel(cancel);

        let start = std::time::Instant::now();
        let outcome = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            stream.run("hello".into(), None),
        )
        .await
        .expect("run should bail out quickly on pre-cancelled token");

        assert!(matches!(outcome, SuperAgentRunOutcome::Cancelled));
        assert!(
            start.elapsed() < std::time::Duration::from_millis(500),
            "cancelled run should return quickly"
        );
    }
}
