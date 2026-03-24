use async_trait::async_trait;
use tracing::info;

use aura_protocol::{InboundMessage, OutboundMessage, SessionInit};
use crate::harness::{HarnessLink, HarnessSession, SessionConfig};
use crate::ws_bridge::spawn_ws_bridge;

#[derive(Debug, Clone)]
pub struct LocalHarness {
    base_url: String,
}

impl LocalHarness {
    pub fn new(base_url: String) -> Self {
        Self { base_url }
    }

    pub fn from_env() -> Self {
        let base_url = std::env::var("LOCAL_HARNESS_URL")
            .unwrap_or_else(|_| "http://localhost:8080".to_string());
        Self::new(base_url)
    }

    fn ws_url(&self) -> String {
        let base = self
            .base_url
            .replace("https://", "wss://")
            .replace("http://", "ws://");
        format!("{base}/stream")
    }
}

#[async_trait]
impl HarnessLink for LocalHarness {
    async fn open_session(&self, config: SessionConfig) -> anyhow::Result<HarnessSession> {
        let (ws_stream, _) = tokio_tungstenite::connect_async(&self.ws_url()).await?;

        let (events_tx, raw_events_tx, commands_tx) = spawn_ws_bridge(ws_stream);

        commands_tx.send(InboundMessage::SessionInit(SessionInit {
            system_prompt: config.system_prompt,
            model: config.model,
            max_tokens: config.max_tokens,
            temperature: None,
            max_turns: config.max_turns,
            installed_tools: None,
            workspace: config.workspace,
            project_path: config.project_path,
            token: config.token,
            project_id: config.project_id,
            conversation_messages: config.conversation_messages,
        }))?;

        let mut rx = events_tx.subscribe();
        let session_id = loop {
            match rx.recv().await {
                Ok(OutboundMessage::SessionReady(ready)) => {
                    break ready.session_id;
                }
                Ok(OutboundMessage::Error(err)) => {
                    anyhow::bail!(
                        "Harness error during init ({}): {}",
                        err.code,
                        err.message
                    );
                }
                Err(_) => {
                    anyhow::bail!("Connection closed before session_ready");
                }
                _ => continue,
            }
        };

        info!(%session_id, "Local harness session ready");

        Ok(HarnessSession {
            session_id,
            events_tx,
            raw_events_tx,
            commands_tx,
        })
    }

    async fn close_session(&self, _session_id: &str) -> anyhow::Result<()> {
        Ok(())
    }
}
