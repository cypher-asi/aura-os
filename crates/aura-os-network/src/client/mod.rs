mod agents;
mod analytics;
mod orgs;
mod projects;
mod social;
mod users;

pub use agents::ListMarketplaceAgentsParams;
pub use social::CreatePostParams;

use std::env;

use reqwest::{Client, Method, RequestBuilder, Url};
use tracing::{debug, error, info, warn};

use crate::error::NetworkError;
use crate::types::*;

/// HTTP client for the aura-network shared backend service.
///
/// Wraps `reqwest` with typed methods for each aura-network API group.
/// All requests that need auth accept a JWT token parameter which is
/// forwarded as `Authorization: Bearer <jwt>`.
#[derive(Clone)]
pub struct NetworkClient {
    pub(crate) http: Client,
    pub(crate) base_url: String,
}

const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);
const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);
const TRANSIENT_RETRY_COUNT: usize = 2;
const TRANSIENT_RETRY_DELAY: std::time::Duration = std::time::Duration::from_millis(500);

fn build_http_client() -> Client {
    Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .build()
        .unwrap_or_else(|_| Client::new())
}

impl NetworkClient {
    /// Create a new `NetworkClient`, reading `AURA_NETWORK_URL` from env.
    /// Returns `None` if the env var is not set or empty (network integration disabled).
    pub fn from_env() -> Option<Self> {
        Self::from_env_key("AURA_NETWORK_URL")
    }

    /// Create a new `NetworkClient` from an arbitrary env var name. Useful for
    /// routing a subset of requests (e.g. the in-development Feedback app) to
    /// a different aura-network deployment via `AURA_NETWORK_FEEDBACK_URL`.
    /// Returns `None` if the env var is not set or empty.
    pub fn from_env_key(key: &str) -> Option<Self> {
        let base_url = env::var(key).ok().filter(|s| !s.is_empty())?;

        let base_url = base_url.trim_end_matches('/').to_string();
        info!(%key, %base_url, "aura-network client configured");

        Some(Self {
            http: build_http_client(),
            base_url,
        })
    }

    /// Create a `NetworkClient` with an explicit base URL (e.g. for tests or custom deployment).
    pub fn with_base_url(base_url: &str) -> Self {
        Self {
            http: build_http_client(),
            base_url: base_url.trim_end_matches('/').to_string(),
        }
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// Access the underlying HTTP client for making custom requests
    /// (e.g. proxying to other services like the swarm gateway).
    pub fn http_client(&self) -> &Client {
        &self.http
    }

    /// Returns the WebSocket URL for the aura-network events stream.
    ///
    /// NOTE: this is a server-to-server (aura-os-server -> aura-network)
    /// connection, so the `?token=` here leaks only into aura-network's
    /// own access logs, not this server's. Browser-facing endpoints use
    /// the short-lived `?ticket=` flow instead (see
    /// `aura-os-server` `handlers::auth::mint_ws_ticket`). Moving this
    /// outbound link off `?token=` (e.g. an `Authorization` handshake
    /// header) requires aura-network to accept header auth on
    /// `/ws/events`; tracked as a follow-up that must land on the
    /// receiving service first to avoid breaking the bridge.
    pub fn ws_events_url(&self, jwt: &str) -> String {
        let ws_base = self
            .base_url
            .replacen("https://", "wss://", 1)
            .replacen("http://", "ws://", 1);
        format!("{}/ws/events?token={}", ws_base, jwt)
    }

    /// Check if aura-network is reachable. Returns `Ok(())` on success.
    pub async fn health_check(&self) -> Result<HealthResponse, NetworkError> {
        let url = format!("{}/health", self.base_url);
        debug!(%url, "Checking aura-network health");

        let start = std::time::Instant::now();
        let resp = self.http.get(&url).send().await.map_err(|e| {
            error!(error = %e, "aura-network health check request failed");
            NetworkError::Request(e)
        })?;

        let status = resp.status();
        let elapsed_ms = start.elapsed().as_millis();

        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            let body_preview: String = body.chars().take(200).collect();
            warn!(status = status.as_u16(), elapsed_ms, body = %body_preview, "aura-network health check failed");
            return Err(NetworkError::HealthCheckFailed(format!(
                "status {}: {}",
                status.as_u16(),
                body
            )));
        }

        let health: HealthResponse = resp
            .json()
            .await
            .map_err(|e| NetworkError::Deserialize(e.to_string()))?;

        info!(
            status = %health.status,
            version = health.version.as_deref().unwrap_or("unknown"),
            elapsed_ms,
            "aura-network health check OK"
        );

        Ok(health)
    }

    // -----------------------------------------------------------------------
    // Internal HTTP helpers
    // -----------------------------------------------------------------------

    /// Build an authenticated request only when its destination exactly matches
    /// the configured aura-network origin. Keeping this check at the bearer-token
    /// boundary prevents future callers from turning the shared helpers into an
    /// SSRF or credential-exfiltration primitive.
    pub(crate) fn authed_request(
        &self,
        method: Method,
        request_url: &str,
        jwt: &str,
    ) -> Result<RequestBuilder, NetworkError> {
        let base_url = Url::parse(&self.base_url).map_err(|_| NetworkError::InvalidBaseUrl)?;
        let request_url = Url::parse(request_url).map_err(|_| NetworkError::InvalidRequestUrl)?;

        let base_is_http = matches!(base_url.scheme(), "http" | "https");
        let base_has_origin = base_url.host_str().is_some();
        let same_origin = request_url.scheme() == base_url.scheme()
            && request_url.host_str() == base_url.host_str()
            && request_url.port_or_known_default() == base_url.port_or_known_default();
        let has_embedded_credentials = !request_url.username().is_empty()
            || request_url.password().is_some()
            || !base_url.username().is_empty()
            || base_url.password().is_some();

        if !base_is_http || !base_has_origin {
            return Err(NetworkError::InvalidBaseUrl);
        }
        if !same_origin || has_embedded_credentials {
            return Err(NetworkError::UntrustedRequestOrigin);
        }

        // The Rust CodeQL SSRF query currently treats even a user-controlled
        // path suffix on a fixed host as tainted. The same-origin check above is
        // the security boundary and is covered by regression tests.
        // codeql[rust/request-forgery]
        Ok(self.http.request(method, request_url).bearer_auth(jwt))
    }

    pub(crate) async fn get_authed<T: serde::de::DeserializeOwned>(
        &self,
        url: &str,
        jwt: &str,
    ) -> Result<T, NetworkError> {
        let mut last_err = None;
        for attempt in 0..=TRANSIENT_RETRY_COUNT {
            if attempt > 0 {
                tokio::time::sleep(TRANSIENT_RETRY_DELAY).await;
            }
            let resp = self.authed_request(Method::GET, url, jwt)?.send().await?;
            match self.handle_response(resp).await {
                Ok(v) => return Ok(v),
                Err(e) if e.is_transient() => {
                    warn!(
                        %url, attempt, error = %e,
                        "transient upstream error, retrying"
                    );
                    last_err = Some(e);
                }
                Err(e) => return Err(e),
            }
        }
        Err(last_err.unwrap())
    }

    pub(crate) async fn post_authed<T: serde::de::DeserializeOwned, B: serde::Serialize>(
        &self,
        url: &str,
        jwt: &str,
        body: &B,
    ) -> Result<T, NetworkError> {
        let mut last_err = None;
        for attempt in 0..=TRANSIENT_RETRY_COUNT {
            if attempt > 0 {
                tokio::time::sleep(TRANSIENT_RETRY_DELAY).await;
            }
            let resp = self
                .authed_request(Method::POST, url, jwt)?
                .json(body)
                .send()
                .await?;
            match self.handle_response(resp).await {
                Ok(v) => return Ok(v),
                Err(e) if e.is_transient() => {
                    warn!(
                        %url, attempt, error = %e,
                        "transient upstream error, retrying"
                    );
                    last_err = Some(e);
                }
                Err(e) => return Err(e),
            }
        }
        Err(last_err.unwrap())
    }

    pub(crate) async fn put_authed<T: serde::de::DeserializeOwned, B: serde::Serialize>(
        &self,
        url: &str,
        jwt: &str,
        body: &B,
    ) -> Result<T, NetworkError> {
        let mut last_err = None;
        for attempt in 0..=TRANSIENT_RETRY_COUNT {
            if attempt > 0 {
                tokio::time::sleep(TRANSIENT_RETRY_DELAY).await;
            }
            let resp = self
                .authed_request(Method::PUT, url, jwt)?
                .json(body)
                .send()
                .await?;
            match self.handle_response(resp).await {
                Ok(v) => return Ok(v),
                Err(e) if e.is_transient() => {
                    warn!(
                        %url, attempt, error = %e,
                        "transient upstream error, retrying"
                    );
                    last_err = Some(e);
                }
                Err(e) => return Err(e),
            }
        }
        Err(last_err.unwrap())
    }

    pub(crate) async fn patch_authed<T: serde::de::DeserializeOwned, B: serde::Serialize>(
        &self,
        url: &str,
        jwt: &str,
        body: &B,
    ) -> Result<T, NetworkError> {
        let mut last_err = None;
        for attempt in 0..=TRANSIENT_RETRY_COUNT {
            if attempt > 0 {
                tokio::time::sleep(TRANSIENT_RETRY_DELAY).await;
            }
            let resp = self
                .authed_request(Method::PATCH, url, jwt)?
                .json(body)
                .send()
                .await?;
            match self.handle_response(resp).await {
                Ok(v) => return Ok(v),
                Err(e) if e.is_transient() => {
                    warn!(
                        %url, attempt, error = %e,
                        "transient upstream error, retrying"
                    );
                    last_err = Some(e);
                }
                Err(e) => return Err(e),
            }
        }
        Err(last_err.unwrap())
    }

    pub(crate) async fn delete_authed(&self, url: &str, jwt: &str) -> Result<(), NetworkError> {
        let mut last_err = None;
        for attempt in 0..=TRANSIENT_RETRY_COUNT {
            if attempt > 0 {
                tokio::time::sleep(TRANSIENT_RETRY_DELAY).await;
            }
            let resp = self
                .authed_request(Method::DELETE, url, jwt)?
                .send()
                .await?;
            let status = resp.status();
            if status.is_success() {
                return Ok(());
            }
            let body = resp.text().await.unwrap_or_default();
            let err = NetworkError::Server {
                status: status.as_u16(),
                body,
            };
            if err.is_transient() {
                warn!(
                    %url, attempt, error = %err,
                    "transient upstream error, retrying"
                );
                last_err = Some(err);
            } else {
                return Err(err);
            }
        }
        Err(last_err.unwrap())
    }

    pub(crate) async fn handle_response<T: serde::de::DeserializeOwned>(
        &self,
        resp: reqwest::Response,
    ) -> Result<T, NetworkError> {
        let url = resp.url().to_string();
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(NetworkError::Server {
                status: status.as_u16(),
                body,
            });
        }
        let body = resp
            .text()
            .await
            .map_err(|e| NetworkError::Deserialize(e.to_string()))?;
        serde_json::from_str::<T>(&body).map_err(|e| {
            let preview: String = body.chars().take(200).collect();
            warn!(%url, error = %e, body_preview = %preview, "Deserialization failed");
            NetworkError::Deserialize(e.to_string())
        })
    }
}

#[cfg(test)]
mod tests {
    use reqwest::Method;

    use super::NetworkClient;
    use crate::error::NetworkError;

    const JWT: &str = "test-jwt";

    #[test]
    fn authenticated_requests_accept_the_configured_origin() {
        let client = NetworkClient::with_base_url("https://network.example");

        let request = client
            .authed_request(
                Method::POST,
                "https://network.example/api/orgs/org-1?include=members",
                JWT,
            )
            .expect("same-origin request should be accepted")
            .build()
            .expect("request should build");

        assert_eq!(request.url().host_str(), Some("network.example"));
        assert_eq!(request.url().path(), "/api/orgs/org-1");
        assert!(request
            .headers()
            .contains_key(reqwest::header::AUTHORIZATION));
    }

    #[test]
    fn authenticated_requests_reject_cross_origin_urls() {
        let client = NetworkClient::with_base_url("https://network.example");

        for url in [
            "https://attacker.example/api/orgs",
            "https://network.example.attacker.example/api/orgs",
            "http://network.example/api/orgs",
            "https://network.example:8443/api/orgs",
            "https://user@network.example/api/orgs",
        ] {
            assert!(matches!(
                client.authed_request(Method::POST, url, JWT),
                Err(NetworkError::UntrustedRequestOrigin)
            ));
        }
    }

    #[test]
    fn authenticated_requests_reject_invalid_urls() {
        let client = NetworkClient::with_base_url("https://network.example");
        assert!(matches!(
            client.authed_request(Method::PUT, "not a URL", JWT),
            Err(NetworkError::InvalidRequestUrl)
        ));

        let invalid_client = NetworkClient::with_base_url("not a URL");
        assert!(matches!(
            invalid_client.authed_request(Method::PUT, "https://network.example/api/users", JWT),
            Err(NetworkError::InvalidBaseUrl)
        ));
    }
}
