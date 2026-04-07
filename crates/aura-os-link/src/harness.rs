use async_trait::async_trait;
use tokio::sync::{broadcast, mpsc};

use aura_protocol::{ConversationMessage, InboundMessage, OutboundMessage, SessionProviderConfig};

#[derive(Default)]
pub struct SessionConfig {
    pub system_prompt: Option<String>,
    pub model: Option<String>,
    pub max_tokens: Option<u32>,
    pub max_turns: Option<u32>,
    pub workspace: Option<String>,
    pub agent_id: Option<String>,
    /// Human-readable display name for the remote agent.
    /// When omitted the swarm harness falls back to `agent_id`.
    pub agent_name: Option<String>,
    pub token: Option<String>,
    pub conversation_messages: Option<Vec<ConversationMessage>>,
    pub project_id: Option<String>,
    /// Absolute path to the project directory on the local filesystem.
    pub project_path: Option<String>,
    /// Domain tools to register with the harness for this session.
    pub installed_tools: Option<Vec<aura_protocol::InstalledTool>>,
    /// Storage session UUID for X-Aura-Session-Id billing header.
    pub aura_session_id: Option<String>,
    /// Org UUID for X-Aura-Org-Id billing header.
    pub aura_org_id: Option<String>,
    /// Optional per-session provider override for Aura BYOK.
    pub provider_config: Option<SessionProviderConfig>,
}

pub struct HarnessSession {
    pub session_id: String,
    pub events_tx: broadcast::Sender<OutboundMessage>,
    /// Raw JSON events that did not match the typed `OutboundMessage` enum.
    /// This lets domain-level events from the harness pass through even when
    /// the protocol crate has not been updated with those variants.
    pub raw_events_tx: broadcast::Sender<serde_json::Value>,
    pub commands_tx: mpsc::UnboundedSender<InboundMessage>,
}

#[async_trait]
pub trait HarnessLink: Send + Sync {
    async fn open_session(&self, config: SessionConfig) -> anyhow::Result<HarnessSession>;
    async fn close_session(&self, session_id: &str) -> anyhow::Result<()>;
}
