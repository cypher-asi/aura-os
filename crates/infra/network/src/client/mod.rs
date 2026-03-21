mod agents;
mod analytics;
mod orgs;
mod projects;
mod social;
mod users;

use std::env;

use reqwest::Client;
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
        let base_url = env::var("AURA_NETWORK_URL")
            .ok()
            .filter(|s| !s.is_empty())?;

        let base_url = base_url.trim_end_matches('/').to_string();
        info!(%base_url, "aura-network client configured");

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

    /// Returns the WebSocket URL for the aura-network events stream.
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
            warn!(status = status.as_u16(), elapsed_ms, %body, "aura-network health check failed");
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

    pub(crate) async fn get_authed<T: serde::de::DeserializeOwned>(
        &self,
        url: &str,
        jwt: &str,
    ) -> Result<T, NetworkError> {
        let resp = self
            .http
            .get(url)
            .bearer_auth(jwt)
            .send()
            .await?;

        self.handle_response(resp).await
    }

    pub(crate) async fn post_authed<T: serde::de::DeserializeOwned, B: serde::Serialize>(
        &self,
        url: &str,
        jwt: &str,
        body: &B,
    ) -> Result<T, NetworkError> {
        let resp = self
            .http
            .post(url)
            .bearer_auth(jwt)
            .json(body)
            .send()
            .await?;

        self.handle_response(resp).await
    }

    pub(crate) async fn put_authed<T: serde::de::DeserializeOwned, B: serde::Serialize>(
        &self,
        url: &str,
        jwt: &str,
        body: &B,
    ) -> Result<T, NetworkError> {
        let resp = self
            .http
            .put(url)
            .bearer_auth(jwt)
            .json(body)
            .send()
            .await?;

        self.handle_response(resp).await
    }

    pub(crate) async fn delete_authed(&self, url: &str, jwt: &str) -> Result<(), NetworkError> {
        let resp = self
            .http
            .delete(url)
            .bearer_auth(jwt)
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(NetworkError::Server {
                status: status.as_u16(),
                body,
            });
        }
        Ok(())
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
        let body = resp.text().await.map_err(|e| NetworkError::Deserialize(e.to_string()))?;
        serde_json::from_str::<T>(&body).map_err(|e| {
            warn!(%url, error = %e, body_preview = &body[..body.len().min(500)], "Deserialization failed");
            NetworkError::Deserialize(e.to_string())
        })
    }
}
