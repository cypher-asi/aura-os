//! Thin session bridge for opening a harness stream and sending a turn.

use tokio::sync::{broadcast, mpsc};

use aura_os_link::{
    HarnessInbound, HarnessLink, HarnessOutbound, HarnessSession, MessageAttachment, SessionConfig,
    UserMessage,
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
    pub commands_tx: mpsc::UnboundedSender<HarnessInbound>,
}

#[derive(Debug, thiserror::Error)]
pub enum SessionBridgeError {
    #[error("opening harness session failed: {0}")]
    Open(String),
    #[error("sending harness message failed: {0}")]
    Send(String),
}

/// Delegates the open-session + first-user-message sequence to aura-harness.
pub struct SessionBridge;

impl SessionBridge {
    pub async fn open_and_send_user_message(
        harness: &dyn HarnessLink,
        config: SessionConfig,
        turn: SessionBridgeTurn,
    ) -> Result<SessionBridgeStarted, SessionBridgeError> {
        let session = harness
            .open_session(config)
            .await
            .map_err(|err| SessionBridgeError::Open(err.to_string()))?;
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
        commands_tx: &mpsc::UnboundedSender<HarnessInbound>,
        turn: SessionBridgeTurn,
    ) -> Result<(), SessionBridgeError> {
        commands_tx
            .send(HarnessInbound::UserMessage(turn.user_message()))
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
        commands_rx: Arc<Mutex<Option<mpsc::UnboundedReceiver<HarnessInbound>>>>,
    }

    #[async_trait]
    impl HarnessLink for FakeHarnessLink {
        async fn open_session(&self, _config: SessionConfig) -> anyhow::Result<HarnessSession> {
            let (events_tx, _) = broadcast::channel(8);
            let (raw_events_tx, _) = broadcast::channel(8);
            let (commands_tx, commands_rx) = mpsc::unbounded_channel();
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
