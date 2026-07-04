//! Shared HTTP client for proxying JSON to the local harness REST API.
//!
//! Centralizes base URL resolution (via [`AppState`](crate::state::AppState) wiring at startup),
//! [`reqwest::Client`] reuse, and common request/response handling for harness proxy routes.

use aura_os_harness::{local_harness_base_url, local_harness_transport_auth_token_from_env};
use axum::http::{Method, StatusCode, header};
use axum::response::{IntoResponse, Response};
use url::Url;

/// Gateway for JSON HTTP calls to the harness (`LOCAL_HARNESS_URL`).
#[derive(Clone)]
pub struct HarnessHttpGateway {
    base_url: String,
    client: reqwest::Client,
    transport_auth_token: Option<String>,
}

impl std::fmt::Debug for HarnessHttpGateway {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HarnessHttpGateway")
            .field("base_url", &self.base_url)
            .field("client", &self.client)
            .field(
                "transport_auth_token",
                &self.transport_auth_token.as_ref().map(|_| "[redacted]"),
            )
            .finish()
    }
}

impl HarnessHttpGateway {
    pub fn new(base_url: impl Into<String>) -> Self {
        let base_url = base_url.into().trim_end_matches('/').to_string();
        Self {
            base_url,
            client: reqwest::Client::new(),
            transport_auth_token: None,
        }
    }

    pub fn with_transport_auth_token(
        base_url: impl Into<String>,
        transport_auth_token: Option<String>,
    ) -> Self {
        let mut gateway = Self::new(base_url);
        gateway.transport_auth_token = transport_auth_token;
        gateway
    }

    pub fn for_configured_local_base_url(base_url: impl Into<String>) -> Self {
        let base_url = base_url.into();
        let transport_auth_token =
            if normalized_base_url(&base_url) == normalized_base_url(&local_harness_base_url()) {
                local_harness_transport_auth_token_from_env()
            } else {
                None
            };
        Self::with_transport_auth_token(base_url, transport_auth_token)
    }

    pub(crate) fn has_transport_auth(&self) -> bool {
        self.transport_auth_token.is_some()
    }

    fn apply_transport_auth(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        match self.transport_auth_token.as_deref() {
            Some(token) => req.bearer_auth(token),
            None => req,
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
        let url = self.harness_url(path, query.as_deref())?;

        let mut req = match method {
            Method::GET => self.client.get(url),
            Method::POST => self.client.post(url),
            Method::PUT => self.client.put(url),
            Method::DELETE => self.client.delete(url),
            _ => return Err(StatusCode::METHOD_NOT_ALLOWED),
        };

        req = self
            .apply_transport_auth(req)
            .header("Content-Type", "application/json");
        if let Some(body) = body {
            req = req.body(body);
        }

        let resp = req.send().await.map_err(|_| StatusCode::BAD_GATEWAY)?;
        let status = StatusCode::from_u16(resp.status().as_u16())
            .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        let body = resp.text().await.map_err(|_| StatusCode::BAD_GATEWAY)?;

        Ok((status, [(header::CONTENT_TYPE, "application/json")], body).into_response())
    }

    /// POST to register a skill on an agent (best-effort; used after agent harness setup).
    pub(crate) async fn install_skill_for_agent(&self, agent_id: &str, skill_name: &str) -> bool {
        let path = format!("api/agents/{agent_id}/skills");
        let body = serde_json::json!({ "name": skill_name }).to_string();
        match self.proxy_json(Method::POST, &path, None, Some(body)).await {
            Ok(resp) => resp.status().is_success(),
            Err(_) => false,
        }
    }

    /// POST JSON and report whether the harness accepted it (2xx status).
    ///
    /// Unlike [`Self::post_json_ignore_result`], the caller can react to a
    /// failed registration instead of silently proceeding. Use this when the
    /// harness call is load-bearing — e.g. the skill-edit path, where this
    /// POST is what reloads the harness's in-memory skill registry and is the
    /// only thing that makes an edit go live. Returns `false` on any
    /// transport failure or non-2xx status.
    pub(crate) async fn post_json_ok(&self, path: &str, body: String) -> bool {
        match self.proxy_json(Method::POST, path, None, Some(body)).await {
            Ok(resp) => resp.status().is_success(),
            Err(_) => false,
        }
    }

    /// Fire-and-forget style POST used when the caller does not need the harness response.
    pub(crate) async fn post_json_ignore_result(&self, path: &str, body: String) {
        let Ok(url) = self.harness_url(path, None) else {
            return;
        };
        let _ = self
            .apply_transport_auth(
                self.client
                    .post(url)
                    .header("Content-Type", "application/json")
                    .body(body),
            )
            .send()
            .await;
    }

    /// Fetch a JSON document from the harness for internal use.
    ///
    /// Unlike [`Self::proxy_json`] (which returns an `axum::Response` destined
    /// for a client), this returns the parsed `serde_json::Value` so callers
    /// can inspect the body as part of a larger server-side decision. Returns
    /// `None` on any transport/status/parse failure — callers should treat
    /// failures as "no data" (best-effort).
    pub(crate) async fn fetch_json(&self, method: Method, path: &str) -> Option<serde_json::Value> {
        let url = self.harness_url(path, None).ok()?;
        let req = match method {
            Method::GET => self.client.get(url),
            Method::POST => self.client.post(url),
            Method::PUT => self.client.put(url),
            Method::DELETE => self.client.delete(url),
            _ => return None,
        };
        let resp = self
            .apply_transport_auth(req)
            .header("Content-Type", "application/json")
            .send()
            .await
            .ok()?;
        if !resp.status().is_success() {
            return None;
        }
        let text = resp.text().await.ok()?;
        serde_json::from_str(&text).ok()
    }

    fn harness_url(&self, path: &str, query: Option<&str>) -> Result<Url, StatusCode> {
        let base = format!("{}/", self.base_url.trim_end_matches('/'));
        let mut url = Url::parse(&base).map_err(|_| StatusCode::BAD_GATEWAY)?;
        {
            let mut path_segments = url
                .path_segments_mut()
                .map_err(|_| StatusCode::BAD_GATEWAY)?;
            path_segments.pop_if_empty();
            for segment in path.trim_start_matches('/').split('/') {
                if segment.is_empty() || segment == "." || segment == ".." {
                    return Err(StatusCode::BAD_REQUEST);
                }
                path_segments.push(segment);
            }
        }
        url.set_query(query);
        Ok(url)
    }
}

fn normalized_base_url(url: &str) -> String {
    url.trim().trim_end_matches('/').to_string()
}

#[cfg(test)]
mod tests {
    use super::HarnessHttpGateway;

    #[test]
    fn harness_url_keeps_base_host_and_encodes_segments() {
        let gateway = HarnessHttpGateway::new("http://127.0.0.1:9999/base");
        let url = gateway
            .harness_url("/api/agents/agent 1/memory/facts", Some("limit=10"))
            .expect("valid harness url");

        assert_eq!(
            url.as_str(),
            "http://127.0.0.1:9999/base/api/agents/agent%201/memory/facts?limit=10"
        );
    }

    #[test]
    fn harness_url_rejects_relative_path_traversal_segments() {
        let gateway = HarnessHttpGateway::new("http://127.0.0.1:9999");
        assert!(gateway.harness_url("api/agents/../skills", None).is_err());
    }
}
