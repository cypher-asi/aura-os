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
        .project
        .as_ref()
        .map(|project| project.org_id.to_string());
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

    AutomatonStartParams {
        project_id: ctx.project_id.to_string(),
        agent_id: Some(harness_agent_id(&ctx.agent_id, Some(&agent_instance_id))),
        aura_agent_id: Some(ctx.agent_id.to_string()),
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
        aura_org_id,
        aura_session_id,
    }
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
    let code = parsed.get("code").and_then(|v| v.as_str()).or_else(|| {
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

#[cfg(test)]
mod stable_session_id_tests {
    use super::stable_dev_loop_session_id;

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
