//! Dev-loop "start" surface: resolves the agent-instance context (workspace, model, permissions) for a new run and exposes the `build_start_params` / `start_or_adopt` / `map_start_error` helpers consumed by the adapter handlers.

mod params;
mod start_or_adopt;

use std::sync::Arc;

use aura_os_core::{AgentInstanceId, HarnessMode, Project, ProjectId};
use aura_os_harness::HarnessLink;

use crate::error::{ApiError, ApiResult};
use crate::handlers::projects_helpers::{
    resolve_agent_instance_workspace_path, slugify, validate_workspace_is_initialised,
};
use crate::state::AppState;

use super::harness_transport::harness_for_base_url;
use super::types::StartContext;

pub(super) use params::{build_start_params, StartParamsInputs};
pub(super) use start_or_adopt::{map_start_error, run_status_indicates_active, start_or_adopt};

pub(super) async fn resolve_start_context(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    jwt: &str,
    requested_model: Option<String>,
) -> ApiResult<StartContext> {
    let project = state.project_service.get_project(&project_id).ok();
    let agent_instance = load_agent_instance(state, &project_id, &agent_instance_id).await?;
    let mode = agent_instance.harness_mode();
    let (client, harness_base_url, harness_auth_token) =
        automaton_client_for_mode(state, mode, &agent_instance.agent_id.to_string(), jwt)?;
    let workspace_root = resolve_workspace(ResolveWorkspaceInputs {
        state,
        client: &client,
        auth_token: harness_auth_token.as_deref(),
        mode,
        project_id,
        project: project.as_ref(),
        agent_instance_id,
    })
    .await?;
    preflight_local_workspace(
        mode,
        &workspace_root,
        params::resolve_git_repo_url(project.as_ref()).as_deref(),
    )?;
    let model = require_model(pick_model(requested_model, &agent_instance))?;
    let permissions = normalize_permissions(&agent_instance, &project_id);
    Ok(StartContext {
        client,
        harness_base_url,
        harness_auth_token,
        project_id,
        project,
        model: Some(model),
        workspace_root,
        agent_id: agent_instance.agent_id,
        agent_system_prompt: agent_instance.system_prompt,
        // PR C: forward the full identity bundle so the harness
        // `SystemPromptBuilder` can render `<agent_identity>` /
        // `<agent_skills>` alongside the operator-authored prompt.
        agent_name: agent_instance.name,
        agent_role: agent_instance.role,
        agent_personality: agent_instance.personality,
        agent_skills: agent_instance.skills,
        agent_org_id: agent_instance.org_id,
        intent_classifier: agent_instance.intent_classifier,
        permissions,
    })
}

/// Look up the agent instance, mapping `AgentError::NotFound` to a
/// 404 `ApiError`. Carved out of [`resolve_start_context`] so its body
/// stays inside the 50-line per-function budget.
async fn load_agent_instance(
    state: &AppState,
    project_id: &ProjectId,
    agent_instance_id: &AgentInstanceId,
) -> ApiResult<aura_os_core::AgentInstance> {
    state
        .agent_instance_service
        .get_instance(project_id, agent_instance_id)
        .await
        .map_err(|e| match e {
            aura_os_agents::AgentError::NotFound => {
                ApiError::not_found(format!("agent instance {agent_instance_id} not found"))
            }
            other => ApiError::internal(format!("looking up agent instance: {other}")),
        })
}

/// Pick the effective model for the start request: an explicit request
/// trims-and-wins, then `default_model`, then `model`. Carved out of
/// [`resolve_start_context`] so its body stays inside the 50-line
/// per-function budget.
fn pick_model(
    requested_model: Option<String>,
    agent_instance: &aura_os_core::AgentInstance,
) -> Option<String> {
    requested_model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| agent_instance.default_model.clone())
        .or_else(|| agent_instance.model.clone())
}

/// Require an explicit model on every dev-loop / task-run start. The
/// harness rejects an unset `model` with HTTP 400
/// `missing model — task run request must include an explicit model
/// identifier`, and the dev-loop's `map_start_error` in turn folds
/// that 400 into a generic 502 `bad_gateway` — which surfaces in the
/// AutomationBar / RunTaskButton as an unhelpful "Bad Gateway" toast
/// that hides the real cause (the FE forgot to attach a model id when
/// the chat-UI store hadn't been hydrated for this agent yet). Bail
/// here with a structured 400 so the FE can show a clear "pick a
/// model" message instead of a transient-looking 502.
fn require_model(model: Option<String>) -> ApiResult<String> {
    model.ok_or_else(|| {
        ApiError::bad_request(
            "no model selected for run; pass ?model=<id> or set the agent's default_model",
        )
    })
}

/// Normalize the agent instance's permissions for dev-loop execution.
/// Carved out of [`resolve_start_context`] so its body stays inside the
/// 50-line per-function budget. Mirrors the previous inline chain
/// verbatim.
fn normalize_permissions(
    agent_instance: &aura_os_core::AgentInstance,
    project_id: &ProjectId,
) -> aura_os_core::AgentPermissions {
    agent_instance
        .permissions
        .clone()
        .normalized_for_identity(&agent_instance.name, Some(agent_instance.role.as_str()))
        .with_project_self_caps(&project_id.to_string())
        .with_dev_loop_execution_caps()
}

/// Resolve the canonical harness transport for `mode`, plus the base
/// URL and bearer token to drive it.
///
/// Both modes ride the canonical `POST /v1/run` + `WS /stream/:run_id`
/// surface; they differ only in base URL and
/// auth. Local shares `state.local_harness` (identity travels in the
/// request body, no Authorization header — matching the pre-migration
/// no-auth `AutomatonClient`); swarm builds a per-request transport
/// against the gateway's `/v1/agents/:id` base and bears the caller's
/// JWT.
fn automaton_client_for_mode(
    state: &AppState,
    mode: HarnessMode,
    swarm_agent_id: &str,
    jwt: &str,
) -> ApiResult<(Arc<dyn HarnessLink>, String, Option<String>)> {
    match mode {
        HarnessMode::Local => Ok((
            state.local_harness.clone(),
            aura_os_harness::local_harness_base_url(),
            None,
        )),
        HarnessMode::Swarm => {
            let base = state
                .swarm_base_url
                .as_deref()
                .ok_or_else(|| ApiError::service_unavailable("swarm gateway is not configured"))?;
            let agent_base = format!(
                "{}/v1/agents/{}",
                base.trim_end_matches('/'),
                swarm_agent_id
            );
            Ok((
                Arc::new(harness_for_base_url(agent_base.clone(), Some(jwt))),
                agent_base,
                Some(jwt.to_string()),
            ))
        }
    }
}

/// Inputs for [`resolve_workspace`]. Bundled so the helper signature
/// stays inside the project's five-parameter ceiling.
struct ResolveWorkspaceInputs<'a> {
    state: &'a AppState,
    client: &'a Arc<dyn HarnessLink>,
    auth_token: Option<&'a str>,
    mode: HarnessMode,
    project_id: ProjectId,
    project: Option<&'a Project>,
    agent_instance_id: AgentInstanceId,
}

async fn resolve_workspace(inputs: ResolveWorkspaceInputs<'_>) -> ApiResult<String> {
    let ResolveWorkspaceInputs {
        state,
        client,
        auth_token,
        mode,
        project_id,
        project,
        agent_instance_id,
    } = inputs;
    if mode == HarnessMode::Swarm {
        let name = project.map(|p| p.name.as_str()).unwrap_or("");
        if let Ok(path) = client.resolve_workspace(name, auth_token).await {
            return Ok(path);
        }
        return Ok(format!("/home/aura/{}", slugify(name)));
    }
    resolve_agent_instance_workspace_path(state, &project_id, Some(agent_instance_id))
        .await
        .ok_or_else(|| {
            ApiError::bad_request("workspace path could not be resolved for agent instance")
        })
}

fn preflight_local_workspace(
    mode: HarnessMode,
    project_path: &str,
    git_repo_url: Option<&str>,
) -> ApiResult<()> {
    if mode != HarnessMode::Local {
        return Ok(());
    }
    let path = std::path::Path::new(project_path);
    match validate_workspace_is_initialised(path) {
        Ok(()) => Ok(()),
        Err(err) => {
            let bootstrap_pending = git_repo_url.is_some_and(|url| !url.trim().is_empty());
            if bootstrap_pending
                && matches!(
                    err,
                    crate::handlers::projects_helpers::WorkspacePreflightError::Empty
                        | crate::handlers::projects_helpers::WorkspacePreflightError::NotAGitRepo
                )
            {
                Ok(())
            } else {
                Err(ApiError::bad_request(err.remediation_hint(path)))
            }
        }
    }
}

#[cfg(test)]
mod stable_session_id_tests {
    use super::params::stable_dev_loop_session_id;

    const PROJECT: &str = "36d4494f-75df-4c02-84d5-07aef06d2569";
    const INSTANCE: &str = "29c9ee0f-3e81-4f00-8ad0-a1ae0e29a586";

    #[test]
    fn stable_across_restarts_for_same_tuple() {
        // The whole point: same (project, instance, task) → same UUID
        // every time, so Cloudflare's per-session WAF score doesn't
        // restart from zero on every dev-loop tick.
        let a = stable_dev_loop_session_id(PROJECT, INSTANCE, None);
        let b = stable_dev_loop_session_id(PROJECT, INSTANCE, None);
        assert_eq!(a, b, "session id must be deterministic for the same tuple");
        // Sanity: it parses as a UUID.
        assert!(
            uuid::Uuid::parse_str(&a).is_ok(),
            "must produce a valid UUID"
        );
    }

    #[test]
    fn distinct_per_project() {
        let a = stable_dev_loop_session_id("11111111-1111-1111-1111-111111111111", INSTANCE, None);
        let b = stable_dev_loop_session_id("22222222-2222-2222-2222-222222222222", INSTANCE, None);
        assert_ne!(a, b, "different projects must get distinct session ids");
    }

    #[test]
    fn distinct_per_agent_instance() {
        let a = stable_dev_loop_session_id(PROJECT, "aaaaaaaa-1111-1111-1111-111111111111", None);
        let b = stable_dev_loop_session_id(PROJECT, "bbbbbbbb-2222-2222-2222-222222222222", None);
        assert_ne!(
            a, b,
            "different agent instances must get distinct session ids"
        );
    }

    #[test]
    fn distinct_dev_loop_vs_task_run() {
        // A dev-loop run and a task-runner run on the same project/
        // instance are different logical sessions for billing — and
        // crucially the task-runner is short-lived, so it must not
        // poison the long-lived dev-loop's per-session WAF score.
        let dev = stable_dev_loop_session_id(PROJECT, INSTANCE, None);
        let task = stable_dev_loop_session_id(PROJECT, INSTANCE, Some("task-123"));
        assert_ne!(dev, task);
    }

    #[test]
    fn distinct_per_task() {
        let a = stable_dev_loop_session_id(PROJECT, INSTANCE, Some("task-aaa"));
        let b = stable_dev_loop_session_id(PROJECT, INSTANCE, Some("task-bbb"));
        assert_ne!(a, b);
    }

    #[test]
    fn does_not_collide_with_chat_namespace() {
        // The chat path uses `persist_ctx.session_id` which is itself a
        // random `Uuid::new_v4()` minted at chat creation. There's no
        // way to deterministically prove no collision against random
        // ids, but we can at least confirm our v5 output never equals
        // the well-known nil UUID — the only "easy" foot-gun if the
        // namespace were ever swapped for `Uuid::nil()` and the input
        // were empty.
        let nil = uuid::Uuid::nil().to_string();
        let id = stable_dev_loop_session_id(PROJECT, INSTANCE, None);
        assert_ne!(id, nil);
    }
}
