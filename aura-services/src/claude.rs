use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tracing::{debug, error, info};

use crate::error::ClaudeClientError;

const ANTHROPIC_API_VERSION: &str = "2023-06-01";
pub const DEFAULT_MODEL: &str = "claude-opus-4-6";

const COST_PER_INPUT_TOKEN: f64 = 5.0 / 1_000_000.0;
const COST_PER_OUTPUT_TOKEN: f64 = 25.0 / 1_000_000.0;

pub fn compute_cost(input_tokens: u64, output_tokens: u64) -> f64 {
    input_tokens as f64 * COST_PER_INPUT_TOKEN + output_tokens as f64 * COST_PER_OUTPUT_TOKEN
}

#[derive(Debug, Clone)]
pub enum ClaudeStreamEvent {
    Delta(String),
    Done {
        stop_reason: String,
        input_tokens: u64,
        output_tokens: u64,
    },
    Error(String),
}

pub struct ClaudeClient {
    http: reqwest::Client,
    base_url: String,
}

#[derive(Serialize)]
struct MessagesRequest {
    model: String,
    max_tokens: u32,
    system: String,
    messages: Vec<Message>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stream: Option<bool>,
}

#[derive(Serialize)]
struct Message {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct MessagesResponse {
    content: Vec<ContentBlock>,
    stop_reason: Option<String>,
}

#[derive(Deserialize)]
struct ContentBlock {
    text: Option<String>,
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
        let request = MessagesRequest {
            model: DEFAULT_MODEL.to_string(),
            max_tokens,
            system: system_prompt.to_string(),
            messages: vec![Message {
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

        debug!(response_len = text.len(), "Claude response text extracted");
        Ok(text)
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
        use tokio_stream::StreamExt;

        let request = MessagesRequest {
            model: DEFAULT_MODEL.to_string(),
            max_tokens,
            system: system_prompt.to_string(),
            messages: vec![Message {
                role: "user".to_string(),
                content: user_message.to_string(),
            }],
            stream: Some(true),
        };

        let url = format!("{}/v1/messages", self.base_url);
        info!(
            model = DEFAULT_MODEL,
            max_tokens,
            user_msg_len = user_message.len(),
            url = %url,
            "Sending streaming Claude API request"
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
                error!(elapsed_ms = start.elapsed().as_millis() as u64, error = %e, "Claude streaming HTTP request failed");
                e
            })?;

        let status = response.status();
        let elapsed_ms = start.elapsed().as_millis() as u64;
        info!(status = status.as_u16(), elapsed_ms, "Claude streaming API responded");

        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            error!(status = status.as_u16(), body = %body, "Claude API error response");
            return Err(ClaudeClientError::Api {
                status: status.as_u16(),
                message: body,
            });
        }

        let mut byte_stream = response.bytes_stream();
        let mut line_buf = String::new();
        let mut accumulated_text = String::new();
        let mut input_tokens: u64 = 0;
        let mut output_tokens: u64 = 0;
        let mut stop_reason = String::from("end_turn");

        while let Some(chunk_result) = byte_stream.next().await {
            let chunk = chunk_result.map_err(|e| {
                error!(error = %e, "Error reading streaming chunk");
                ClaudeClientError::Http(e)
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
                    "content_block_delta" => {
                        if let Ok(data) = serde_json::from_str::<serde_json::Value>(&data_str) {
                            if let Some(text) = data.get("delta").and_then(|d| d.get("text")).and_then(|t| t.as_str()) {
                                accumulated_text.push_str(text);
                                let _ = event_tx.send(ClaudeStreamEvent::Delta(text.to_string()));
                            }
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
            elapsed_ms = start.elapsed().as_millis() as u64,
            "Claude streaming complete"
        );

        if stop_reason == "max_tokens" {
            error!(max_tokens, "Claude streaming response truncated — hit max_tokens limit");
            return Err(ClaudeClientError::Truncated { max_tokens });
        }

        if accumulated_text.is_empty() {
            error!("Claude streaming returned empty text content");
            return Err(ClaudeClientError::Parse("no text content in streaming response".into()));
        }

        Ok(accumulated_text)
    }

    /// Streaming variant that pre-fills the assistant turn with `prefill` (e.g. `"{"`)
    /// to steer the model toward structured output. The prefill is prepended to the
    /// returned text so callers receive the complete response.
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

    /// Multi-turn streaming variant. Accepts a full conversation history as
    /// `(role, content)` pairs and streams the assistant response via `event_tx`.
    pub async fn complete_stream_multi(
        &self,
        api_key: &str,
        system_prompt: &str,
        messages: Vec<(String, String)>,
        max_tokens: u32,
        event_tx: mpsc::UnboundedSender<ClaudeStreamEvent>,
    ) -> Result<String, ClaudeClientError> {
        use tokio_stream::StreamExt;

        let api_messages: Vec<Message> = messages
            .into_iter()
            .map(|(role, content)| Message { role, content })
            .collect();

        let msg_count = api_messages.len();
        let request = MessagesRequest {
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
                error!(elapsed_ms = start.elapsed().as_millis() as u64, error = %e, "Claude multi-turn streaming HTTP request failed");
                e
            })?;

        let status = response.status();
        let elapsed_ms = start.elapsed().as_millis() as u64;
        info!(status = status.as_u16(), elapsed_ms, "Claude multi-turn streaming API responded");

        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            error!(status = status.as_u16(), body = %body, "Claude API error response");
            return Err(ClaudeClientError::Api {
                status: status.as_u16(),
                message: body,
            });
        }

        let mut byte_stream = response.bytes_stream();
        let mut line_buf = String::new();
        let mut accumulated_text = String::new();
        let mut input_tokens: u64 = 0;
        let mut output_tokens: u64 = 0;
        let mut stop_reason = String::from("end_turn");

        while let Some(chunk_result) = byte_stream.next().await {
            let chunk = chunk_result.map_err(|e| {
                error!(error = %e, "Error reading streaming chunk");
                ClaudeClientError::Http(e)
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
                    "content_block_delta" => {
                        if let Ok(data) = serde_json::from_str::<serde_json::Value>(&data_str) {
                            if let Some(text) = data.get("delta").and_then(|d| d.get("text")).and_then(|t| t.as_str()) {
                                accumulated_text.push_str(text);
                                let _ = event_tx.send(ClaudeStreamEvent::Delta(text.to_string()));
                            }
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
                        debug!(elapsed_ms = start.elapsed().as_millis() as u64, "Claude multi-turn stream completed");
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
            elapsed_ms = start.elapsed().as_millis() as u64,
            "Claude multi-turn streaming complete"
        );

        if stop_reason == "max_tokens" {
            error!(max_tokens, "Claude multi-turn streaming response truncated — hit max_tokens limit");
            return Err(ClaudeClientError::Truncated { max_tokens });
        }

        if accumulated_text.is_empty() {
            error!("Claude multi-turn streaming returned empty text content");
            return Err(ClaudeClientError::Parse("no text content in streaming response".into()));
        }

        Ok(accumulated_text)
    }
}

impl Default for ClaudeClient {
    fn default() -> Self {
        Self::new()
    }
}
