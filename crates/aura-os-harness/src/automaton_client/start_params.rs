use serde::{Deserialize, Serialize};

use aura_protocol::{
    AgentPermissionsWire, InstalledIntegration, InstalledTool, IntentClassifierSpec,
    SessionModelOverrides,
};

#[derive(Debug, Clone, Serialize)]
pub struct AutomatonStartParams {
    pub project_id: String,
    /// Upstream harness `agent_id` for this automaton run.
    ///
    /// After Phase 1c this is the partitioned
    /// `{template}::{agent_instance_id}` key produced by
    /// [`aura_os_core::harness_agent_id`], not the bare template id.
    /// The harness uses this string as the turn-lock key, so two
    /// concurrent dev-loop / single-task runs of the same template
    /// no longer collide once they sit on different partitions.
    /// Skipped on the wire when `None` so pre-Phase-1c harnesses
    /// (which derive `agent_id` from the URL path) keep accepting
    /// the payload.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    /// Stable template agent UUID forwarded to the harness for
    /// `X-Aura-Agent-Id` on proxy `/v1/messages` calls.
    ///
    /// `agent_id` is a partition/turn-lock key for automata; the proxy
    /// billing identity must match chat's `SessionInit::aura_agent_id`
    /// and stay on the template agent so SWE-bench/dev-loop requests
    /// hit the same router bucket as the main Aura OS app.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aura_agent_id: Option<String>,
    /// Template agent id for harness skill / permissions / billing
    /// lookup when `agent_id` carries a partition key
    /// (`{template}::{instance}`). When `None`, the harness falls back
    /// to `agent_id` for skill lookup. Mirrors
    /// `aura_protocol::SessionInit::template_agent_id`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub template_agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Full project-aware system prompt, mirroring `SessionInit::system_prompt`.
    /// The harness uses this to shape the first automaton LLM request the same
    /// way chat/spec sessions are shaped.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
    /// Optional per-session model/router overrides. Dev-loop automata must carry
    /// the same prompt-cache/model override envelope as `SessionInit` so the
    /// router sees an equivalent request shape.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_overrides: Option<SessionModelOverrides>,
    /// Originating end-user id for resolving user-scoped tool defaults.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    /// Optional keyword-driven tool classifier mirrored from the chat session
    /// init path.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub intent_classifier: Option<IntentClassifierSpec>,
    /// Agentic-turn ceiling for the automaton's initial task executor session.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_turns: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_repo_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_tools: Option<Vec<InstalledTool>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_integrations: Option<Vec<InstalledIntegration>>,
    /// Capability + scope bundle for the agent driving this automaton.
    /// The harness applies this to the same kernel policy gate used by
    /// chat sessions, so dev-loop runs inherit the agent's real tool
    /// capabilities instead of falling back to an empty bundle.
    pub agent_permissions: AgentPermissionsWire,
    /// Retry-warm-up: the reason text persisted on the previous
    /// attempt's `task_failed` record. Forwarded verbatim to the
    /// harness as `prior_failure`; the `task-run` automaton folds it
    /// into `TaskInfo::execution_notes` so the retry prompt differs
    /// from the initial one. Skipped on the wire when `None` so
    /// pre-C1 harnesses (which don't know about this field) still
    /// accept the payload.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prior_failure: Option<String>,
    /// Retry-warm-up: recent work-log entries the server wants the
    /// agent to re-see on this attempt. Forwarded to the harness as
    /// `work_log`; threaded straight into `AgenticTaskParams
    /// ::work_log`. Skipped on the wire when empty so pre-C1
    /// harnesses see the old payload shape.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub work_log: Vec<String>,
    /// Org UUID forwarded to the harness so the outbound Anthropic
    /// proxy request carries an `X-Aura-Org-Id` header. The chat path
    /// already sets this via `SessionConfig::aura_org_id`
    /// (see `crates/aura-os-harness/src/harness.rs`); the dev-loop
    /// / single-task path went without it until now, which left
    /// `aura-router` (and Cloudflare in front of it) without per-org
    /// bucketing context for automation runs and made eval bursts
    /// trip the WAF rule earlier than interactive chat from the same
    /// account. Skipped on the wire when `None` so older harnesses
    /// (which `#[serde(default)]` the field) still accept the payload.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aura_org_id: Option<String>,
    /// Storage session UUID forwarded to the harness so the outbound
    /// Anthropic proxy request carries an `X-Aura-Session-Id` header.
    /// Generated per-automaton-start so router / billing telemetry can
    /// distinguish concurrent automation runs of the same agent.
    /// Skipped on the wire when `None`; pre-existing harnesses ignore
    /// it via `#[serde(default)]`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aura_session_id: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum AutomatonStartError {
    #[error("a dev loop is already running (automaton_id: {0:?})")]
    Conflict(Option<String>),
    #[error("{message}")]
    Request {
        message: String,
        is_connect: bool,
        is_timeout: bool,
    },
    #[error("harness start returned status {status}: {body}")]
    Response { status: u16, body: String },
    #[error("{0}")]
    Other(#[from] anyhow::Error),
}

#[derive(Debug, Clone, Deserialize)]
pub struct AutomatonStartResult {
    #[serde(alias = "id")]
    pub automaton_id: String,
    #[serde(alias = "ws_url", alias = "stream_url")]
    pub event_stream_url: String,
}
