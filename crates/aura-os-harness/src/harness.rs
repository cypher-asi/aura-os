use async_trait::async_trait;
use tokio::sync::{broadcast, mpsc};

use aura_protocol::{
    AgentCapabilities, AgentIdentity, AgentPermissionsWire, AgentPersona, AgentToolPermissionsWire,
    ChatProjectInfoWire, ConversationMessage, CouncilMechanism, CouncilMember, InboundMessage,
    InstalledIntegration, IntentClassifierSpec, ModelSelection, OutboundMessage, ProjectContext,
    RuntimeRequest, RuntimeRequestType, SessionModelOverrides, WorkspaceLocation,
};

use crate::error::HarnessError;

#[derive(Default)]
pub struct SessionConfig {
    pub model: Option<String>,
    pub max_tokens: Option<u32>,
    pub max_turns: Option<u32>,
    pub workspace: Option<String>,
    pub agent_id: Option<String>,
    /// Template agent id for harness skill / permissions / billing lookup
    /// when the partitioned `agent_id` is in use. See
    /// [`aura_protocol::AgentIdentity::template_id`].
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
    /// session.
    pub agent_permissions: AgentPermissionsWire,
    /// Optional per-turn intent classifier. CEO-style agents populate
    /// this so the harness narrows the visible tool set each turn.
    pub intent_classifier: Option<IntentClassifierSpec>,
    /// Optional per-agent tool permission override stamped onto this
    /// session.
    pub tool_permissions: Option<AgentToolPermissionsWire>,
    /// Chat-WS migration: typed agent persona (name / role /
    /// personality). Forwarded onto
    /// [`aura_protocol::AgentIdentity::persona`] so the harness's
    /// `SystemPromptBuilder` renders the `<agent_identity>` section.
    pub agent_identity: Option<AgentPersona>,
    /// Chat-WS migration: operator-curated skills list.
    pub agent_skills: Vec<String>,
    /// Chat-WS migration: operator-authored system prompt.
    pub agent_system_prompt: Option<String>,
    /// Chat-WS migration: typed project descriptor. Forwarded onto
    /// [`aura_protocol::ProjectContext::project_info`].
    pub project_info: Option<ChatProjectInfoWire>,
    /// User-selected reasoning-effort tier
    /// (`low`/`medium`/`high`/`xhigh`/`max`) from the chat model
    /// picker. Forwarded to the harness via
    /// [`crate::automaton_client::start_params::AutomatonStartParams::reasoning_effort`]
    /// so the agent loop hard-pins the requested thinking level instead
    /// of relying solely on its internal taper heuristic.
    pub reasoning_effort: Option<String>,
    /// Optional AURA Council membership. When present with >= 2 members
    /// [`build_runtime_request`] emits
    /// [`RuntimeRequestType::Council`] instead of
    /// [`RuntimeRequestType::Chat`]: the query fans across every member
    /// in parallel and `council[0]` synthesizes the combined answer.
    /// `None` (or a single member) keeps the ordinary single-model chat
    /// path unchanged.
    pub council: Option<Vec<CouncilMemberConfig>>,
    /// How an active AURA Council combines its members' answers once
    /// every member has completed. Only meaningful when [`Self::council`]
    /// resolves to a [`RuntimeRequestType::Council`] request (>= 2
    /// members). `None` lets [`build_runtime_request`] fall back to
    /// [`CouncilMechanism::Synthesize`], the original behavior.
    pub council_mechanism: Option<CouncilMechanism>,
    /// Presentation hint for Council-backed multi-agent runs. This is
    /// Aura OS-side metadata only: the runtime request still uses the
    /// existing Council wire shape, while the server annotates spawned
    /// member cards so the UI can render variants like Second Opinion.
    pub council_presentation: Option<CouncilPresentation>,
    /// Computer-use capability flag forwarded onto
    /// [`aura_protocol::AgentCapabilities::computer_use`]. When `true`
    /// the harness exposes the Anthropic computer-use tool so the agent
    /// can drive the real desktop. Off by default.
    pub computer_use: bool,
    /// Base URL of the local desktop computer-use executor, forwarded
    /// onto [`aura_protocol::AgentCapabilities::computer_executor_url`].
    /// The aura-os server populates this from the local desktop server
    /// URL when it builds the [`SessionConfig`] for a computer-use
    /// session; `None` (the default) leaves forwarding disabled.
    pub computer_executor_url: Option<String>,
}

/// Resolved AURA Council member ready to build a wire
/// [`CouncilMember`]. The server resolves each requested model id into
/// an effective model + reasoning-effort tier + per-member provider
/// overrides before constructing the [`SessionConfig`].
#[derive(Debug, Clone, Default)]
pub struct CouncilMemberConfig {
    /// Resolved effective model id for this member.
    pub model: Option<String>,
    /// Per-member reasoning-effort tier (same wire strings as
    /// [`SessionConfig::reasoning_effort`]). Parsed into the typed wire
    /// enum in [`build_runtime_request`].
    pub reasoning_effort: Option<String>,
    /// Per-member provider overrides (default model + prompt-cache
    /// key/retention) layered on the harness env defaults.
    pub provider_overrides: Option<SessionModelOverrides>,
    /// Optional semantic role for specialized Council-backed flows.
    /// Ordinary Council leaves this unset. Second Opinion sets the
    /// final model to `aggregator` and advisor models to `reference`.
    pub role: Option<aura_protocol::CouncilMemberRole>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CouncilPresentation {
    SecondOpinion,
}

impl CouncilPresentation {
    #[must_use]
    pub const fn subagent_type(self) -> &'static str {
        match self {
            Self::SecondOpinion => "second-opinion",
        }
    }
}

pub struct HarnessSession {
    pub session_id: String,
    /// Harness-allocated run identifier from `POST /v1/run` (the path
    /// segment on `WS /stream/:run_id` and the `/v1/run/:id/*` lifecycle
    /// endpoints). Retained so a caller can reattach to or control the
    /// run by id — the canonical handle that unifies chat and automaton
    /// flows. May be empty for transports that predate the run model
    /// (e.g. the swarm session-init handshake), in which case it falls
    /// back to `session_id`.
    pub run_id: String,
    pub events_tx: broadcast::Sender<OutboundMessage>,
    /// Raw JSON events that did not match the typed `OutboundMessage`
    /// enum. This lets domain-level events from the harness pass
    /// through even when the protocol crate has not been updated with
    /// those variants.
    pub raw_events_tx: broadcast::Sender<serde_json::Value>,
    pub commands_tx: HarnessCommandSender,
    /// Initialization frames consumed before any server-side consumer
    /// subscribes to `events_tx`. For chat runs this starts with
    /// `SessionReady`, followed by every other typed pre-ready frame in
    /// its original order. tokio `broadcast` only delivers messages sent
    /// after a receiver subscribes, so these would otherwise be lost. The
    /// chat orchestrator replays them onto `events_tx` once every consumer
    /// (SSE, persist, watchdog, live registry) is subscribed.
    pub pending_events: Vec<OutboundMessage>,
    /// Receiver subscribed to `events_tx` at WS-bridge creation time,
    /// BEFORE the reader task could broadcast the harness's
    /// replay-on-attach burst. A consumer that adopts this receiver
    /// (instead of a late `events_tx.subscribe()`) observes a run's full
    /// replayed transcript on attach rather than dropping it. `take()`-n
    /// by the subagent live-stream attach + capture paths, where the
    /// child run is frequently already complete so its whole transcript
    /// lives in that initial burst. `None` on transports/tests that do
    /// not prime one; the parent chat path leaves it unused (it relies on
    /// `pending_events` for its multi-consumer fan-out).
    pub events_rx: Option<broadcast::Receiver<OutboundMessage>>,
    /// Raw receivers subscribed before the WebSocket reader starts. The
    /// automaton pipeline takes one for its live forwarder and one for
    /// event persistence so an attach-time replay burst cannot outrun
    /// either downstream subscription. Transports without a primed raw
    /// path may leave this empty; callers fall back to fresh subscribers.
    pub raw_events_rx: Vec<broadcast::Receiver<serde_json::Value>>,
}

pub type HarnessCommandSender = mpsc::Sender<InboundMessage>;

/// Outcome of `POST /v1/run`: the harness-allocated `run_id` plus the
/// relative WS path to attach to. Canonical handle returned by
/// [`HarnessLink::submit_run`] and shared by chat and automaton flows.
///
/// Deserializes the harness response tolerantly: `run_id` accepts the
/// `id` / `automaton_id` aliases older builds used, and
/// `event_stream_url` accepts `ws_url` / `stream_url`.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct RunHandle {
    #[serde(alias = "id", alias = "automaton_id", alias = "run_id_v0")]
    pub run_id: String,
    #[serde(alias = "ws_url", alias = "stream_url")]
    pub event_stream_url: String,
}

#[async_trait]
pub trait HarnessLink: Send + Sync {
    async fn open_session(&self, config: SessionConfig) -> anyhow::Result<HarnessSession>;
    async fn close_session(&self, session_id: &str) -> anyhow::Result<()>;

    /// Submit a run via `POST /v1/run` WITHOUT attaching the event
    /// stream, returning the [`RunHandle`]. The canonical first step
    /// shared by chat (`open_session` = submit + attach) and automaton
    /// (submit, optionally adopt on conflict, then attach) flows.
    /// Surfaces [`HarnessError::Conflict`] on `409` and
    /// [`HarnessError::CapacityExhausted`] on `503`.
    ///
    /// Default: unsupported. Overridden by [`crate::LocalHarness`]; the
    /// swarm gateway transport still uses its session-init handshake via
    /// `open_session`.
    async fn submit_run(
        &self,
        _request: RuntimeRequest,
        _auth_token: Option<&str>,
    ) -> anyhow::Result<RunHandle> {
        anyhow::bail!("submit_run is not supported by this harness transport")
    }

    /// Attach (or reattach) to a run's `WS /stream/:run_id` event
    /// stream. `wait_for_ready` waits for the `SessionReady` frame
    /// (chat); when false a short liveness probe is used instead
    /// (automaton runs, which never emit `SessionReady`).
    async fn attach_run(
        &self,
        _run_id: &str,
        _auth_token: Option<&str>,
        _wait_for_ready: bool,
    ) -> anyhow::Result<HarnessSession> {
        anyhow::bail!("attach_run is not supported by this harness transport")
    }

    /// Attach (or reattach) to a run's event stream using the
    /// harness-provided `event_stream_url` when available, falling back
    /// to `WS /stream/:run_id`. The swarm gateway returns a routable
    /// absolute (or gateway-relative) URL from `POST /v1/run` that does
    /// not match the local `{ws_base}/stream/:run_id` convention, so the
    /// automaton connect path threads it through here.
    ///
    /// Resolution semantics (ported from the legacy automaton client):
    /// an absolute `ws://` / `wss://` URL is used verbatim; a relative
    /// URL is joined onto the transport's WS base; `None` falls back to
    /// `/stream/:run_id`.
    async fn attach_run_at_url(
        &self,
        _run_id: &str,
        _event_stream_url: Option<&str>,
        _auth_token: Option<&str>,
        _wait_for_ready: bool,
    ) -> anyhow::Result<HarnessSession> {
        anyhow::bail!("attach_run_at_url is not supported by this harness transport")
    }

    /// Pause a run via `POST /v1/run/:id/pause`.
    async fn pause_run(&self, _run_id: &str, _auth_token: Option<&str>) -> anyhow::Result<()> {
        anyhow::bail!("pause_run is not supported by this harness transport")
    }

    /// Stop a run via `POST /v1/run/:id/stop`.
    async fn stop_run(&self, _run_id: &str, _auth_token: Option<&str>) -> anyhow::Result<()> {
        anyhow::bail!("stop_run is not supported by this harness transport")
    }

    /// Resume a paused run via `POST /v1/run/:id/resume`.
    async fn resume_run(&self, _run_id: &str, _auth_token: Option<&str>) -> anyhow::Result<()> {
        anyhow::bail!("resume_run is not supported by this harness transport")
    }

    /// Resolve the canonical workspace path for a project via
    /// `GET /workspace/resolve?project_name=:name`. Used by the swarm
    /// dev-loop start path to discover the gateway-side workspace
    /// directory before kicking off a run.
    async fn resolve_workspace(
        &self,
        _project_name: &str,
        _auth_token: Option<&str>,
    ) -> anyhow::Result<String> {
        anyhow::bail!("resolve_workspace is not supported by this harness transport")
    }

    /// Get a run's status via `GET /v1/run/:id/status`.
    async fn run_status(
        &self,
        _run_id: &str,
        _auth_token: Option<&str>,
    ) -> anyhow::Result<serde_json::Value> {
        anyhow::bail!("run_status is not supported by this harness transport")
    }
}

/// Canonical [`RuntimeRequest`] construction from a [`SessionConfig`].
///
/// Both [`crate::LocalHarness::open_session`] and
/// [`crate::SwarmHarness::open_session`] funnel through this helper so
/// a new wire-level field only has to be wired in one place.
///
/// Renamed from `build_session_init` in Phase A of the cross-repo
/// gateway refactor: the harness no longer accepts a `SessionInit`
/// first-frame, so chat sessions submit a [`RuntimeRequest`] over
/// HTTP and the WS attaches to the returned `run_id`.
#[must_use]
pub fn build_runtime_request(cfg: &SessionConfig) -> RuntimeRequest {
    // AURA Council is active only when >= 2 members are resolved; a
    // single member (or an absent council) falls through to the
    // ordinary single-model `Chat` request unchanged.
    let council_members = cfg
        .council
        .as_ref()
        .filter(|members| members.len() >= 2)
        .map(|members| {
            members
                .iter()
                .enumerate()
                .map(|(index, member)| CouncilMember {
                    id: index.to_string(),
                    model: ModelSelection {
                        id: member.model.clone(),
                        reasoning_effort: member
                            .reasoning_effort
                            .as_deref()
                            .and_then(aura_protocol::ReasoningEffort::from_wire),
                        provider_overrides: member.provider_overrides.clone(),
                        ..Default::default()
                    },
                    role: member.role,
                })
                .collect::<Vec<_>>()
        });

    RuntimeRequest {
        r#type: match council_members {
            // `members[0]` is the synthesizer (first selected model).
            Some(members) => RuntimeRequestType::Council {
                members,
                mechanism: cfg.council_mechanism.unwrap_or_default(),
                conversation_messages: cfg.conversation_messages.clone().unwrap_or_default(),
            },
            None => RuntimeRequestType::Chat {
                conversation_messages: cfg.conversation_messages.clone().unwrap_or_default(),
            },
        },
        agent_identity: AgentIdentity {
            template_id: cfg.template_agent_id.clone(),
            partition_id: cfg.agent_id.clone(),
            persona: cfg.agent_identity.clone(),
            skills: cfg.agent_skills.clone(),
            system_prompt: cfg.agent_system_prompt.clone(),
        },
        model: ModelSelection {
            id: cfg.model.clone(),
            max_tokens: cfg.max_tokens,
            max_turns: cfg.max_turns,
            temperature: None,
            // Parse the HTTP-edge string into the typed wire enum here so
            // the cross-repo contract carries a strong type. Unknown /
            // blank values resolve to `None`, letting the harness fall
            // back to its internal effort taper.
            reasoning_effort: cfg
                .reasoning_effort
                .as_deref()
                .and_then(aura_protocol::ReasoningEffort::from_wire),
            provider_overrides: cfg.provider_overrides.clone(),
        },
        workspace: WorkspaceLocation {
            workspace: cfg.workspace.clone(),
            project_path: cfg.project_path.clone(),
            git_repo_url: None,
            git_branch: None,
        },
        project: cfg.project_id.as_ref().map(|pid| ProjectContext {
            project_id: pid.clone(),
            project_info: cfg.project_info.clone(),
            aura_org_id: cfg.aura_org_id.clone(),
            aura_session_id: cfg.aura_session_id.clone(),
            // Billing aggregates per *agent*, not per partition. When
            // the caller supplies `template_agent_id`, `agent_id` is
            // the `{template}::{instance}` partition string used
            // solely for the harness turn-lock; the billing header
            // must stay on the stable template id.
            aura_agent_id: cfg
                .template_agent_id
                .clone()
                .or_else(|| cfg.agent_id.clone()),
        }),
        agent_permissions: cfg.agent_permissions.clone(),
        tool_permissions: cfg.tool_permissions.clone(),
        agent_capabilities: AgentCapabilities {
            installed_tools: cfg.installed_tools.clone().unwrap_or_default(),
            installed_integrations: cfg.installed_integrations.clone().unwrap_or_default(),
            intent_classifier: cfg.intent_classifier.clone(),
            computer_use: cfg.computer_use,
            computer_executor_url: cfg.computer_executor_url.clone(),
        },
        auth_jwt: cfg.token.clone(),
        user_id: cfg.user_id.clone().unwrap_or_default(),
    }
}

/// Tier 2 fail-fast: harness-side preflight that mirrors the
/// minimum required identity contract enforced by the server's
/// `handlers::agents::session_identity::validate_session_identity`.
///
/// Renamed from `validate_session_init_identity` in Phase A.
pub fn validate_runtime_request_identity(cfg: &SessionConfig) -> Result<(), HarnessError> {
    if is_blank(cfg.aura_org_id.as_deref()) {
        return Err(HarnessError::SessionIdentityMissing {
            field: "aura_org_id",
            context: "runtime_request",
        });
    }
    if is_blank(cfg.aura_session_id.as_deref()) {
        return Err(HarnessError::SessionIdentityMissing {
            field: "aura_session_id",
            context: "runtime_request",
        });
    }
    if is_blank(cfg.template_agent_id.as_deref()) && is_blank(cfg.agent_id.as_deref()) {
        return Err(HarnessError::SessionIdentityMissing {
            field: "agent_id",
            context: "runtime_request",
        });
    }
    // Token is optional for public-guest sessions (aura_org_id ==
    // "public"). The harness provider skips the Authorization header
    // when token is None, and the router assigns user_id
    // "public-guest". All other sessions must carry a token.
    let is_public = cfg
        .aura_org_id
        .as_deref()
        .map(|v| v == "public")
        .unwrap_or(false);
    if !is_public && is_blank(cfg.token.as_deref()) {
        return Err(HarnessError::SessionIdentityMissing {
            field: "auth_token",
            context: "runtime_request",
        });
    }
    Ok(())
}

fn is_blank(value: Option<&str>) -> bool {
    value.map(|v| v.trim().is_empty()).unwrap_or(true)
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
        assert!(validate_runtime_request_identity(&full_cfg()).is_ok());
    }

    #[test]
    fn validate_rejects_missing_org_id() {
        let mut cfg = full_cfg();
        cfg.aura_org_id = None;
        let err = validate_runtime_request_identity(&cfg).unwrap_err();
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
        let err = validate_runtime_request_identity(&cfg).unwrap_err();
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
        assert!(validate_runtime_request_identity(&cfg).is_ok());
    }

    #[test]
    fn validate_rejects_missing_both_agent_identities() {
        let mut cfg = full_cfg();
        cfg.template_agent_id = None;
        cfg.agent_id = None;
        let err = validate_runtime_request_identity(&cfg).unwrap_err();
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
        let err = validate_runtime_request_identity(&cfg).unwrap_err();
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
        let mut cfg = full_cfg();
        cfg.user_id = None;
        assert!(validate_runtime_request_identity(&cfg).is_ok());
    }

    #[test]
    fn run_handle_accepts_ws_url_alias() {
        let result: RunHandle = serde_json::from_value(serde_json::json!({
            "run_id": "auto-123",
            "ws_url": "/stream/auto-123",
        }))
        .expect("run handle should deserialize");

        assert_eq!(result.run_id, "auto-123");
        assert_eq!(result.event_stream_url, "/stream/auto-123");
    }

    #[test]
    fn run_handle_accepts_legacy_automaton_id_alias() {
        let result: RunHandle = serde_json::from_value(serde_json::json!({
            "automaton_id": "auto-456",
            "event_stream_url": "/stream/auto-456",
        }))
        .expect("legacy automaton_id alias should still deserialize");

        assert_eq!(result.run_id, "auto-456");
        assert_eq!(result.event_stream_url, "/stream/auto-456");
    }

    fn two_member_council() -> Vec<CouncilMemberConfig> {
        vec![
            CouncilMemberConfig {
                model: Some("model-a".into()),
                ..Default::default()
            },
            CouncilMemberConfig {
                model: Some("model-b".into()),
                ..Default::default()
            },
        ]
    }

    #[test]
    fn build_runtime_request_defaults_council_mechanism_to_synthesize() {
        let cfg = SessionConfig {
            council: Some(two_member_council()),
            ..Default::default()
        };
        match build_runtime_request(&cfg).r#type {
            RuntimeRequestType::Council { mechanism, .. } => {
                assert_eq!(mechanism, CouncilMechanism::Synthesize);
            }
            other => panic!("expected council request, got {other:?}"),
        }
    }

    #[test]
    fn build_runtime_request_forwards_selected_council_mechanism() {
        let cfg = SessionConfig {
            council: Some(two_member_council()),
            council_mechanism: Some(CouncilMechanism::SideBySide),
            ..Default::default()
        };
        match build_runtime_request(&cfg).r#type {
            RuntimeRequestType::Council { mechanism, .. } => {
                assert_eq!(mechanism, CouncilMechanism::SideBySide);
            }
            other => panic!("expected council request, got {other:?}"),
        }
    }

    #[test]
    fn build_runtime_request_forwards_second_opinion_roles() {
        let cfg = SessionConfig {
            council: Some(vec![
                CouncilMemberConfig {
                    model: Some("final".into()),
                    role: Some(aura_protocol::CouncilMemberRole::Aggregator),
                    ..Default::default()
                },
                CouncilMemberConfig {
                    model: Some("reference".into()),
                    role: Some(aura_protocol::CouncilMemberRole::Reference),
                    ..Default::default()
                },
            ]),
            ..Default::default()
        };

        match build_runtime_request(&cfg).r#type {
            RuntimeRequestType::Council { members, .. } => {
                assert_eq!(
                    members[0].role,
                    Some(aura_protocol::CouncilMemberRole::Aggregator)
                );
                assert_eq!(
                    members[1].role,
                    Some(aura_protocol::CouncilMemberRole::Reference)
                );
            }
            other => panic!("expected council request, got {other:?}"),
        }
    }

    #[test]
    fn build_runtime_request_ignores_mechanism_for_single_member() {
        // A single member never becomes a Council request, so the
        // mechanism is irrelevant and the ordinary Chat path is used.
        let cfg = SessionConfig {
            council: Some(vec![CouncilMemberConfig {
                model: Some("solo".into()),
                ..Default::default()
            }]),
            council_mechanism: Some(CouncilMechanism::Contrast),
            ..Default::default()
        };
        assert!(matches!(
            build_runtime_request(&cfg).r#type,
            RuntimeRequestType::Chat { .. }
        ));
    }
}
