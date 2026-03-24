use async_trait::async_trait;
use tokio::sync::{broadcast, mpsc};

use aura_protocol::{ConversationMessage, InboundMessage, OutboundMessage};

pub struct SessionConfig {
    pub system_prompt: Option<String>,
    pub model: Option<String>,
    pub max_tokens: Option<u32>,
    pub max_turns: Option<u32>,
    pub workspace: Option<String>,
    pub agent_id: Option<String>,
    pub token: Option<String>,
    pub conversation_messages: Option<Vec<ConversationMessage>>,
    pub project_id: Option<String>,
    /// Absolute path to the project directory on the local filesystem.
    pub project_path: Option<String>,
}

impl Default for SessionConfig {
    fn default() -> Self {
        Self {
            system_prompt: None,
            model: None,
            max_tokens: None,
            max_turns: None,
            workspace: None,
            agent_id: None,
            token: None,
            conversation_messages: None,
            project_id: None,
            project_path: None,
        }
    }
}

pub struct HarnessSession {
    pub session_id: String,
    pub events_tx: broadcast::Sender<OutboundMessage>,
    pub commands_tx: mpsc::UnboundedSender<InboundMessage>,
}

#[async_trait]
pub trait HarnessLink: Send + Sync {
    async fn open_session(&self, config: SessionConfig) -> anyhow::Result<HarnessSession>;
    async fn close_session(&self, session_id: &str) -> anyhow::Result<()>;
}
