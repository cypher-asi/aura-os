//! Thin HTTP wrapper for the z-billing service.
//!
//! Sub-modules:
//!
//! * [`account`] — billing account lookup + auto-provisioning.
//! * [`credits`] — credit balance, purchase checkout, transaction
//!   history, and the `ensure_has_credits` gate.

mod account;
mod credits;
mod usage;

pub use usage::{LlmUsageQuote, UsageQuoteResponse};

use std::time::Duration;

use reqwest::{Client, Method};
use tracing::warn;

use crate::error::BillingError;

#[derive(Clone)]
pub struct BillingClient {
    http: Client,
    base_url: String,
    service_api_key: Option<String>,
    service_name: String,
}

impl BillingClient {
    pub fn new() -> Self {
        let base_url = std::env::var("Z_BILLING_URL")
            .unwrap_or_else(|_| "https://z-billing.onrender.com".to_string());
        Self::build(base_url)
    }

    pub fn with_base_url(base_url: String) -> Self {
        Self::build(base_url)
    }

    fn build(base_url: String) -> Self {
        Self {
            http: Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(60))
                .build()
                .expect("failed to build billing http client"),
            base_url,
            service_api_key: std::env::var("Z_BILLING_API_KEY")
                .ok()
                .filter(|key| !key.trim().is_empty()),
            service_name: "aura-os-server".to_string(),
        }
    }

    #[cfg(any(test, feature = "test-utils"))]
    pub fn with_base_url_and_api_key(base_url: String, api_key: String) -> Self {
        let mut client = Self::build(base_url);
        client.service_api_key = Some(api_key);
        client
    }

    pub(super) async fn send_authed_json(
        &self,
        method: Method,
        path: &str,
        access_token: &str,
        body: Option<serde_json::Value>,
    ) -> Result<reqwest::Response, BillingError> {
        let url = format!("{}{}", self.base_url, path);
        let mut req = self
            .http
            .request(method, &url)
            .header("authorization", format!("Bearer {access_token}"));
        if let Some(body) = body {
            req = req.json(&body);
        }
        req.send().await.map_err(BillingError::from)
    }

    pub(super) async fn json_or_server_error<T: serde::de::DeserializeOwned>(
        &self,
        resp: reqwest::Response,
        error_context: &str,
    ) -> Result<T, BillingError> {
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            warn!(status = status.as_u16(), %body, "{error_context}");
            return Err(BillingError::ServerError {
                status: status.as_u16(),
                body,
            });
        }
        resp.json()
            .await
            .map_err(|e| BillingError::Deserialize(e.to_string()))
    }

    pub(super) async fn send_service_json(
        &self,
        method: Method,
        path: &str,
        body: serde_json::Value,
    ) -> Result<reqwest::Response, BillingError> {
        let Some(api_key) = self.service_api_key.as_deref() else {
            return Err(BillingError::ServiceApiKeyNotConfigured);
        };
        let url = format!("{}{}", self.base_url, path);
        self.http
            .request(method, &url)
            .header("x-api-key", api_key)
            .header("x-service-name", &self.service_name)
            .json(&body)
            .send()
            .await
            .map_err(BillingError::from)
    }
}

impl Default for BillingClient {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests;
