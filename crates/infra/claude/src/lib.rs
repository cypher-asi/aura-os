mod error;
pub mod mock;

pub use error::ClaudeClientError;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tracing::{debug, error, info};

const ANTHROPIC_API_VERSION: &str = "2023-06-01";
pub const DEFAULT_MODEL: &str = "claude-opus-4-6";

/// Deprecated: use `aura_billing::PricingService::compute_cost` or the pure
/// functions in `aura_billing` instead. Kept temporarily for backward compat.
pub fn compute_cost(input_tokens: u64, output_tokens: u64) -> f64 {
    input_tokens as f64 * 5.0 / 1_000_000.0 + output_tokens as f64 * 25.0 / 1_000_000.0
}

/// Approximate token count for a text string.
/// Uses a simple heuristic: ~4 characters per token on average for English text
/// and code. This is intentionally conservative (overestimates slightly).
pub fn estimate_tokens(text: &str) -> u64 {
    (text.len() as u64 + 3) / 4
}

/// Estimate token count for a RichMessage (handles both text and block content).
pub fn estimate_message_tokens(msg: &RichMessage) -> u64 {
    match &msg.content {
        MessageContent::Text(t) => estimate_tokens(t) + 4,
        MessageContent::Blocks(blocks) => {
            let mut total: u64 = 4;
            for block in blocks {
                total += match block {
                    ContentBlock::Text { text } => estimate_tokens(text),
                    ContentBlock::Image { source } => {
                        // Approximate: base64 is ~4 chars per 3 bytes; images ~1000 tokens each
                        1000 + (source.data.len() as u64 / 4)
                    }
                    ContentBlock::ToolUse { name, input, .. } => {
                        estimate_tokens(name)
                            + estimate_tokens(&input.to_string())
                            + 10
                    }
                    ContentBlock::ToolResult { content, .. } => {
                        estimate_tokens(content) + 10
                    }
                };
            }
            total
        }
    }
}

// ---------------------------------------------------------------------------
// Public types for tool use
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub input: serde_json::Value,
}

#[derive(Debug, Clone)]
pub struct ToolStreamResponse {
    pub text: String,
    pub tool_calls: Vec<ToolCall>,
    pub stop_reason: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
}

// ---------------------------------------------------------------------------
// Rich message types for the Anthropic API (supports both string and block content)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageSource {
    #[serde(rename = "type")]
    pub source_type: String,
    pub media_type: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentBlock {
    Text {
        text: String,
    },
    Image {
        source: ImageSource,
    },
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    ToolResult {
        tool_use_id: String,
        content: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        is_error: Option<bool>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MessageContent {
    Text(String),
    Blocks(Vec<ContentBlock>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RichMessage {
    pub role: String,
    pub content: MessageContent,
}

impl RichMessage {
    pub fn user(text: &str) -> Self {
        Self {
            role: "user".into(),
            content: MessageContent::Text(text.into()),
        }
    }
    pub fn assistant_text(text: &str) -> Self {
        Self {
            role: "assistant".into(),
            content: MessageContent::Text(text.into()),
        }
    }
    pub fn assistant_blocks(blocks: Vec<ContentBlock>) -> Self {
        Self {
            role: "assistant".into(),
            content: MessageContent::Blocks(blocks),
        }
    }
    pub fn tool_results(results: Vec<ContentBlock>) -> Self {
        Self {
            role: "user".into(),
            content: MessageContent::Blocks(results),
        }
    }
}

// ---------------------------------------------------------------------------
// Generic type aliases (provider-agnostic names for callers)
// ---------------------------------------------------------------------------

pub type LlmStreamEvent = ClaudeStreamEvent;
pub type LlmToolResponse = ToolStreamResponse;
pub type LlmError = ClaudeClientError;

#[derive(Debug, Clone)]
pub struct LlmResponse {
    pub text: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
}

// ---------------------------------------------------------------------------
// Provider trait -- the abstraction that all callers depend on
// ---------------------------------------------------------------------------

#[async_trait]
pub trait LlmProvider: Send + Sync {
    /// Non-streaming completion that returns text with token usage.
    async fn complete(
        &self,
        api_key: &str,
        system_prompt: &str,
        user_message: &str,
        max_tokens: u32,
    ) -> Result<LlmResponse, ClaudeClientError>;

    /// Single-turn streaming completion.
    async fn complete_stream(
        &self,
        api_key: &str,
        system_prompt: &str,
        user_message: &str,
        max_tokens: u32,
        event_tx: mpsc::UnboundedSender<LlmStreamEvent>,
    ) -> Result<String, ClaudeClientError>;

    /// Multi-turn streaming completion (no tools).
    async fn complete_stream_multi(
        &self,
        api_key: &str,
        system_prompt: &str,
        messages: Vec<(String, String)>,
        max_tokens: u32,
        event_tx: mpsc::UnboundedSender<LlmStreamEvent>,
    ) -> Result<String, ClaudeClientError>;

    /// Multi-turn streaming with tool definitions and optional thinking.
    async fn complete_stream_with_tools(
        &self,
        api_key: &str,
        system_prompt: &str,
        messages: Vec<RichMessage>,
        tools: Vec<ToolDefinition>,
        max_tokens: u32,
        thinking: Option<ThinkingConfig>,
        event_tx: mpsc::UnboundedSender<LlmStreamEvent>,
    ) -> Result<ToolStreamResponse, ClaudeClientError>;
}

// ---------------------------------------------------------------------------
// Stream events
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub enum ClaudeStreamEvent {
    Delta(String),
    ThinkingDelta(String),
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    Done {
        stop_reason: String,
        input_tokens: u64,
        output_tokens: u64,
    },
    Error(String),
}

// ---------------------------------------------------------------------------
// Internal request/response types
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct SimpleMessage {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct SimpleMessagesRequest {
    model: String,
    max_tokens: u32,
    system: String,
    messages: Vec<SimpleMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stream: Option<bool>,
}

#[derive(Serialize, Clone)]
pub struct ThinkingConfig {
    #[serde(rename = "type")]
    pub thinking_type: String,
    pub budget_tokens: u32,
}

impl ThinkingConfig {
    pub fn enabled(budget_tokens: u32) -> Self {
        Self {
            thinking_type: "enabled".to_string(),
            budget_tokens,
        }
    }
}

#[derive(Serialize)]
struct ToolMessagesRequest {
    model: String,
    max_tokens: u32,
    system: String,
    messages: Vec<RichMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stream: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<ToolDefinition>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    thinking: Option<ThinkingConfig>,
}

#[derive(Deserialize)]
struct MessagesResponse {
    content: Vec<ResponseContentBlock>,
    stop_reason: Option<String>,
    #[serde(default)]
    usage: Option<UsageBlock>,
}

#[derive(Deserialize, Default)]
struct UsageBlock {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
}

#[derive(Deserialize)]
struct ResponseContentBlock {
    text: Option<String>,
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

pub struct ClaudeClient {
    http: reqwest::Client,
    base_url: String,
}

impl ClaudeClient {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::new(),
            base_url: "https://api.anthropic.com".to_string(),
        }
    }

    #[cfg(test)]
    pub fn with_base_url(base_url: &str) -> Self {
        Self {
            http: reqwest::Client::new(),
            base_url: base_url.to_string(),
        }
    }

    pub async fn complete(
        &self,
        api_key: &str,
        system_prompt: &str,
        user_message: &str,
        max_tokens: u32,
    ) -> Result<String, ClaudeClientError> {
        self.complete_with_usage(api_key, system_prompt, user_message, max_tokens)
            .await
            .map(|r| r.text)
    }

    pub async fn complete_with_usage(
        &self,
        api_key: &str,
        system_prompt: &str,
        user_message: &str,
        max_tokens: u32,
    ) -> Result<LlmResponse, ClaudeClientError> {
        let request = SimpleMessagesRequest {
            model: DEFAULT_MODEL.to_string(),
            max_tokens,
            system: system_prompt.to_string(),
            messages: vec![SimpleMessage {
                role: "user".to_string(),
                content: user_message.to_string(),
            }],
            stream: None,
        };

        let url = format!("{}/v1/messages", self.base_url);
        info!(
            model = DEFAULT_MODEL,
            max_tokens,
            user_msg_len = user_message.len(),
            url = %url,
            "Sending Claude API request"
        );
        let start = std::time::Instant::now();

        let response = self
            .http
            .post(&url)
            .header("x-api-key", api_key)
            .header("anthropic-version", ANTHROPIC_API_VERSION)
            .header("content-type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| {
                error!(elapsed_ms = start.elapsed().as_millis() as u64, error = %e, "Claude HTTP request failed");
                e
            })?;

        let status = response.status();
        let elapsed_ms = start.elapsed().as_millis() as u64;
        info!(status = status.as_u16(), elapsed_ms, "Claude API responded");

        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            error!(status = status.as_u16(), body = %body, "Claude API error response");
            return Err(ClaudeClientError::Api {
                status: status.as_u16(),
                message: body,
            });
        }

        let body: MessagesResponse = response
            .json()
            .await
            .map_err(|e| {
                error!(error = %e, "Failed to deserialize Claude response body");
                ClaudeClientError::Parse(e.to_string())
            })?;

        let stop_reason = body.stop_reason.as_deref().unwrap_or("unknown");
        info!(stop_reason, "Claude stop_reason");

        if stop_reason == "max_tokens" {
            error!(max_tokens, "Claude response truncated — hit max_tokens limit");
            return Err(ClaudeClientError::Truncated { max_tokens });
        }

        let usage = body.usage.unwrap_or_default();

        let text = body
            .content
            .into_iter()
            .filter_map(|block| block.text)
            .collect::<Vec<_>>()
            .join("");

        if text.is_empty() {
            error!("Claude returned empty text content");
            return Err(ClaudeClientError::Parse(
                "no text content in response".into(),
            ));
        }

        debug!(response_len = text.len(), input_tokens = usage.input_tokens, output_tokens = usage.output_tokens, "Claude response text extracted");
        Ok(LlmResponse {
            text,
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
        })
    }

    /// Streaming variant of `complete()`. Sends token deltas to `event_tx` as they
    /// arrive from the Anthropic SSE stream, then returns the accumulated full text.
    pub async fn complete_stream(
        &self,
        api_key: &str,
        system_prompt: &str,
        user_message: &str,
        max_tokens: u32,
        event_tx: mpsc::UnboundedSender<ClaudeStreamEvent>,
    ) -> Result<String, ClaudeClientError> {
        let messages = vec![
            ("user".to_string(), user_message.to_string()),
        ];
        self.complete_stream_multi(api_key, system_prompt, messages, max_tokens, event_tx)
            .await
    }

    /// Streaming variant that pre-fills the assistant turn with `prefill` (e.g. `"{"`)
    /// to steer the model toward structured output.
    pub async fn complete_stream_with_prefill(
        &self,
        api_key: &str,
        system_prompt: &str,
        user_message: &str,
        max_tokens: u32,
        prefill: &str,
        event_tx: mpsc::UnboundedSender<ClaudeStreamEvent>,
    ) -> Result<String, ClaudeClientError> {
        let messages = vec![
            ("user".to_string(), user_message.to_string()),
            ("assistant".to_string(), prefill.to_string()),
        ];
        let continuation = self
            .complete_stream_multi(api_key, system_prompt, messages, max_tokens, event_tx)
            .await?;
        Ok(format!("{prefill}{continuation}"))
    }

    /// Multi-turn streaming variant (no tools). Accepts a full conversation history as
    /// `(role, content)` pairs and streams the assistant response via `event_tx`.
    pub async fn complete_stream_multi(
        &self,
        api_key: &str,
        system_prompt: &str,
        messages: Vec<(String, String)>,
        max_tokens: u32,
        event_tx: mpsc::UnboundedSender<ClaudeStreamEvent>,
    ) -> Result<String, ClaudeClientError> {
        let api_messages: Vec<SimpleMessage> = messages
            .into_iter()
            .map(|(role, content)| SimpleMessage { role, content })
            .collect();

        let msg_count = api_messages.len();
        let request = SimpleMessagesRequest {
            model: DEFAULT_MODEL.to_string(),
            max_tokens,
            system: system_prompt.to_string(),
            messages: api_messages,
            stream: Some(true),
        };

        let url = format!("{}/v1/messages", self.base_url);
        info!(
            model = DEFAULT_MODEL,
            max_tokens,
            msg_count,
            url = %url,
            "Sending multi-turn streaming Claude API request"
        );

        let body = serde_json::to_value(&request).map_err(|e| {
            ClaudeClientError::Parse(format!("Failed to serialize request: {e}"))
        })?;
        let response = self.send_request(api_key, &url, &body).await?;
        let result = self.parse_sse_stream(response, &event_tx).await?;

        if result.stop_reason == "max_tokens" {
            error!(max_tokens, "Claude multi-turn streaming response truncated");
            return Err(ClaudeClientError::Truncated { max_tokens });
        }

        if result.text.is_empty() && result.tool_calls.is_empty() {
            error!("Claude multi-turn streaming returned empty content");
            return Err(ClaudeClientError::Parse("no text content in streaming response".into()));
        }

        Ok(result.text)
    }

    /// Multi-turn streaming with tool definitions. Returns a `ToolStreamResponse` that
    /// includes both accumulated text and any tool_use blocks the model requested.
    pub async fn complete_stream_with_tools(
        &self,
        api_key: &str,
        system_prompt: &str,
        messages: Vec<RichMessage>,
        tools: Vec<ToolDefinition>,
        max_tokens: u32,
        event_tx: mpsc::UnboundedSender<ClaudeStreamEvent>,
    ) -> Result<ToolStreamResponse, ClaudeClientError> {
        self.complete_stream_with_tools_inner(
            api_key, system_prompt, messages, tools, max_tokens, None, event_tx,
        ).await
    }

    /// Multi-turn streaming with tool definitions and optional extended thinking.
    pub async fn complete_stream_with_tools_thinking(
        &self,
        api_key: &str,
        system_prompt: &str,
        messages: Vec<RichMessage>,
        tools: Vec<ToolDefinition>,
        max_tokens: u32,
        thinking: ThinkingConfig,
        event_tx: mpsc::UnboundedSender<ClaudeStreamEvent>,
    ) -> Result<ToolStreamResponse, ClaudeClientError> {
        self.complete_stream_with_tools_inner(
            api_key, system_prompt, messages, tools, max_tokens, Some(thinking), event_tx,
        ).await
    }

    async fn complete_stream_with_tools_inner(
        &self,
        api_key: &str,
        system_prompt: &str,
        messages: Vec<RichMessage>,
        tools: Vec<ToolDefinition>,
        max_tokens: u32,
        thinking: Option<ThinkingConfig>,
        event_tx: mpsc::UnboundedSender<ClaudeStreamEvent>,
    ) -> Result<ToolStreamResponse, ClaudeClientError> {
        let msg_count = messages.len();
        let tool_count = tools.len();
        let request = ToolMessagesRequest {
            model: DEFAULT_MODEL.to_string(),
            max_tokens,
            system: system_prompt.to_string(),
            messages,
            stream: Some(true),
            tools: if tools.is_empty() { None } else { Some(tools) },
            thinking,
        };

        let url = format!("{}/v1/messages", self.base_url);
        info!(
            model = DEFAULT_MODEL,
            max_tokens,
            msg_count,
            tool_count,
            url = %url,
            "Sending tool-use streaming Claude API request"
        );

        let body = serde_json::to_value(&request).map_err(|e| {
            ClaudeClientError::Parse(format!("Failed to serialize request: {e}"))
        })?;
        let response = self.send_request(api_key, &url, &body).await?;
        self.parse_sse_stream(response, &event_tx).await
    }

    // -----------------------------------------------------------------------
    // Shared helpers
    // -----------------------------------------------------------------------

    async fn send_request(
        &self,
        api_key: &str,
        url: &str,
        body: &serde_json::Value,
    ) -> Result<reqwest::Response, ClaudeClientError> {
        let start = std::time::Instant::now();

        let response = self
            .http
            .post(url)
            .header("x-api-key", api_key)
            .header("anthropic-version", ANTHROPIC_API_VERSION)
            .header("content-type", "application/json")
            .json(body)
            .send()
            .await
            .map_err(|e| {
                error!(elapsed_ms = start.elapsed().as_millis() as u64, error = %e, "Claude HTTP request failed");
                e
            })?;

        let status = response.status();
        let elapsed_ms = start.elapsed().as_millis() as u64;
        info!(status = status.as_u16(), elapsed_ms, "Claude API responded");

        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            error!(status = status.as_u16(), body = %body, "Claude API error response");
            return Err(ClaudeClientError::Api {
                status: status.as_u16(),
                message: body,
            });
        }

        Ok(response)
    }

    /// Parse an Anthropic SSE stream, handling both text and tool_use content blocks.
    async fn parse_sse_stream(
        &self,
        response: reqwest::Response,
        event_tx: &mpsc::UnboundedSender<ClaudeStreamEvent>,
    ) -> Result<ToolStreamResponse, ClaudeClientError> {
        use tokio_stream::StreamExt;
        let byte_stream = response.bytes_stream().map(|r| r.map_err(ClaudeClientError::Http));
        parse_sse_events(byte_stream, event_tx).await
    }
}

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
    let mut stop_reason = String::from("end_turn");

    let mut tool_calls: Vec<ToolCall> = Vec::new();
    let mut current_tool_id = String::new();
    let mut current_tool_name = String::new();
    let mut current_tool_json = String::new();
    let mut in_tool_block = false;
    let mut in_thinking_block = false;

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| {
            error!(error = %e, "Error reading streaming chunk");
            e
        })?;

        line_buf.push_str(&String::from_utf8_lossy(&chunk));

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

            match event_type.as_str() {
                "message_start" => {
                    if let Ok(data) = serde_json::from_str::<serde_json::Value>(&data_str) {
                        if let Some(usage) = data.get("message").and_then(|m| m.get("usage")) {
                            if let Some(it) = usage.get("input_tokens").and_then(|v| v.as_u64()) {
                                input_tokens = it;
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
                                        let _ = event_tx.send(ClaudeStreamEvent::Delta(text.to_string()));
                                    }
                                }
                                "thinking_delta" => {
                                    if let Some(text) = delta.get("thinking").and_then(|t| t.as_str()) {
                                        let _ = event_tx.send(ClaudeStreamEvent::ThinkingDelta(text.to_string()));
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
                            .unwrap_or(serde_json::Value::Object(Default::default()));
                        let tool_call = ToolCall {
                            id: current_tool_id.clone(),
                            name: current_tool_name.clone(),
                            input: input.clone(),
                        };
                        let _ = event_tx.send(ClaudeStreamEvent::ToolUse {
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
                    let msg = serde_json::from_str::<serde_json::Value>(&data_str)
                        .ok()
                        .and_then(|v| v.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()).map(String::from))
                        .unwrap_or_else(|| data_str.clone());
                    let _ = event_tx.send(ClaudeStreamEvent::Error(msg.clone()));
                    return Err(ClaudeClientError::Parse(msg));
                }
                _ => {}
            }
        }
    }

    let _ = event_tx.send(ClaudeStreamEvent::Done {
        stop_reason: stop_reason.clone(),
        input_tokens,
        output_tokens,
    });

    info!(
        stop_reason = %stop_reason,
        input_tokens,
        output_tokens,
        response_len = accumulated_text.len(),
        tool_call_count = tool_calls.len(),
        elapsed_ms = start.elapsed().as_millis() as u64,
        "Claude streaming complete"
    );

    Ok(ToolStreamResponse {
        text: accumulated_text,
        tool_calls,
        stop_reason,
        input_tokens,
        output_tokens,
    })
}

impl Default for ClaudeClient {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Stream-token-capture helper
// ---------------------------------------------------------------------------

/// Wraps an event channel to intercept `Done` events and capture token counts,
/// optionally forwarding all events to an outer sender.
///
/// Eliminates the repeated `(inner_tx, inner_rx) + Arc<Mutex<(u64,u64)>> +
/// tokio::spawn` pattern from `MeteredLlm` and build-fix code.
/// Handle returned by [`stream_token_capture`] constructors. Await to get
/// the captured `(input_tokens, output_tokens)` once the sender is dropped.
pub struct TokenCaptureHandle {
    forwarder: tokio::task::JoinHandle<()>,
    tokens: std::sync::Arc<tokio::sync::Mutex<(u64, u64)>>,
}

impl TokenCaptureHandle {
    /// Wait for the forwarder task to complete, then return accumulated
    /// `(input_tokens, output_tokens)`.
    pub async fn finalize(self) -> (u64, u64) {
        let _ = self.forwarder.await;
        *self.tokens.lock().await
    }
}

/// Helpers for intercepting stream events to capture token usage.
pub struct StreamTokenCapture;

impl StreamTokenCapture {
    /// Create a channel that forwards every event to `outer` while capturing
    /// token counts from `Done` events. Returns the sender (to pass to
    /// `LlmProvider::complete_stream*`) and a handle to retrieve the counts.
    pub fn forwarding(
        outer: mpsc::UnboundedSender<ClaudeStreamEvent>,
    ) -> (mpsc::UnboundedSender<ClaudeStreamEvent>, TokenCaptureHandle) {
        let (tx, mut rx) = mpsc::unbounded_channel::<ClaudeStreamEvent>();
        let tokens = std::sync::Arc::new(tokio::sync::Mutex::new((0u64, 0u64)));
        let tc = tokens.clone();
        let forwarder = tokio::spawn(async move {
            while let Some(evt) = rx.recv().await {
                if let ClaudeStreamEvent::Done { input_tokens, output_tokens, .. } = &evt {
                    let mut g = tc.lock().await;
                    g.0 = *input_tokens;
                    g.1 = *output_tokens;
                }
                let _ = outer.send(evt);
            }
        });
        (tx, TokenCaptureHandle { forwarder, tokens })
    }

    /// Create a channel that consumes events without forwarding, accumulating
    /// token counts across multiple `Done` events (useful for build-fix loops).
    pub fn sink() -> (mpsc::UnboundedSender<ClaudeStreamEvent>, TokenCaptureHandle) {
        let (tx, mut rx) = mpsc::unbounded_channel::<ClaudeStreamEvent>();
        let tokens = std::sync::Arc::new(tokio::sync::Mutex::new((0u64, 0u64)));
        let tc = tokens.clone();
        let forwarder = tokio::spawn(async move {
            while let Some(evt) = rx.recv().await {
                if let ClaudeStreamEvent::Done { input_tokens, output_tokens, .. } = &evt {
                    let mut g = tc.lock().await;
                    g.0 += *input_tokens;
                    g.1 += *output_tokens;
                }
            }
        });
        (tx, TokenCaptureHandle { forwarder, tokens })
    }
}

#[async_trait]
impl LlmProvider for ClaudeClient {
    async fn complete(
        &self,
        api_key: &str,
        system_prompt: &str,
        user_message: &str,
        max_tokens: u32,
    ) -> Result<LlmResponse, ClaudeClientError> {
        self.complete_with_usage(api_key, system_prompt, user_message, max_tokens)
            .await
    }

    async fn complete_stream(
        &self,
        api_key: &str,
        system_prompt: &str,
        user_message: &str,
        max_tokens: u32,
        event_tx: mpsc::UnboundedSender<LlmStreamEvent>,
    ) -> Result<String, ClaudeClientError> {
        ClaudeClient::complete_stream(self, api_key, system_prompt, user_message, max_tokens, event_tx)
            .await
    }

    async fn complete_stream_multi(
        &self,
        api_key: &str,
        system_prompt: &str,
        messages: Vec<(String, String)>,
        max_tokens: u32,
        event_tx: mpsc::UnboundedSender<LlmStreamEvent>,
    ) -> Result<String, ClaudeClientError> {
        ClaudeClient::complete_stream_multi(self, api_key, system_prompt, messages, max_tokens, event_tx)
            .await
    }

    async fn complete_stream_with_tools(
        &self,
        api_key: &str,
        system_prompt: &str,
        messages: Vec<RichMessage>,
        tools: Vec<ToolDefinition>,
        max_tokens: u32,
        thinking: Option<ThinkingConfig>,
        event_tx: mpsc::UnboundedSender<LlmStreamEvent>,
    ) -> Result<ToolStreamResponse, ClaudeClientError> {
        self.complete_stream_with_tools_inner(
            api_key, system_prompt, messages, tools, max_tokens, thinking, event_tx,
        )
        .await
    }
}

#[cfg(test)]
mod tests {
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
        let result = parse_sse_events(sse_stream(raw), &tx).await.unwrap();
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
        let result = parse_sse_events(sse_stream(raw), &tx).await.unwrap();
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
        let result = parse_sse_events(sse_stream(raw), &tx).await.unwrap();
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
    async fn test_parse_error_event() {
        let raw = r#"event: message_start
data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}

event: error
data: {"type":"error","error":{"type":"overloaded_error","message":"API is overloaded"}}

"#;

        let (tx, mut rx) = mpsc::unbounded_channel();
        let result = parse_sse_events(sse_stream(raw), &tx).await;
        drop(tx);
        let events = drain_events(&mut rx);

        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("overloaded"),
            "Error should contain 'overloaded': {err_msg}"
        );

        assert!(events
            .iter()
            .any(|e| matches!(e, ClaudeStreamEvent::Error(_))));
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
            parse_sse_events(sse_stream_chunked(vec![chunk1, chunk2, chunk3]), &tx)
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
}
