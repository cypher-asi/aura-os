//! Shared HTTP client for proxying JSON to the local harness REST API.
//!
//! Centralizes base URL resolution (via [`AppState`](crate::state::AppState) wiring at startup),
//! [`reqwest::Client`] reuse, and common request/response handling for harness proxy routes.

use axum::http::{header, Method, StatusCode};
use axum::response::{IntoResponse, Response};

/// Gateway for JSON HTTP calls to the harness (`LOCAL_HARNESS_URL`).
#[derive(Debug, Clone)]
pub struct HarnessHttpGateway {
    base_url: String,
    client: reqwest::Client,
}

impl HarnessHttpGateway {
    pub fn new(base_url: impl Into<String>) -> Self {
        let base_url = base_url.into().trim_end_matches('/').to_string();
        Self {
            base_url,
            client: reqwest::Client::new(),
        }
    }

    /// Proxy a JSON request to `{base}/{path}` with optional query string and body.
    pub(crate) async fn proxy_json(
        &self,
        method: Method,
        path: &str,
        query: Option<String>,
        body: Option<String>,
    ) -> Result<Response, StatusCode> {
        let path = path.trim_start_matches('/');
        let url = match query {
            Some(q) => format!("{}/{path}?{q}", self.base_url),
            None => format!("{}/{path}", self.base_url),
        };

        let mut req = match method {
            Method::GET => self.client.get(&url),
            Method::POST => self.client.post(&url),
            Method::PUT => self.client.put(&url),
            Method::DELETE => self.client.delete(&url),
            _ => return Err(StatusCode::METHOD_NOT_ALLOWED),
        };

        req = req.header("Content-Type", "application/json");
        if let Some(body) = body {
            req = req.body(body);
        }

        let resp = req.send().await.map_err(|_| StatusCode::BAD_GATEWAY)?;
        let status = StatusCode::from_u16(resp.status().as_u16())
            .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        let body = resp.text().await.map_err(|_| StatusCode::BAD_GATEWAY)?;

        Ok((status, [(header::CONTENT_TYPE, "application/json")], body).into_response())
    }

    /// POST to register a skill on an agent (best-effort; used after super-agent setup).
    pub(crate) async fn install_skill_for_agent(&self, agent_id: &str, skill_name: &str) -> bool {
        let path = format!("api/agents/{agent_id}/skills");
        let body = serde_json::json!({ "name": skill_name }).to_string();
        match self.proxy_json(Method::POST, &path, None, Some(body)).await {
            Ok(resp) => resp.status().is_success(),
            Err(_) => false,
        }
    }

    /// Fire-and-forget style POST used when the caller does not need the harness response.
    pub(crate) async fn post_json_ignore_result(&self, path: &str, body: String) {
        let path = path.trim_start_matches('/');
        let url = format!("{}/{path}", self.base_url);
        let _ = self
            .client
            .post(&url)
            .header("Content-Type", "application/json")
            .body(body)
            .send()
            .await;
    }
}
