use std::env;

use reqwest::Client;
use serde_json::Value;
use tracing::{info, warn};

use aura_os_core::entities::OrgIntegration;
use aura_os_core::OrgId;

use crate::error::IntegrationsError;

const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);
const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
const TRANSIENT_RETRY_COUNT: usize = 2;
const TRANSIENT_RETRY_DELAY: std::time::Duration = std::time::Duration::from_millis(500);

fn build_http_client() -> Client {
    Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .build()
        .unwrap_or_else(|_| Client::new())
}

/// HTTP client for the aura-integrations microservice.
///
/// Public CRUD methods forward the user's JWT as `Authorization: Bearer`.
/// Internal methods (secret retrieval) use `X-Internal-Token`.
#[derive(Clone)]
pub struct IntegrationsClient {
    http: Client,
    base_url: String,
    internal_token: String,
}

impl IntegrationsClient {
    /// Create from env vars.
    ///
    /// `aura-integrations` is the canonical integration backend when both
    /// `AURA_INTEGRATIONS_URL` and `AURA_INTEGRATIONS_INTERNAL_TOKEN` are set.
    /// Otherwise Aura OS remains in compatibility-only local fallback mode.
    pub fn from_env() -> Option<Self> {
        let base_url = env::var("AURA_INTEGRATIONS_URL")
            .ok()
            .filter(|s| !s.is_empty());
        let internal_token = env::var("AURA_INTEGRATIONS_INTERNAL_TOKEN")
            .ok()
            .filter(|s| !s.is_empty());

        let (base_url, internal_token) = match (base_url, internal_token) {
            (Some(base_url), Some(internal_token)) => (base_url, internal_token),
            (Some(_), None) => {
                warn!(
                    "AURA_INTEGRATIONS_URL is set without AURA_INTEGRATIONS_INTERNAL_TOKEN; using compatibility-only local integration storage"
                );
                return None;
            }
            (None, Some(_)) => {
                warn!(
                    "AURA_INTEGRATIONS_INTERNAL_TOKEN is set without AURA_INTEGRATIONS_URL; using compatibility-only local integration storage"
                );
                return None;
            }
            (None, None) => return None,
        };

        let base_url = base_url.trim_end_matches('/').to_string();
        info!(%base_url, "aura-integrations client configured");

        Some(Self {
            http: build_http_client(),
            base_url,
            internal_token,
        })
    }

    /// Create with an explicit base URL and internal token (e.g. for tests).
    pub fn with_base_url(base_url: &str, internal_token: &str) -> Self {
        Self {
            http: build_http_client(),
            base_url: base_url.trim_end_matches('/').to_string(),
            internal_token: internal_token.to_string(),
        }
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub async fn health_check(&self) -> Result<(), IntegrationsError> {
        let url = format!("{}/health", self.base_url);
        let resp = self.http.get(&url).send().await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(IntegrationsError::Server {
                status: status.as_u16(),
                body,
            });
        }
        Ok(())
    }

    // ── Public API (JWT auth) ──

    pub async fn list_integrations(
        &self,
        org_id: &OrgId,
        jwt: &str,
    ) -> Result<Vec<OrgIntegration>, IntegrationsError> {
        let url = format!("{}/api/orgs/{}/integrations", self.base_url, org_id);
        self.get_authed(&url, jwt).await
    }

    pub async fn create_integration(
        &self,
        org_id: &OrgId,
        jwt: &str,
        body: &Value,
    ) -> Result<OrgIntegration, IntegrationsError> {
        let url = format!("{}/api/orgs/{}/integrations", self.base_url, org_id);
        self.post_authed(&url, jwt, body).await
    }

    pub async fn update_integration(
        &self,
        org_id: &OrgId,
        integration_id: &str,
        jwt: &str,
        body: &Value,
    ) -> Result<OrgIntegration, IntegrationsError> {
        let url = format!(
            "{}/api/orgs/{}/integrations/{}",
            self.base_url, org_id, integration_id
        );
        self.put_authed(&url, jwt, body).await
    }

    pub async fn delete_integration(
        &self,
        org_id: &OrgId,
        integration_id: &str,
        jwt: &str,
    ) -> Result<(), IntegrationsError> {
        let url = format!(
            "{}/api/orgs/{}/integrations/{}",
            self.base_url, org_id, integration_id
        );
        self.delete_authed(&url, jwt).await
    }

    // ── Internal API (X-Internal-Token) ──

    pub async fn get_integration_internal(
        &self,
        org_id: &OrgId,
        integration_id: &str,
    ) -> Result<OrgIntegration, IntegrationsError> {
        let url = format!(
            "{}/internal/orgs/{}/integrations/{}",
            self.base_url, org_id, integration_id
        );
        self.get_internal(&url).await
    }

    pub async fn list_integrations_internal(
        &self,
        org_id: &OrgId,
    ) -> Result<Vec<OrgIntegration>, IntegrationsError> {
        let url = format!("{}/internal/orgs/{}/integrations", self.base_url, org_id);
        self.get_internal(&url).await
    }

    pub async fn get_integration_secret(
        &self,
        org_id: &OrgId,
        integration_id: &str,
    ) -> Result<Option<String>, IntegrationsError> {
        let url = format!(
            "{}/internal/orgs/{}/integrations/{}/secret",
            self.base_url, org_id, integration_id
        );
        let resp: Value = self.get_internal(&url).await?;
        Ok(resp.get("secret").and_then(Value::as_str).map(String::from))
    }

    // ── HTTP helpers ──

    async fn get_authed<T: serde::de::DeserializeOwned>(
        &self,
        url: &str,
        jwt: &str,
    ) -> Result<T, IntegrationsError> {
        let mut last_err = None;
        for attempt in 0..=TRANSIENT_RETRY_COUNT {
            if attempt > 0 {
                tokio::time::sleep(TRANSIENT_RETRY_DELAY).await;
            }
            let resp = self.http.get(url).bearer_auth(jwt).send().await?;
            match self.handle_response(resp).await {
                Ok(v) => return Ok(v),
                Err(e) if e.is_transient() => {
                    warn!(%url, attempt, error = %e, "transient upstream error, retrying");
                    last_err = Some(e);
                }
                Err(e) => return Err(e),
            }
        }
        Err(last_err.unwrap())
    }

    async fn post_authed<T: serde::de::DeserializeOwned, B: serde::Serialize>(
        &self,
        url: &str,
        jwt: &str,
        body: &B,
    ) -> Result<T, IntegrationsError> {
        let mut last_err = None;
        for attempt in 0..=TRANSIENT_RETRY_COUNT {
            if attempt > 0 {
                tokio::time::sleep(TRANSIENT_RETRY_DELAY).await;
            }
            let resp = self
                .http
                .post(url)
                .bearer_auth(jwt)
                .json(body)
                .send()
                .await?;
            match self.handle_response(resp).await {
                Ok(v) => return Ok(v),
                Err(e) if e.is_transient() => {
                    warn!(%url, attempt, error = %e, "transient upstream error, retrying");
                    last_err = Some(e);
                }
                Err(e) => return Err(e),
            }
        }
        Err(last_err.unwrap())
    }

    async fn put_authed<T: serde::de::DeserializeOwned, B: serde::Serialize>(
        &self,
        url: &str,
        jwt: &str,
        body: &B,
    ) -> Result<T, IntegrationsError> {
        let mut last_err = None;
        for attempt in 0..=TRANSIENT_RETRY_COUNT {
            if attempt > 0 {
                tokio::time::sleep(TRANSIENT_RETRY_DELAY).await;
            }
            let resp = self
                .http
                .put(url)
                .bearer_auth(jwt)
                .json(body)
                .send()
                .await?;
            match self.handle_response(resp).await {
                Ok(v) => return Ok(v),
                Err(e) if e.is_transient() => {
                    warn!(%url, attempt, error = %e, "transient upstream error, retrying");
                    last_err = Some(e);
                }
                Err(e) => return Err(e),
            }
        }
        Err(last_err.unwrap())
    }

    async fn delete_authed(&self, url: &str, jwt: &str) -> Result<(), IntegrationsError> {
        let mut last_err = None;
        for attempt in 0..=TRANSIENT_RETRY_COUNT {
            if attempt > 0 {
                tokio::time::sleep(TRANSIENT_RETRY_DELAY).await;
            }
            let resp = self.http.delete(url).bearer_auth(jwt).send().await?;
            let status = resp.status();
            if status.is_success() {
                return Ok(());
            }
            let body = resp.text().await.unwrap_or_default();
            let err = IntegrationsError::Server {
                status: status.as_u16(),
                body,
            };
            if err.is_transient() {
                warn!(%url, attempt, error = %err, "transient upstream error, retrying");
                last_err = Some(err);
            } else {
                return Err(err);
            }
        }
        Err(last_err.unwrap())
    }

    async fn get_internal<T: serde::de::DeserializeOwned>(
        &self,
        url: &str,
    ) -> Result<T, IntegrationsError> {
        let mut last_err = None;
        for attempt in 0..=TRANSIENT_RETRY_COUNT {
            if attempt > 0 {
                tokio::time::sleep(TRANSIENT_RETRY_DELAY).await;
            }
            let resp = self
                .http
                .get(url)
                .header("x-internal-token", &self.internal_token)
                .send()
                .await?;
            match self.handle_response(resp).await {
                Ok(v) => return Ok(v),
                Err(e) if e.is_transient() => {
                    warn!(%url, attempt, error = %e, "transient upstream error, retrying");
                    last_err = Some(e);
                }
                Err(e) => return Err(e),
            }
        }
        Err(last_err.unwrap())
    }

    async fn handle_response<T: serde::de::DeserializeOwned>(
        &self,
        resp: reqwest::Response,
    ) -> Result<T, IntegrationsError> {
        let url = resp.url().to_string();
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(IntegrationsError::Server {
                status: status.as_u16(),
                body,
            });
        }
        let body = resp
            .text()
            .await
            .map_err(|e| IntegrationsError::Deserialize(e.to_string()))?;
        serde_json::from_str::<T>(&body).map_err(|e| {
            let preview: String = body.chars().take(200).collect();
            warn!(%url, error = %e, body_preview = %preview, "Deserialization failed");
            IntegrationsError::Deserialize(e.to_string())
        })
    }
}
