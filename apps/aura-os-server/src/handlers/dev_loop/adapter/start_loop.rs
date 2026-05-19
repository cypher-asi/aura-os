//! `POST /v1/projects/:id/dev-loop` cold-start handler and the orphan-recovery sweep that runs before the harness scheduler comes online.

use std::sync::{atomic::AtomicBool, Arc};

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use tracing::{info, warn};

use aura_os_automation::{recover_orphans, OrphanRecoveryPlan};
use aura_os_core::ProjectId;
use aura_os_events::{LoopId, LoopKind};
use aura_os_harness::connect_with_retries;

use crate::dto::LoopStatusResponse;
use crate::error::{ApiError, ApiResult};
use crate::handlers::agents::chat::errors::map_harness_error_to_api;
use crate::state::{ActiveAutomaton, AppState, AuthJwt, AuthSession};

use super::super::registry::{can_reuse_forwarder, replace_registry_entry, status_response};
use super::super::session::{begin_session, existing_session_id, recover_orphan_tasks};
use super::super::start::{build_start_params, resolve_start_context, start_or_adopt};
use super::super::streaming::{emit_domain_event, spawn_event_forwarder};
use super::super::types::{ForwarderContext, LoopQueryParams, LoopRetryState};
use super::common::{loop_user_id, resolve_loop_instance_id, LOOP_STREAM_TIMEOUT};

pub(crate) async fn start_loop(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    session: AuthSession,
    Path(project_id): Path<ProjectId>,
    Query(params): Query<LoopQueryParams>,
) -> ApiResult<(StatusCode, Json<LoopStatusResponse>)> {
    crate::handlers::billing::require_credits(&state, &jwt).await?;
    let agent_instance_id = resolve_loop_instance_id(&state, project_id, &params).await?;
    let ctx = resolve_start_context(
        &state,
        project_id,
        agent_instance_id,
        &jwt,
        params.model.clone(),
    )
    .await?;
    // Clone the JWT for the forwarder before `build_start_params`
    // consumes it. The forwarder uses it for background writes to
    // aura-storage (e.g. persisting `tasks.execution_notes` when a
    // `task_failed` event arrives so the fail reason survives page
    // reloads, not just live WS subscribers).
    let forwarder_jwt = jwt.clone();
    let start_params = build_start_params(
        &state,
        &ctx,
        agent_instance_id,
        Some(jwt),
        Some(session.0.user_id.clone()),
        None,
    )
    .await;
    let started = start_or_adopt(&ctx.client, start_params, state.harness_ws_slots).await?;

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

    // If we're adopting an existing harness automaton that just lost
    // its forwarder (e.g. server restart), reuse the storage session
    // already stashed on the registry entry instead of opening a new
    // one — otherwise `total_sessions` doubles every adoption. Cold
    // starts always materialise a fresh session.
    let reused_session_id =
        existing_session_id(&state, project_id, agent_instance_id, &started.automaton_id).await;
    let session_id = if reused_session_id.is_some() {
        reused_session_id
    } else {
        begin_session(
            &state,
            project_id,
            agent_instance_id,
            None,
            Some(session.0.user_id.clone()),
            ctx.model.clone(),
        )
        .await
    };

    replace_registry_entry(&state, project_id, agent_instance_id).await;
    // Section E (orphan recovery): sweep tasks left in `InProgress`
    // from a previous server invocation back to `Ready` BEFORE the
    // forwarder + scheduler come online, so the next scheduler tick
    // actually sees them as candidates. Best-effort: any storage
    // failure is logged and we continue — the worst case is "stuck
    // orphans stay stuck until the next start_loop", which is
    // strictly no worse than today's behaviour.
    let recovered = recover_orphan_tasks(&state, project_id, &forwarder_jwt).await;
    if recovered > 0 {
        tracing::info!(
            %project_id,
            recovered,
            "orphan recovery: pushed {} task(s) back to Ready before scheduler start",
            recovered,
        );
    }
    let (events_tx, ws_reader_handle) = connect_with_retries(
        &ctx.client,
        &started.automaton_id,
        started.event_stream_url.as_deref(),
        2,
    )
    .await
    .map_err(|e| {
        // The /automaton/start HTTP call may have succeeded only for
        // the upstream WS upgrade to be rejected with the 503 / 1013
        // capacity signal (see `aura_os_harness::HarnessError`). Route
        // through the shared mapper so it surfaces as the structured
        // 503 `harness_capacity_exhausted` envelope instead of a
        // generic `bad_gateway`.
        map_harness_error_to_api(&e, state.harness_ws_slots, |err| {
            ApiError::bad_gateway(format!("connecting automaton stream: {err}"))
        })
    })?;

    // Section E: orphan-recovery sweep before the loop's task
    // scheduler picks the first task. Tasks left in `InProgress`
    // after a previous loop was killed mid-run (server crash, deploy)
    // are silently bridged back to `Ready` so the scheduler doesn't
    // skip them on the assumption another runner already owns them.
    // Best-effort: storage / JWT failures here are logged and the
    // loop still starts — the worst case is the orphan stays
    // `InProgress` until the next start_loop sweep retries.
    apply_orphan_recovery(&state, project_id, &forwarder_jwt).await;

    let alive = Arc::new(AtomicBool::new(true));
    let loop_handle = state.loop_registry.open(LoopId::new(
        loop_user_id(&session),
        Some(project_id),
        Some(agent_instance_id),
        ctx.agent_id,
        LoopKind::Automation,
    ));
    state
        .loop_log
        .on_loop_started(project_id, agent_instance_id)
        .await;
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
        session_id,
        retry_state: Arc::new(LoopRetryState::new()),
    });
    state.automaton_registry.lock().await.insert(
        (project_id, agent_instance_id),
        ActiveAutomaton {
            automaton_id: started.automaton_id.clone(),
            project_id,
            template_agent_id: ctx.agent_id,
            harness_base_url: ctx.client.base_url().to_string(),
            paused: false,
            alive,
            forwarder: Some(forwarder),
            current_task_id: None,
            session_id,
        },
    );
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

/// Orphan-recovery sweep at loop start.
///
/// Lists the project's tasks via the storage-backed `TaskService`,
/// hands the snapshot to [`recover_orphans`] for the pure planning
/// step, and applies each [`OrphanRecoveryPlan`] via
/// [`aura_os_tasks::safe_transition`] so any task left
/// `InProgress` by a previously-killed loop returns to `Ready` for
/// the scheduler.
///
/// Best-effort by design:
///
/// * If the project list call fails (auth blip, storage down) we
///   warn and return — the loop still starts; the next loop start
///   will retry the sweep against the same orphans.
/// * Per-plan transition failures are logged but do not abort the
///   sweep: a single 4xx on one task should not block recovering
///   the others.
async fn apply_orphan_recovery(state: &AppState, project_id: ProjectId, jwt: &str) {
    let Some(storage) = state.storage_client.as_ref() else {
        return;
    };
    let tasks = match state.task_service.list_tasks(&project_id).await {
        Ok(tasks) => tasks,
        Err(error) => {
            warn!(
                %project_id,
                %error,
                "orphan recovery: failed to list tasks; skipping sweep for this loop start"
            );
            return;
        }
    };
    let plans = recover_orphans(&tasks);
    if plans.is_empty() {
        return;
    }
    info!(
        %project_id,
        orphan_count = plans.len(),
        "orphan recovery: bridging InProgress tasks back to Ready"
    );
    for OrphanRecoveryPlan {
        task_id,
        target_status,
        ..
    } in plans
    {
        if let Err(error) =
            aura_os_tasks::safe_transition(storage, jwt, &task_id.to_string(), target_status).await
        {
            warn!(
                %task_id,
                %error,
                "orphan recovery: safe_transition failed; leaving task in InProgress"
            );
        }
    }
}
