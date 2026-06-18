//! Step 6 of the run pipeline: spawn the event forwarder, register
//! the live automaton in `automaton_registry`, and emit the
//! mode-specific lifecycle event.
//!
//! The two modes diverge non-trivially in the ordering of
//! `loop_log` / `seed_task_output` / `emit_domain_event` / forwarder
//! spawn / registry insert - this module pins each ordering to
//! match the pre-refactor handlers verbatim.
//!
//! Automation order (post-`replace_registry_entry` and orphan
//! recovery, which the controller runs before `connect_automaton_stream`):
//! handles -> `loop_log.on_loop_started` -> spawn forwarder ->
//! registry insert -> `emit_domain_event("loop_started")`.
//!
//! SingleTask order: `loop_log.on_loop_started` ->
//! `loop_log.on_task_started` -> `seed_task_output` ->
//! `emit_domain_event("task_started")` -> handles ->
//! `loop_handle.set_current_task` -> spawn forwarder ->
//! registry insert.

use std::sync::{
    atomic::{AtomicBool, AtomicI64},
    Arc,
};
use std::time::Duration;

use tokio::sync::broadcast;

use aura_os_core::{SessionId, TaskId};
use aura_os_events::{LoopId, LoopKind};
use aura_os_harness::WsReaderHandle;
use aura_os_loops::LoopHandle;

use crate::state::ActiveAutomaton;

use super::super::limits::{LOOP_STREAM_TIMEOUT, TASK_STREAM_TIMEOUT};
use super::super::streaming::{
    current_millis, emit_domain_event, seed_task_output, spawn_event_forwarder,
};
use super::super::types::{ForwarderContext, LoopRetryState, StartedAutomaton};
use super::context::RunContext;
use super::request::{RunMode, RunRequest};

/// Per-automaton handles allocated post-`begin_session` and shared
/// between the spawned forwarder and the registry entry.
struct HandleSet {
    alive: Arc<AtomicBool>,
    loop_handle: Arc<LoopHandle>,
    last_forwarder_event_at: Arc<AtomicI64>,
}

/// Bundled inputs for the post-`begin_session` register helpers. The
/// forwarder spawn + registry insert legitimately needs the full
/// pipeline context (request, prep, started automaton, broadcast
/// channels, ws-reader handle, session id) so we group them once at
/// the entry point and thread the bundle through the mode-specific
/// branches instead of repeating six-arg signatures three times.
pub(super) struct RegisterInputs<'a> {
    pub(super) req: &'a RunRequest,
    pub(super) prep: &'a RunContext,
    pub(super) started: &'a StartedAutomaton,
    pub(super) events_tx: broadcast::Sender<serde_json::Value>,
    pub(super) ws_reader_handle: WsReaderHandle,
    pub(super) session_id: Option<SessionId>,
}

pub(super) async fn register_active_automaton(inputs: RegisterInputs<'_>) {
    match inputs.req.mode {
        RunMode::Automation => register_automation(inputs).await,
        RunMode::SingleTask { task_id } => register_single_task(inputs, task_id).await,
    }
}

async fn register_automation(inputs: RegisterInputs<'_>) {
    let RegisterInputs {
        req,
        prep,
        started,
        events_tx,
        ws_reader_handle,
        session_id,
    } = inputs;
    let handles = forge_handles(req, prep, LoopKind::Automation);
    req.state
        .loop_log
        .on_loop_started(req.project_id, req.agent_instance_id)
        .await;
    finalize_registration(FinalizeInputs {
        req,
        prep,
        started,
        handles: &handles,
        events_tx,
        ws_reader_handle,
        session_id,
        task_id: None,
        timeout: LOOP_STREAM_TIMEOUT,
    })
    .await;
    // Persist the run handle so a restarted server can rediscover this
    // harness run and let the UI reattach instead of going headless.
    // Automation only: ephemeral single-task runs are short-lived and
    // their executor row is deleted with them.
    super::super::run_handles::save(
        &req.state,
        &super::super::run_handles::RunHandle {
            automaton_id: started.automaton_id.clone(),
            project_id: req.project_id,
            agent_instance_id: req.agent_instance_id,
            harness_base_url: prep.start.harness_base_url.clone(),
            saved_at: chrono::Utc::now(),
        },
    );
    tracing::info!(
        target: "aura::automation",
        project_id = %req.project_id,
        agent_instance_id = %req.agent_instance_id,
        automaton_id = %started.automaton_id,
        adopted = started.adopted,
        mode = "automation",
        session_id = session_id.map(|s| s.to_string()).unwrap_or_default(),
        "automation run registered"
    );
    emit_domain_event(
        &req.state,
        "loop_started",
        req.project_id,
        req.agent_instance_id,
        serde_json::json!({
            "automaton_id": started.automaton_id,
            "adopted": started.adopted,
        }),
    );
}

async fn register_single_task(inputs: RegisterInputs<'_>, task_id: TaskId) {
    let RegisterInputs {
        req,
        prep,
        started,
        events_tx,
        ws_reader_handle,
        session_id,
    } = inputs;
    let task_id_str = prep
        .task_id_str
        .clone()
        .expect("SingleTask context always populates task_id_str");
    seed_single_task_loop_state(req, session_id, &task_id_str, task_id).await;
    let handles = forge_handles(req, prep, LoopKind::TaskRun);
    handles.loop_handle.set_current_task(Some(task_id)).await;
    let task_id_for_log = task_id_str.clone();
    finalize_registration(FinalizeInputs {
        req,
        prep,
        started,
        handles: &handles,
        events_tx,
        ws_reader_handle,
        session_id,
        task_id: Some(task_id_str),
        timeout: TASK_STREAM_TIMEOUT,
    })
    .await;
    tracing::info!(
        target: "aura::automation",
        project_id = %req.project_id,
        agent_instance_id = %req.agent_instance_id,
        automaton_id = %started.automaton_id,
        adopted = started.adopted,
        mode = "single_task",
        task_id = %task_id_for_log,
        session_id = session_id.map(|s| s.to_string()).unwrap_or_default(),
        "automation run registered"
    );
    // No `replace_registry_entry`: the ephemeral id is freshly
    // minted, there is nothing to displace, and concurrent task
    // runs are explicitly allowed to coexist under different
    // ephemeral ids in the registry.
}

/// Record the loop/task start in the run log, seed the task output
/// row, and emit the `task_started` domain event for a single-task
/// run. Carved out of [`register_single_task`] so the body stays
/// inside the 50-line per-function budget. Side-effect ordering is
/// preserved verbatim.
async fn seed_single_task_loop_state(
    req: &RunRequest,
    session_id: Option<SessionId>,
    task_id_str: &str,
    task_id: TaskId,
) {
    req.state
        .loop_log
        .on_loop_started(req.project_id, req.agent_instance_id)
        .await;
    req.state
        .loop_log
        .on_task_started(req.project_id, req.agent_instance_id, task_id, None, None)
        .await;
    seed_task_output(
        &req.state,
        req.project_id,
        req.agent_instance_id,
        session_id,
        task_id_str,
    )
    .await;
    emit_domain_event(
        &req.state,
        "task_started",
        req.project_id,
        req.agent_instance_id,
        serde_json::json!({
            "task_id": task_id_str,
            "template_agent_instance_id": req.template_agent_instance_id.to_string(),
            "ephemeral": true,
        }),
    );
}

/// Allocate the per-automaton `Arc` bookkeeping shared between the
/// spawned forwarder and its registry slot. Sets the freshness clock
/// to "now" at registration time so a brand-new entry doesn't look
/// stale to `can_reuse_forwarder` until the first harness event
/// lands.
fn forge_handles(req: &RunRequest, prep: &RunContext, kind: LoopKind) -> HandleSet {
    let alive = Arc::new(AtomicBool::new(true));
    let loop_handle = Arc::new(req.state.loop_registry.open(LoopId::new(
        req.loop_user_id,
        Some(req.project_id),
        Some(req.agent_instance_id),
        prep.start.agent_id,
        kind,
    )));
    let last_forwarder_event_at = Arc::new(AtomicI64::new(current_millis()));
    HandleSet {
        alive,
        loop_handle,
        last_forwarder_event_at,
    }
}

/// Bundled inputs for [`finalize_registration`]. The forwarder + registry
/// insert legitimately needs a wide bag of fields (events / ws-reader / session
/// / task / timeout) so we group them here instead of widening the function
/// signature past the project's five-parameter ceiling.
struct FinalizeInputs<'a> {
    req: &'a RunRequest,
    prep: &'a RunContext,
    started: &'a StartedAutomaton,
    handles: &'a HandleSet,
    events_tx: broadcast::Sender<serde_json::Value>,
    ws_reader_handle: WsReaderHandle,
    session_id: Option<SessionId>,
    task_id: Option<String>,
    timeout: Duration,
}

async fn finalize_registration(inputs: FinalizeInputs<'_>) {
    let FinalizeInputs {
        req,
        prep,
        started,
        handles,
        events_tx,
        ws_reader_handle,
        session_id,
        task_id,
        timeout,
    } = inputs;
    let forwarder = spawn_event_forwarder(ForwarderContext {
        state: req.state.clone(),
        project_id: req.project_id,
        agent_instance_id: req.agent_instance_id,
        automaton_id: started.automaton_id.clone(),
        task_id,
        events_tx,
        ws_reader_handle: ws_reader_handle.clone(),
        alive: handles.alive.clone(),
        timeout,
        loop_handle: handles.loop_handle.clone(),
        jwt: Some(prep.forwarder_jwt.clone()),
        session_id,
        retry_state: Arc::new(LoopRetryState::new()),
        last_forwarder_event_at: handles.last_forwarder_event_at.clone(),
    });
    req.state.automaton_registry.lock().await.insert(
        (req.project_id, req.agent_instance_id),
        ActiveAutomaton {
            automaton_id: started.automaton_id.clone(),
            project_id: req.project_id,
            template_agent_id: prep.start.agent_id,
            loop_engineering: req
                .loop_engineering
                .as_ref()
                .and_then(|contract| serde_json::to_value(contract).ok()),
            harness_base_url: prep.start.harness_base_url.clone(),
            paused: false,
            alive: handles.alive.clone(),
            forwarder: Some(forwarder),
            ws_reader_handle: Some(ws_reader_handle),
            loop_handle: Some(handles.loop_handle.clone()),
            last_forwarder_event_at: handles.last_forwarder_event_at.clone(),
            session_id,
        },
    );
}
