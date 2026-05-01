//! HTTP and WebSocket client for the aura-harness node API.

use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use serde::{Deserialize, Serialize};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::header::AUTHORIZATION as WS_AUTHORIZATION;
use tokio_tungstenite::tungstenite::http::HeaderValue as WsHeaderValue;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};
use tracing::instrument;

const DEFAULT_HTTP_TIMEOUT_SECS: u64 = 30;

/// Transaction kinds accepted by the harness `POST /tx` endpoint.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HarnessTxKind {
    UserPrompt,
    AgentMsg,
    Trigger,
    ActionResult,
    System,
}

impl HarnessTxKind {
    /// Return the wire string expected by aura-harness.
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

/// Result of a reachability check against a harness node.
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

/// Request payload for `POST /automaton/start` when starting harness-owned work.
#[derive(Debug, Clone, Serialize)]
pub struct HarnessAutomatonStartParams {
    pub kind: String,
    pub project_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub process_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<serde_json::Value>,
    /// Org UUID forwarded to the harness so the outbound proxy
    /// request carries `X-Aura-Org-Id`. Mirrors the same field on
    /// [`crate::AutomatonStartParams::aura_org_id`] for dev-loop /
    /// single-task automata. Skipped on the wire when `None` so
    /// pre-existing harnesses (which `#[serde(default)]` the field)
    /// keep accepting the payload.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aura_org_id: Option<String>,
    /// Storage session UUID forwarded to the harness so the outbound
    /// proxy request carries `X-Aura-Session-Id`. Generated per
    /// process-run start so router / billing telemetry can
    /// distinguish concurrent scheduled-process runs of the same
    /// process.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aura_session_id: Option<String>,
}

/// Response payload from `POST /automaton/start`.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct HarnessAutomatonStartResponse {
    #[serde(alias = "id")]
    pub automaton_id: String,
    #[serde(alias = "ws_url", alias = "stream_url")]
    pub event_stream_url: String,
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

/// Lightweight client for the aura-harness node HTTP + WebSocket surface.
#[derive(Debug, Clone)]
pub struct HarnessClient {
    base_url: String,
    http: reqwest::Client,
}

impl HarnessClient {
    /// Build a client from a base URL.
    #[must_use]
    pub fn new(base_url: impl Into<String>) -> Self {
        let base_url = base_url.into().trim_end_matches('/').to_string();
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(DEFAULT_HTTP_TIMEOUT_SECS))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self { base_url, http }
    }

    /// Build a client from `LOCAL_HARNESS_URL`, defaulting to localhost.
    #[must_use]
    pub fn from_env() -> Self {
        let base = std::env::var("LOCAL_HARNESS_URL")
            .unwrap_or_else(|_| "http://localhost:8080".to_string());
        Self::new(base)
    }

    /// Return the normalized base URL.
    #[must_use]
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// Submit a transaction to the harness.
    #[instrument(skip(self, payload, jwt), fields(agent_id = %agent_id, kind = ?kind))]
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
        let req = self.http.post(format!("{}/tx", self.base_url)).json(&body);
        let resp = apply_jwt(req, jwt)?.send().await?;
        json_response(resp).await
    }

    /// Convenience: submit a UTF-8 user prompt transaction.
    pub async fn submit_user_prompt(
        &self,
        agent_id: &str,
        prompt: &str,
        jwt: Option<&str>,
    ) -> Result<SubmitTxResponse, HarnessClientError> {
        self.submit_tx(agent_id, HarnessTxKind::UserPrompt, prompt.as_bytes(), jwt)
            .await
    }

    /// Start an automaton through the harness HTTP API.
    #[instrument(skip(self, params, jwt), fields(kind = %params.kind, project_id = %params.project_id))]
    pub async fn start_automaton(
        &self,
        params: &HarnessAutomatonStartParams,
        jwt: Option<&str>,
    ) -> Result<HarnessAutomatonStartResponse, HarnessClientError> {
        let req = self
            .http
            .post(format!("{}/automaton/start", self.base_url))
            .json(params);
        let resp = apply_jwt(req, jwt)?.send().await?;
        json_response(resp).await
    }

    /// Fetch the current head sequence number for an agent.
    #[instrument(skip(self, jwt), fields(agent_id = %agent_id))]
    pub async fn get_head(
        &self,
        agent_id: &str,
        jwt: Option<&str>,
    ) -> Result<GetHeadResponse, HarnessClientError> {
        let req = self
            .http
            .get(format!("{}/agents/{agent_id}/head", self.base_url));
        let resp = apply_jwt(req, jwt)?.send().await?;
        json_response(resp).await
    }

    /// Scan record entries for an agent as raw JSON.
    #[instrument(skip(self, jwt), fields(agent_id = %agent_id, from_seq, limit))]
    pub async fn scan_record(
        &self,
        agent_id: &str,
        from_seq: u64,
        limit: u32,
        jwt: Option<&str>,
    ) -> Result<Vec<serde_json::Value>, HarnessClientError> {
        let url = format!(
            "{}/agents/{agent_id}/record?from_seq={from_seq}&limit={limit}",
            self.base_url
        );
        let resp = apply_jwt(self.http.get(url), jwt)?.send().await?;
        json_response(resp).await
    }

    /// Cheap reachability probe for UI target status.
    #[instrument(skip(self, jwt))]
    pub async fn probe(&self, jwt: Option<&str>) -> HarnessProbeResult {
        let nil = uuid::Uuid::nil().to_string();
        let url = format!("{}/agents/{nil}/head", self.base_url);
        let start = std::time::Instant::now();
        let req = match apply_jwt(self.http.get(url), jwt) {
            Ok(req) => req,
            Err(err) => return self.probe_error(start, format!("invalid jwt header: {err}")),
        };

        match req.send().await {
            Ok(resp) => HarnessProbeResult {
                reachable: true,
                url: self.base_url.clone(),
                latency_ms: elapsed_ms(start),
                status: Some(resp.status().as_u16()),
                error: None,
            },
            Err(err) => self.probe_error(start, err.to_string()),
        }
    }

    /// Open the `/stream` WebSocket and forward JWT as bearer auth.
    #[instrument(skip(self, jwt))]
    pub async fn subscribe_stream(
        &self,
        jwt: Option<&str>,
    ) -> Result<WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>, HarnessClientError> {
        let ws_url = http_to_ws(&self.base_url)
            .ok_or_else(|| HarnessClientError::InvalidBaseUrl(self.base_url.clone()))?;
        let mut request = format!("{ws_url}/stream").into_client_request()?;
        if let Some(jwt) = jwt {
            let value = WsHeaderValue::from_str(&format!("Bearer {jwt}"))
                .map_err(|err| HarnessClientError::InvalidJwt(err.to_string()))?;
            request.headers_mut().insert(WS_AUTHORIZATION, value);
        }
        let (stream, _resp) = tokio_tungstenite::connect_async(request).await?;
        Ok(stream)
    }

    fn probe_error(&self, start: std::time::Instant, error: String) -> HarnessProbeResult {
        HarnessProbeResult {
            reachable: false,
            url: self.base_url.clone(),
            latency_ms: elapsed_ms(start),
            status: None,
            error: Some(error),
        }
    }
}

fn apply_jwt(
    req: reqwest::RequestBuilder,
    jwt: Option<&str>,
) -> Result<reqwest::RequestBuilder, HarnessClientError> {
    match jwt {
        Some(jwt) => Ok(req.header(AUTHORIZATION, bearer_value(jwt)?)),
        None => Ok(req),
    }
}

async fn json_response<T: serde::de::DeserializeOwned>(
    resp: reqwest::Response,
) -> Result<T, HarnessClientError> {
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

fn bearer_value(jwt: &str) -> Result<HeaderValue, HarnessClientError> {
    HeaderValue::from_str(&format!("Bearer {jwt}"))
        .map_err(|err| HarnessClientError::InvalidJwt(err.to_string()))
}

/// Build bearer headers using the same convention as [`HarnessClient`].
pub fn bearer_headers(jwt: &str) -> Result<HeaderMap, HarnessClientError> {
    let mut headers = HeaderMap::new();
    headers.insert(AUTHORIZATION, bearer_value(jwt)?);
    Ok(headers)
}

fn elapsed_ms(start: std::time::Instant) -> u64 {
    u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX)
}

fn http_to_ws(base: &str) -> Option<String> {
    if let Some(rest) = base.strip_prefix("https://") {
        Some(format!("wss://{rest}"))
    } else {
        base.strip_prefix("http://")
            .map(|rest| format!("ws://{rest}"))
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
        let client = HarnessClient::new("http://localhost:8080/");
        assert_eq!(client.base_url(), "http://localhost:8080");
    }

    #[test]
    fn bearer_headers_sets_authorization() {
        let headers = bearer_headers("abc.def.ghi").unwrap();
        assert_eq!(headers.get(AUTHORIZATION).unwrap(), "Bearer abc.def.ghi");
    }
}
