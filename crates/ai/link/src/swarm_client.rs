//! HTTP client for the Swarm automaton management API.

use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};

use crate::swarm_types::{
    AutomatonEvent, AutomatonInfo, AutomatonStatus, InstallRequest, InstallResponse,
};

/// Thin HTTP client that talks to the Swarm service.
///
/// All methods map 1-to-1 to REST endpoints on the swarm daemon.
#[derive(Debug, Clone)]
pub struct SwarmClient {
    base_url: String,
    auth_token: Option<String>,
    client: reqwest::Client,
}

impl SwarmClient {
    /// Create a new client pointing at `base_url` (e.g. `http://localhost:9800`).
    pub fn new(base_url: String, auth_token: Option<String>) -> Self {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        if let Some(ref token) = auth_token {
            if let Ok(val) = HeaderValue::from_str(&format!("Bearer {token}")) {
                headers.insert(AUTHORIZATION, val);
            }
        }

        let client = reqwest::Client::builder()
            .default_headers(headers)
            .build()
            .expect("failed to build reqwest client");

        Self {
            base_url,
            auth_token,
            client,
        }
    }

    /// Build from environment variables.
    ///
    /// | Variable             | Default                    |
    /// |----------------------|----------------------------|
    /// | `SWARM_BASE_URL`     | `http://localhost:9800`    |
    /// | `SWARM_AUTH_TOKEN`   | `None`                     |
    pub fn from_env() -> Self {
        let base_url = std::env::var("SWARM_BASE_URL")
            .unwrap_or_else(|_| "http://localhost:9800".to_string());
        let auth_token = std::env::var("SWARM_AUTH_TOKEN").ok();
        Self::new(base_url, auth_token)
    }

    /// Install a new automaton of the given `kind` with `config`.
    pub async fn install(
        &self,
        kind: &str,
        config: serde_json::Value,
    ) -> anyhow::Result<InstallResponse> {
        let body = InstallRequest {
            kind: kind.to_string(),
            config,
        };
        let resp = self
            .client
            .post(format!("{}/automatons", self.base_url))
            .json(&body)
            .send()
            .await?
            .error_for_status()?;
        Ok(resp.json().await?)
    }

    /// Stop and remove an automaton.
    pub async fn stop(&self, automaton_id: &str) -> anyhow::Result<()> {
        self.client
            .delete(format!("{}/automatons/{automaton_id}", self.base_url))
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }

    /// Pause a running automaton.
    pub async fn pause(&self, automaton_id: &str) -> anyhow::Result<()> {
        self.client
            .post(format!(
                "{}/automatons/{automaton_id}/pause",
                self.base_url
            ))
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }

    /// Resume a paused automaton.
    pub async fn resume(&self, automaton_id: &str) -> anyhow::Result<()> {
        self.client
            .post(format!(
                "{}/automatons/{automaton_id}/resume",
                self.base_url
            ))
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }

    /// Send a trigger payload to an automaton.
    pub async fn trigger(
        &self,
        automaton_id: &str,
        payload: serde_json::Value,
    ) -> anyhow::Result<()> {
        self.client
            .post(format!(
                "{}/automatons/{automaton_id}/trigger",
                self.base_url
            ))
            .json(&payload)
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }

    /// Get the current status of an automaton.
    pub async fn status(&self, automaton_id: &str) -> anyhow::Result<AutomatonStatus> {
        let resp = self
            .client
            .get(format!("{}/automatons/{automaton_id}", self.base_url))
            .send()
            .await?
            .error_for_status()?;
        Ok(resp.json().await?)
    }

    /// List all automatons.
    pub async fn list(&self) -> anyhow::Result<Vec<AutomatonInfo>> {
        let resp = self
            .client
            .get(format!("{}/automatons", self.base_url))
            .send()
            .await?
            .error_for_status()?;
        Ok(resp.json().await?)
    }

    /// Open a Server-Sent Events stream for an automaton.
    ///
    /// Returns a receiver that yields [`AutomatonEvent`]s. The background task
    /// closes automatically when the receiver is dropped or the server closes
    /// the connection.
    pub async fn events(
        &self,
        automaton_id: &str,
    ) -> anyhow::Result<tokio::sync::mpsc::UnboundedReceiver<AutomatonEvent>> {
        use futures_core::Stream;
        use tokio::io::AsyncBufReadExt;

        let resp = self
            .client
            .get(format!(
                "{}/automatons/{automaton_id}/events",
                self.base_url
            ))
            .header("Accept", "text/event-stream")
            .send()
            .await?
            .error_for_status()?;

        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();

        let io_stream: std::pin::Pin<
            Box<dyn Stream<Item = Result<bytes::Bytes, std::io::Error>> + Send>,
        > = Box::pin(futures_util::StreamExt::map(
            resp.bytes_stream(),
            |r| r.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e)),
        ));
        let reader = tokio::io::BufReader::new(tokio_util::io::StreamReader::new(io_stream));
        let mut lines = reader.lines();

        tokio::spawn(async move {
            let mut data_buf = String::new();

            while let Ok(Some(line)) = lines.next_line().await {
                if let Some(value) = line.strip_prefix("data: ") {
                    data_buf.push_str(value);
                } else if line.is_empty() && !data_buf.is_empty() {
                    if let Ok(event) = serde_json::from_str::<AutomatonEvent>(&data_buf) {
                        if tx.send(event).is_err() {
                            break;
                        }
                    }
                    data_buf.clear();
                }
            }
        });

        Ok(rx)
    }

    /// Returns the base URL this client was configured with.
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// Returns the auth token, if one was configured.
    pub fn auth_token(&self) -> Option<&str> {
        self.auth_token.as_deref()
    }
}
