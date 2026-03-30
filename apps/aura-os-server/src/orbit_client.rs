use std::fmt;
use std::time::Duration;

use reqwest::Client;
use tracing::{debug, info, warn};

#[derive(Debug)]
pub enum OrbitError {
    Request(String),
    Response { status: u16, body: String },
}

impl fmt::Display for OrbitError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Request(msg) => write!(f, "orbit request failed: {msg}"),
            Self::Response { status, body } => {
                write!(f, "orbit returned {status}: {body}")
            }
        }
    }
}

impl std::error::Error for OrbitError {}

#[derive(Clone)]
pub struct OrbitClient {
    http: Client,
    base_url: String,
}

impl OrbitClient {
    pub fn from_env() -> Option<Self> {
        let base_url = std::env::var("ORBIT_BASE_URL")
            .ok()
            .filter(|s| !s.trim().is_empty())?;
        let base_url = base_url.trim_end_matches('/').to_string();
        info!(base_url = %base_url, "Orbit client configured");
        Some(Self {
            http: Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(30))
                .build()
                .expect("failed to build orbit http client"),
            base_url,
        })
    }

    /// Ensure a repository exists on Orbit, creating it if necessary.
    ///
    /// Calls `POST /v1/repos` with the user's JWT. Treats 409 (already exists)
    /// as success so the operation is idempotent.
    pub async fn ensure_repo(
        &self,
        name: &str,
        org_id: &str,
        jwt: &str,
    ) -> Result<(), OrbitError> {
        let url = format!("{}/v1/repos", self.base_url);
        debug!(%url, %name, %org_id, "Creating Orbit repo");

        let resp = self
            .http
            .post(&url)
            .header("authorization", format!("Bearer {jwt}"))
            .json(&serde_json::json!({
                "name": name,
                "org_id": org_id,
            }))
            .send()
            .await
            .map_err(|e| OrbitError::Request(e.to_string()))?;

        let status = resp.status();

        if status.as_u16() == 409 {
            info!(%name, %org_id, "Orbit repo already exists (409)");
            return Ok(());
        }

        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            warn!(
                status = status.as_u16(),
                %body, %name, %org_id,
                "Orbit repo creation failed"
            );
            return Err(OrbitError::Response {
                status: status.as_u16(),
                body,
            });
        }

        info!(%name, %org_id, "Orbit repo created");
        Ok(())
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }
}
