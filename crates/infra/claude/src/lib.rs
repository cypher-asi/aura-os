mod adapter;
pub(crate) mod channel_ext;
mod conversions;
mod error;
pub mod mock;
mod retry;
mod sse;
pub mod token_capture;
pub mod types;

pub use aura_provider::ModelProvider;
pub use error::ClaudeClientError;
pub use token_capture::{StreamTokenCapture, TokenCaptureHandle};
pub use types::*;

#[derive(Debug, Clone, PartialEq)]
pub enum AuthMode {
    ApiKey,
    Bearer,
}

use async_trait::async_trait;
use tokio::sync::mpsc;
use tracing::{error, info};

use types::{MessagesResponse, SimpleMessage, SimpleMessagesRequest, ToolMessagesRequest};

pub(crate) const ANTHROPIC_API_VERSION: &str = "2023-06-01";
pub(crate) const ANTHROPIC_BETA: &str = "prompt-caching-2024-07-31";
pub const DEFAULT_MODEL: &str = "claude-opus-4-6";
pub const FAST_MODEL: &str = "claude-haiku-4-5-20251001";
pub const MID_MODEL: &str = "claude-sonnet-4-5";

/// Ordered fallback chain: when the primary model is overloaded, try these in order.
pub(crate) const FALLBACK_MODELS: &[&str] = &[
    "claude-opus-4-6",
    "claude-sonnet-4-5",
    "claude-haiku-4-5-20251001",
];

/// Resolve the model to use at startup: AURA_LLM_MODEL env var, then DEFAULT_MODEL.
pub fn resolve_model() -> String {
    std::env::var("AURA_LLM_MODEL")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_MODEL.to_string())
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

pub struct ClaudeClient {
    pub(crate) http: reqwest::Client,
    pub(crate) base_url: String,
    pub(crate) model: String,
    pub(crate) auth_mode: AuthMode,
}

const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);
const STREAM_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(600);

fn build_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(STREAM_TIMEOUT)
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

impl ClaudeClient {
    pub fn new() -> Self {
        let model = resolve_model();
        let (base_url, auth_mode) = match std::env::var("AURA_ROUTER_URL")
            .ok()
            .filter(|s| !s.is_empty())
        {
            Some(url) => {
                info!(router_url = %url, "Router mode enabled");
                (url, AuthMode::Bearer)
            }
            None => ("https://api.anthropic.com".to_string(), AuthMode::ApiKey),
        };
        info!(model = %model, auth_mode = ?auth_mode, "ClaudeClient initialized");
        Self {
            http: build_http_client(),
            base_url,
            model,
            auth_mode,
        }
    }

    pub fn with_model(model: &str) -> Self {
        let (base_url, auth_mode) = match std::env::var("AURA_ROUTER_URL")
            .ok()
            .filter(|s| !s.is_empty())
        {
            Some(url) => (url, AuthMode::Bearer),
            None => ("https://api.anthropic.com".to_string(), AuthMode::ApiKey),
        };
        Self {
            http: build_http_client(),
            base_url,
            model: model.to_string(),
            auth_mode,
        }
    }

    #[cfg(test)]
    pub fn with_base_url(base_url: &str) -> Self {
        Self {
            http: build_http_client(),
            base_url: base_url.to_string(),
            model: DEFAULT_MODEL.to_string(),
            auth_mode: AuthMode::ApiKey,
        }
    }

    pub fn is_router_mode(&self) -> bool {
        self.auth_mode == AuthMode::Bearer
    }

    pub fn model(&self) -> &str {
        &self.model
    }

    pub fn default_model_name(&self) -> &str {
        &self.model
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
        self.complete_with_usage_model(
            &self.model,
            api_key,
            system_prompt,
            user_message,
            max_tokens,
        )
        .await
    }

    pub async fn complete_with_usage_model(
        &self,
        model: &str,
        api_key: &str,
        system_prompt: &str,
        user_message: &str,
        max_tokens: u32,
    ) -> Result<LlmResponse, ClaudeClientError> {
        let request = SimpleMessagesRequest {
            model: model.to_string(),
            max_tokens,
            system: serde_json::Value::String(system_prompt.to_string()),
            messages: vec![SimpleMessage {
                role: "user".to_string(),
                content: user_message.to_string(),
            }],
            stream: None,
        };

        let url = format!("{}/v1/messages", self.base_url);
        info!(model, max_tokens, user_msg_len = user_message.len(), url = %url, "Sending Claude API request");
        let response = self
            .complete_non_stream_with_retry(api_key, &url, &request)
            .await?;
        parse_messages_response(response, max_tokens).await
    }

    pub async fn complete_stream(
        &self,
        api_key: &str,
        system_prompt: &str,
        user_message: &str,
        max_tokens: u32,
        event_tx: mpsc::UnboundedSender<ClaudeStreamEvent>,
    ) -> Result<String, ClaudeClientError> {
        let messages = vec![("user".to_string(), user_message.to_string())];
        self.complete_stream_multi(api_key, system_prompt, messages, max_tokens, event_tx)
            .await
    }

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
            model: self.model.clone(),
            max_tokens,
            system: serde_json::Value::String(system_prompt.to_string()),
            messages: api_messages,
            stream: Some(true),
        };

        let url = format!("{}/v1/messages", self.base_url);
        info!(
            model = %self.model,
            max_tokens,
            msg_count,
            url = %url,
            "Sending multi-turn streaming Claude API request"
        );

        let body = serde_json::to_value(&request)
            .map_err(|e| ClaudeClientError::Parse(format!("Failed to serialize request: {e}")))?;
        let result = self
            .stream_with_retry_and_fallback(api_key, &url, body, &event_tx)
            .await?;

        if result.stop_reason == "max_tokens" {
            error!(max_tokens, "Claude multi-turn streaming response truncated");
            return Err(ClaudeClientError::Truncated { max_tokens });
        }

        if result.text.is_empty() && result.tool_calls.is_empty() {
            error!("Claude multi-turn streaming returned empty content");
            return Err(ClaudeClientError::Parse(
                "no text content in streaming response".into(),
            ));
        }

        Ok(result.text)
    }
}

async fn parse_messages_response(
    response: reqwest::Response,
    max_tokens: u32,
) -> Result<LlmResponse, ClaudeClientError> {
    let body: MessagesResponse = response.json().await.map_err(|e| {
        error!(error = %e, "Failed to deserialize Claude response body");
        ClaudeClientError::Parse(e.to_string())
    })?;

    let stop_reason = body.stop_reason.as_deref().unwrap_or("unknown");
    info!(stop_reason, "Claude stop_reason");
    if stop_reason == "max_tokens" {
        error!(
            max_tokens,
            "Claude response truncated — hit max_tokens limit"
        );
        return Err(ClaudeClientError::Truncated { max_tokens });
    }

    let usage = body.usage.unwrap_or_default();
    let text: String = body
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

    tracing::debug!(
        response_len = text.len(),
        input_tokens = usage.input_tokens,
        output_tokens = usage.output_tokens,
        "Claude response text extracted"
    );
    Ok(LlmResponse {
        text,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
    })
}

/// Place a rolling `cache_control: ephemeral` breakpoint on the last user
/// message's last content block.  This lets Anthropic cache the entire prefix
/// (system + tools + all messages up to this point) between iterations,
/// reducing input-token cost by 50-80% on subsequent calls.
fn inject_message_cache_breakpoint(body: &mut serde_json::Value) {
    let Some(messages) = body.get_mut("messages").and_then(|m| m.as_array_mut()) else {
        return;
    };
    for msg in messages.iter_mut().rev() {
        if msg.get("role").and_then(|r| r.as_str()) != Some("user") {
            continue;
        }
        let Some(content) = msg.get_mut("content") else {
            continue;
        };
        if content.is_array() {
            if let Some(last_block) = content.as_array_mut().and_then(|a| a.last_mut()) {
                if let Some(obj) = last_block.as_object_mut() {
                    obj.insert(
                        "cache_control".into(),
                        serde_json::json!({"type": "ephemeral"}),
                    );
                }
            }
            return;
        }
        if content.is_string() {
            let text = content.as_str().unwrap_or("").to_string();
            *content = serde_json::json!([{
                "type": "text",
                "text": text,
                "cache_control": {"type": "ephemeral"}
            }]);
            return;
        }
    }
}

fn cached_system_blocks(text: &str) -> serde_json::Value {
    serde_json::json!([{
        "type": "text",
        "text": text,
        "cache_control": {"type": "ephemeral"}
    }])
}

impl Default for ClaudeClient {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// LlmProvider impl
// ---------------------------------------------------------------------------

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
        ClaudeClient::complete_stream(
            self,
            api_key,
            system_prompt,
            user_message,
            max_tokens,
            event_tx,
        )
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
        ClaudeClient::complete_stream_multi(
            self,
            api_key,
            system_prompt,
            messages,
            max_tokens,
            event_tx,
        )
        .await
    }

    async fn complete_stream_with_tools(
        &self,
        req: ToolStreamRequest<'_>,
    ) -> Result<ToolStreamResponse, ClaudeClientError> {
        let ToolStreamRequest {
            api_key,
            system_prompt,
            messages,
            mut tools,
            max_tokens,
            thinking,
            event_tx,
            model_override,
        } = req;
        let msg_count = messages.len();
        let tool_count = tools.len();
        let effective_model = model_override.unwrap_or(&self.model);

        if let Some(last) = tools.last_mut() {
            last.cache_control = Some(CacheControl::ephemeral());
        }

        let request = ToolMessagesRequest {
            model: effective_model.to_string(),
            max_tokens,
            system: cached_system_blocks(system_prompt),
            messages,
            stream: Some(true),
            tools: if tools.is_empty() { None } else { Some(tools) },
            thinking,
        };

        let url = format!("{}/v1/messages", self.base_url);
        info!(
            model = %effective_model,
            max_tokens,
            msg_count,
            tool_count,
            url = %url,
            "Sending tool-use streaming Claude API request"
        );

        let mut body = serde_json::to_value(&request)
            .map_err(|e| ClaudeClientError::Parse(format!("Failed to serialize request: {e}")))?;
        inject_message_cache_breakpoint(&mut body);
        self.stream_with_retry_and_fallback(api_key, &url, body, &event_tx)
            .await
    }

    async fn complete_with_model(
        &self,
        model: &str,
        api_key: &str,
        system_prompt: &str,
        user_message: &str,
        max_tokens: u32,
    ) -> Result<LlmResponse, ClaudeClientError> {
        self.complete_with_usage_model(model, api_key, system_prompt, user_message, max_tokens)
            .await
    }
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
