use tokio::sync::mpsc;
use tokio_stream::StreamExt;
use tracing::{error, info, warn};

use crate::error::ClaudeClientError;
use crate::types::{ClaudeStreamEvent, SimpleMessagesRequest, ToolStreamResponse};
use crate::{sse, AuthMode, ClaudeClient, ANTHROPIC_API_VERSION, ANTHROPIC_BETA, FALLBACK_MODELS};

impl ClaudeClient {
    const MAX_RETRIES: u32 = 2;
    const INITIAL_BACKOFF_MS: u64 = 1000;

    pub(crate) async fn stream_with_retry_and_fallback(
        &self,
        api_key: &str,
        url: &str,
        mut body: serde_json::Value,
        event_tx: &mpsc::UnboundedSender<ClaudeStreamEvent>,
    ) -> Result<ToolStreamResponse, ClaudeClientError> {
        let mut models: Vec<&str> = vec![&self.model];
        for fb in FALLBACK_MODELS {
            if !models.contains(fb) {
                models.push(fb);
            }
        }

        let mut last_err = None;
        for (model_idx, model) in models.iter().enumerate() {
            body["model"] = serde_json::Value::String(model.to_string());

            for attempt in 0..=Self::MAX_RETRIES {
                if attempt > 0 {
                    let backoff = Self::INITIAL_BACKOFF_MS * 2u64.pow(attempt - 1);
                    warn!(attempt, model = %model, backoff_ms = backoff, "Retrying after overloaded error");
                    tokio::time::sleep(std::time::Duration::from_millis(backoff)).await;
                }
                let result = async {
                    let response = self.send_request(api_key, url, &body).await?;
                    self.parse_sse_stream(response, event_tx).await
                }
                .await;
                match result {
                    Ok(mut resp) => {
                        resp.model_used = model.to_string();
                        if model_idx > 0 {
                            info!(primary = %self.model, fallback = %model, "Completed with fallback model");
                        }
                        return Ok(resp);
                    }
                    Err(e) if matches!(e, ClaudeClientError::InsufficientCredits) => return Err(e),
                    Err(e) if e.is_overloaded() && attempt < Self::MAX_RETRIES => {
                        warn!(attempt, model = %model, "Claude API overloaded, will retry");
                        last_err = Some(e);
                    }
                    Err(e) if e.is_overloaded() && model_idx < models.len() - 1 => {
                        warn!(model = %model, "Model exhausted retries, falling back to next model");
                        last_err = Some(e);
                        break;
                    }
                    Err(e) => return Err(e),
                }
            }
        }
        Err(last_err.unwrap_or(ClaudeClientError::Overloaded))
    }

    pub(crate) async fn complete_non_stream_with_retry(
        &self,
        api_key: &str,
        url: &str,
        request: &SimpleMessagesRequest,
    ) -> Result<reqwest::Response, ClaudeClientError> {
        let mut last_err = None;
        for attempt in 0..=Self::MAX_RETRIES {
            if attempt > 0 {
                let backoff = Self::INITIAL_BACKOFF_MS * 2u64.pow(attempt - 1);
                warn!(
                    attempt,
                    backoff_ms = backoff,
                    "Retrying non-streaming request after overloaded error"
                );
                tokio::time::sleep(std::time::Duration::from_millis(backoff)).await;
            }

            let start = std::time::Instant::now();
            let mut req = self
                .http
                .post(url)
                .header("content-type", "application/json");

            match self.auth_mode {
                AuthMode::ApiKey => {
                    req = req
                        .header("x-api-key", api_key)
                        .header("anthropic-version", ANTHROPIC_API_VERSION)
                        .header("anthropic-beta", ANTHROPIC_BETA);
                }
                AuthMode::Bearer => {
                    req = req.header("authorization", format!("Bearer {api_key}"));
                }
            }

            let response = req
                .json(request)
                .send()
                .await
                .map_err(|e| {
                    error!(elapsed_ms = start.elapsed().as_millis() as u64, error = %e, "Claude HTTP request failed");
                    ClaudeClientError::Http(e)
                })?;

            let status = response.status();
            let elapsed_ms = start.elapsed().as_millis() as u64;
            info!(status = status.as_u16(), elapsed_ms, "Claude API responded");

            if status.is_success() {
                return Ok(response);
            }

            let status_code = status.as_u16();
            let body_text = response.text().await.unwrap_or_default();
            let truncated_body: String = body_text.chars().take(500).collect();
            error!(status = status_code, body = %truncated_body, "Claude API error response");

            if status_code == 402 {
                return Err(ClaudeClientError::InsufficientCredits);
            }

            if (status_code == 429 || status_code == 529) && attempt < Self::MAX_RETRIES {
                last_err = Some(ClaudeClientError::Overloaded);
                continue;
            }

            if status_code == 429 || status_code == 529 {
                return Err(ClaudeClientError::Overloaded);
            }
            return Err(ClaudeClientError::Api {
                status: status_code,
                message: body_text,
            });
        }
        Err(last_err.unwrap_or(ClaudeClientError::Overloaded))
    }

    async fn send_request(
        &self,
        api_key: &str,
        url: &str,
        body: &serde_json::Value,
    ) -> Result<reqwest::Response, ClaudeClientError> {
        let start = std::time::Instant::now();

        let mut req = self
            .http
            .post(url)
            .header("content-type", "application/json");

        match self.auth_mode {
            AuthMode::ApiKey => {
                req = req
                    .header("x-api-key", api_key)
                    .header("anthropic-version", ANTHROPIC_API_VERSION)
                    .header("anthropic-beta", ANTHROPIC_BETA);
            }
            AuthMode::Bearer => {
                req = req.header("authorization", format!("Bearer {api_key}"));
            }
        }

        let response = req
            .json(body)
            .send()
            .await
            .map_err(|e| {
                error!(elapsed_ms = start.elapsed().as_millis() as u64, error = %e, "Claude HTTP request failed");
                e
            })?;

        let status = response.status();
        let elapsed_ms = start.elapsed().as_millis() as u64;
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("unknown");
        info!(
            status = status.as_u16(),
            elapsed_ms, content_type, "Claude API responded"
        );

        if !status.is_success() {
            let status_code = status.as_u16();
            let body = response.text().await.unwrap_or_default();
            let truncated_body: String = body.chars().take(500).collect();
            error!(status = status_code, body = %truncated_body, "Claude API error response");
            if status_code == 402 {
                return Err(ClaudeClientError::InsufficientCredits);
            }
            if status_code == 429 || status_code == 529 {
                return Err(ClaudeClientError::Overloaded);
            }
            return Err(ClaudeClientError::Api {
                status: status_code,
                message: body,
            });
        }

        Ok(response)
    }

    async fn parse_sse_stream(
        &self,
        response: reqwest::Response,
        event_tx: &mpsc::UnboundedSender<ClaudeStreamEvent>,
    ) -> Result<ToolStreamResponse, ClaudeClientError> {
        let byte_stream = response
            .bytes_stream()
            .map(|r| r.map_err(ClaudeClientError::Http));
        sse::parse_sse_events(byte_stream, event_tx).await
    }
}

#[cfg(test)]
#[path = "retry_tests.rs"]
mod retry_tests;
