//! `POST /v1/projects/:id/tasks/:task_id/run-once` handler.
//!
//! After the Stage 2 unification the run pipeline lives in
//! [`super::super::run`]; this handler keeps the SingleTask-specific
//! orchestration that wraps a run - resolving the project's run
//! template, allocating a fresh ephemeral executor row per call so
//! concurrent ad-hoc task runs in the same project don't collide on
//! the `(project_id, agent_instance_id)` registry key, and scheduling
//! the post-run reaper that cleans the ephemeral row up after the run
//! hits terminal status. The bootstrap pipeline itself (credit
//! preflight, context resolution, identity guard, `client.start`,
//! stream connect, session begin, forwarder spawn, registry insert)
//! is delegated to [`super::super::run::run_automaton`].

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;

use aura_os_core::{AgentInstanceId, ProjectId, TaskId};

use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthJwt, AuthSession};

use super::super::limits::{EPHEMERAL_REAPER_POLL, EPHEMERAL_REAPER_TTL};
use super::super::run::{run_automaton, RunMode, RunRequest};
use super::super::types::LoopQueryParams;
use super::common::loop_user_id;

pub(crate) async fn run_single_task(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    session: AuthSession,
    Path((project_id, task_id)): Path<(ProjectId, TaskId)>,
    Query(params): Query<LoopQueryParams>,
) -> ApiResult<StatusCode> {
    // run_single_task allocates a fresh ephemeral `agent_instance_id`
    // per call so concurrent ad-hoc task runs in the same project no
    // longer abort each other on the
    // `(project_id, agent_instance_id)` automaton registry key. The
    // caller-supplied id (or the project's default Loop/Chat
    // template) is used solely to resolve the start context
    // (workspace path, agent template, default model). The freshly
    // minted ephemeral id keys the registry slot, the loop handle,
    // the forwarder, and every emitted event - the dev-loop forwarder
    // drops the registry entry on terminal status, and best-effort
    // teardown of the persisted `Executor` row happens in the
    // background after the run completes.
    let (template_instance_id, ephemeral_instance_id) =
        allocate_ephemeral_executor(&state, project_id, &params).await?;
    let req = RunRequest {
        loop_user_id: loop_user_id(&session),
        user_id: session.0.user_id.clone(),
        state: state.clone(),
        project_id,
        agent_instance_id: ephemeral_instance_id,
        template_agent_instance_id: template_instance_id,
        jwt,
        model: params.model,
        mode: RunMode::SingleTask { task_id },
        loop_engineering: None,
    };
    // run::run_automaton owns the cleanup-on-failure for the
    // ephemeral row at the pre-refactor failure points
    // (resolve_start_context / validate_automaton_identity /
    // client.start) - see `super::super::run::context` and
    // `super::super::run::automaton`. Failures past those points
    // (connect_with_retries, etc.) intentionally don't clean up,
    // matching the pre-refactor behaviour where the next janitor
    // sweep would reap the row.
    let _ = run_automaton(req).await?;
    // Schedule a best-effort cleanup of the ephemeral `project_agents`
    // row after the run hits terminal status (or after a generous TTL
    // if the forwarder dies before reporting completion). Storage
    // failures are swallowed: the entry will be reaped by the next
    // janitor sweep.
    spawn_ephemeral_executor_reaper(state, ephemeral_instance_id).await;
    Ok(StatusCode::ACCEPTED)
}

/// Resolve the template project-agent and spawn a fresh ephemeral
/// executor row for an ad-hoc task run. Returns
/// `(template_agent_instance_id, ephemeral_agent_instance_id)`.
/// Carved out of [`run_single_task`] so its body stays inside the
/// 50-line per-function budget. Side-effect ordering is preserved.
async fn allocate_ephemeral_executor(
    state: &AppState,
    project_id: ProjectId,
    params: &LoopQueryParams,
) -> ApiResult<(AgentInstanceId, AgentInstanceId)> {
    let template_instance = resolve_run_template(state, project_id, params).await?;
    let template_instance_id = template_instance.agent_instance_id;
    let ephemeral = state
        .agent_instance_service
        .spawn_ephemeral_executor(&project_id, &template_instance)
        .await
        .map_err(|e| ApiError::internal(format!("allocating ephemeral executor: {e}")))?;
    Ok((template_instance_id, ephemeral.agent_instance_id))
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
/// drops the storage row. Failures are logged at `warn` and ignored -
/// the row at worst becomes a stale catalogue entry that the next
/// janitor pass can sweep.
async fn spawn_ephemeral_executor_reaper(state: AppState, ephemeral_instance_id: AgentInstanceId) {
    tokio::spawn(async move {
        let started = std::time::Instant::now();
        loop {
            tokio::time::sleep(EPHEMERAL_REAPER_POLL).await;
            let still_present = state
                .automaton_registry
                .lock()
                .await
                .keys()
                .any(|(_, id)| *id == ephemeral_instance_id);
            if !still_present {
                break;
            }
            if started.elapsed() >= EPHEMERAL_REAPER_TTL {
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
