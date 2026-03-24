use async_trait::async_trait;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use tracing::info;

use crate::harness::{HarnessLink, HarnessSession, SessionConfig};
use crate::ws_bridge::spawn_ws_bridge;

#[derive(Debug, Clone)]
pub struct SwarmHarness {
    base_url: String,
    client: reqwest::Client,
}

impl SwarmHarness {
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
            .connect_timeout(std::time::Duration::from_secs(10))
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .expect("failed to build HTTP client");

        Self { base_url, client }
    }

    pub fn from_env() -> Self {
        let base_url =
            std::env::var("SWARM_BASE_URL").unwrap_or_else(|_| "http://localhost:8080".to_string());
        let auth_token = std::env::var("SWARM_AUTH_TOKEN").ok();
        Self::new(base_url, auth_token)
    }

    fn ws_base_url(&self) -> String {
        self.base_url
            .replace("https://", "wss://")
            .replace("http://", "ws://")
    }
}

#[derive(serde::Deserialize)]
struct CreateAgentResponse {
    id: String,
}

#[derive(serde::Deserialize)]
struct CreateSessionResponse {
    session_id: String,
    ws_url: String,
}

#[async_trait]
impl HarnessLink for SwarmHarness {
    async fn open_session(&self, config: SessionConfig) -> anyhow::Result<HarnessSession> {
        // 1. Create or reuse agent
        let agent_body = serde_json::json!({
            "name": config.agent_id.as_deref().unwrap_or("default"),
            "system_prompt": config.system_prompt,
        });
        let agent_resp: CreateAgentResponse = self
            .client
            .post(format!("{}/v1/agents", self.base_url))
            .json(&agent_body)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        let agent_id = &agent_resp.id;

        // 2. Create session
        let session_body = serde_json::json!({
            "model": config.model,
            "max_tokens": config.max_tokens,
            "max_turns": config.max_turns,
            "workspace": config.workspace,
        });
        let session_resp: CreateSessionResponse = self
            .client
            .post(format!("{}/v1/agents/{agent_id}/sessions", self.base_url))
            .json(&session_body)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;

        info!(
            session_id = %session_resp.session_id,
            "Swarm session created"
        );

        // 3. Open WebSocket
        let ws_url = format!("{}/{}", self.ws_base_url(), session_resp.ws_url.trim_start_matches('/'));
        let (ws_stream, _) = tokio_tungstenite::connect_async(&ws_url).await?;

        // 4. Spawn bridge
        let (events_tx, commands_tx) = spawn_ws_bridge(ws_stream);

        Ok(HarnessSession {
            session_id: session_resp.session_id,
            events_tx,
            commands_tx,
        })
    }

    async fn close_session(&self, session_id: &str) -> anyhow::Result<()> {
        self.client
            .delete(format!("{}/v1/sessions/{session_id}", self.base_url))
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }
}
