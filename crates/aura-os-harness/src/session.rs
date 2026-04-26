//! Thin session bridge for opening a harness stream and sending a turn.

use tokio::sync::broadcast;

use crate::error::HarnessError;
use crate::{
    HarnessCommandSender, HarnessInbound, HarnessLink, HarnessOutbound, HarnessSession,
    MessageAttachment, SessionConfig, UserMessage,
};

/// User turn payload sent through a harness session.
#[derive(Debug, Clone)]
pub struct SessionBridgeTurn {
    pub content: String,
    pub tool_hints: Option<Vec<String>>,
    pub attachments: Option<Vec<MessageAttachment>>,
}

impl SessionBridgeTurn {
    #[must_use]
    pub fn user_message(self) -> UserMessage {
        UserMessage {
            content: self.content,
            tool_hints: self.tool_hints,
            attachments: self.attachments,
        }
    }
}

/// Newly opened harness session plus the handles server chat needs.
pub struct SessionBridgeStarted {
    pub session: HarnessSession,
    pub events_rx: broadcast::Receiver<HarnessOutbound>,
    pub commands_tx: HarnessCommandSender,
}

#[derive(Debug, thiserror::Error)]
pub enum SessionBridgeError {
    #[error("opening harness session failed: {0}")]
    Open(String),
    #[error("sending harness message failed: {0}")]
    Send(String),
    /// Upstream harness rejected the new session because all WS
    /// slots in its per-process semaphore are in use. Surfaced from
    /// either [`crate::SwarmHarness::open_session`] (HTTP 503) or
    /// [`crate::LocalHarness::open_session`] (tungstenite 503 / WS
    /// 1013) via [`HarnessError::CapacityExhausted`]. The server side
    /// maps this to `ApiError::harness_capacity_exhausted` using its
    /// configured `AURA_HARNESS_WS_SLOTS` value (Phase 6 of the
    /// robust-concurrent-agent-infra plan). The original anyhow chain
    /// is preserved as a `Display` string for log fidelity.
    #[error("harness rejected new session: WS slot capacity exhausted ({0})")]
    CapacityExhausted(String),
}

/// Delegates the open-session + first-user-message sequence to aura-harness.
pub struct SessionBridge;

impl SessionBridge {
    pub async fn open_and_send_user_message(
        harness: &dyn HarnessLink,
        config: SessionConfig,
        turn: SessionBridgeTurn,
    ) -> Result<SessionBridgeStarted, SessionBridgeError> {
        tracing::info!(
            target: "aura_os_harness::session",
            harness_agent_id = ?config.agent_id,
            template_agent_id = ?config.template_agent_id,
            aura_session_id = ?config.aura_session_id,
            aura_org_id = ?config.aura_org_id,
            "opening harness session",
        );
        let session = harness.open_session(config).await.map_err(|err| {
            if HarnessError::is_capacity_exhausted(&err) {
                SessionBridgeError::CapacityExhausted(err.to_string())
            } else {
                SessionBridgeError::Open(err.to_string())
            }
        })?;
        let events_rx = session.events_tx.subscribe();
        let commands_tx = session.commands_tx.clone();
        Self::send_user_message(&commands_tx, turn)?;
        Ok(SessionBridgeStarted {
            session,
            events_rx,
            commands_tx,
        })
    }

    pub fn send_user_message(
        commands_tx: &HarnessCommandSender,
        turn: SessionBridgeTurn,
    ) -> Result<(), SessionBridgeError> {
        commands_tx
            .try_send(HarnessInbound::UserMessage(turn.user_message()))
            .map_err(|err| SessionBridgeError::Send(err.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use async_trait::async_trait;
    use tokio::sync::{broadcast, mpsc};

    use super::*;

    #[derive(Default)]
    struct FakeHarnessLink {
        commands_rx: Arc<Mutex<Option<mpsc::Receiver<HarnessInbound>>>>,
    }

    #[async_trait]
    impl HarnessLink for FakeHarnessLink {
        async fn open_session(&self, _config: SessionConfig) -> anyhow::Result<HarnessSession> {
            let (events_tx, _) = broadcast::channel(8);
            let (raw_events_tx, _) = broadcast::channel(8);
            let (commands_tx, commands_rx) = mpsc::channel(8);
            *self.commands_rx.lock().expect("commands receiver lock") = Some(commands_rx);
            Ok(HarnessSession {
                session_id: "session-1".to_string(),
                events_tx,
                raw_events_tx,
                commands_tx,
            })
        }

        async fn close_session(&self, _session_id: &str) -> anyhow::Result<()> {
            Ok(())
        }
    }

    #[tokio::test]
    async fn open_and_send_user_message_posts_first_turn() {
        let harness = FakeHarnessLink::default();
        let started = SessionBridge::open_and_send_user_message(
            &harness,
            SessionConfig::default(),
            SessionBridgeTurn {
                content: "hello".to_string(),
                tool_hints: None,
                attachments: None,
            },
        )
        .await
        .expect("bridge should start session");

        assert_eq!(started.session.session_id, "session-1");
        let mut rx = harness
            .commands_rx
            .lock()
            .expect("commands receiver lock")
            .take()
            .expect("commands receiver");
        match rx.recv().await.expect("first command") {
            HarnessInbound::UserMessage(message) => assert_eq!(message.content, "hello"),
            other => panic!("unexpected command: {other:?}"),
        }
    }
}
