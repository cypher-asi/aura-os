//! `AutomatonStartParams` assembly plus the stable per-(project, agent-instance, task) session UUID derivation that keeps Cloudflare's WAF score from restarting on every dev-loop tick.

use aura_os_core::{harness_agent_id, AgentInstanceId, Project};
use aura_os_harness::AutomatonStartParams;
use aura_protocol::{AgentPersona, ChatProjectInfoWire};

use crate::handlers::agents::session_model_overrides_with_cache;
use crate::handlers::agents::tool_dedupe::dedupe_and_log_installed_tools;
use crate::handlers::agents::workspace_tools::{
    installed_workspace_app_tools, installed_workspace_integrations_for_org_with_token,
};
use crate::state::AppState;

use super::super::loop_engineering::{augment_system_prompt, LoopEngineeringContract};
use super::super::types::StartContext;

/// Inputs for [`build_start_params`]. Bundled to keep the helper
/// under the project's five-parameter ceiling without disturbing the
/// downstream wire shape.
pub(crate) struct StartParamsInputs<'a> {
    pub(crate) state: &'a AppState,
    pub(crate) ctx: &'a StartContext,
    pub(crate) agent_instance_id: AgentInstanceId,
    pub(crate) jwt: Option<String>,
    pub(crate) user_id: Option<String>,
    pub(crate) task_id: Option<String>,
    pub(crate) loop_engineering: Option<&'a LoopEngineeringContract>,
}

pub(crate) async fn build_start_params(inputs: StartParamsInputs<'_>) -> AutomatonStartParams {
    let StartParamsInputs {
        state,
        ctx,
        agent_instance_id,
        jwt,
        user_id,
        task_id,
        loop_engineering,
    } = inputs;
    let installed_tools = resolve_installed_tools(state, ctx, jwt.as_deref()).await;
    let installed_integrations = resolve_installed_integrations(state, ctx, jwt.as_deref()).await;
    let aura_org_id = resolve_aura_org_id(ctx);
    // Stable per-(project, agent-instance, task) session UUID so
    // Cloudflare's `(IP, X-Aura-Session-Id)` bucket score doesn't
    // reset on every dev-loop restart. See [`stable_dev_loop_session_id`].
    let aura_session_id = stable_dev_loop_session_id(
        &ctx.project_id.to_string(),
        &agent_instance_id.to_string(),
        task_id.as_deref(),
    );
    assemble_automaton_start_params(AssembleInputs {
        ctx,
        agent_instance_id,
        jwt,
        user_id,
        task_id,
        installed_tools,
        installed_integrations,
        aura_org_id,
        aura_session_id,
        loop_engineering,
    })
}

/// Bundled inputs for [`assemble_automaton_start_params`]. Pulled
/// out of [`build_start_params`] so the assembly call site stays
/// under the project's five-parameter ceiling.
struct AssembleInputs<'a> {
    ctx: &'a StartContext,
    agent_instance_id: AgentInstanceId,
    jwt: Option<String>,
    user_id: Option<String>,
    task_id: Option<String>,
    installed_tools: Option<Vec<aura_os_harness::InstalledTool>>,
    installed_integrations: Option<Vec<aura_os_harness::InstalledIntegration>>,
    aura_org_id: Option<String>,
    aura_session_id: String,
    loop_engineering: Option<&'a LoopEngineeringContract>,
}

/// Project all the resolved-once inputs onto a fresh
/// [`AutomatonStartParams`] in the canonical field order. Carved out
/// of [`build_start_params`] so the entry-point stays inside the
/// 50-line per-function budget while still constructing the same
/// wire-shape verbatim.
fn assemble_automaton_start_params(inputs: AssembleInputs<'_>) -> AutomatonStartParams {
    let AssembleInputs {
        ctx,
        agent_instance_id,
        jwt,
        user_id,
        task_id,
        installed_tools,
        installed_integrations,
        aura_org_id,
        aura_session_id,
        loop_engineering,
    } = inputs;
    let (git_repo_url, git_branch) = git_fields(ctx);
    AutomatonStartParams {
        project_id: ctx.project_id.to_string(),
        agent_id: Some(harness_agent_id(
            &ctx.agent_id,
            Some(&agent_instance_id),
            None,
        )),
        aura_agent_id: Some(ctx.agent_id.to_string()),
        template_agent_id: Some(ctx.agent_id.to_string()),
        auth_token: jwt,
        model: ctx.model.clone(),
        provider_overrides: start_provider_overrides(ctx, agent_instance_id),
        user_id,
        intent_classifier: ctx.intent_classifier.clone(),
        // Wire-level dead field: the harness's `AutomatonStartRequest`
        // has no `max_turns`; the dev-loop cap is
        // `AgentRunnerConfig::max_agentic_iterations` (40) inside the
        // harness. `None` makes serde skip the field via
        // `skip_serializing_if`. See the doc on the struct field in
        // `aura_os_harness::AutomatonStartParams`.
        max_turns: None,
        workspace_root: Some(ctx.workspace_root.clone()),
        task_id,
        git_repo_url,
        git_branch,
        prior_failure: None,
        work_log: Vec::new(),
        installed_tools,
        installed_integrations,
        agent_permissions: (&ctx.permissions).into(),
        // Per-tool tri-state overrides persisted on the agent record.
        // Forwarded so dev-loop / single-task automation runs respect
        // the same Permissions-tab tool toggles as chat sessions.
        tool_permissions: (!ctx.permissions.tool_permissions.is_empty())
            .then(|| (&ctx.permissions.tool_permissions).into()),
        aura_org_id,
        aura_session_id,
        // PR C: forward the typed identity bundle resolved by
        // `resolve_start_context`. The harness `SystemPromptBuilder`
        // renders these as `<agent_identity>` / `<agent_skills>` /
        // `<agent_system_prompt>` sections. Empty / blank values are
        // dropped wire-side by `skip_serializing_if`, so legacy /
        // blank agent rows produce no `<agent_*>` bytes.
        agent_identity: start_agent_identity(ctx),
        agent_skills: ctx.agent_skills.clone(),
        agent_system_prompt: augment_system_prompt(&ctx.agent_system_prompt, loop_engineering),
        // Forward the typed project descriptor so dev-loop / task-run
        // automata render the same `<project_context>` as chat and the
        // harness's `agents_md_from_workspace()` can locate `AGENTS.md`
        // from `workspace_root`. Chat carries this via
        // `SessionConfig::project_info`; the automaton path went
        // without it (hardcoded `project_info: None`) until now.
        project_info: start_project_info(ctx),
    }
}

/// Build the typed [`ChatProjectInfoWire`] descriptor off the resolved
/// [`StartContext`], mirroring the chat path's
/// `build_typed_session_fields` project block. Returns `None` when the
/// project record is unavailable so the harness skips
/// `<project_context>` rather than emitting an empty envelope. The
/// `workspace_root` is the dev-loop run's resolved workspace path —
/// the same value forwarded as `WorkspaceLocation::project_path` — so
/// the harness reads `AGENTS.md` from the run's actual checkout.
fn start_project_info(ctx: &StartContext) -> Option<ChatProjectInfoWire> {
    let project = ctx.project.as_ref()?;
    Some(ChatProjectInfoWire {
        id: ctx.project_id.to_string(),
        name: project.name.clone(),
        description: project.description.clone(),
        workspace_root: ctx.workspace_root.clone(),
        build_command: project.build_command.clone().unwrap_or_default(),
        test_command: project.test_command.clone().unwrap_or_default(),
    })
}

/// Project the per-agent identity prose off the resolved
/// [`StartContext`] into the wire shape. Returns `None` (which
/// `#[serde(skip_serializing_if = "Option::is_none")]` then drops from
/// the JSON payload) when every field is blank, so the harness keeps
/// `<agent_identity>` out of the assembled prompt for legacy rows.
fn start_agent_identity(ctx: &StartContext) -> Option<AgentPersona> {
    let wire = AgentPersona {
        name: ctx.agent_name.clone(),
        role: ctx.agent_role.clone(),
        personality: ctx.agent_personality.clone(),
    };
    (!wire.is_empty()).then_some(wire)
}

/// Build the per-loop provider-override map with a 24h cache key
/// scoped to the (project, agent-instance) pair. Carved out of
/// [`assemble_automaton_start_params`] so its body stays inside
/// the 50-line per-function budget. Cache key format matches the
/// pre-refactor code verbatim.
fn start_provider_overrides(
    ctx: &StartContext,
    agent_instance_id: AgentInstanceId,
) -> Option<aura_protocol::SessionModelOverrides> {
    session_model_overrides_with_cache(
        ctx.model.as_deref(),
        Some(format!("devloop:{}:{}", ctx.project_id, agent_instance_id)),
        Some("24h"),
    )
}
/// Project git fields off the start context: the project's
/// configured `git_repo_url` and `git_branch` (if any). Carved out of
/// [`assemble_automaton_start_params`] so its body stays inside the
/// 50-line per-function budget; values are preserved verbatim.
fn git_fields(ctx: &StartContext) -> (Option<String>, Option<String>) {
    let git_repo_url = resolve_git_repo_url(ctx.project.as_ref());
    let git_branch = ctx
        .project
        .as_ref()
        .and_then(|project| project.git_branch.clone());
    (git_repo_url, git_branch)
}

/// Resolve the project's installed workspace-app tool list. Returns
/// `None` when the caller has no JWT to authenticate the integration
/// API call OR the project has no owning org. The dedupe+log helper
/// is run on the result so the start log stays readable when the
/// same tool is installed twice.
async fn resolve_installed_tools(
    state: &AppState,
    ctx: &StartContext,
    jwt: Option<&str>,
) -> Option<Vec<aura_os_harness::InstalledTool>> {
    let (jwt, org_id) = jwt.zip(ctx.project.as_ref().map(|p| &p.org_id))?;
    let mut tools = installed_workspace_app_tools(state, org_id, jwt).await;
    dedupe_and_log_installed_tools("dev_loop_start", &ctx.project_id.to_string(), &mut tools);
    (!tools.is_empty()).then_some(tools)
}

/// Resolve the project's installed workspace integrations. Returns
/// `None` for the same "missing JWT / missing project" preconditions
/// as [`resolve_installed_tools`] or when the project has no
/// integrations enabled.
async fn resolve_installed_integrations(
    state: &AppState,
    ctx: &StartContext,
    jwt: Option<&str>,
) -> Option<Vec<aura_os_harness::InstalledIntegration>> {
    let (project, jwt) = ctx.project.as_ref().zip(jwt)?;
    let integrations =
        installed_workspace_integrations_for_org_with_token(state, &project.org_id, jwt).await;
    (!integrations.is_empty()).then_some(integrations)
}

/// Resolve the `X-Aura-Org-Id` value the harness will forward on
/// outbound `/v1/messages` calls. Prefers the explicit
/// `agent_org_id` stamped on the `StartContext` and falls back to
/// the project's org id. Without this header `aura-router` falls back
/// to IP-bucket rate limiting (the eval local-stack failure mode).
fn resolve_aura_org_id(ctx: &StartContext) -> Option<String> {
    ctx.agent_org_id
        .as_ref()
        .map(ToString::to_string)
        .or_else(|| {
            ctx.project
                .as_ref()
                .map(|project| project.org_id.to_string())
        })
}

/// Derive a stable session UUID for the (project, agent-instance, task)
/// tuple that owns this dev-loop run.
///
/// The harness forwards this string as the `X-Aura-Session-Id` header on
/// every outbound `/v1/messages` call. Cloudflare's WAF in front of
/// `aura-router.onrender.com` scores requests partly on per-session
/// novelty: a brand-new session id arriving with a 60+ KB POST from a
/// non-browser User-Agent looks indistinguishable from automated abuse,
/// and the eval pipeline (which restarts the dev loop on every tick /
/// failure) was generating one fresh `Uuid::new_v4()` per start, hot-pathing
/// the managed challenge that the desktop app's stable chat session never
/// touches.
///
/// Using `Uuid::new_v5` over a fixed namespace + a `(project, instance,
/// task)` payload keeps the id constant for any restart of the same
/// logical run while still keeping concurrent runs of distinct
/// instances / tasks on distinct billing partitions. The DNS namespace is
/// arbitrary — any well-known constant works since we never round-trip
/// the namespace itself.
pub(super) fn stable_dev_loop_session_id(
    project_id: &str,
    agent_instance_id: &str,
    task_id: Option<&str>,
) -> String {
    let task_segment = task_id.unwrap_or("dev_loop");
    let payload = format!("aura-os/dev-loop:{project_id}:{agent_instance_id}:{task_segment}");
    uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_DNS, payload.as_bytes()).to_string()
}

pub(super) fn resolve_git_repo_url(project: Option<&Project>) -> Option<String> {
    let project = project?;
    project
        .git_repo_url
        .clone()
        .filter(|url| !url.is_empty())
        .or_else(|| {
            let owner = project.orbit_owner.as_deref()?.trim();
            let repo = project.orbit_repo.as_deref()?.trim();
            let base = project
                .orbit_base_url
                .clone()
                .or_else(|| std::env::var("ORBIT_BASE_URL").ok())?;
            (!owner.is_empty() && !repo.is_empty() && !base.trim().is_empty())
                .then(|| format!("{}/{owner}/{repo}.git", base.trim().trim_end_matches('/')))
        })
}
