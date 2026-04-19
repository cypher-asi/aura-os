//! Phase 1 of the agent / harness unification plan.
//!
//! [`HarnessClient`] is a lightweight wrapper around the aura-harness node's
//! transaction-based HTTP surface (`POST /tx`, `GET /agents/:id/head`,
//! `GET /agents/:id/record`) and its `/stream` WebSocket.
//!
//! This module is intentionally **not wired into any live code path yet**. It
//! exists so that later phases (harness-hosted agents, cross-agent
//! tools) can delegate execution to a harness node at any URL — local or
//! cloud — using a single shared client.
//!
//! The caller's JWT is forwarded as a `Bearer` token on every request so that
//! a harness-hosted agent can authenticate upstream calls the same way the
//! in-process agent dispatch does today.
//!
//! See `docs/` and the plan file for the full rollout context.

use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use serde::{Deserialize, Serialize};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::header::AUTHORIZATION as WS_AUTHORIZATION;
use tokio_tungstenite::tungstenite::http::HeaderValue as WsHeaderValue;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};
use tracing::instrument;

/// Default HTTP timeout for non-streaming requests. Streaming (`/stream`)
/// uses its own connection without this timeout.
const DEFAULT_HTTP_TIMEOUT_SECS: u64 = 30;

/// Transaction kinds accepted by the harness's `POST /tx` endpoint.
///
/// Matches the string enumeration in
/// `aura-harness/crates/aura-node/src/router/tx.rs`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HarnessTxKind {
    UserPrompt,
    AgentMsg,
    Trigger,
    ActionResult,
    System,
}

impl HarnessTxKind {
    /// The wire string expected by the harness router.
    pub fn as_wire(self) -> &'static str {
        match self {
            Self::UserPrompt => "user_prompt",
            Self::AgentMsg => "agent_msg",
            Self::Trigger => "trigger",
            Self::ActionResult => "action_result",
            Self::System => "system",
        }
    }
}

/// Response payload from `POST /tx`.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SubmitTxResponse {
    pub accepted: bool,
    pub tx_id: String,
}

/// Response payload from `GET /agents/:id/head`.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct GetHeadResponse {
    pub agent_id: String,
    pub head_seq: u64,
}

/// Result of a non-authoritative reachability check against a harness node.
///
/// Exposed by [`HarnessClient::probe`] so the UI can render a "Cloud target
/// reachable" pill on the agent editor. The probe deliberately tolerates a
/// 404 on the placeholder endpoint it hits: if a well-formed HTTP response
/// came back at all the harness is up, even when the probed resource itself
/// doesn't exist.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessProbeResult {
    pub reachable: bool,
    pub url: String,
    pub latency_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Errors produced by [`HarnessClient`].
#[derive(Debug, thiserror::Error)]
pub enum HarnessClientError {
    #[error("http request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("harness returned status {status}: {body}")]
    Status { status: u16, body: String },
    #[error("websocket connect failed: {0}")]
    WsConnect(#[from] tokio_tungstenite::tungstenite::Error),
    #[error("invalid jwt header value: {0}")]
    InvalidJwt(String),
    #[error("invalid base url: {0}")]
    InvalidBaseUrl(String),
}

/// Lightweight client for the aura-harness node HTTP + WS surface.
///
/// Holds a base URL (e.g. `http://localhost:8080`) and a shared
/// [`reqwest::Client`]. Each call optionally forwards a JWT as a
/// `Bearer` token.
#[derive(Debug, Clone)]
pub struct HarnessClient {
    base_url: String,
    http: reqwest::Client,
}

impl HarnessClient {
    /// Build a client from a base URL.
    ///
    /// Trailing slashes on `base_url` are stripped.
    pub fn new(base_url: impl Into<String>) -> Self {
        let base_url = base_url.into().trim_end_matches('/').to_string();
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(DEFAULT_HTTP_TIMEOUT_SECS))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self { base_url, http }
    }

    /// Build a client from the canonical `LOCAL_HARNESS_URL` env var
    /// (default `http://localhost:8080`), matching the existing
    /// [`HarnessHttpGateway`](crate::HarnessHttpGateway) convention.
    pub fn from_env() -> Self {
        let base = std::env::var("LOCAL_HARNESS_URL")
            .unwrap_or_else(|_| "http://localhost:8080".to_string());
        Self::new(base)
    }

    /// Return the base URL (no trailing slash).
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// Submit a transaction to the harness.
    ///
    /// `payload` is the raw bytes for the transaction body; the harness
    /// expects it base64-encoded over the wire.
    #[instrument(skip(self, payload, jwt), fields(agent_id = %agent_id, kind = ?kind, payload_len = payload.len()))]
    pub async fn submit_tx(
        &self,
        agent_id: &str,
        kind: HarnessTxKind,
        payload: &[u8],
        jwt: Option<&str>,
    ) -> Result<SubmitTxResponse, HarnessClientError> {
        use base64::Engine;

        let body = serde_json::json!({
            "agent_id": agent_id,
            "kind": kind.as_wire(),
            "payload": base64::engine::general_purpose::STANDARD.encode(payload),
        });

        let url = format!("{}/tx", self.base_url);
        let mut req = self.http.post(&url).json(&body);
        if let Some(jwt) = jwt {
            req = req.header(AUTHORIZATION, bearer_value(jwt)?);
        }

        let resp = req.send().await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(HarnessClientError::Status {
                status: status.as_u16(),
                body,
            });
        }
        Ok(resp.json().await?)
    }

    /// Convenience: submit a `UserPrompt` with the given utf-8 prompt.
    pub async fn submit_user_prompt(
        &self,
        agent_id: &str,
        prompt: &str,
        jwt: Option<&str>,
    ) -> Result<SubmitTxResponse, HarnessClientError> {
        self.submit_tx(agent_id, HarnessTxKind::UserPrompt, prompt.as_bytes(), jwt)
            .await
    }

    /// Fetch the current head sequence number for an agent.
    #[instrument(skip(self, jwt), fields(agent_id = %agent_id))]
    pub async fn get_head(
        &self,
        agent_id: &str,
        jwt: Option<&str>,
    ) -> Result<GetHeadResponse, HarnessClientError> {
        let url = format!("{}/agents/{}/head", self.base_url, agent_id);
        let mut req = self.http.get(&url);
        if let Some(jwt) = jwt {
            req = req.header(AUTHORIZATION, bearer_value(jwt)?);
        }
        let resp = req.send().await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(HarnessClientError::Status {
                status: status.as_u16(),
                body,
            });
        }
        Ok(resp.json().await?)
    }

    /// Scan record entries for an agent starting at `from_seq` (inclusive),
    /// returning up to `limit` entries as raw JSON values.
    ///
    /// The harness returns `Vec<RecordEntry>` which has a rich internal
    /// shape; we return [`serde_json::Value`] here so this client can
    /// stay decoupled from the harness-side type definitions. Later
    /// phases that need a typed view can layer a stronger deserializer
    /// on top.
    #[instrument(skip(self, jwt), fields(agent_id = %agent_id, from_seq, limit))]
    pub async fn scan_record(
        &self,
        agent_id: &str,
        from_seq: u64,
        limit: u32,
        jwt: Option<&str>,
    ) -> Result<Vec<serde_json::Value>, HarnessClientError> {
        let url = format!(
            "{}/agents/{}/record?from_seq={}&limit={}",
            self.base_url, agent_id, from_seq, limit
        );
        let mut req = self.http.get(&url);
        if let Some(jwt) = jwt {
            req = req.header(AUTHORIZATION, bearer_value(jwt)?);
        }
        let resp = req.send().await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(HarnessClientError::Status {
                status: status.as_u16(),
                body,
            });
        }
        Ok(resp.json().await?)
    }

    /// Cheap reachability probe used by the UI to render a "target
    /// available" pill next to the Local/Cloud host-mode picker.
    ///
    /// This is **not** in the chat hot path. It's issued on demand when the
    /// operator opens the agent editor and wants visual confirmation
    /// that the configured `LOCAL_HARNESS_URL` (or future per-agent
    /// `harness_url`) answers. Any well-formed HTTP response — including a
    /// 404 on the placeholder endpoint — counts as "reachable"; only
    /// transport errors flip `reachable` to false.
    ///
    /// The probed path is `GET /agents/:nil/head` rather than `GET /`
    /// because the axum-based aura-node does not currently expose a bare
    /// root endpoint and we don't want the probe to spuriously fail if a
    /// future maintainer adds or removes one. The head endpoint is
    /// stable, cheap, and authenticated, which also doubles as a JWT
    /// forwarding check.
    #[instrument(skip(self, jwt))]
    pub async fn probe(&self, jwt: Option<&str>) -> HarnessProbeResult {
        let nil = uuid::Uuid::nil().to_string();
        let url = format!("{}/agents/{}/head", self.base_url, nil);
        let start = std::time::Instant::now();
        let mut req = self.http.get(&url);
        if let Some(jwt) = jwt {
            match bearer_value(jwt) {
                Ok(v) => req = req.header(AUTHORIZATION, v),
                Err(e) => {
                    return HarnessProbeResult {
                        reachable: false,
                        url: self.base_url.clone(),
                        latency_ms: start.elapsed().as_millis() as u64,
                        status: None,
                        error: Some(format!("invalid jwt header: {e}")),
                    };
                }
            }
        }
        match req.send().await {
            Ok(resp) => HarnessProbeResult {
                reachable: true,
                url: self.base_url.clone(),
                latency_ms: start.elapsed().as_millis() as u64,
                status: Some(resp.status().as_u16()),
                error: None,
            },
            Err(err) => HarnessProbeResult {
                reachable: false,
                url: self.base_url.clone(),
                latency_ms: start.elapsed().as_millis() as u64,
                status: None,
                error: Some(err.to_string()),
            },
        }
    }

    /// Open the `/stream` WebSocket, forwarding the JWT as a `Bearer`
    /// token in the upgrade request.
    ///
    /// Returns the raw [`WebSocketStream`]; callers iterate messages
    /// themselves. Later phases will layer a typed frame iterator on
    /// top.
    #[instrument(skip(self, jwt))]
    pub async fn subscribe_stream(
        &self,
        jwt: Option<&str>,
    ) -> Result<WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>, HarnessClientError> {
        let ws_url = http_to_ws(&self.base_url)
            .ok_or_else(|| HarnessClientError::InvalidBaseUrl(self.base_url.clone()))?;
        let url = format!("{ws_url}/stream");

        let mut request = url.clone().into_client_request()?;
        if let Some(jwt) = jwt {
            let value = WsHeaderValue::from_str(&format!("Bearer {jwt}"))
                .map_err(|e| HarnessClientError::InvalidJwt(e.to_string()))?;
            request.headers_mut().insert(WS_AUTHORIZATION, value);
        }

        let (stream, _resp) = tokio_tungstenite::connect_async(request).await?;
        Ok(stream)
    }
}

fn bearer_value(jwt: &str) -> Result<HeaderValue, HarnessClientError> {
    HeaderValue::from_str(&format!("Bearer {jwt}"))
        .map_err(|e| HarnessClientError::InvalidJwt(e.to_string()))
}

/// Headers helper exposed for any caller that needs to forward a JWT on
/// its own [`reqwest::Client`] while sharing this crate's conventions.
pub fn bearer_headers(jwt: &str) -> Result<HeaderMap, HarnessClientError> {
    let mut h = HeaderMap::new();
    h.insert(AUTHORIZATION, bearer_value(jwt)?);
    Ok(h)
}

fn http_to_ws(base: &str) -> Option<String> {
    if let Some(rest) = base.strip_prefix("https://") {
        Some(format!("wss://{rest}"))
    } else if let Some(rest) = base.strip_prefix("http://") {
        Some(format!("ws://{rest}"))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tx_kind_wire_names_match_harness_router() {
        assert_eq!(HarnessTxKind::UserPrompt.as_wire(), "user_prompt");
        assert_eq!(HarnessTxKind::AgentMsg.as_wire(), "agent_msg");
        assert_eq!(HarnessTxKind::Trigger.as_wire(), "trigger");
        assert_eq!(HarnessTxKind::ActionResult.as_wire(), "action_result");
        assert_eq!(HarnessTxKind::System.as_wire(), "system");
    }

    #[test]
    fn http_to_ws_rewrites_scheme() {
        assert_eq!(
            http_to_ws("http://localhost:8080").as_deref(),
            Some("ws://localhost:8080")
        );
        assert_eq!(
            http_to_ws("https://harness.example.com").as_deref(),
            Some("wss://harness.example.com")
        );
        assert!(http_to_ws("ftp://nope").is_none());
    }

    #[test]
    fn base_url_trailing_slash_is_stripped() {
        let c = HarnessClient::new("http://localhost:8080/");
        assert_eq!(c.base_url(), "http://localhost:8080");
    }

    #[test]
    fn bearer_headers_sets_authorization() {
        let headers = bearer_headers("abc.def.ghi").unwrap();
        assert_eq!(headers.get(AUTHORIZATION).unwrap(), "Bearer abc.def.ghi");
    }
}
