//! Shared HTTP client for proxying JSON to the local harness REST API.
//!
//! Centralizes base URL resolution (via [`AppState`](crate::state::AppState) wiring at startup),
//! [`reqwest::Client`] reuse, and common request/response handling for harness proxy routes.

use aura_os_harness::{
    is_hosted_harness_base_url, local_harness_base_url, local_harness_transport_auth_token_from_env,
};
use axum::http::{header, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use std::time::Duration;
use url::Url;

/// Gateway for JSON HTTP calls to the harness (`LOCAL_HARNESS_URL`).
#[derive(Clone)]
pub struct HarnessHttpGateway {
    base_url: String,
    client: reqwest::Client,
    transport_auth_token: Option<String>,
}

#[derive(Debug)]
pub(crate) struct HarnessJsonError {
    pub(crate) status: StatusCode,
    pub(crate) message: String,
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

    pub(crate) fn hosted_local_runtime_available(&self) -> bool {
        is_hosted_harness_base_url(&self.base_url) && self.has_transport_auth()
    }

    pub(crate) fn hosted_base_requires_transport_auth(&self) -> bool {
        is_hosted_harness_base_url(&self.base_url) && !self.has_transport_auth()
    }

    /// Confirm that the configured harness is actually serving requests.
    /// Configuration alone is not availability: desktop must fail closed
    /// when its managed sidecar did not start, and hosted deployments must
    /// also have transport auth before they can advertise local agents.
    pub(crate) async fn runtime_available(&self) -> bool {
        if self.hosted_base_requires_transport_auth() {
            return false;
        }
        tokio::time::timeout(
            Duration::from_secs(2),
            self.fetch_json(Method::GET, "health"),
        )
        .await
        .ok()
        .flatten()
        .is_some()
    }

    /// Whether the separately deployed local harness owns the Safe Workspace
    /// lifecycle API. Missing fields and failed probes deliberately mean
    /// unsupported so mixed-version Render deployments fail closed.
    pub(crate) async fn hosted_safe_workspace_available(&self) -> bool {
        if !self.hosted_local_runtime_available() {
            return false;
        }
        tokio::time::timeout(
            Duration::from_secs(2),
            self.fetch_json(Method::GET, "health"),
        )
        .await
        .ok()
        .flatten()
        .is_some_and(|health| health_advertises_safe_workspace(&health))
    }

    /// Call a hosted Safe Workspace endpoint and preserve both the upstream
    /// status and structured error message for Aura OS API handlers.
    pub(crate) async fn hosted_safe_workspace_json(
        &self,
        method: Method,
        path: &str,
    ) -> Result<serde_json::Value, HarnessJsonError> {
        let url = self
            .harness_url(path, None)
            .map_err(|status| HarnessJsonError {
                status,
                message: "building hosted Safe Workspace URL failed".to_string(),
            })?;
        let req = match method {
            Method::GET => self.client.get(url),
            Method::POST => self.client.post(url),
            _ => {
                return Err(HarnessJsonError {
                    status: StatusCode::METHOD_NOT_ALLOWED,
                    message: "unsupported hosted Safe Workspace method".to_string(),
                })
            }
        };
        let response = self
            .apply_transport_auth(req)
            .header("Content-Type", "application/json")
            .send()
            .await
            .map_err(|error| HarnessJsonError {
                status: StatusCode::BAD_GATEWAY,
                message: format!("hosted Safe Workspace request failed: {error}"),
            })?;
        let status = StatusCode::from_u16(response.status().as_u16())
            .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        let body = response.text().await.map_err(|error| HarnessJsonError {
            status: StatusCode::BAD_GATEWAY,
            message: format!("reading hosted Safe Workspace response failed: {error}"),
        })?;
        let value =
            serde_json::from_str::<serde_json::Value>(&body).map_err(|error| HarnessJsonError {
                status: StatusCode::BAD_GATEWAY,
                message: format!("hosted Safe Workspace returned invalid JSON: {error}"),
            })?;
        if !status.is_success() {
            let message = value
                .get("error")
                .and_then(|value| value.as_str())
                .unwrap_or("hosted Safe Workspace request was rejected")
                .to_string();
            return Err(HarnessJsonError { status, message });
        }
        Ok(value)
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

    /// Copy browser-imported project files into the filesystem owned by a
    /// separately hosted local Harness.
    pub(crate) async fn import_workspace(
        &self,
        workspace_key: &str,
        files: serde_json::Value,
    ) -> Result<(), String> {
        let body = serde_json::json!({
            "workspace_key": workspace_key,
            "files": files,
        })
        .to_string();
        let response = self
            .proxy_json(Method::POST, "workspace/import", None, Some(body))
            .await
            .map_err(|status| format!("hosted Harness import proxy failed with {status}"))?;
        if response.status().is_success() {
            Ok(())
        } else {
            Err(format!(
                "hosted Harness rejected workspace import with {}",
                response.status()
            ))
        }
    }

    /// Best-effort hosted workspace cleanup used after project deletion.
    pub(crate) async fn delete_workspace(&self, workspace_key: &str) -> Result<(), String> {
        let path = format!("workspace/{workspace_key}");
        let response = self
            .proxy_json(Method::DELETE, &path, None, None)
            .await
            .map_err(|status| format!("hosted Harness delete proxy failed with {status}"))?;
        if response.status().is_success() {
            Ok(())
        } else {
            Err(format!(
                "hosted Harness rejected workspace deletion with {}",
                response.status()
            ))
        }
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
        if self.hosted_base_requires_transport_auth() {
            return Err(StatusCode::SERVICE_UNAVAILABLE);
        }
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

fn health_advertises_safe_workspace(health: &serde_json::Value) -> bool {
    health
        .get("safe_workspace")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::{health_advertises_safe_workspace, HarnessHttpGateway};
    use axum::{
        http::StatusCode,
        routing::{get, post},
        Json, Router,
    };

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

    #[test]
    fn hosted_local_runtime_requires_non_loopback_base_and_transport_auth() {
        let hosted_without_auth =
            HarnessHttpGateway::new("https://aura-harness-latest.onrender.com");
        assert!(!hosted_without_auth.hosted_local_runtime_available());
        assert!(hosted_without_auth.hosted_base_requires_transport_auth());
        assert_eq!(
            hosted_without_auth.harness_url("api/skills", None),
            Err(axum::http::StatusCode::SERVICE_UNAVAILABLE)
        );

        let hosted_with_auth = HarnessHttpGateway::with_transport_auth_token(
            "https://aura-harness-latest.onrender.com",
            Some("secret".to_string()),
        );
        assert!(hosted_with_auth.hosted_local_runtime_available());
        assert!(!hosted_with_auth.hosted_base_requires_transport_auth());

        let loopback_without_auth = HarnessHttpGateway::new("http://127.0.0.1:9999");
        assert!(!loopback_without_auth.hosted_local_runtime_available());
        assert!(!loopback_without_auth.hosted_base_requires_transport_auth());
    }

    #[test]
    fn hosted_safe_workspace_capability_fails_closed_for_old_or_malformed_health() {
        assert!(!health_advertises_safe_workspace(&serde_json::json!({
            "status": "ok"
        })));
        assert!(!health_advertises_safe_workspace(&serde_json::json!({
            "safe_workspace": "yes"
        })));
        assert!(health_advertises_safe_workspace(&serde_json::json!({
            "safe_workspace": true
        })));
    }

    #[tokio::test]
    async fn runtime_availability_requires_a_live_health_response() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(
                listener,
                Router::new().route(
                    "/health",
                    get(|| async { Json(serde_json::json!({ "status": "ok" })) }),
                ),
            )
            .await
            .unwrap();
        });

        let gateway = HarnessHttpGateway::new(format!("http://{address}"));
        assert!(gateway.runtime_available().await);
        server.abort();

        let closed_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let closed_address = closed_listener.local_addr().unwrap();
        drop(closed_listener);
        let unavailable = HarnessHttpGateway::new(format!("http://{closed_address}"));
        assert!(!unavailable.runtime_available().await);
    }

    #[tokio::test]
    async fn checked_json_post_reports_rejection_and_transport_failure() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(
                listener,
                Router::new()
                    .route("/accepted", post(|| async { StatusCode::CREATED }))
                    .route("/rejected", post(|| async { StatusCode::BAD_REQUEST })),
            )
            .await
            .unwrap();
        });

        let gateway = HarnessHttpGateway::new(format!("http://{address}"));
        assert!(gateway.post_json_ok("accepted", "{}".into()).await);
        assert!(!gateway.post_json_ok("rejected", "{}".into()).await);
        server.abort();

        let closed_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let closed_address = closed_listener.local_addr().unwrap();
        drop(closed_listener);
        let unavailable = HarnessHttpGateway::new(format!("http://{closed_address}"));
        assert!(!unavailable.post_json_ok("accepted", "{}".into()).await);
    }
}
