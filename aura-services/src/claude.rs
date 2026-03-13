use serde::{Deserialize, Serialize};
use tracing::{debug, error, info};

use crate::error::ClaudeClientError;

const ANTHROPIC_API_VERSION: &str = "2023-06-01";
const DEFAULT_MODEL: &str = "claude-sonnet-4-20250514";

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
}

impl Default for ClaudeClient {
    fn default() -> Self {
        Self::new()
    }
}
