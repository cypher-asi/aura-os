//! `AutomatonStartParams` assembly plus the stable per-(project, agent-instance, task) session UUID derivation that keeps Cloudflare's WAF score from restarting on every dev-loop tick.

use aura_os_core::{harness_agent_id, AgentInstanceId, Project};
use aura_os_harness::AutomatonStartParams;

use crate::handlers::agents::chat::build_project_system_prompt;
use crate::handlers::agents::session_model_overrides_with_cache;
use crate::handlers::agents::tool_dedupe::dedupe_and_log_installed_tools;
use crate::handlers::agents::workspace_tools::{
    installed_workspace_app_tools, installed_workspace_integrations_for_org_with_token,
};
use crate::handlers::projects_helpers::project_tool_max_turns;
use crate::state::AppState;

use super::super::types::StartContext;

pub(crate) async fn build_start_params(
    state: &AppState,
    ctx: &StartContext,
    agent_instance_id: AgentInstanceId,
    jwt: Option<String>,
    user_id: Option<String>,
    task_id: Option<String>,
) -> AutomatonStartParams {
    let installed_tools = match jwt.as_deref().zip(ctx.project.as_ref().map(|p| &p.org_id)) {
        Some((jwt, org_id)) => {
            let mut tools = installed_workspace_app_tools(state, org_id, jwt).await;
            dedupe_and_log_installed_tools(
                "dev_loop_start",
                &ctx.project_id.to_string(),
                &mut tools,
            );
            (!tools.is_empty()).then_some(tools)
        }
        None => None,
    };
    let installed_integrations = match ctx.project.as_ref().zip(jwt.as_deref()) {
        Some((project, jwt)) => {
            let integrations =
                installed_workspace_integrations_for_org_with_token(state, &project.org_id, jwt)
                    .await;
            (!integrations.is_empty()).then_some(integrations)
        }
        None => None,
    };
    // Resolve the project's org so the harness can forward
    // `X-Aura-Org-Id` on outbound `/v1/messages` calls. The chat path
    // populates this via `SessionConfig::aura_org_id` from the agent
    // instance's `org_id`; for dev-loop runs the project (already on
    // `StartContext`) is the canonical org owner — instances are
    // scoped to a single project, so `project.org_id` matches
    // `instance.org_id` and saves a redundant lookup.
    //
    // Why this matters: without this header `aura-router` falls back
    // to IP-bucket rate limiting, which is exactly what the eval
    // local-stack was hitting (Cloudflare WAF on
    // `aura-router.onrender.com` tripping on bursty automation
    // traffic that interactive chat from the same account never
    // reproduces).
    let aura_org_id = ctx
        .agent_org_id
        .as_ref()
        .map(ToString::to_string)
        .or_else(|| {
            ctx.project
                .as_ref()
                .map(|project| project.org_id.to_string())
        });
    // Stable per-(project, agent-instance, task) session UUID. The
    // router / Cloudflare WAF buckets by `(IP, X-Aura-Session-Id)`
    // when scoring "is this automated traffic?", so a fresh
    // `Uuid::new_v4()` per dev-loop start made every restart look
    // like a brand-new client — and the swebench eval, which
    // recreates the dev-loop on every tick / failure, kept tripping
    // the managed-rule challenge that the desktop app's stable chat
    // session never hits. Deriving from the (project, instance,
    // task) tuple keeps the session id constant across restarts of
    // the same logical run while still partitioning concurrent runs
    // of different instances or tasks for billing / telemetry —
    // mirroring `SessionConfig::aura_session_id` for chat (which
    // reuses the persisted chat-session id across reconnects).
    let aura_session_id = Some(stable_dev_loop_session_id(
        &ctx.project_id.to_string(),
        &agent_instance_id.to_string(),
        task_id.as_deref(),
    ));

    let params = AutomatonStartParams {
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
        system_prompt: Some(build_project_system_prompt(
            state,
            &ctx.project_id,
            &ctx.agent_system_prompt,
            Some(&ctx.workspace_root),
        )),
        provider_overrides: session_model_overrides_with_cache(
            ctx.model.as_deref(),
            Some(format!("devloop:{}:{}", ctx.project_id, agent_instance_id)),
            Some("24h"),
        ),
        user_id,
        intent_classifier: ctx.intent_classifier.clone(),
        max_turns: Some(project_tool_max_turns()),
        workspace_root: Some(ctx.workspace_root.clone()),
        task_id,
        git_repo_url: resolve_git_repo_url(ctx.project.as_ref()),
        git_branch: ctx
            .project
            .as_ref()
            .and_then(|project| project.git_branch.clone()),
        prior_failure: None,
        work_log: Vec::new(),
        installed_tools,
        installed_integrations,
        agent_permissions: (&ctx.permissions).into(),
        aura_org_id,
        aura_session_id,
    };

    params
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
