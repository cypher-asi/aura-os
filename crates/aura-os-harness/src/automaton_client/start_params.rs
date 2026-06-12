use serde::Serialize;

use aura_protocol::{
    AgentCapabilities, AgentIdentity, AgentPermissionsWire, AgentPersona, AgentToolPermissionsWire,
    ChatProjectInfoWire, InstalledIntegration, InstalledTool, IntentClassifierSpec, ModelSelection,
    ProjectContext, RuntimeRequest, RuntimeRequestType, SessionModelOverrides, WorkspaceLocation,
};

#[derive(Debug, Clone, Serialize)]
pub struct AutomatonStartParams {
    pub project_id: String,
    /// Upstream harness `agent_id` for this automaton run.
    ///
    /// This is the partitioned `{template}::{agent_instance_id}` key
    /// produced by [`aura_os_core::harness_agent_id`], not the bare
    /// template id. The harness uses this string as the turn-lock
    /// key, so two concurrent dev-loop / single-task runs of the
    /// same template no longer collide once they sit on different
    /// partitions. Skipped on the wire when `None` so older harnesses
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
    ///
    /// Wire-level asymmetry: the harness's `AutomatonStartRequest` (the
    /// dev-loop / single-task entry point) has no `max_turns` field and
    /// silently drops this on deserialisation; that path's cap is
    /// `AgentRunnerConfig::max_agentic_iterations` (40) inside the harness.
    /// The dev-loop call site therefore leaves this `None`. Chat /
    /// project-tool / public-chat sessions are unaffected: they route
    /// `max_turns` through `aura_protocol::SessionInit::max_turns`, a
    /// distinct harness type which the harness DOES consume.
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
    /// Per-tool tri-state overrides persisted on the agent record
    /// (Permissions tab). Layered on top of `agent_permissions` by the
    /// harness exactly like chat sessions, so an operator who turned a
    /// tool `off` for an agent sees that respected in dev-loop /
    /// single-task automation runs too. Skipped on the wire when
    /// `None` so older harnesses keep accepting the payload.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_permissions: Option<AgentToolPermissionsWire>,
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
    /// PR B (simplify-system-prompts): typed agent identity bundle.
    ///
    /// The harness's `AutomatonStartRequest` reads this back into
    /// `AgenticTaskParams::agent.identity` and renders the
    /// `<agent_identity>` section once PR C flips the producer side
    /// in `assemble_automaton_start_params`. PR B leaves this `None`
    /// at every call site, `skip_serializing_if` keeps the wire shape
    /// identical with PR A so the harness reads the field as default.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_identity: Option<AgentPersona>,
    /// PR B (simplify-system-prompts): operator-curated skills list.
    /// Same default-empty / serialise-when-populated contract as
    /// [`AutomatonStartParams::agent_identity`].
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub agent_skills: Vec<String>,
    /// PR B (simplify-system-prompts): operator-authored system prompt
    /// (the "system prompt" textarea on the agent template). Same
    /// default-`None` / serialise-when-populated contract as
    /// [`AutomatonStartParams::agent_identity`].
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_system_prompt: Option<String>,
    /// Typed project descriptor surfaced into the harness
    /// `SystemPromptBuilder`'s `<project_context>` section, mirroring
    /// the chat path's [`crate::SessionConfig::project_info`]. Carries
    /// the `workspace_root` the harness's `agents_md_from_workspace()`
    /// uses to locate `AGENTS.md`, so autonomous runs render the same
    /// project context (and pick up `AGENTS.md`) as interactive chat.
    /// Skipped on the wire when `None` so pre-existing harnesses keep
    /// accepting the payload via `#[serde(default)]`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_info: Option<ChatProjectInfoWire>,
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

/// Convert an [`AutomatonStartParams`] into the canonical
/// [`RuntimeRequest`] body of `POST /v1/run`.
///
/// Maps `task_id` presence to [`RuntimeRequestType::TaskRun`] versus
/// [`RuntimeRequestType::DevLoop`]. Chat-session kickoffs do not go
/// through this builder — they construct a [`RuntimeRequest::r#type`]
/// of [`RuntimeRequestType::Chat`] directly from
/// [`crate::harness::build_runtime_request`].
#[must_use]
pub fn automaton_start_params_to_runtime_request(params: &AutomatonStartParams) -> RuntimeRequest {
    let r#type = match params.task_id.clone() {
        Some(task_id) => RuntimeRequestType::TaskRun {
            task_id,
            prior_failure: params.prior_failure.clone(),
            work_log: params.work_log.clone(),
        },
        None => RuntimeRequestType::DevLoop {},
    };
    RuntimeRequest {
        r#type,
        agent_identity: AgentIdentity {
            template_id: params.template_agent_id.clone(),
            partition_id: params.agent_id.clone(),
            persona: params.agent_identity.clone().filter(|p| !p.is_empty()),
            skills: params.agent_skills.clone(),
            system_prompt: params
                .agent_system_prompt
                .clone()
                .filter(|s| !s.trim().is_empty()),
        },
        model: ModelSelection {
            id: params.model.clone(),
            max_tokens: None,
            max_turns: params.max_turns,
            temperature: None,
            // Dev-loop / automaton runs keep the harness's internal
            // effort taper; no user-selected thinking level applies.
            reasoning_effort: None,
            provider_overrides: params.provider_overrides.clone(),
        },
        workspace: WorkspaceLocation {
            workspace: None,
            project_path: params.workspace_root.clone(),
            git_repo_url: params.git_repo_url.clone(),
            git_branch: params.git_branch.clone(),
        },
        project: Some(ProjectContext {
            project_id: params.project_id.clone(),
            project_info: params.project_info.clone(),
            aura_org_id: params.aura_org_id.clone(),
            aura_session_id: params.aura_session_id.clone(),
            aura_agent_id: params.aura_agent_id.clone(),
        }),
        agent_permissions: params.agent_permissions.clone(),
        tool_permissions: params.tool_permissions.clone(),
        agent_capabilities: AgentCapabilities {
            installed_tools: params.installed_tools.clone().unwrap_or_default(),
            installed_integrations: params.installed_integrations.clone().unwrap_or_default(),
            intent_classifier: params.intent_classifier.clone(),
            // Computer-use is a chat/demo-session capability only;
            // dev-loop / single-task automata never drive the real
            // desktop. TODO: thread these through `AutomatonStartParams`
            // if a headless automaton ever needs computer-use.
            computer_use: false,
            computer_executor_url: None,
        },
        auth_jwt: params.auth_token.clone(),
        user_id: params.user_id.clone().unwrap_or_default(),
    }
}
