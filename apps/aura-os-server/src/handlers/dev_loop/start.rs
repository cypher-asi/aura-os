use std::sync::Arc;

use axum::http::StatusCode;
use axum::Json;

use aura_os_core::{harness_agent_id, AgentInstanceId, HarnessMode, Project, ProjectId};
use aura_os_harness::{AutomatonClient, AutomatonStartError, AutomatonStartParams};

use crate::error::{ApiError, ApiResult};
use crate::handlers::agents::tool_dedupe::dedupe_and_log_installed_tools;
use crate::handlers::agents::workspace_tools::{
    installed_workspace_app_tools, installed_workspace_integrations_for_org_with_token,
};
use crate::handlers::projects_helpers::{
    resolve_agent_instance_workspace_path, slugify, validate_workspace_is_initialised,
};
use crate::state::AppState;

use super::types::{StartContext, StartedAutomaton};

pub(super) async fn resolve_start_context(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    jwt: &str,
    requested_model: Option<String>,
) -> ApiResult<StartContext> {
    let project = state.project_service.get_project(&project_id).ok();
    let agent_instance = state
        .agent_instance_service
        .get_instance(&project_id, &agent_instance_id)
        .await
        .map_err(|e| match e {
            aura_os_agents::AgentError::NotFound => {
                ApiError::not_found(format!("agent instance {agent_instance_id} not found"))
            }
            other => ApiError::internal(format!("looking up agent instance: {other}")),
        })?;
    let mode = agent_instance.harness_mode();
    let client = automaton_client_for_mode(state, mode, &agent_instance.agent_id.to_string(), jwt)?;
    let workspace_root = resolve_workspace(
        state,
        &client,
        mode,
        project_id,
        project.as_ref(),
        agent_instance_id,
    )
    .await?;
    preflight_local_workspace(
        mode,
        &workspace_root,
        resolve_git_repo_url(project.as_ref()).as_deref(),
    )?;
    let model = requested_model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| agent_instance.default_model.clone())
        .or_else(|| agent_instance.model.clone());
    let permissions = agent_instance
        .permissions
        .clone()
        .normalized_for_identity(&agent_instance.name, Some(agent_instance.role.as_str()))
        .with_project_self_caps(&project_id.to_string());
    Ok(StartContext {
        client,
        project_id,
        project,
        model,
        workspace_root,
        agent_id: agent_instance.agent_id,
        permissions,
    })
}

fn automaton_client_for_mode(
    state: &AppState,
    mode: HarnessMode,
    swarm_agent_id: &str,
    jwt: &str,
) -> ApiResult<Arc<AutomatonClient>> {
    match mode {
        HarnessMode::Local => Ok(state.automaton_client.clone()),
        HarnessMode::Swarm => {
            let base = state
                .swarm_base_url
                .as_deref()
                .ok_or_else(|| ApiError::service_unavailable("swarm gateway is not configured"))?;
            Ok(Arc::new(
                AutomatonClient::new(&format!(
                    "{}/v1/agents/{}",
                    base.trim_end_matches('/'),
                    swarm_agent_id
                ))
                .with_auth(Some(jwt.to_string())),
            ))
        }
    }
}

async fn resolve_workspace(
    state: &AppState,
    client: &AutomatonClient,
    mode: HarnessMode,
    project_id: ProjectId,
    project: Option<&Project>,
    agent_instance_id: AgentInstanceId,
) -> ApiResult<String> {
    if mode == HarnessMode::Swarm {
        let name = project.map(|p| p.name.as_str()).unwrap_or("");
        if let Ok(path) = client.resolve_workspace(name).await {
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

pub(super) async fn build_start_params(
    state: &AppState,
    ctx: &StartContext,
    agent_instance_id: AgentInstanceId,
    jwt: Option<String>,
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
    AutomatonStartParams {
        project_id: ctx.project_id.to_string(),
        agent_id: Some(harness_agent_id(&ctx.agent_id, Some(&agent_instance_id))),
        template_agent_id: Some(ctx.agent_id.to_string()),
        auth_token: jwt,
        model: ctx.model.clone(),
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
    }
}

fn resolve_git_repo_url(project: Option<&Project>) -> Option<String> {
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

pub(super) async fn start_or_adopt(
    client: &AutomatonClient,
    params: AutomatonStartParams,
    ws_slots_cap: usize,
) -> ApiResult<StartedAutomaton> {
    match client.start(params.clone()).await {
        Ok(result) => Ok(StartedAutomaton {
            automaton_id: result.automaton_id,
            event_stream_url: Some(result.event_stream_url),
            adopted: false,
        }),
        Err(AutomatonStartError::Conflict(Some(existing))) => {
            if !automaton_status_is_active(client, &existing).await {
                let _ = client.stop(&existing).await;
                let result = client
                    .start(params)
                    .await
                    .map_err(|e| map_start_error(client.base_url(), e, ws_slots_cap))?;
                return Ok(StartedAutomaton {
                    automaton_id: result.automaton_id,
                    event_stream_url: Some(result.event_stream_url),
                    adopted: false,
                });
            }
            Ok(StartedAutomaton {
                automaton_id: existing,
                event_stream_url: None,
                adopted: true,
            })
        }
        Err(error) => Err(map_start_error(client.base_url(), error, ws_slots_cap)),
    }
}

async fn automaton_status_is_active(client: &AutomatonClient, automaton_id: &str) -> bool {
    let Ok(status) = client.status(automaton_id).await else {
        return false;
    };
    status
        .get("running")
        .and_then(|v| v.as_bool())
        .unwrap_or_else(|| {
            status
                .get("state")
                .or_else(|| status.get("status"))
                .and_then(|v| v.as_str())
                .map(|s| matches!(s, "running" | "active" | "started" | "paused"))
                .unwrap_or(true)
        })
}

pub(super) fn map_start_error(
    base_url: &str,
    error: AutomatonStartError,
    ws_slots_cap: usize,
) -> (StatusCode, Json<ApiError>) {
    match error {
        AutomatonStartError::Conflict(_) => ApiError::conflict("a dev loop is already running"),
        AutomatonStartError::Request {
            message,
            is_connect,
            is_timeout,
        } if is_connect || is_timeout => {
            crate::app_builder::ensure_local_harness_running();
            ApiError::service_unavailable(format!(
                "aura-harness at {base_url} is unavailable: {message}"
            ))
        }
        // Phase 6: detect upstream WS-slot exhaustion shape (HTTP 503,
        // optionally with a structured `code: "capacity_exhausted"`
        // body) and remap to the structured 503 instead of leaking the
        // raw upstream body via `bad_gateway`. Mirrors the
        // `is_capacity_exhausted_response` heuristic in
        // `crates/aura-os-harness/src/swarm_harness.rs` so chat / spec
        // / task / dev-loop paths agree on the wire-level taxonomy.
        AutomatonStartError::Response { status: 503, body }
            if response_body_is_capacity_exhausted(&body) =>
        {
            ApiError::harness_capacity_exhausted(ws_slots_cap)
        }
        AutomatonStartError::Response { status, body } => ApiError::bad_gateway(format!(
            "automaton start via {base_url} failed ({status}): {body}"
        )),
        other => ApiError::internal(format!("starting automaton: {other}")),
    }
}

/// Heuristic match for "upstream WS-slot semaphore exhausted" on a
/// 503 automaton-start response. Empty bodies and explicit
/// `code: "capacity_exhausted"` payloads both qualify; an explicit
/// non-`capacity_exhausted` `code` opts back into the generic
/// `bad_gateway` mapping. Kept in sync with
/// `crates/aura-os-harness/src/swarm_harness.rs::is_capacity_exhausted_response`.
fn response_body_is_capacity_exhausted(body: &str) -> bool {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return true;
    }
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) else {
        return true;
    };
    let code = parsed
        .get("code")
        .and_then(|v| v.as_str())
        .or_else(|| {
            parsed
                .get("error")
                .and_then(|err| err.get("code"))
                .and_then(|v| v.as_str())
        });
    match code {
        Some(c) if c.eq_ignore_ascii_case("capacity_exhausted") => true,
        Some(_) => false,
        None => true,
    }
}
