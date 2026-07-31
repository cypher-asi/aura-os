mod events;
mod logs;
mod notes;
mod processes;
mod project_agents;
mod project_artifacts;
mod sessions;
mod skills;
mod specs;
mod stats;
mod tasks;

use std::env;

use reqwest::Client;
use tracing::info;

use crate::error::StorageError;

/// Validate that a string ID is safe to interpolate into a URL path.
/// Accepts UUID format (hex digits and hyphens) to prevent path traversal or injection.
pub(crate) fn validate_url_id(id: &str, label: &str) -> Result<(), StorageError> {
    if id.is_empty() {
        return Err(StorageError::Validation(format!("{label} is empty")));
    }
    let valid = id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if !valid {
        return Err(StorageError::Validation(format!(
            "{label} contains invalid characters: {id}"
        )));
    }
    Ok(())
}

/// Validate a public share token before interpolating it into a URL
/// path. Share tokens have the shape `t_<32 lowercase hex>` (a v4 UUID
/// with its dashes stripped, e.g.
/// `t_6a1e3d8f6e548191948c1f0a9c68cbda`). The general
/// [`validate_url_id`] rejects the `_` separator, so the by-share read
/// path needs this dedicated check. Enforces `^t_[0-9a-f]{32}$` with a
/// manual scan (no regex dependency). The token is a capability secret,
/// so it is never echoed into the error message.
pub(crate) fn validate_share_token(token: &str, label: &str) -> Result<(), StorageError> {
    let bytes = token.as_bytes();
    let valid = bytes.len() == 34
        && bytes[0] == b't'
        && bytes[1] == b'_'
        && bytes[2..]
            .iter()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'));
    if !valid {
        return Err(StorageError::Validation(format!(
            "{label} is not a valid share token"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod share_token_tests {
    use super::validate_share_token;

    #[test]
    fn accepts_canonical_share_token() {
        assert!(validate_share_token("t_6a1e3d8f6e548191948c1f0a9c68cbda", "token").is_ok());
    }

    #[test]
    fn rejects_bare_uuid() {
        assert!(validate_share_token("6a1e3d8f-6e54-8191-948c-1f0a9c68cbda", "token").is_err());
        assert!(validate_share_token("6a1e3d8f6e548191948c1f0a9c68cbda", "token").is_err());
    }

    #[test]
    fn rejects_empty() {
        assert!(validate_share_token("", "token").is_err());
    }

    #[test]
    fn rejects_wrong_length() {
        // 31 hex chars (one short) and 33 hex chars (one long).
        assert!(validate_share_token("t_6a1e3d8f6e548191948c1f0a9c68cbd", "token").is_err());
        assert!(validate_share_token("t_6a1e3d8f6e548191948c1f0a9c68cbdaa", "token").is_err());
    }

    #[test]
    fn rejects_uppercase_hex() {
        assert!(validate_share_token("t_6A1E3D8F6E548191948C1F0A9C68CBDA", "token").is_err());
    }

    #[test]
    fn rejects_wrong_prefix() {
        assert!(validate_share_token("x_6a1e3d8f6e548191948c1f0a9c68cbda", "token").is_err());
    }
}

/// HTTP client for the aura-storage shared backend service.
///
/// Wraps `reqwest` with typed methods for each aura-storage API endpoint.
/// All authenticated requests accept a JWT token parameter forwarded as
/// `Authorization: Bearer <jwt>`.
#[derive(Clone)]
pub struct StorageClient {
    pub(crate) http: Client,
    pub(crate) base_url: String,
    pub(crate) internal_token: Option<String>,
}

impl StorageClient {
    /// Create a new `StorageClient`, reading `AURA_STORAGE_URL` from env.
    /// Returns `None` if the env var is not set or empty (storage integration disabled).
    pub fn from_env() -> Option<Self> {
        let base_url = env::var("AURA_STORAGE_URL")
            .ok()
            .filter(|s| !s.is_empty())?;

        let base_url = base_url.trim_end_matches('/').to_string();
        let internal_token = env::var("AURA_STORAGE_INTERNAL_TOKEN")
            .ok()
            .filter(|s| !s.is_empty());
        info!(%base_url, has_internal_token = internal_token.is_some(), "aura-storage client configured");

        Some(Self {
            http: Self::build_http_client(),
            base_url,
            internal_token,
        })
    }

    /// Create a client with an explicit base URL (e.g. for tests or custom deployment).
    pub fn with_base_url(base_url: &str) -> Self {
        Self {
            http: Self::build_http_client(),
            base_url: base_url.trim_end_matches('/').to_string(),
            internal_token: None,
        }
    }

    /// Create a client with base URL and internal token (for executor/scheduler).
    pub fn with_base_url_and_token(base_url: &str, internal_token: &str) -> Self {
        Self {
            http: Self::build_http_client(),
            base_url: base_url.trim_end_matches('/').to_string(),
            internal_token: Some(internal_token.to_string()),
        }
    }

    fn build_http_client() -> Client {
        Client::builder()
            .connect_timeout(std::time::Duration::from_secs(10))
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| Client::new())
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub fn has_internal_token(&self) -> bool {
        self.internal_token.is_some()
    }

    pub async fn health_check(&self) -> Result<(), StorageError> {
        let url = format!("{}/health", self.base_url);
        let resp = self.http.get(&url).send().await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(StorageError::Server {
                status: status.as_u16(),
                body,
            });
        }
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Internal HTTP helpers
    // -----------------------------------------------------------------------

    pub(crate) async fn get_authed<T: serde::de::DeserializeOwned>(
        &self,
        url: &str,
        jwt: &str,
    ) -> Result<T, StorageError> {
        let resp = self.http.get(url).bearer_auth(jwt).send().await?;
        self.handle_response(resp).await
    }

    pub(crate) async fn post_authed<T: serde::de::DeserializeOwned, B: serde::Serialize>(
        &self,
        url: &str,
        jwt: &str,
        body: &B,
    ) -> Result<T, StorageError> {
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
    ) -> Result<T, StorageError> {
        let resp = self
            .http
            .put(url)
            .bearer_auth(jwt)
            .json(body)
            .send()
            .await?;
        self.handle_response(resp).await
    }

    pub(crate) async fn put_authed_no_response<B: serde::Serialize>(
        &self,
        url: &str,
        jwt: &str,
        body: &B,
    ) -> Result<(), StorageError> {
        let resp = self
            .http
            .put(url)
            .bearer_auth(jwt)
            .json(body)
            .send()
            .await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(StorageError::Server {
                status: status.as_u16(),
                body,
            });
        }
        Ok(())
    }

    pub(crate) async fn delete_authed(&self, url: &str, jwt: &str) -> Result<(), StorageError> {
        let resp = self.http.delete(url).bearer_auth(jwt).send().await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(StorageError::Server {
                status: status.as_u16(),
                body,
            });
        }
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Internal HTTP helpers (X-Internal-Token auth)
    // -----------------------------------------------------------------------

    pub(crate) fn internal_token(&self) -> Result<&str, StorageError> {
        self.internal_token.as_deref().ok_or_else(|| {
            StorageError::Validation("AURA_STORAGE_INTERNAL_TOKEN not configured".into())
        })
    }

    pub(crate) async fn get_internal<T: serde::de::DeserializeOwned>(
        &self,
        url: &str,
    ) -> Result<T, StorageError> {
        let token = self.internal_token()?;
        let resp = self
            .http
            .get(url)
            .header("x-internal-token", token)
            .send()
            .await?;
        self.handle_response(resp).await
    }

    pub(crate) async fn post_internal<T: serde::de::DeserializeOwned, B: serde::Serialize>(
        &self,
        url: &str,
        body: &B,
    ) -> Result<T, StorageError> {
        let token = self.internal_token()?;
        let resp = self
            .http
            .post(url)
            .header("x-internal-token", token)
            .json(body)
            .send()
            .await?;
        self.handle_response(resp).await
    }

    pub(crate) async fn put_internal<T: serde::de::DeserializeOwned, B: serde::Serialize>(
        &self,
        url: &str,
        body: &B,
    ) -> Result<T, StorageError> {
        let token = self.internal_token()?;
        let resp = self
            .http
            .put(url)
            .header("x-internal-token", token)
            .json(body)
            .send()
            .await?;
        self.handle_response(resp).await
    }

    pub(crate) async fn handle_response<T: serde::de::DeserializeOwned>(
        &self,
        resp: reqwest::Response,
    ) -> Result<T, StorageError> {
        let url = resp.url().to_string();
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(StorageError::Server {
                status: status.as_u16(),
                body,
            });
        }
        let body = resp
            .text()
            .await
            .map_err(|e| StorageError::Deserialize(e.to_string()))?;
        serde_json::from_str::<T>(&body).map_err(|e| {
            let preview: String = body.chars().take(200).collect();
            tracing::warn!(%url, error = %e, body_preview = %preview, "Deserialization failed");
            StorageError::Deserialize(e.to_string())
        })
    }
}
