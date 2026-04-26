use async_trait::async_trait;
use tokio::sync::{broadcast, mpsc};

use aura_protocol::{
    AgentPermissionsWire, AgentToolPermissionsWire, ConversationMessage, InboundMessage,
    InstalledIntegration, IntentClassifierSpec, OutboundMessage, SessionInit,
    SessionProviderConfig,
};

#[derive(Default)]
pub struct SessionConfig {
    pub system_prompt: Option<String>,
    pub model: Option<String>,
    pub max_tokens: Option<u32>,
    pub max_turns: Option<u32>,
    pub workspace: Option<String>,
    pub agent_id: Option<String>,
    /// Originating end-user id for harness-side tool defaults.
    pub user_id: Option<String>,
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
    /// Enabled integrations to authorize for this runtime session.
    pub installed_integrations: Option<Vec<InstalledIntegration>>,
    /// Storage session UUID for X-Aura-Session-Id billing header.
    pub aura_session_id: Option<String>,
    /// Org UUID for X-Aura-Org-Id billing header.
    pub aura_org_id: Option<String>,
    /// Optional per-session provider override for Aura BYOK.
    pub provider_config: Option<SessionProviderConfig>,
    /// Capability + scope bundle the harness must enforce for this
    /// session. Defaults to [`AgentPermissionsWire::default`] (empty
    /// capabilities, universe scope) when the caller does not populate
    /// it; callers on the unified agent chat path always pass the
    /// agent's `permissions` through.
    pub agent_permissions: AgentPermissionsWire,
    /// Optional per-turn intent classifier. CEO-style agents populate
    /// this so the harness narrows the visible tool set each turn.
    pub intent_classifier: Option<IntentClassifierSpec>,
    /// Optional per-agent tool permission override stamped onto this session.
    pub tool_permissions: Option<AgentToolPermissionsWire>,
}

pub struct HarnessSession {
    pub session_id: String,
    pub events_tx: broadcast::Sender<OutboundMessage>,
    /// Raw JSON events that did not match the typed `OutboundMessage` enum.
    /// This lets domain-level events from the harness pass through even when
    /// the protocol crate has not been updated with those variants.
    pub raw_events_tx: broadcast::Sender<serde_json::Value>,
    pub commands_tx: HarnessCommandSender,
}

pub type HarnessCommandSender = mpsc::Sender<InboundMessage>;

#[async_trait]
pub trait HarnessLink: Send + Sync {
    async fn open_session(&self, config: SessionConfig) -> anyhow::Result<HarnessSession>;
    async fn close_session(&self, session_id: &str) -> anyhow::Result<()>;
}

/// Canonical [`SessionInit`] construction from a [`SessionConfig`].
///
/// Both [`crate::LocalHarness::open_session`] and
/// [`crate::SwarmHarness::open_session`] funnel through this helper so a
/// new `SessionInit` field only has to be wired in one place. Historically
/// each harness kept its own inline struct literal, which drifted when
/// fields were added (e.g. `intent_classifier`, `agent_permissions`); that
/// drift is exactly what this helper eliminates.
///
/// The `temperature` field is intentionally omitted from [`SessionConfig`]
/// today and hard-coded to `None` here; if / when a caller needs to set
/// it, add the field to `SessionConfig` and thread it through this
/// single helper.
#[must_use]
pub fn build_session_init(cfg: &SessionConfig) -> SessionInit {
    SessionInit {
        system_prompt: cfg.system_prompt.clone(),
        model: cfg.model.clone(),
        max_tokens: cfg.max_tokens,
        temperature: None,
        max_turns: cfg.max_turns,
        installed_tools: cfg.installed_tools.clone(),
        installed_integrations: cfg.installed_integrations.clone(),
        workspace: cfg.workspace.clone(),
        project_path: cfg.project_path.clone(),
        token: cfg.token.clone(),
        project_id: cfg.project_id.clone(),
        conversation_messages: cfg.conversation_messages.clone(),
        aura_agent_id: cfg.agent_id.clone(),
        aura_session_id: cfg.aura_session_id.clone(),
        aura_org_id: cfg.aura_org_id.clone(),
        agent_id: cfg.agent_id.clone(),
        user_id: cfg.user_id.clone().unwrap_or_default(),
        provider_config: cfg.provider_config.clone(),
        intent_classifier: cfg.intent_classifier.clone(),
        agent_permissions: cfg.agent_permissions.clone(),
        tool_permissions: cfg.tool_permissions.clone(),
    }
}

/// Projection of [`SessionConfig`] used by
/// [`crate::SwarmHarness::open_session`]'s HTTP bootstrap
/// (`POST /v1/agents/:id/sessions`).
///
/// The gateway's `CreateSessionRequest` accepts only the subset of
/// fields needed to allocate a remote session container — the full
/// [`SessionInit`] (tools, permissions, classifier, …) is sent over
/// the WebSocket once the container is up. Keep this projection in a
/// single helper so the HTTP shape doesn't drift from the wire
/// contract.
#[must_use]
pub fn build_remote_handshake(cfg: &SessionConfig) -> serde_json::Value {
    serde_json::json!({
        "config": {
            "system_prompt": cfg.system_prompt,
            "model": cfg.model,
            "max_tokens": cfg.max_tokens,
            "max_turns": cfg.max_turns,
        }
    })
}
