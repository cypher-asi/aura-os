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

use std::{net::IpAddr, time::Duration};

use reqwest::{Client, Method, Url};
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
        let url = self.service_url(path)?;
        self.http
            .request(method, url)
            .header("x-api-key", api_key)
            .header("x-service-name", &self.service_name)
            .json(&body)
            .send()
            .await
            .map_err(BillingError::from)
    }

    fn service_url(&self, path: &str) -> Result<Url, BillingError> {
        let mut base_url = self.base_url.trim_end_matches('/').to_string();
        base_url.push('/');
        let base = Url::parse(&base_url)
            .map_err(|error| BillingError::InvalidServiceUrl(error.to_string()))?;
        validate_service_base_url(&base)?;
        base.join(path.trim_start_matches('/'))
            .map_err(|error| BillingError::InvalidServiceUrl(error.to_string()))
    }
}

impl Default for BillingClient {
    fn default() -> Self {
        Self::new()
    }
}

fn validate_service_base_url(url: &Url) -> Result<(), BillingError> {
    if url.username() != "" || url.password().is_some() {
        return Err(BillingError::InsecureServiceUrl);
    }

    if url.scheme() == "https" && is_public_host(url) {
        return Ok(());
    }

    #[cfg(any(test, feature = "test-utils", debug_assertions))]
    if url.scheme() == "http" && is_loopback_host(url) {
        return Ok(());
    }

    Err(BillingError::InsecureServiceUrl)
}

fn is_public_host(url: &Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    if let Ok(addr) = host.parse::<IpAddr>() {
        return match addr {
            IpAddr::V4(addr) => {
                !(addr.is_private()
                    || addr.is_loopback()
                    || addr.is_link_local()
                    || addr.is_broadcast()
                    || addr.is_unspecified())
            }
            IpAddr::V6(addr) => !(addr.is_loopback() || addr.is_unspecified()),
        };
    }

    let normalized = host.trim_end_matches('.').to_ascii_lowercase();
    !matches!(normalized.as_str(), "localhost" | "localhost.localdomain")
}

#[cfg(any(test, feature = "test-utils", debug_assertions))]
fn is_loopback_host(url: &Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    if let Ok(addr) = host.parse::<IpAddr>() {
        match addr {
            IpAddr::V4(addr) => addr.is_loopback(),
            IpAddr::V6(addr) => addr.is_loopback(),
        }
    } else {
        host.eq_ignore_ascii_case("localhost")
    }
}

#[cfg(test)]
mod tests;
