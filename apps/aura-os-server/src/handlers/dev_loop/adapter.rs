use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use tokio::sync::broadcast;
use tracing::warn;

use aura_os_core::{AgentInstanceId, HarnessMode, Project, ProjectId, TaskId};
use aura_os_harness::{
    collect_automaton_events, connect_with_retries, AutomatonClient, AutomatonStartError,
    AutomatonStartParams, WsReaderHandle,
};

use crate::dto::{ActiveLoopTask, LoopStatusResponse};
use crate::error::{ApiError, ApiResult};
use crate::handlers::agents::tool_dedupe::dedupe_and_log_installed_tools;
use crate::handlers::agents::workspace_tools::{
    installed_workspace_app_tools, installed_workspace_integrations_for_org_with_token,
};
use crate::handlers::projects_helpers::{
    resolve_agent_instance_workspace_path, slugify, validate_workspace_is_initialised,
};
use crate::state::{ActiveAutomaton, AppState, AuthJwt, CachedTaskOutput};

const LOOP_STREAM_TIMEOUT: Duration = Duration::from_secs(24 * 60 * 60);
const TASK_STREAM_TIMEOUT: Duration = Duration::from_secs(6 * 60 * 60);

#[derive(Debug, Deserialize, Default)]
pub(crate) struct LoopQueryParams {
    pub agent_instance_id: Option<AgentInstanceId>,
    pub model: Option<String>,
}

pub(crate) fn emit_domain_event(
    broadcast_tx: &broadcast::Sender<serde_json::Value>,
    event_type: &str,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    extra: serde_json::Value,
) {
    let mut event = serde_json::json!({
        "type": event_type,
        "project_id": project_id.to_string(),
        "agent_instance_id": agent_instance_id.to_string(),
    });
    if let (Some(base), Some(extra)) = (event.as_object_mut(), extra.as_object()) {
        for (key, value) in extra {
            base.insert(key.clone(), value.clone());
        }
    }
    let _ = broadcast_tx.send(event);
}

pub(crate) async fn start_loop(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<ProjectId>,
    Query(params): Query<LoopQueryParams>,
) -> ApiResult<(StatusCode, Json<LoopStatusResponse>)> {
    crate::handlers::billing::require_credits(&state, &jwt).await?;
    let agent_instance_id = params
        .agent_instance_id
        .unwrap_or_else(AgentInstanceId::new);
    let ctx =
        resolve_start_context(&state, project_id, agent_instance_id, &jwt, params.model).await?;
    let start_params = build_start_params(&state, &ctx, Some(jwt), None).await;
    let started = start_or_adopt(&ctx.client, start_params).await?;

    if started.adopted
        && can_reuse_forwarder(&state, agent_instance_id, &started.automaton_id).await
    {
        emit_domain_event(
            &state.event_broadcast,
            "loop_started",
            project_id,
            agent_instance_id,
            serde_json::json!({"automaton_id": started.automaton_id, "adopted": true, "reused": true}),
        );
        return Ok((
            StatusCode::OK,
            Json(status_response(&state, project_id, Some(agent_instance_id)).await),
        ));
    }

    replace_registry_entry(&state, agent_instance_id).await;
    let (events_tx, ws_reader_handle) = connect_with_retries(
        &ctx.client,
        &started.automaton_id,
        started.event_stream_url.as_deref(),
        2,
    )
    .await
    .map_err(|e| ApiError::bad_gateway(format!("connecting automaton stream: {e}")))?;

    let alive = Arc::new(AtomicBool::new(true));
    let forwarder = spawn_event_forwarder(ForwarderContext {
        state: state.clone(),
        project_id,
        agent_instance_id,
        automaton_id: started.automaton_id.clone(),
        task_id: None,
        events_tx,
        ws_reader_handle,
        alive: alive.clone(),
        timeout: LOOP_STREAM_TIMEOUT,
    });
    state.automaton_registry.lock().await.insert(
        agent_instance_id,
        ActiveAutomaton {
            automaton_id: started.automaton_id.clone(),
            project_id,
            harness_base_url: ctx.client.base_url().to_string(),
            paused: false,
            alive,
            forwarder: Some(forwarder),
            current_task_id: None,
        },
    );
    state
        .loop_log
        .on_loop_started(project_id, agent_instance_id)
        .await;
    emit_domain_event(
        &state.event_broadcast,
        "loop_started",
        project_id,
        agent_instance_id,
        serde_json::json!({"automaton_id": started.automaton_id, "adopted": started.adopted}),
    );
    Ok((
        StatusCode::CREATED,
        Json(status_response(&state, project_id, Some(agent_instance_id)).await),
    ))
}

pub(crate) async fn pause_loop(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
    Query(params): Query<LoopQueryParams>,
) -> ApiResult<Json<LoopStatusResponse>> {
    control_loop(
        &state,
        project_id,
        params.agent_instance_id,
        ControlAction::Pause,
    )
    .await
}

pub(crate) async fn stop_loop(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
    Query(params): Query<LoopQueryParams>,
) -> ApiResult<Json<LoopStatusResponse>> {
    control_loop(
        &state,
        project_id,
        params.agent_instance_id,
        ControlAction::Stop,
    )
    .await
}

pub(crate) async fn resume_loop(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
    Query(params): Query<LoopQueryParams>,
) -> ApiResult<Json<LoopStatusResponse>> {
    control_loop(
        &state,
        project_id,
        params.agent_instance_id,
        ControlAction::Resume,
    )
    .await
}

pub(crate) async fn get_loop_status(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<LoopStatusResponse>> {
    Ok(Json(status_response(&state, project_id, None).await))
}

pub(crate) async fn run_single_task(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((project_id, task_id)): Path<(ProjectId, TaskId)>,
    Query(params): Query<LoopQueryParams>,
) -> ApiResult<StatusCode> {
    crate::handlers::billing::require_credits(&state, &jwt).await?;
    let agent_instance_id = params
        .agent_instance_id
        .unwrap_or_else(AgentInstanceId::new);
    let ctx =
        resolve_start_context(&state, project_id, agent_instance_id, &jwt, params.model).await?;
    let task_id = task_id.to_string();
    let result = ctx
        .client
        .start(build_start_params(&state, &ctx, Some(jwt), Some(task_id.clone())).await)
        .await
        .map_err(|e| map_start_error(ctx.client.base_url(), e))?;
    let (events_tx, ws_reader_handle) = connect_with_retries(
        &ctx.client,
        &result.automaton_id,
        Some(&result.event_stream_url),
        2,
    )
    .await
    .map_err(|e| ApiError::bad_gateway(format!("connecting task automaton stream: {e}")))?;

    seed_task_output(&state, project_id, agent_instance_id, &task_id).await;
    emit_domain_event(
        &state.event_broadcast,
        "task_started",
        project_id,
        agent_instance_id,
        serde_json::json!({"task_id": task_id}),
    );
    let alive = Arc::new(AtomicBool::new(true));
    let forwarder = spawn_event_forwarder(ForwarderContext {
        state: state.clone(),
        project_id,
        agent_instance_id,
        automaton_id: result.automaton_id.clone(),
        task_id: Some(task_id.clone()),
        events_tx,
        ws_reader_handle,
        alive: alive.clone(),
        timeout: TASK_STREAM_TIMEOUT,
    });
    replace_registry_entry(&state, agent_instance_id).await;
    state.automaton_registry.lock().await.insert(
        agent_instance_id,
        ActiveAutomaton {
            automaton_id: result.automaton_id,
            project_id,
            harness_base_url: ctx.client.base_url().to_string(),
            paused: false,
            alive,
            forwarder: Some(forwarder),
            current_task_id: Some(task_id),
        },
    );
    Ok(StatusCode::ACCEPTED)
}

struct StartContext {
    client: Arc<AutomatonClient>,
    project_id: ProjectId,
    project: Option<Project>,
    model: Option<String>,
    workspace_root: String,
}

async fn resolve_start_context(
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
    Ok(StartContext {
        client,
        project_id,
        project,
        model,
        workspace_root,
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

async fn build_start_params(
    state: &AppState,
    ctx: &StartContext,
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
        auth_token: jwt,
        model: ctx.model.clone(),
        workspace_root: Some(ctx.workspace_root.clone()),
        task_id,
        git_repo_url: resolve_git_repo_url(ctx.project.as_ref()),
        git_branch: ctx
            .project
            .as_ref()
            .and_then(|project| project.git_branch.clone()),
        installed_tools,
        installed_integrations,
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

struct StartedAutomaton {
    automaton_id: String,
    event_stream_url: Option<String>,
    adopted: bool,
}

async fn start_or_adopt(
    client: &AutomatonClient,
    params: AutomatonStartParams,
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
                    .map_err(|e| map_start_error(client.base_url(), e))?;
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
        Err(error) => Err(map_start_error(client.base_url(), error)),
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

fn map_start_error(base_url: &str, error: AutomatonStartError) -> (StatusCode, Json<ApiError>) {
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
        AutomatonStartError::Response { status, body } => ApiError::bad_gateway(format!(
            "automaton start via {base_url} failed ({status}): {body}"
        )),
        other => ApiError::internal(format!("starting automaton: {other}")),
    }
}

enum ControlAction {
    Pause,
    Resume,
    Stop,
}

async fn control_loop(
    state: &AppState,
    project_id: ProjectId,
    only_agent: Option<AgentInstanceId>,
    action: ControlAction,
) -> ApiResult<Json<LoopStatusResponse>> {
    let targets = {
        let reg = state.automaton_registry.lock().await;
        reg.iter()
            .filter(|(_, entry)| entry.project_id == project_id)
            .filter(|(agent_id, _)| only_agent.map_or(true, |wanted| **agent_id == wanted))
            .map(|(agent_id, entry)| {
                (
                    *agent_id,
                    entry.automaton_id.clone(),
                    entry.harness_base_url.clone(),
                )
            })
            .collect::<Vec<_>>()
    };
    if targets.is_empty() && !matches!(action, ControlAction::Stop) {
        return Err(ApiError::bad_request("no matching dev loop is running"));
    }
    for (agent_id, automaton_id, base_url) in targets {
        let client = AutomatonClient::new(&base_url);
        let result = match action {
            ControlAction::Pause => client.pause(&automaton_id).await,
            ControlAction::Resume => client.resume(&automaton_id).await,
            ControlAction::Stop => client.stop(&automaton_id).await,
        };
        if let Err(error) = result {
            warn!(%automaton_id, %error, "harness automaton control request failed");
        }
        match action {
            ControlAction::Pause => set_paused(state, agent_id, true).await,
            ControlAction::Resume => set_paused(state, agent_id, false).await,
            ControlAction::Stop => abort_and_remove(state, agent_id).await,
        }
        let event_type = match action {
            ControlAction::Pause => "loop_paused",
            ControlAction::Resume => "loop_resumed",
            ControlAction::Stop => "loop_stopped",
        };
        emit_domain_event(
            &state.event_broadcast,
            event_type,
            project_id,
            agent_id,
            serde_json::json!({}),
        );
    }
    Ok(Json(status_response(state, project_id, only_agent).await))
}

async fn set_paused(state: &AppState, agent_instance_id: AgentInstanceId, paused: bool) {
    if let Some(entry) = state
        .automaton_registry
        .lock()
        .await
        .get_mut(&agent_instance_id)
    {
        entry.paused = paused;
    }
}

async fn can_reuse_forwarder(
    state: &AppState,
    agent_id: AgentInstanceId,
    automaton_id: &str,
) -> bool {
    state
        .automaton_registry
        .lock()
        .await
        .get(&agent_id)
        .is_some_and(|entry| {
            entry.automaton_id == automaton_id && entry.alive.load(Ordering::SeqCst)
        })
}

async fn replace_registry_entry(state: &AppState, agent_id: AgentInstanceId) {
    abort_and_remove(state, agent_id).await;
}

async fn abort_and_remove(state: &AppState, agent_id: AgentInstanceId) {
    if let Some(entry) = state.automaton_registry.lock().await.remove(&agent_id) {
        if let Some(handle) = entry.forwarder {
            handle.abort();
        }
    }
}

async fn status_response(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: Option<AgentInstanceId>,
) -> LoopStatusResponse {
    let reg = state.automaton_registry.lock().await;
    let active: Vec<AgentInstanceId> = reg
        .iter()
        .filter(|(_, entry)| entry.project_id == project_id)
        .map(|(agent_id, _)| *agent_id)
        .collect();
    let paused = reg
        .iter()
        .any(|(_, entry)| entry.project_id == project_id && entry.paused);
    let active_tasks = reg
        .iter()
        .filter(|(_, entry)| entry.project_id == project_id)
        .filter_map(|(agent_id, entry)| {
            entry
                .current_task_id
                .as_ref()
                .map(|task_id| ActiveLoopTask {
                    task_id: task_id.clone(),
                    agent_instance_id: *agent_id,
                })
        })
        .collect::<Vec<_>>();
    let running = !active.is_empty();
    LoopStatusResponse {
        running,
        paused,
        loop_state: Some(
            if paused {
                "paused"
            } else if running {
                "running"
            } else {
                "finished"
            }
            .to_string(),
        ),
        project_id: Some(project_id),
        agent_instance_id,
        active_agent_instances: Some(active),
        cooldown_remaining_ms: None,
        cooldown_reason: None,
        cooldown_kind: None,
        active_tasks: Some(active_tasks),
    }
}

struct ForwarderContext {
    state: AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    automaton_id: String,
    task_id: Option<String>,
    events_tx: broadcast::Sender<serde_json::Value>,
    ws_reader_handle: WsReaderHandle,
    alive: Arc<AtomicBool>,
    timeout: Duration,
}

fn spawn_event_forwarder(ctx: ForwarderContext) -> tokio::task::AbortHandle {
    let handle = tokio::spawn(async move {
        let _ws_reader_handle = ctx.ws_reader_handle;
        let rx = ctx.events_tx.subscribe();
        let state = ctx.state.clone();
        let project_id = ctx.project_id;
        let agent_instance_id = ctx.agent_instance_id;
        let fallback_task_id = ctx.task_id.clone();
        let completion = collect_automaton_events(rx, ctx.timeout, |event, event_type| {
            let state = state.clone();
            let event = event.clone();
            let event_type = event_type.to_string();
            let fallback_task_id = fallback_task_id.clone();
            tokio::spawn(async move {
                record_event_side_effects(
                    &state,
                    project_id,
                    agent_instance_id,
                    fallback_task_id,
                    event,
                    &event_type,
                )
                .await;
            });
        })
        .await;
        ctx.alive.store(false, Ordering::SeqCst);
        {
            let mut reg = ctx.state.automaton_registry.lock().await;
            if reg
                .get(&ctx.agent_instance_id)
                .is_some_and(|entry| entry.automaton_id == ctx.automaton_id)
            {
                reg.remove(&ctx.agent_instance_id);
            }
        }
        emit_domain_event(
            &ctx.state.event_broadcast,
            if completion.is_success() {
                "loop_finished"
            } else {
                "task_failed"
            },
            ctx.project_id,
            ctx.agent_instance_id,
            serde_json::json!({}),
        );
    });
    handle.abort_handle()
}

async fn record_event_side_effects(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    fallback_task_id: Option<String>,
    event: serde_json::Value,
    event_type: &str,
) {
    let task_id = event
        .get("task_id")
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .or(fallback_task_id);
    let mut enriched = event.clone();
    if let Some(object) = enriched.as_object_mut() {
        object
            .entry("project_id".to_string())
            .or_insert_with(|| project_id.to_string().into());
        object
            .entry("agent_instance_id".to_string())
            .or_insert_with(|| agent_instance_id.to_string().into());
        if let Some(task_id) = task_id.as_ref() {
            object
                .entry("task_id".to_string())
                .or_insert_with(|| task_id.clone().into());
        }
    }
    let _ = state.event_broadcast.send(enriched);

    match event_type {
        "task_started" => {
            if let Some(task_id) = task_id.as_ref() {
                seed_task_output(state, project_id, agent_instance_id, task_id).await;
                if let Some(entry) = state
                    .automaton_registry
                    .lock()
                    .await
                    .get_mut(&agent_instance_id)
                {
                    entry.current_task_id = Some(task_id.clone());
                }
            }
        }
        "task_completed" | "task_failed" => {
            if let Some(entry) = state
                .automaton_registry
                .lock()
                .await
                .get_mut(&agent_instance_id)
            {
                entry.current_task_id = None;
            }
        }
        "text_delta" => {
            if let Some((task_id, text)) = task_id.as_ref().zip(event_text(&event)) {
                state
                    .task_output_cache
                    .lock()
                    .await
                    .entry(task_id.clone())
                    .or_default()
                    .live_output
                    .push_str(text);
            }
        }
        "token_usage" | "assistant_message_end" | "usage" | "session_usage" => {
            if let Some(task_id) = task_id.as_ref() {
                update_usage_cache(state, task_id, &event).await;
            }
        }
        _ => {}
    }
}

fn event_text(event: &serde_json::Value) -> Option<&str> {
    event
        .get("text")
        .or_else(|| event.get("delta"))
        .and_then(|value| value.as_str())
}

async fn seed_task_output(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    task_id: &str,
) {
    state
        .task_output_cache
        .lock()
        .await
        .entry(task_id.to_string())
        .or_insert_with(|| CachedTaskOutput {
            project_id: Some(project_id.to_string()),
            agent_instance_id: Some(agent_instance_id.to_string()),
            ..Default::default()
        });
}

async fn update_usage_cache(state: &AppState, task_id: &str, event: &serde_json::Value) {
    let usage = event.get("usage").unwrap_or(event);
    let mut cache = state.task_output_cache.lock().await;
    let entry = cache.entry(task_id.to_string()).or_default();
    if let Some(model) = usage.get("model").and_then(|value| value.as_str()) {
        entry.model = Some(model.to_string());
    }
    if let Some(provider) = usage.get("provider").and_then(|value| value.as_str()) {
        entry.provider = Some(provider.to_string());
    }
    if let Some(input) = usage.get("input_tokens").and_then(|value| value.as_u64()) {
        entry.input_tokens = entry.input_tokens.saturating_add(input);
        entry.total_input_tokens = entry.total_input_tokens.saturating_add(input);
    }
    if let Some(output) = usage.get("output_tokens").and_then(|value| value.as_u64()) {
        entry.output_tokens = entry.output_tokens.saturating_add(output);
        entry.total_output_tokens = entry.total_output_tokens.saturating_add(output);
    }
}
