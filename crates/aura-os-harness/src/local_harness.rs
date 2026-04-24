use anyhow::Context;
use async_trait::async_trait;
use tracing::info;

use crate::harness::{build_session_init, HarnessLink, HarnessSession, SessionConfig};
use crate::harness_url::local_harness_base_url;
use crate::ws_bridge::spawn_ws_bridge;
use aura_protocol::{InboundMessage, OutboundMessage};

#[derive(Debug, Clone)]
pub struct LocalHarness {
    base_url: String,
}

impl LocalHarness {
    pub fn new(base_url: String) -> Self {
        Self { base_url }
    }

    pub fn from_env() -> Self {
        Self::new(local_harness_base_url())
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
        let (ws_stream, _) = tokio_tungstenite::connect_async(&self.ws_url())
            .await
            .context("local harness websocket connect failed")?;

        let (events_tx, raw_events_tx, commands_tx) = spawn_ws_bridge(ws_stream);

        commands_tx
            .send(InboundMessage::SessionInit(Box::new(build_session_init(
                &config,
            ))))
            .context("local harness session_init send failed")?;

        let mut rx = events_tx.subscribe();
        let session_id = loop {
            match rx.recv().await {
                Ok(OutboundMessage::SessionReady(ready)) => {
                    break ready.session_id;
                }
                Ok(OutboundMessage::Error(err)) => {
                    anyhow::bail!("Harness error during init ({}): {}", err.code, err.message);
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
