//! Shared bootstrap pipeline for the long-lived dev-loop and
//! single-task automaton runs.
//!
//! Both `start_loop` and `run_single_task` previously duplicated the
//! same six-step bootstrap (credit preflight, context resolution,
//! automaton start, stream connect, session materialisation,
//! forwarder registration). This module factors the shared flow into
//! [`run_automaton`] and folds the previously-duplicated mode-specific
//! branches into a single [`RunMode`] switch. Adapter handlers
//! collapse to thin HTTP wrappers that build a [`RunRequest`] and
//! dispatch.

mod automaton;
mod context;
mod register;
mod request;
mod session;
mod stream;

use axum::http::StatusCode;
use tokio::sync::broadcast;

use aura_os_core::SessionId;
use aura_os_events::{LoopId, LoopKind};
use aura_os_harness::WsReaderHandle;

use crate::dto::LoopStatusResponse;
use crate::error::ApiResult;

pub(super) use request::{RunMode, RunRequest};

use automaton::{start_automaton, StartOutcome};
use context::{prepare_run_context, RunContext};
use register::{register_active_automaton, RegisterInputs};
use session::materialize_run_session;
use stream::connect_automaton_stream;

use super::registry::{replace_registry_entry, status_response};
use super::session::recover_orphan_tasks;
use super::streaming::emit_domain_event;
use super::types::StartedAutomaton;

/// Outcome of a run dispatch. Adapter handlers map this onto the
/// HTTP shape their endpoint requires.
pub(super) enum RunOutcome {
    /// `RunMode::Automation` cold start (or adopted start with no
    /// live forwarder to reuse). Maps to `201 Created`.
    AutomationCreated(LoopStatusResponse),
    /// `RunMode::Automation` adopt-shortcut: the existing forwarder
    /// passed `can_reuse_forwarder` and was reused. Maps to `200 OK`.
    AutomationReused(LoopStatusResponse),
    /// `RunMode::SingleTask` accepted. Maps to `202 Accepted`.
    SingleTaskAccepted,
}

impl RunOutcome {
    /// Coerce an Automation-only outcome to its `(StatusCode, body)`
    /// pair. Panics if called on [`RunOutcome::SingleTaskAccepted`]:
    /// adapter `start_loop` only ever sees Automation variants by
    /// construction.
    pub(super) fn into_loop_response(self) -> (StatusCode, LoopStatusResponse) {
        match self {
            Self::AutomationCreated(body) => (StatusCode::CREATED, body),
            Self::AutomationReused(body) => (StatusCode::OK, body),
            Self::SingleTaskAccepted => {
                unreachable!("Automation dispatch never returns SingleTaskAccepted")
            }
        }
    }
}

/// Shared run controller. Mirrors the pre-refactor flow of
/// `start_loop` (Automation) and `run_single_task` (SingleTask)
/// branch-by-branch - the matrix lives in the Stage 2 plan.
pub(super) async fn run_automaton(req: RunRequest) -> ApiResult<RunOutcome> {
    crate::handlers::billing::require_credits(&req.state, &req.jwt).await?;

    let prep = prepare_run_context(&req).await?;
    let started = match start_automaton(&req, &prep).await? {
        StartOutcome::AdoptShortcutReused { started } => {
            return Ok(adopt_shortcut_outcome(&req, &prep, &started).await);
        }
        StartOutcome::Cold { started } => started,
    };

    // The two modes order session materialisation, registry
    // displacement, orphan recovery, and stream-connect differently
    // - all four are pinned here to match the pre-refactor handlers
    // verbatim (Automation begins its session BEFORE the WS connect
    // and runs orphan recovery + registry displacement between the
    // two; SingleTask connects first and begins the session
    // afterwards).
    let (session_id, events_tx, ws_reader_handle) = match req.mode {
        RunMode::Automation => bootstrap_automation(&req, &prep, &started).await?,
        RunMode::SingleTask { .. } => bootstrap_single_task(&req, &prep, &started).await?,
    };

    register_active_automaton(RegisterInputs {
        req: &req,
        prep: &prep,
        started: &started,
        events_tx,
        ws_reader_handle,
        session_id,
    })
    .await;

    Ok(match req.mode {
        RunMode::Automation => RunOutcome::AutomationCreated(
            status_response(&req.state, req.project_id, Some(req.agent_instance_id)).await,
        ),
        RunMode::SingleTask { .. } => RunOutcome::SingleTaskAccepted,
    })
}

/// Build the `200 OK` adopt-shortcut response: emit the
/// `loop_started` event with the `reused: true` payload that
/// downstream observers key off and snapshot the existing registry
/// state for the response body.
async fn adopt_shortcut_outcome(
    req: &RunRequest,
    prep: &RunContext,
    started: &StartedAutomaton,
) -> RunOutcome {
    emit_domain_event(
        &req.state,
        "loop_started",
        req.project_id,
        req.agent_instance_id,
        serde_json::json!({
            "automaton_id": started.automaton_id,
            "adopted": true,
            "reused": true,
        }),
    );
    // Re-publish the typed `LoopOpened` event for the existing
    // registry slot. The adopt-shortcut path skips
    // `register_active_automaton` (which is where the cold path calls
    // `loop_registry.open()` and therefore mints the only
    // `LoopOpened` the bridge would normally mirror to the FE). The
    // legacy `loop_started` event above keeps `AutomationBar` happy —
    // it pivots off `/loop/status` HTTP polls plus `loop_started` /
    // `task_started` WS hints — but the three live surfaces that
    // depend on `useLoopActivityStore` (nav-bar loop ring, per-task
    // spinner, Run pane) only ingest the typed
    // `loop_opened` / `loop_activity_changed` frames the bridge
    // mirrors out of `aura-os-events`'s `EventHub`. Without this
    // re-emit `useLoopActivityStore.loops` stays empty for the entire
    // lifetime of a reused loop and every downstream selector
    // (`selectTaskActivity`, `loop-activity-store.ts` selectors)
    // returns null, so spinners never light up even though the
    // harness is actively working.
    let loop_id = LoopId::new(
        req.loop_user_id,
        Some(req.project_id),
        Some(req.agent_instance_id),
        prep.start.agent_id,
        LoopKind::Automation,
    );
    if !req.state.loop_registry.re_emit_loop_opened(&loop_id) {
        // Genuinely absent registry slot: the forwarder we adopted is
        // alive but no `LoopRegistry::open()` ever ran for this
        // instance (e.g. a server restart that somehow left the
        // forwarder slot wired up without a matching registry entry).
        // Future debugging hook — leave at debug! so it's findable
        // without paying log volume in healthy runs.
        tracing::debug!(
            project_id = %req.project_id,
            agent_instance_id = %req.agent_instance_id,
            "adopt-shortcut: re_emit_loop_opened found no live registry slot; \
             FE useLoopActivityStore will stay empty for this run"
        );
    }
    let body = status_response(&req.state, req.project_id, Some(req.agent_instance_id)).await;
    RunOutcome::AutomationReused(body)
}

/// Automation post-start sequence: begin (or reuse) the storage
/// session, displace any stale registry entry, sweep orphan tasks
/// back to `Ready` BEFORE the scheduler comes online, then connect
/// the harness event stream.
async fn bootstrap_automation(
    req: &RunRequest,
    prep: &RunContext,
    started: &StartedAutomaton,
) -> ApiResult<(
    Option<SessionId>,
    broadcast::Sender<serde_json::Value>,
    WsReaderHandle,
)> {
    let session_id = materialize_run_session(req, prep, &started.automaton_id).await;
    replace_registry_entry(&req.state, req.project_id, req.agent_instance_id).await;
    // Skip the orphan sweep when adopting a run that is still alive on
    // the harness: its `in_progress` task rows belong to the running
    // scheduler, and flipping them back to `ready` here would fight
    // the very loop we are reattaching to (double-claimed tasks,
    // duplicate work). Cold starts keep the sweep — there is no live
    // scheduler, so any `in_progress` row is by definition orphaned.
    let recovered = if started.adopted {
        0
    } else {
        recover_orphan_tasks(&req.state, req.project_id, &prep.forwarder_jwt).await
    };
    if recovered > 0 {
        tracing::info!(
            project_id = %req.project_id,
            recovered,
            "orphan recovery: pushed {} task(s) back to Ready before scheduler start",
            recovered,
        );
    }
    let (events_tx, ws_reader_handle) = connect_automaton_stream(req, prep, started).await?;
    Ok((session_id, events_tx, ws_reader_handle))
}

/// SingleTask post-start sequence: connect the harness event stream
/// FIRST so a connect failure doesn't leak a half-baked session row,
/// then begin the storage session tagged with the bound `task_id`.
async fn bootstrap_single_task(
    req: &RunRequest,
    prep: &RunContext,
    started: &StartedAutomaton,
) -> ApiResult<(
    Option<SessionId>,
    broadcast::Sender<serde_json::Value>,
    WsReaderHandle,
)> {
    let (events_tx, ws_reader_handle) = connect_automaton_stream(req, prep, started).await?;
    let session_id = materialize_run_session(req, prep, &started.automaton_id).await;
    Ok((session_id, events_tx, ws_reader_handle))
}
