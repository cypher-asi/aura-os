//! `POST /v1/projects/:id/tasks/:task_id/run-once` handler: spawns a fresh ephemeral executor instance per call so concurrent single-task runs in the same project don't collide on the `(project_id, agent_instance_id)` registry key, plus the background reaper that cleans the ephemeral row up after the run.

use std::sync::{atomic::AtomicBool, Arc};
use std::time::Duration;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;

use aura_os_core::{AgentInstanceId, ProjectId, TaskId};
use aura_os_events::{LoopId, LoopKind};
use aura_os_harness::connect_with_retries;

use crate::error::{ApiError, ApiResult};
use crate::handlers::agents::chat::errors::map_harness_error_to_api;
use crate::state::{ActiveAutomaton, AppState, AuthJwt, AuthSession};

use super::super::session::begin_session;
use super::super::start::{build_start_params, map_start_error, resolve_start_context};
use super::super::streaming::{emit_domain_event, seed_task_output, spawn_event_forwarder};
use super::super::types::{ForwarderContext, LoopQueryParams, LoopRetryState};
use super::common::{loop_user_id, TASK_STREAM_TIMEOUT};

pub(crate) async fn run_single_task(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    session: AuthSession,
    Path((project_id, task_id)): Path<(ProjectId, TaskId)>,
    Query(params): Query<LoopQueryParams>,
) -> ApiResult<StatusCode> {
    crate::handlers::billing::require_credits(&state, &jwt).await?;

    // run_single_task allocates a fresh ephemeral `agent_instance_id`
    // per call so concurrent ad-hoc task runs in the same project no
    // longer abort each other on the
    // `(project_id, agent_instance_id)` automaton registry key. The
    // caller-supplied id (or the project's default Loop/Chat
    // template) is used solely to resolve the start context
    // (workspace path, agent template, default model). The freshly
    // minted ephemeral id keys the registry slot, the loop handle,
    // the forwarder, and every emitted event — the dev-loop forwarder
    // drops the registry entry on terminal status, and best-effort
    // teardown of the persisted `Executor` row happens in the
    // background after the run completes.
    let template_instance = resolve_run_template(&state, project_id, &params).await?;
    let template_instance_id = template_instance.agent_instance_id;
    let ephemeral = state
        .agent_instance_service
        .spawn_ephemeral_executor(&project_id, &template_instance)
        .await
        .map_err(|e| ApiError::internal(format!("allocating ephemeral executor: {e}")))?;
    let ephemeral_instance_id = ephemeral.agent_instance_id;

    let ctx = resolve_start_context(&state, project_id, template_instance_id, &jwt, params.model)
        .await
        .inspect_err(|_| {
            // Best-effort: don't leak the row we just created if context
            // resolution fails before we even reach the harness.
            let svc = state.agent_instance_service.clone();
            tokio::spawn(async move {
                let _ = svc.delete_instance(&ephemeral_instance_id).await;
            });
        })?;
    let task_id_str = task_id.to_string();
    // Clone the JWT for the forwarder before `build_start_params` moves
    // it; see `start_loop` for the motivation.
    let forwarder_jwt = jwt.clone();
    let params = build_start_params(
        &state,
        &ctx,
        ephemeral_instance_id,
        Some(jwt),
        Some(session.0.user_id.clone()),
        Some(task_id_str.clone()),
    )
    .await;
    // Tier 1 fail-fast: refuse to POST /automaton/start with a payload
    // missing one of the required X-Aura-* identity fields. Mirrors
    // the guard inside `start_or_adopt` for the dev-loop path.
    if let Err(err) = crate::handlers::agents::session_identity::validate_automaton_identity(
        &params,
        crate::handlers::agents::session_identity::SessionIdentityRequirements::DEV_LOOP,
        "single_task_automaton",
    ) {
        let svc = state.agent_instance_service.clone();
        tokio::spawn(async move {
            let _ = svc.delete_instance(&ephemeral_instance_id).await;
        });
        return Err(err);
    }
    let result = ctx.client.start(params).await.map_err(|e| {
        let svc = state.agent_instance_service.clone();
        tokio::spawn(async move {
            let _ = svc.delete_instance(&ephemeral_instance_id).await;
        });
        map_start_error(ctx.client.base_url(), e, state.harness_ws_slots)
    })?;
    let (events_tx, ws_reader_handle) = connect_with_retries(
        &ctx.client,
        &result.automaton_id,
        Some(&result.event_stream_url),
        2,
    )
    .await
    .map_err(|e| {
        // Same capacity-vs-bad-gateway mapping rationale as in
        // `start_loop` above; mirror it here so single-task runs
        // surface the same 503 envelope when the WS upgrade is the
        // step that trips the harness's WS-slot semaphore.
        map_harness_error_to_api(&e, state.harness_ws_slots, |err| {
            ApiError::bad_gateway(format!("connecting task automaton stream: {err}"))
        })
    })?;

    // Single-task runs always mint a fresh ephemeral agent instance,
    // so they always need a fresh storage session — there's nothing
    // to adopt. Tagging it with `active_task_id` lets the storage
    // backend correlate the session with the task it was minted for.
    let session_id = begin_session(
        &state,
        project_id,
        ephemeral_instance_id,
        Some(task_id),
        Some(session.0.user_id.clone()),
        ctx.model.clone(),
    )
    .await;

    state
        .loop_log
        .on_loop_started(project_id, ephemeral_instance_id)
        .await;
    state
        .loop_log
        .on_task_started(project_id, ephemeral_instance_id, task_id, None)
        .await;
    seed_task_output(&state, project_id, ephemeral_instance_id, &task_id_str).await;
    emit_domain_event(
        &state,
        "task_started",
        project_id,
        ephemeral_instance_id,
        serde_json::json!({
            "task_id": task_id_str,
            "template_agent_instance_id": template_instance_id.to_string(),
            "ephemeral": true,
        }),
    );
    let alive = Arc::new(AtomicBool::new(true));
    let loop_handle = state.loop_registry.open(LoopId::new(
        loop_user_id(&session),
        Some(project_id),
        Some(ephemeral_instance_id),
        ctx.agent_id,
        LoopKind::TaskRun,
    ));
    loop_handle.set_current_task(Some(task_id)).await;
    let forwarder = spawn_event_forwarder(ForwarderContext {
        state: state.clone(),
        project_id,
        agent_instance_id: ephemeral_instance_id,
        automaton_id: result.automaton_id.clone(),
        task_id: Some(task_id_str.clone()),
        events_tx,
        ws_reader_handle,
        alive: alive.clone(),
        timeout: TASK_STREAM_TIMEOUT,
        loop_handle,
        jwt: Some(forwarder_jwt),
        session_id,
        retry_state: Arc::new(LoopRetryState::new()),
    });
    // No `replace_registry_entry`: the ephemeral id is freshly minted,
    // there is nothing to displace, and concurrent task runs are
    // explicitly allowed to coexist under different ephemeral ids in
    // the registry.
    state.automaton_registry.lock().await.insert(
        (project_id, ephemeral_instance_id),
        ActiveAutomaton {
            automaton_id: result.automaton_id,
            project_id,
            template_agent_id: ctx.agent_id,
            harness_base_url: ctx.client.base_url().to_string(),
            paused: false,
            alive,
            forwarder: Some(forwarder),
            current_task_id: Some(task_id_str),
            session_id,
        },
    );
    // Schedule a best-effort cleanup of the ephemeral `project_agents`
    // row after the run hits terminal status (or after a generous TTL
    // if the forwarder dies before reporting completion). Storage
    // failures are swallowed: the entry will be reaped by the next
    // janitor sweep.
    spawn_ephemeral_executor_reaper(state.clone(), ephemeral_instance_id).await;
    Ok(StatusCode::ACCEPTED)
}

/// Resolve the project-agent instance to use as the **template** for
/// an ad-hoc task run. The caller's `agent_instance_id` is honoured
/// when supplied; otherwise the project's default Loop/Chat instance
/// is picked via `pick_run_template` so the frontend can omit the
/// param when it doesn't yet know which binding to target.
async fn resolve_run_template(
    state: &AppState,
    project_id: ProjectId,
    params: &LoopQueryParams,
) -> ApiResult<aura_os_core::AgentInstance> {
    if let Some(id) = params.agent_instance_id {
        return state
            .agent_instance_service
            .get_instance(&project_id, &id)
            .await
            .map_err(|e| match e {
                aura_os_agents::AgentError::NotFound => {
                    ApiError::not_found(format!("agent instance {id} not found"))
                }
                other => ApiError::internal(format!("looking up agent instance: {other}")),
            });
    }
    state
        .agent_instance_service
        .pick_run_template(&project_id)
        .await
        .map_err(|e| match e {
            aura_os_agents::AgentError::NotFound => ApiError::bad_request(
                "agent_instance_id is required: project has no instances available \
                 to use as a task-run template",
            ),
            other => ApiError::internal(format!("picking run template: {other}")),
        })
}

/// Spawn a best-effort background reaper that deletes the ephemeral
/// `Executor` `project_agents` row once the run is no longer in the
/// automaton registry, with a TTL backstop in case the forwarder
/// never reports terminal status.
///
/// The forwarder removes the registry entry on terminal status; this
/// reaper polls until the entry is gone (or the TTL fires) and then
/// drops the storage row. Failures are logged at `warn` and ignored —
/// the row at worst becomes a stale catalogue entry that the next
/// janitor pass can sweep.
async fn spawn_ephemeral_executor_reaper(state: AppState, ephemeral_instance_id: AgentInstanceId) {
    const TTL: Duration = Duration::from_secs(8 * 60 * 60);
    const POLL: Duration = Duration::from_secs(15);
    tokio::spawn(async move {
        let started = std::time::Instant::now();
        loop {
            tokio::time::sleep(POLL).await;
            let still_present = state
                .automaton_registry
                .lock()
                .await
                .keys()
                .any(|(_, id)| *id == ephemeral_instance_id);
            if !still_present {
                break;
            }
            if started.elapsed() >= TTL {
                tracing::warn!(
                    %ephemeral_instance_id,
                    elapsed_secs = started.elapsed().as_secs(),
                    "ephemeral executor still in registry after TTL; forcing storage cleanup"
                );
                break;
            }
        }
        if let Err(error) = state
            .agent_instance_service
            .delete_instance(&ephemeral_instance_id)
            .await
        {
            tracing::warn!(
                %ephemeral_instance_id,
                %error,
                "failed to reap ephemeral executor row; will be retried by janitor"
            );
        }
    });
}
