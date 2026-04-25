use std::str::FromStr;
use std::sync::{atomic::AtomicBool, Arc};
use std::time::Duration;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;

use aura_os_core::{AgentInstanceId, ProjectId, TaskId, UserId};
use aura_os_events::{LoopId, LoopKind};
use aura_os_harness::connect_with_retries;

use crate::dto::LoopStatusResponse;
use crate::error::{ApiError, ApiResult};
use crate::state::{ActiveAutomaton, AppState, AuthJwt, AuthSession};

use super::control::control_loop;
use super::registry::{can_reuse_forwarder, replace_registry_entry, status_response};
use super::start::{build_start_params, map_start_error, resolve_start_context, start_or_adopt};
pub(crate) use super::streaming::emit_domain_event;
use super::streaming::{seed_task_output, spawn_event_forwarder};
use super::types::{ControlAction, ForwarderContext, LoopQueryParams};

/// Resolve the agent_instance_id for a loop start request.
///
/// We deliberately reject calls that omit the agent_instance_id rather
/// than minting a random UUID. A random UUID does not correspond to any
/// project_agents row, which means:
///
/// * the resulting registry entry is unreachable from any client that
///   only knows the real project agents,
/// * two concurrent omitting callers each get a distinct random id
///   instead of being multiplexed onto the right binding,
/// * the harness session opens against a non-existent agent.
///
/// Forcing the caller to supply the binding id is the difference
/// between "isolated agent loops" and "uncoordinated zombie loops".
fn require_agent_instance_id(params: &LoopQueryParams) -> ApiResult<AgentInstanceId> {
    params.agent_instance_id.ok_or_else(|| {
        ApiError::bad_request(
            "agent_instance_id is required: every loop must be bound to a real \
             project_agents row so it can be addressed and supervised correctly",
        )
    })
}

/// Resolve the signed-in user id for loop identity.
///
/// When the auth session lacks a network user id we fall back to the
/// string user id parsed into a UUID; as a last resort we mint a new
/// UserId so the loop is still addressable in telemetry. This should
/// never happen for fully-validated zOS sessions, but we guard against
/// it rather than `.expect()`.
fn loop_user_id(session: &AuthSession) -> UserId {
    if let Some(uid) = session.0.network_user_id {
        return uid;
    }
    UserId::from_str(&session.0.user_id).unwrap_or_else(|_| UserId::new())
}

const LOOP_STREAM_TIMEOUT: Duration = Duration::from_secs(24 * 60 * 60);
const TASK_STREAM_TIMEOUT: Duration = Duration::from_secs(6 * 60 * 60);

pub(crate) async fn start_loop(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    session: AuthSession,
    Path(project_id): Path<ProjectId>,
    Query(params): Query<LoopQueryParams>,
) -> ApiResult<(StatusCode, Json<LoopStatusResponse>)> {
    crate::handlers::billing::require_credits(&state, &jwt).await?;
    let agent_instance_id = require_agent_instance_id(&params)?;
    let ctx =
        resolve_start_context(&state, project_id, agent_instance_id, &jwt, params.model).await?;
    // Clone the JWT for the forwarder before `build_start_params`
    // consumes it. The forwarder uses it for background writes to
    // aura-storage (e.g. persisting `tasks.execution_notes` when a
    // `task_failed` event arrives so the fail reason survives page
    // reloads, not just live WS subscribers).
    let forwarder_jwt = jwt.clone();
    let start_params = build_start_params(&state, &ctx, Some(jwt), None).await;
    let started = start_or_adopt(&ctx.client, start_params).await?;

    if started.adopted
        && can_reuse_forwarder(&state, project_id, agent_instance_id, &started.automaton_id).await
    {
        emit_domain_event(
            &state,
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

    replace_registry_entry(&state, project_id, agent_instance_id).await;
    let (events_tx, ws_reader_handle) = connect_with_retries(
        &ctx.client,
        &started.automaton_id,
        started.event_stream_url.as_deref(),
        2,
    )
    .await
    .map_err(|e| ApiError::bad_gateway(format!("connecting automaton stream: {e}")))?;

    let alive = Arc::new(AtomicBool::new(true));
    let loop_handle = state.loop_registry.open(LoopId::new(
        loop_user_id(&session),
        Some(project_id),
        Some(agent_instance_id),
        ctx.agent_id,
        LoopKind::Automation,
    ));
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
        loop_handle,
        jwt: Some(forwarder_jwt),
    });
    state.automaton_registry.lock().await.insert(
        (project_id, agent_instance_id),
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
        &state,
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
    session: AuthSession,
    Path((project_id, task_id)): Path<(ProjectId, TaskId)>,
    Query(params): Query<LoopQueryParams>,
) -> ApiResult<StatusCode> {
    crate::handlers::billing::require_credits(&state, &jwt).await?;
    let agent_instance_id = require_agent_instance_id(&params)?;
    let ctx =
        resolve_start_context(&state, project_id, agent_instance_id, &jwt, params.model).await?;
    let task_id_str = task_id.to_string();
    // Clone the JWT for the forwarder before `build_start_params` moves
    // it; see `start_loop` for the motivation.
    let forwarder_jwt = jwt.clone();
    let result = ctx
        .client
        .start(build_start_params(&state, &ctx, Some(jwt), Some(task_id_str.clone())).await)
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

    seed_task_output(&state, project_id, agent_instance_id, &task_id_str).await;
    emit_domain_event(
        &state,
        "task_started",
        project_id,
        agent_instance_id,
        serde_json::json!({"task_id": task_id_str}),
    );
    let alive = Arc::new(AtomicBool::new(true));
    let loop_handle = state.loop_registry.open(LoopId::new(
        loop_user_id(&session),
        Some(project_id),
        Some(agent_instance_id),
        ctx.agent_id,
        LoopKind::TaskRun,
    ));
    loop_handle.set_current_task(Some(task_id)).await;
    let forwarder = spawn_event_forwarder(ForwarderContext {
        state: state.clone(),
        project_id,
        agent_instance_id,
        automaton_id: result.automaton_id.clone(),
        task_id: Some(task_id_str.clone()),
        events_tx,
        ws_reader_handle,
        alive: alive.clone(),
        timeout: TASK_STREAM_TIMEOUT,
        loop_handle,
        jwt: Some(forwarder_jwt),
    });
    replace_registry_entry(&state, project_id, agent_instance_id).await;
    state.automaton_registry.lock().await.insert(
        (project_id, agent_instance_id),
        ActiveAutomaton {
            automaton_id: result.automaton_id,
            project_id,
            harness_base_url: ctx.client.base_url().to_string(),
            paused: false,
            alive,
            forwarder: Some(forwarder),
            current_task_id: Some(task_id_str),
        },
    );
    Ok(StatusCode::ACCEPTED)
}
