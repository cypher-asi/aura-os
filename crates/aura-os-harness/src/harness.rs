use async_trait::async_trait;
use tokio::sync::{broadcast, mpsc};

use aura_protocol::{
    AgentPermissionsWire, AgentToolPermissionsWire, ConversationMessage, InboundMessage,
    InstalledIntegration, IntentClassifierSpec, OutboundMessage, SessionInit,
    SessionModelOverrides,
};

use crate::error::HarnessError;

#[derive(Default)]
pub struct SessionConfig {
    pub system_prompt: Option<String>,
    pub model: Option<String>,
    pub max_tokens: Option<u32>,
    pub max_turns: Option<u32>,
    pub workspace: Option<String>,
    pub agent_id: Option<String>,
    /// Template agent id for harness skill / permissions / billing lookup
    /// when the partitioned `agent_id` is in use. See
    /// `aura_protocol::SessionInit::template_agent_id`.
    pub template_agent_id: Option<String>,
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
    /// Optional per-session model overrides applied on top of the
    /// harness env-default router config.
    pub provider_overrides: Option<SessionModelOverrides>,
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
        // Billing aggregates per *agent*, not per partition. When the
        // caller supplies `template_agent_id` (Phase 1b+ chat call
        // sites), `agent_id` is the `{template}::{instance}` partition
        // string used solely for the harness turn-lock; the billing
        // header must stay on the stable template id. Pre-Phase-1b
        // callers leave `template_agent_id` as `None` and we fall back
        // to `agent_id` (which is still the bare template), preserving
        // the historical billing semantics.
        aura_agent_id: cfg
            .template_agent_id
            .clone()
            .or_else(|| cfg.agent_id.clone()),
        aura_session_id: cfg.aura_session_id.clone(),
        aura_org_id: cfg.aura_org_id.clone(),
        agent_id: cfg.agent_id.clone(),
        template_agent_id: cfg.template_agent_id.clone(),
        user_id: cfg.user_id.clone().unwrap_or_default(),
        provider_overrides: cfg.provider_overrides.clone(),
        intent_classifier: cfg.intent_classifier.clone(),
        agent_permissions: cfg.agent_permissions.clone(),
        tool_permissions: cfg.tool_permissions.clone(),
    }
}

/// Tier 2 fail-fast: harness-side preflight that mirrors the
/// minimum required identity contract enforced by the server's
/// `handlers::agents::session_identity::validate_session_identity`.
///
/// The harness has no notion of "call site" (chat vs dev-loop vs
/// project-tool), so we validate the *intersection* of fields that
/// every real session-open path must populate so the upstream proxy
/// can stamp the corresponding `X-Aura-*` header. `user_id` is left
/// off this list intentionally: server-side Tier 1 enforces it for
/// the chat / dev-loop / project-tool surfaces, but the harness
/// must keep accepting non-user sessions (e.g. ad-hoc CLI runs in
/// `aura-os-harness/runner.rs`).
///
/// Drift signal: if a server build forgets to call its Tier 1
/// preflight, this Tier 2 check still surfaces the missing field as
/// a structured [`HarnessError::SessionIdentityMissing`] inside the
/// returned `anyhow::Error`, which the server's
/// `map_harness_error_to_api` then funnels into the same
/// `session_identity_missing` 422 response shape.
pub fn validate_session_init_identity(cfg: &SessionConfig) -> Result<(), HarnessError> {
    if is_blank(cfg.aura_org_id.as_deref()) {
        return Err(HarnessError::SessionIdentityMissing {
            field: "aura_org_id",
            context: "session_init",
        });
    }
    if is_blank(cfg.aura_session_id.as_deref()) {
        return Err(HarnessError::SessionIdentityMissing {
            field: "aura_session_id",
            context: "session_init",
        });
    }
    if is_blank(cfg.template_agent_id.as_deref()) && is_blank(cfg.agent_id.as_deref()) {
        return Err(HarnessError::SessionIdentityMissing {
            field: "agent_id",
            context: "session_init",
        });
    }
    if is_blank(cfg.token.as_deref()) {
        return Err(HarnessError::SessionIdentityMissing {
            field: "auth_token",
            context: "session_init",
        });
    }
    Ok(())
}

fn is_blank(value: Option<&str>) -> bool {
    value.map(|v| v.trim().is_empty()).unwrap_or(true)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn full_cfg() -> SessionConfig {
        SessionConfig {
            aura_org_id: Some("org-1".into()),
            aura_session_id: Some("session-1".into()),
            template_agent_id: Some("template-1".into()),
            agent_id: Some("template-1::instance-1".into()),
            token: Some("jwt".into()),
            ..Default::default()
        }
    }

    #[test]
    fn validate_accepts_fully_populated_config() {
        assert!(validate_session_init_identity(&full_cfg()).is_ok());
    }

    #[test]
    fn validate_rejects_missing_org_id() {
        let mut cfg = full_cfg();
        cfg.aura_org_id = None;
        let err = validate_session_init_identity(&cfg).unwrap_err();
        assert!(matches!(
            err,
            HarnessError::SessionIdentityMissing {
                field: "aura_org_id",
                ..
            }
        ));
    }

    #[test]
    fn validate_rejects_blank_session_id() {
        let mut cfg = full_cfg();
        cfg.aura_session_id = Some("   ".into());
        let err = validate_session_init_identity(&cfg).unwrap_err();
        assert!(matches!(
            err,
            HarnessError::SessionIdentityMissing {
                field: "aura_session_id",
                ..
            }
        ));
    }

    #[test]
    fn validate_accepts_agent_id_when_template_missing() {
        let mut cfg = full_cfg();
        cfg.template_agent_id = None;
        // bare `agent_id` is enough — the harness's `build_session_init`
        // falls back from template_agent_id to agent_id for
        // X-Aura-Agent-Id.
        assert!(validate_session_init_identity(&cfg).is_ok());
    }

    #[test]
    fn validate_rejects_missing_both_agent_identities() {
        let mut cfg = full_cfg();
        cfg.template_agent_id = None;
        cfg.agent_id = None;
        let err = validate_session_init_identity(&cfg).unwrap_err();
        assert!(matches!(
            err,
            HarnessError::SessionIdentityMissing {
                field: "agent_id",
                ..
            }
        ));
    }

    #[test]
    fn validate_rejects_missing_auth_token() {
        let mut cfg = full_cfg();
        cfg.token = None;
        let err = validate_session_init_identity(&cfg).unwrap_err();
        assert!(matches!(
            err,
            HarnessError::SessionIdentityMissing {
                field: "auth_token",
                ..
            }
        ));
    }

    #[test]
    fn validate_does_not_require_user_id() {
        // The harness must keep accepting non-user (CLI / runner)
        // sessions; user_id is enforced server-side per call site.
        let mut cfg = full_cfg();
        cfg.user_id = None;
        assert!(validate_session_init_identity(&cfg).is_ok());
    }
}
