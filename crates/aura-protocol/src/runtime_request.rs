//! Canonical wire shape for `POST /v1/run`.
//!
//! Mirror of `aura_harness::aura_protocol::RuntimeRequest`.
//! [`RuntimeRequest`] replaces the previous twin shapes
//! `SessionInit` (chat WS first-frame) + `AutomatonStartRequest`
//! (`POST /automaton/start` body) with a single discriminated-union
//! body. The harness `aura-runtime` gateway and the aura-os producer
//! side both speak this shape.
//!
//! High-level grouping (field-ownership is intentional — each
//! sub-struct maps to exactly one downstream consumer):
//!
//! - [`RuntimeRequestType`]: discriminated union over the three run
//!   kinds the harness supports (`Chat`, `DevLoop`, `TaskRun`).
//! - [`AgentIdentity`]: "who is this agent" — template id, partition
//!   id, persona, skills, system prompt.
//! - [`ModelSelection`]: "what model to drive the agent with".
//! - [`WorkspaceLocation`]: "where the agent runs" (workspace +
//!   project path + git repo/branch).
//! - [`ProjectContext`]: "which project + which billing partition".
//! - [`AgentCapabilities`]: "what tools / integrations / intent
//!   classifier the agent can use".
//! - [`crate::AgentPermissionsWire`] +
//!   [`crate::AgentToolPermissionsWire`]: "what the agent is
//!   **allowed** to do" (kernel-enforced).

use serde::{Deserialize, Serialize};

#[cfg(feature = "typescript")]
use ts_rs::TS;

use crate::agent_identity::AgentPersona;
use crate::chat_project_info::ChatProjectInfoWire;
use crate::client::{ConversationMessage, IntentClassifierSpec, SessionModelOverrides};
use crate::installed::{InstalledIntegration, InstalledTool};
use crate::permissions::{AgentPermissionsWire, AgentToolPermissionsWire};

/// Canonical body of `POST /v1/run`.
///
/// Returned synchronously with `{ run_id, event_stream_url }`. The
/// caller then opens `WS /stream/:run_id` to receive events (and, on
/// the [`RuntimeRequestType::Chat`] variant, to send `user_message`
/// frames).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct RuntimeRequest {
    /// Discriminated union carrying the data unique to each request
    /// type. Renamed `r#type` so the wire payload uses the natural
    /// `"type"` key while Rust still gets a typed enum match.
    #[serde(rename = "type")]
    pub r#type: RuntimeRequestType,

    /// Who is this agent — template + partition + persona + skills +
    /// system prompt. See [`AgentIdentity`].
    pub agent_identity: AgentIdentity,

    /// What model to drive the agent with: id, max_tokens, max_turns,
    /// temperature, provider_overrides.
    pub model: ModelSelection,

    /// Where the agent runs: workspace path, project path, git
    /// repo/branch.
    pub workspace: WorkspaceLocation,

    /// Project context: project_id, typed project_info, billing
    /// header values (`aura_org_id`, `aura_session_id`,
    /// `aura_agent_id`). `None` only for callers that have no project
    /// (e.g. ad-hoc chat).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<ProjectContext>,

    /// Policy bundle — what the agent is **allowed** to do.
    /// Capability + scope grants enforced by the kernel policy gate.
    #[serde(default)]
    pub agent_permissions: AgentPermissionsWire,

    /// Per-tool on/off overrides layered on top of
    /// [`Self::agent_permissions`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_permissions: Option<AgentToolPermissionsWire>,

    /// Runtime tools / integrations / intent classifier the agent
    /// **can use**.
    #[serde(default)]
    pub agent_capabilities: AgentCapabilities,

    /// Bearer JWT forwarded to the model proxy + domain API calls.
    /// `None` is valid in dev (auth disabled).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_jwt: Option<String>,

    /// Originating end-user id for resolving + persisting tool
    /// defaults.
    pub user_id: String,
}

/// Discriminated union carrying the data unique to each run type.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
#[serde(tag = "kind", content = "params", rename_all = "snake_case")]
pub enum RuntimeRequestType {
    /// Bidirectional chat session. The WS stream stays open after
    /// init and the client sends `user_message` frames over it.
    Chat {
        /// Prior conversation messages to hydrate into session
        /// history (empty for a brand-new session).
        #[serde(default)]
        conversation_messages: Vec<ConversationMessage>,
    },
    /// Dev-loop automaton — long-running, no client messages after
    /// kickoff.
    DevLoop {},
    /// Single-task automaton — runs one task to completion, then
    /// exits.
    TaskRun {
        /// Task UUID the automaton should execute.
        task_id: String,
        /// Retry warm-up: the reason text persisted on the previous
        /// attempt's `task_failed` record.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        prior_failure: Option<String>,
        /// Retry warm-up: recent work-log entries the agent should
        /// re-see.
        #[serde(default)]
        work_log: Vec<String>,
    },
    /// AURA Council: fan the same query across `members` in parallel
    /// (one subagent child run each), then combine their answers with
    /// `members[0]` (the first model) using the chosen [`mechanism`].
    /// `members[0]` is the synthesizer.
    ///
    /// [`mechanism`]: CouncilMechanism
    Council {
        /// Council member models in order; `members[0]` synthesizes.
        members: Vec<CouncilMember>,
        /// How `members[0]` combines the members' answers once every
        /// member has completed. Defaults to [`CouncilMechanism::Synthesize`]
        /// for older clients that omit the field.
        #[serde(default)]
        mechanism: CouncilMechanism,
        /// Prior conversation messages to hydrate into session history.
        #[serde(default)]
        conversation_messages: Vec<ConversationMessage>,
    },
}

/// One member of an AURA Council run: a model to fan the shared query
/// out to. `id` is a stable per-member slot id the runtime echoes back
/// on the member's `SubagentSpawned` so the UI can correlate columns.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct CouncilMember {
    /// Stable member id (the council slot index as a string, e.g. "0").
    pub id: String,
    /// Model driving this member.
    pub model: ModelSelection,
    /// Optional semantic role for specialized Council-backed flows.
    /// Ordinary AURA Council requests omit this field. Second Opinion
    /// stamps `aggregator` on the final-answer model and `reference` on
    /// advisor models so newer runtimes can apply Hermes-style behavior,
    /// while older runtimes ignore the unknown JSON field and keep using
    /// the classic Council path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<CouncilMemberRole>,
}

/// Optional role for a [`CouncilMember`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
#[serde(rename_all = "snake_case")]
pub enum CouncilMemberRole {
    /// Final-answer model. In Second Opinion this model hosts the parent
    /// run and receives private reference guidance.
    Aggregator,
    /// Advisory model. The runtime asks it for private critique/context
    /// rather than letting it act as the final user-facing agent.
    Reference,
}

/// How an AURA Council combines its members' answers once every member
/// has completed. Selected by the user before the run; applied by the
/// synthesizer (`members[0]`) in the final turn the UI renders below the
/// council panel.
///
/// Wire format is snake_case (`synthesize` / `contrast` / `side_by_side`).
/// `#[serde(default)]` on the [`RuntimeRequestType::Council`] field folds
/// older clients that omit it into [`Self::Synthesize`], the prior
/// behavior.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
#[serde(rename_all = "snake_case")]
pub enum CouncilMechanism {
    /// Integrate the members' answers into ONE combined best answer
    /// (the default, original council behavior).
    #[default]
    Synthesize,
    /// Compare the members' answers, explicitly calling out where they
    /// agree and disagree, without forcing a single merged answer.
    Contrast,
    /// Present each member's answer verbatim, side by side, with light
    /// per-member framing and no integration or editorializing.
    SideBySide,
}

impl CouncilMechanism {
    /// Parse a wire string (snake_case, case-insensitive) into a
    /// mechanism. Returns `None` for unknown / empty input so HTTP-edge
    /// callers can fall back to the default rather than failing the
    /// request.
    #[must_use]
    pub fn from_wire(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "synthesize" => Some(Self::Synthesize),
            "contrast" => Some(Self::Contrast),
            "side_by_side" | "side-by-side" | "sidebyside" => Some(Self::SideBySide),
            _ => None,
        }
    }

    /// The canonical snake_case wire string for this mechanism.
    #[must_use]
    pub const fn as_wire(self) -> &'static str {
        match self {
            Self::Synthesize => "synthesize",
            Self::Contrast => "contrast",
            Self::SideBySide => "side_by_side",
        }
    }
}

/// "Who is this agent" bundle.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct AgentIdentity {
    /// Stable template agent UUID — the row in the `agents` table.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template_id: Option<String>,
    /// Partitioned harness agent id, one of:
    /// - `{template}::default`        (bare agent, no instance/session axis)
    /// - `{template}::{instance}`     (per-instance partition)
    /// - `{template}::{instance}::{session}` (per-(instance, session) partition)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub partition_id: Option<String>,
    /// Persona fields rendered into the `<agent_identity>` section
    /// of the assembled system prompt.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub persona: Option<AgentPersona>,
    /// Operator-curated skill names rendered verbatim as `<agent_skills>`
    /// in the assembled system prompt. This is a lightweight prompt hint
    /// only — it is distinct from the harness's per-agent skill *install*
    /// store (keyed by `template_id`), which independently resolves
    /// SKILL.md content, grants tools/permissions, and populates
    /// `SessionReady.skills`. These two lists are not required to match.
    #[serde(default)]
    pub skills: Vec<String>,
    /// Operator-authored system prompt (the "system prompt"
    /// textarea on the agent template). Rendered as
    /// `<agent_system_prompt>`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
}

/// User-selected reasoning-effort tier carried end-to-end from the chat
/// model picker to the router.
///
/// Provider-accurate **superset** — each model only exposes the subset
/// it supports (gated in the aura-os model catalog). `Minimal` is
/// OpenAI's lowest `reasoning_effort` tier; `Max` is Anthropic's largest
/// thinking budget (OpenAI has no `max`, so the router clamps it to
/// `high`). The harness maps these onto its internal Anthropic budget
/// tiers and the router translates them into each provider's native
/// control.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
#[serde(rename_all = "snake_case")]
pub enum ReasoningEffort {
    Minimal,
    Low,
    Medium,
    High,
    Max,
}

impl ReasoningEffort {
    /// Parse a wire string (snake_case, case-insensitive) into a tier.
    ///
    /// Returns `None` for unknown / empty input so HTTP-edge callers
    /// fall back to the harness's internal effort heuristic rather than
    /// failing the request. `xhigh` is accepted for backward
    /// compatibility with clients persisted before the tier rename and
    /// folds into [`Self::High`].
    #[must_use]
    pub fn from_wire(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "minimal" => Some(Self::Minimal),
            "low" => Some(Self::Low),
            "medium" => Some(Self::Medium),
            "high" | "xhigh" => Some(Self::High),
            "max" => Some(Self::Max),
            _ => None,
        }
    }

    /// The canonical snake_case wire string for this tier.
    #[must_use]
    pub const fn as_wire(self) -> &'static str {
        match self {
            Self::Minimal => "minimal",
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::Max => "max",
        }
    }
}

/// "What model to drive the agent with."
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct ModelSelection {
    /// Model identifier (e.g. `"claude-opus-4-7"`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// Maximum tokens per model response.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    /// Maximum agentic steps per turn.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_turns: Option<u32>,
    /// Sampling temperature.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    /// User-selected reasoning-effort tier from the chat model picker's
    /// thinking-level flyout. The harness maps this into its
    /// `ThinkingEffort` enum and hard-pins it across the turn. Absent
    /// for models without effort tiers and for older clients.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<ReasoningEffort>,
    /// Optional per-session model overrides applied on top of the
    /// harness's env-default router config.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_overrides: Option<SessionModelOverrides>,
}

/// "Where the agent runs."
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct WorkspaceLocation {
    /// Workspace directory path (must be under the server's
    /// `workspaces` base).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace: Option<String>,
    /// Absolute path to the real project directory on the host
    /// filesystem.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_path: Option<String>,
    /// Optional remote-git source URL for dev-loop / task-run
    /// kickoffs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub git_repo_url: Option<String>,
    /// Optional remote-git branch paired with [`Self::git_repo_url`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub git_branch: Option<String>,
}

/// "Which project + which billing partition."
///
/// `None` on a [`RuntimeRequest`] means "no project" (ad-hoc chat).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct ProjectContext {
    /// Project UUID for domain tool calls (specs, tasks, etc.).
    pub project_id: String,
    /// Typed project descriptor surfaced into the chat-path system
    /// prompt's `<project_context>` section.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_info: Option<ChatProjectInfoWire>,
    /// Organization UUID for `X-Aura-Org-Id` billing header.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aura_org_id: Option<String>,
    /// Storage session UUID for `X-Aura-Session-Id` billing header.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aura_session_id: Option<String>,
    /// Project-agent UUID for `X-Aura-Agent-Id` billing header.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aura_agent_id: Option<String>,
}

/// "What tools / integrations / intent classifier the agent can use."
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct AgentCapabilities {
    /// Installed tools registered for this run.
    #[serde(default)]
    pub installed_tools: Vec<InstalledTool>,
    /// Installed integrations authorized for this run.
    #[serde(default)]
    pub installed_integrations: Vec<InstalledIntegration>,
    /// Optional keyword-driven intent classifier spec.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub intent_classifier: Option<IntentClassifierSpec>,
    /// Computer-use capability flag. When `true`, the harness exposes
    /// the Anthropic computer-use tool for this run so the agent can
    /// drive the real OS cursor/keyboard and read back screenshots.
    /// Off by default; strictly additive (older producers omit it and
    /// it deserializes to `false`).
    #[serde(default)]
    pub computer_use: bool,
    /// Base URL of the desktop computer-use executor the harness should
    /// forward `computer` actions to (e.g.
    /// `"http://127.0.0.1:<port>"`). `None` disables forwarding even
    /// when [`Self::computer_use`] is set. Additive and omitted from
    /// the wire when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub computer_executor_url: Option<String>,
}

/// Response body of `POST /v1/run`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS), ts(export))]
pub struct RuntimeRunResponse {
    /// Stable identifier for the spawned run.
    pub run_id: String,
    /// Convenience field — the relative WS path the client should
    /// open. Always `/stream/:run_id`.
    pub event_stream_url: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reasoning_effort_serializes_to_snake_case() {
        for (tier, wire) in [
            (ReasoningEffort::Minimal, "\"minimal\""),
            (ReasoningEffort::Low, "\"low\""),
            (ReasoningEffort::Medium, "\"medium\""),
            (ReasoningEffort::High, "\"high\""),
            (ReasoningEffort::Max, "\"max\""),
        ] {
            let json = serde_json::to_string(&tier).expect("serialize tier");
            assert_eq!(json, wire);
            let back: ReasoningEffort = serde_json::from_str(&json).expect("deserialize tier");
            assert_eq!(back, tier);
        }
    }

    #[test]
    fn reasoning_effort_from_wire_is_lenient() {
        assert_eq!(
            ReasoningEffort::from_wire("MINIMAL"),
            Some(ReasoningEffort::Minimal)
        );
        assert_eq!(
            ReasoningEffort::from_wire(" high "),
            Some(ReasoningEffort::High)
        );
        // Legacy clients that persisted the pre-rename `xhigh` tier fold
        // into `High` rather than dropping the selection.
        assert_eq!(
            ReasoningEffort::from_wire("xhigh"),
            Some(ReasoningEffort::High)
        );
        assert_eq!(ReasoningEffort::from_wire("bogus"), None);
        assert_eq!(ReasoningEffort::from_wire(""), None);
    }

    #[test]
    fn model_selection_omits_absent_reasoning_effort() {
        let model = ModelSelection {
            id: Some("aura-gpt-5-5".to_string()),
            ..Default::default()
        };
        let json = serde_json::to_string(&model).expect("serialize selection");
        assert!(
            !json.contains("reasoning_effort"),
            "absent tier must be skipped: {json}"
        );

        let with_effort = ModelSelection {
            reasoning_effort: Some(ReasoningEffort::Max),
            ..Default::default()
        };
        let json = serde_json::to_string(&with_effort).expect("serialize selection");
        assert!(
            json.contains("\"reasoning_effort\":\"max\""),
            "tier must round-trip: {json}"
        );
        let back: ModelSelection = serde_json::from_str(&json).expect("deserialize selection");
        assert_eq!(back.reasoning_effort, Some(ReasoningEffort::Max));
    }

    #[test]
    fn council_mechanism_round_trips_snake_case() {
        for (mechanism, wire) in [
            (CouncilMechanism::Synthesize, "\"synthesize\""),
            (CouncilMechanism::Contrast, "\"contrast\""),
            (CouncilMechanism::SideBySide, "\"side_by_side\""),
        ] {
            let json = serde_json::to_string(&mechanism).expect("serialize mechanism");
            assert_eq!(json, wire);
            let back: CouncilMechanism =
                serde_json::from_str(&json).expect("deserialize mechanism");
            assert_eq!(back, mechanism);
            assert_eq!(mechanism.as_wire(), &wire[1..wire.len() - 1]);
        }
    }

    #[test]
    fn council_mechanism_defaults_to_synthesize() {
        assert_eq!(CouncilMechanism::default(), CouncilMechanism::Synthesize);
        // A council request that omits `mechanism` (older client) folds
        // into the default rather than failing to deserialize.
        let json = r#"{"kind":"council","params":{"members":[],"conversation_messages":[]}}"#;
        let parsed: RuntimeRequestType =
            serde_json::from_str(json).expect("deserialize legacy council request");
        match parsed {
            RuntimeRequestType::Council { mechanism, .. } => {
                assert_eq!(mechanism, CouncilMechanism::Synthesize);
            }
            other => panic!("expected council, got {other:?}"),
        }
    }

    #[test]
    fn council_member_role_is_optional_and_round_trips() {
        let legacy: CouncilMember = serde_json::from_str(r#"{"id":"0","model":{"id":"final"}}"#)
            .expect("deserialize legacy council member");
        assert_eq!(legacy.role, None);

        let member = CouncilMember {
            id: "1".to_string(),
            model: ModelSelection {
                id: Some("reference".to_string()),
                ..ModelSelection::default()
            },
            role: Some(CouncilMemberRole::Reference),
        };
        let json = serde_json::to_string(&member).expect("serialize role");
        assert!(
            json.contains(r#""role":"reference""#),
            "role must be present for second-opinion members: {json}"
        );
        let back: CouncilMember = serde_json::from_str(&json).expect("deserialize role");
        assert_eq!(back.role, Some(CouncilMemberRole::Reference));
    }

    #[test]
    fn council_mechanism_from_wire_is_lenient() {
        assert_eq!(
            CouncilMechanism::from_wire("SIDE_BY_SIDE"),
            Some(CouncilMechanism::SideBySide)
        );
        assert_eq!(
            CouncilMechanism::from_wire("side-by-side"),
            Some(CouncilMechanism::SideBySide)
        );
        assert_eq!(
            CouncilMechanism::from_wire(" contrast "),
            Some(CouncilMechanism::Contrast)
        );
        assert_eq!(CouncilMechanism::from_wire("bogus"), None);
        assert_eq!(CouncilMechanism::from_wire(""), None);
    }
}
