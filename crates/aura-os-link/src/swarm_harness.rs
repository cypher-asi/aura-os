use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use anyhow::Context;
use async_trait::async_trait;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tracing::{info, warn};

use aura_protocol::{InboundMessage, SessionInit};

use crate::harness::{HarnessLink, HarnessSession, SessionConfig};
use crate::ws_bridge::spawn_ws_bridge;

const AGENT_READY_POLL_INTERVAL: Duration = Duration::from_secs(2);
const AGENT_READY_TIMEOUT: Duration = Duration::from_secs(90);

#[derive(Debug, Clone)]
pub struct SwarmHarness {
    base_url: String,
    /// Optional fallback auth token injected by the caller. Per-request tokens
    /// from `SessionConfig.token` take priority when available.
    auth_token: Option<String>,
    client: reqwest::Client,
    session_tokens: Arc<Mutex<HashMap<String, String>>>,
}

impl SwarmHarness {
    pub fn new(base_url: String, auth_token: Option<String>) -> Self {
        let client = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(10))
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .expect("failed to build HTTP client");

        Self {
            base_url,
            auth_token,
            client,
            session_tokens: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn from_env() -> Self {
        let base_url = std::env::var("SWARM_BASE_URL").unwrap_or_default();
        Self::new(base_url, None)
    }

    fn configured_base_url(&self) -> anyhow::Result<&str> {
        let base_url = self.base_url.trim();
        if base_url.is_empty() {
            anyhow::bail!("swarm gateway is not configured (SWARM_BASE_URL)");
        }
        Ok(base_url.trim_end_matches('/'))
    }

    fn ws_base_url(&self) -> anyhow::Result<String> {
        Ok(self
            .configured_base_url()?
            .replace("https://", "wss://")
            .replace("http://", "ws://"))
    }

    async fn wait_for_agent_ready(
        &self,
        agent_id: &str,
        token: Option<&str>,
    ) -> anyhow::Result<()> {
        let headers = self.bearer_headers(token);
        let url = format!("{}/v1/agents/{agent_id}/state", self.configured_base_url()?);
        let deadline = tokio::time::Instant::now() + AGENT_READY_TIMEOUT;

        loop {
            tokio::time::sleep(AGENT_READY_POLL_INTERVAL).await;

            if tokio::time::Instant::now() >= deadline {
                anyhow::bail!(
                    "agent {agent_id} did not become ready within {}s",
                    AGENT_READY_TIMEOUT.as_secs()
                );
            }

            let resp = self.client.get(&url).headers(headers.clone()).send().await;

            match resp {
                Ok(r) if r.status().is_success() => {
                    if let Ok(state) = r.json::<AgentStateResponse>().await {
                        match state.state.as_str() {
                            "running" | "idle" => return Ok(()),
                            "error" => {
                                anyhow::bail!("agent {agent_id} entered error state");
                            }
                            other => {
                                info!(agent_id = %agent_id, state = %other, "Waiting for agent...");
                            }
                        }
                    }
                }
                Ok(r) => {
                    warn!(agent_id = %agent_id, status = %r.status(), "Agent state check failed");
                }
                Err(e) => {
                    warn!(agent_id = %agent_id, error = %e, "Agent state poll error");
                }
            }
        }
    }

    fn bearer_headers(&self, token: Option<&str>) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        if let Some(t) = token {
            if let Ok(val) = HeaderValue::from_str(&format!("Bearer {t}")) {
                headers.insert(AUTHORIZATION, val);
            }
        }
        headers
    }
}

#[derive(serde::Deserialize)]
pub struct CreateAgentResponse {
    pub agent_id: String,
    pub status: String,
    #[serde(default)]
    pub pod_id: Option<String>,
}

#[derive(serde::Deserialize)]
struct AgentStateResponse {
    state: String,
}

#[derive(serde::Deserialize)]
struct CreateSessionResponse {
    session_id: String,
    ws_url: String,
}

#[async_trait]
impl HarnessLink for SwarmHarness {
    async fn open_session(&self, config: SessionConfig) -> anyhow::Result<HarnessSession> {
        let base_url = self.configured_base_url()?.to_string();
        let token = config.token.as_deref().or(self.auth_token.as_deref());
        let headers = self.bearer_headers(token);

        // 1. Create agent (idempotent when agent_id is supplied for ID parity).
        //    Use the explicit agent_name when provided; fall back to agent_id
        //    so existing callers that only set agent_id keep working.
        let agent_display_name = config
            .agent_name
            .as_deref()
            .or(config.agent_id.as_deref())
            .unwrap_or("default");
        let mut agent_body = serde_json::json!({
            "name": agent_display_name,
        });
        if let Some(ref aid) = config.agent_id {
            agent_body["agent_id"] = serde_json::Value::String(aid.clone());
        }

        let agent_response = self
            .client
            .post(format!("{base_url}/v1/agents"))
            .headers(headers.clone())
            .json(&agent_body)
            .send()
            .await
            .context("swarm create agent request failed")?;
        let agent_status = agent_response.status();
        let agent_body_text = agent_response.text().await?;
        if !agent_status.is_success() {
            anyhow::bail!(
                "swarm create agent failed with {}: {}",
                agent_status,
                agent_body_text
            );
        }
        let agent_resp: CreateAgentResponse = serde_json::from_str(&agent_body_text)?;
        let agent_id = &agent_resp.agent_id;

        // 2. Wait for agent to reach a runnable state before creating session
        let is_ready = matches!(agent_resp.status.as_str(), "running" | "idle");

        if !is_ready {
            info!(
                agent_id = %agent_id,
                status = %agent_resp.status,
                "Agent not ready, waiting for provisioning..."
            );
            self.wait_for_agent_ready(agent_id, token)
                .await
                .context("swarm agent readiness check failed")?;
        }

        info!(agent_id = %agent_id, "Swarm agent ready");

        // 3. Create session (config envelope matches gateway contract)
        let session_body = serde_json::json!({
            "config": {
                "system_prompt": config.system_prompt,
                "model": config.model,
                "max_tokens": config.max_tokens,
                "max_turns": config.max_turns,
            }
        });

        let session_response = self
            .client
            .post(format!("{base_url}/v1/agents/{agent_id}/sessions"))
            .headers(headers.clone())
            .json(&session_body)
            .send()
            .await
            .context("swarm create session request failed")?;
        let session_status = session_response.status();
        let session_body_text = session_response.text().await?;
        if !session_status.is_success() {
            anyhow::bail!(
                "swarm create session failed with {}: {}",
                session_status,
                session_body_text
            );
        }
        let session_resp: CreateSessionResponse = serde_json::from_str(&session_body_text)?;
        if let Some(t) = token {
            self.session_tokens
                .lock()
                .await
                .insert(session_resp.session_id.clone(), t.to_string());
        }

        info!(
            session_id = %session_resp.session_id,
            agent_id = %agent_id,
            "Swarm session created"
        );

        // 4. Open WebSocket with bearer auth on the upgrade request
        let ws_url = format!(
            "{}/{}",
            self.ws_base_url()?,
            session_resp.ws_url.trim_start_matches('/')
        );

        let mut ws_request = ws_url
            .into_client_request()
            .context("swarm websocket request build failed")?;
        if let Some(t) = token {
            ws_request.headers_mut().insert(
                "Authorization",
                format!("Bearer {t}").parse().map_err(|e| {
                    anyhow::anyhow!("swarm websocket auth header build failed: {e}")
                })?,
            );
        }

        let (ws_stream, _) = tokio_tungstenite::connect_async(ws_request)
            .await
            .context("swarm websocket connect failed")?;

        // 5. Spawn bridge and send session_init (required by harness protocol)
        let (events_tx, raw_events_tx, commands_tx) = spawn_ws_bridge(ws_stream);

        commands_tx
            .send(InboundMessage::SessionInit(Box::new(SessionInit {
                system_prompt: config.system_prompt,
                model: config.model,
                max_tokens: config.max_tokens,
                temperature: None,
                max_turns: config.max_turns,
                installed_tools: config.installed_tools,
                installed_integrations: config.installed_integrations,
                workspace: config.workspace,
                project_path: config.project_path,
                token: config.token,
                project_id: config.project_id,
                conversation_messages: config.conversation_messages,
                aura_agent_id: config.agent_id.clone(),
                aura_session_id: config.aura_session_id,
                aura_org_id: config.aura_org_id,
                agent_id: config.agent_id,
                provider_config: config.provider_config,
            })))
            .context("swarm session_init send failed")?;

        Ok(HarnessSession {
            session_id: session_resp.session_id,
            events_tx,
            raw_events_tx,
            commands_tx,
        })
    }

    async fn close_session(&self, session_id: &str) -> anyhow::Result<()> {
        let base_url = self.configured_base_url()?.to_string();
        let token = self
            .session_tokens
            .lock()
            .await
            .remove(session_id)
            .or_else(|| self.auth_token.clone());
        let headers = self.bearer_headers(token.as_deref());

        self.client
            .delete(format!("{base_url}/v1/sessions/{session_id}"))
            .headers(headers)
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }
}
