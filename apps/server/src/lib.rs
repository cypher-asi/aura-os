mod app_builder;
pub(crate) mod channel_ext;
pub mod dto;
pub mod error;
pub mod handlers;
pub mod loop_log;
mod network_bridge;
mod persistence;
pub mod router;
pub mod session_init;
pub mod state;

pub use app_builder::build_app_state;
pub use router::{create_router, create_router_with_frontend};
pub use state::AppState;

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::{broadcast, mpsc};
use tokio::time::{interval, Duration};
use tracing::{debug, warn};

use crate::channel_ext::broadcast_or_log;
use crate::loop_log::LoopLogWriter;
use crate::state::{TaskOutputBuffers, TaskStepBuffers};

use aura_engine::EngineEvent;
use aura_storage::StorageClient;
use aura_store::RocksStore;

const LIVE_OUTPUT_FLUSH_INTERVAL: u64 = 50;
const DELTA_BROADCAST_INTERVAL_MS: u64 = 100;

/// Map an EngineEvent type to a log level string for aura-storage.
fn event_log_level(event: &EngineEvent) -> &'static str {
    match event {
        EngineEvent::TaskFailed { .. }
        | EngineEvent::SpecGenFailed { .. }
        | EngineEvent::BuildVerificationFailed { .. }
        | EngineEvent::TestVerificationFailed { .. } => "error",
        EngineEvent::TaskRetrying { .. }
        | EngineEvent::BuildFixAttempt { .. }
        | EngineEvent::TestFixAttempt { .. } => "warn",
        _ => "info",
    }
}

/// Build a human-readable summary from an EngineEvent.
fn event_summary(event: &EngineEvent) -> String {
    match event {
        EngineEvent::LoopStarted { .. } => "Dev loop started".into(),
        EngineEvent::TaskStarted { task_title, .. } => format!("Task started: {task_title}"),
        EngineEvent::TaskCompleted { task_id, .. } => format!("Task {task_id} completed"),
        EngineEvent::TaskFailed {
            task_id, reason, ..
        } => {
            format!("Task {task_id} failed: {reason}")
        }
        EngineEvent::TaskRetrying {
            task_id,
            attempt,
            reason,
            ..
        } => {
            format!("Task {task_id} retrying (attempt {attempt}): {reason}")
        }
        EngineEvent::LoopFinished { outcome, .. } => format!("Dev loop finished: {outcome}"),
        EngineEvent::LoopStopped {
            completed_count, ..
        } => {
            format!("Dev loop stopped ({completed_count} tasks completed)")
        }
        EngineEvent::LoopPaused {
            completed_count, ..
        } => {
            format!("Dev loop paused ({completed_count} tasks completed)")
        }
        EngineEvent::SpecGenStarted { .. } => "Spec generation started".into(),
        EngineEvent::SpecGenCompleted { spec_count, .. } => {
            format!("Spec generation completed ({spec_count} specs)")
        }
        EngineEvent::SpecGenFailed { reason, .. } => {
            format!("Spec generation failed: {reason}")
        }
        EngineEvent::SessionRolledOver { .. } => "Session rolled over".into(),
        EngineEvent::FileOpsApplied {
            files_written,
            files_deleted,
            ..
        } => {
            format!("Files applied: {files_written} written, {files_deleted} deleted")
        }
        EngineEvent::LogLine { message } => message.clone(),
        _ => {
            let type_name = serde_json::to_value(event)
                .ok()
                .and_then(|v| v.get("type").and_then(|t| t.as_str()).map(String::from))
                .unwrap_or_else(|| "unknown".into());
            type_name
        }
    }
}

/// Per-task context tracked between TaskStarted and TaskCompleted/TaskFailed.
pub(crate) struct TaskSessionEntry {
    pub(crate) project_id: aura_core::ProjectId,
    pub(crate) agent_instance_id: aura_core::AgentInstanceId,
    pub(crate) session_id: aura_core::SessionId,
}

type DeltaBroadcastBuf =
    HashMap<aura_core::TaskId, (aura_core::ProjectId, aura_core::AgentInstanceId, String)>;
type ReadyBroadcastBuf = Vec<(
    aura_core::ProjectId,
    aura_core::AgentInstanceId,
    aura_core::TaskId,
)>;

struct DeltaContext<'a> {
    task_output_buffers: &'a TaskOutputBuffers,
    delta_broadcast_buf: &'a mut DeltaBroadcastBuf,
    delta_count: &'a mut u64,
    store: &'a Arc<RocksStore>,
}

fn handle_task_output_delta(
    task_id: aura_core::TaskId,
    project_id: aura_core::ProjectId,
    agent_instance_id: aura_core::AgentInstanceId,
    delta: &str,
    ctx: &mut DeltaContext<'_>,
) {
    if let Ok(mut bufs) = ctx.task_output_buffers.lock() {
        bufs.entry(task_id).or_default().push_str(delta);
    }
    *ctx.delta_count += 1;
    if (*ctx.delta_count).is_multiple_of(LIVE_OUTPUT_FLUSH_INTERVAL) {
        flush_live_output(ctx.store, ctx.task_output_buffers);
    }
    let entry = ctx
        .delta_broadcast_buf
        .entry(task_id)
        .or_insert_with(|| (project_id, agent_instance_id, String::new()));
    entry.2.push_str(delta);
}

fn handle_verification_event(
    event: &EngineEvent,
    task_id: &aura_core::TaskId,
    is_build: bool,
    task_step_buffers: &TaskStepBuffers,
) {
    if let Ok(val) = serde_json::to_value(event) {
        if let Ok(mut steps) = task_step_buffers.lock() {
            let entry = steps.entry(*task_id).or_default();
            if is_build {
                entry.0.push(val);
            } else {
                entry.1.push(val);
            }
        }
    }
}

async fn handle_task_end(
    event: &EngineEvent,
    task_id: &aura_core::TaskId,
    task_output_buffers: &TaskOutputBuffers,
    task_step_buffers: &TaskStepBuffers,
    task_session_map: &mut HashMap<aura_core::TaskId, TaskSessionEntry>,
    storage_client: &Option<Arc<StorageClient>>,
    store: &Arc<RocksStore>,
) -> Option<(aura_core::TaskId, String)> {
    let output = if let Ok(mut bufs) = task_output_buffers.lock() {
        bufs.remove(task_id).unwrap_or_default()
    } else {
        String::new()
    };
    let (build_steps, test_steps) = if let Ok(mut steps) = task_step_buffers.lock() {
        steps.remove(task_id).unwrap_or_default()
    } else {
        (Vec::new(), Vec::new())
    };
    let log_entry = Some((*task_id, output.clone()));

    if let Some(ref sc) = storage_client {
        if let Some(jwt) = store.get_jwt() {
            persistence::persist_task_to_storage(
                sc,
                &jwt,
                event,
                &output,
                task_session_map.get(task_id),
                &build_steps,
                &test_steps,
            )
            .await;
        }
    }
    task_session_map.remove(task_id);
    finalize_live_output(store, task_output_buffers, task_id);

    log_entry
}

async fn write_loop_log_lifecycle(
    loop_log: &LoopLogWriter,
    event: &EngineEvent,
    task_output_for_log: &mut Option<(aura_core::TaskId, String)>,
) {
    loop_log.on_event(event).await;
    match event {
        EngineEvent::LoopStarted {
            project_id,
            agent_instance_id,
            ..
        } => {
            loop_log
                .on_loop_started(*project_id, *agent_instance_id)
                .await;
        }
        EngineEvent::TaskStarted {
            project_id,
            agent_instance_id,
            task_id,
            ..
        } => {
            loop_log
                .on_task_started(*project_id, *agent_instance_id, *task_id)
                .await;
        }
        EngineEvent::TaskCompleted { .. } | EngineEvent::TaskFailed { .. } => {
            if let Some((tid, ref out)) = task_output_for_log.take() {
                loop_log.on_task_end(tid, out).await;
            }
        }
        EngineEvent::LoopFinished {
            project_id,
            agent_instance_id,
            ..
        }
        | EngineEvent::LoopStopped {
            project_id,
            agent_instance_id,
            ..
        } => {
            loop_log
                .on_loop_ended(*project_id, *agent_instance_id)
                .await;
        }
        _ => {}
    }
}

async fn write_storage_log_entry(
    storage_client: &Option<Arc<StorageClient>>,
    store: &Arc<RocksStore>,
    event: &EngineEvent,
) {
    if let Some(ref sc) = storage_client {
        if let Some(pid) = event.project_id() {
            if let Some(jwt) = store.get_jwt() {
                let metadata = serde_json::to_value(event).ok();
                let req = aura_storage::CreateLogEntryRequest {
                    level: event_log_level(event).to_string(),
                    message: event_summary(event),
                    metadata,
                };
                if let Err(e) = sc.create_log_entry(&pid.to_string(), &jwt, &req).await {
                    debug!("Failed to write log entry to aura-storage: {e}");
                }
            }
        }
    }
}

fn flush_buffered_events(
    broadcast_tx: &broadcast::Sender<EngineEvent>,
    delta_broadcast_buf: &mut DeltaBroadcastBuf,
    ready_broadcast_buf: &mut ReadyBroadcastBuf,
) {
    for (task_id, (pid, aiid, text)) in delta_broadcast_buf.drain() {
        broadcast_or_log(
            broadcast_tx,
            EngineEvent::TaskOutputDelta {
                project_id: pid,
                agent_instance_id: aiid,
                task_id,
                delta: text,
            },
        );
    }
    if !ready_broadcast_buf.is_empty() {
        let (pid, aiid, _) = ready_broadcast_buf[0];
        let task_ids: Vec<aura_core::TaskId> = ready_broadcast_buf
            .drain(..)
            .map(|(_, _, tid)| tid)
            .collect();
        broadcast_or_log(
            broadcast_tx,
            EngineEvent::TasksBecameReady {
                project_id: pid,
                agent_instance_id: aiid,
                task_ids,
            },
        );
    }
}

struct RebroadcastState {
    delta_count: u64,
    delta_broadcast_buf: DeltaBroadcastBuf,
    ready_broadcast_buf: ReadyBroadcastBuf,
    task_output_for_log: Option<(aura_core::TaskId, String)>,
    task_session_map: HashMap<aura_core::TaskId, TaskSessionEntry>,
}

impl RebroadcastState {
    fn new() -> Self {
        Self {
            delta_count: 0,
            delta_broadcast_buf: HashMap::new(),
            ready_broadcast_buf: Vec::new(),
            task_output_for_log: None,
            task_session_map: HashMap::new(),
        }
    }
}

async fn dispatch_engine_event(
    event: &EngineEvent,
    rbs: &mut RebroadcastState,
    task_output_buffers: &TaskOutputBuffers,
    task_step_buffers: &TaskStepBuffers,
    storage_client: &Option<Arc<StorageClient>>,
    store: &Arc<RocksStore>,
) {
    match event {
        EngineEvent::TaskOutputDelta {
            project_id,
            agent_instance_id,
            task_id,
            delta,
        } => {
            handle_task_output_delta(
                *task_id,
                *project_id,
                *agent_instance_id,
                delta,
                &mut DeltaContext {
                    task_output_buffers,
                    delta_broadcast_buf: &mut rbs.delta_broadcast_buf,
                    delta_count: &mut rbs.delta_count,
                    store,
                },
            );
        }
        EngineEvent::TaskBecameReady {
            project_id,
            agent_instance_id,
            task_id,
        } => {
            rbs.ready_broadcast_buf
                .push((*project_id, *agent_instance_id, *task_id));
        }
        EngineEvent::TaskStarted {
            project_id,
            agent_instance_id,
            task_id,
            session_id,
            ..
        } => {
            rbs.task_session_map.insert(
                *task_id,
                TaskSessionEntry {
                    project_id: *project_id,
                    agent_instance_id: *agent_instance_id,
                    session_id: *session_id,
                },
            );
            if let Ok(mut steps) = task_step_buffers.lock() {
                steps.remove(task_id);
            }
        }
        EngineEvent::BuildVerificationSkipped { task_id, .. }
        | EngineEvent::BuildVerificationStarted { task_id, .. }
        | EngineEvent::BuildVerificationPassed { task_id, .. }
        | EngineEvent::BuildVerificationFailed { task_id, .. }
        | EngineEvent::BuildFixAttempt { task_id, .. } => {
            handle_verification_event(event, task_id, true, task_step_buffers);
        }
        EngineEvent::TestVerificationStarted { task_id, .. }
        | EngineEvent::TestVerificationPassed { task_id, .. }
        | EngineEvent::TestVerificationFailed { task_id, .. }
        | EngineEvent::TestFixAttempt { task_id, .. } => {
            handle_verification_event(event, task_id, false, task_step_buffers);
        }
        EngineEvent::TaskCompleted { task_id, .. } | EngineEvent::TaskFailed { task_id, .. } => {
            rbs.task_output_for_log = handle_task_end(
                event,
                task_id,
                task_output_buffers,
                task_step_buffers,
                &mut rbs.task_session_map,
                storage_client,
                store,
            )
            .await;
        }
        EngineEvent::LoopStopped { .. } | EngineEvent::LoopFinished { .. } => {
            rbs.task_session_map.clear();
            finalize_all_live_output(store, task_output_buffers);
            if let Ok(mut steps) = task_step_buffers.lock() {
                steps.clear();
            }
        }
        _ => {}
    }
}

fn spawn_event_rebroadcast(
    mut rx: mpsc::UnboundedReceiver<EngineEvent>,
    broadcast_tx: broadcast::Sender<EngineEvent>,
    store: Arc<RocksStore>,
    storage_client: Option<Arc<StorageClient>>,
    task_output_buffers: TaskOutputBuffers,
    task_step_buffers: TaskStepBuffers,
    loop_log: Arc<LoopLogWriter>,
) {
    tokio::spawn(async move {
        let mut rbs = RebroadcastState::new();
        let mut flush_interval = interval(Duration::from_millis(DELTA_BROADCAST_INTERVAL_MS));
        flush_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            tokio::select! {
                maybe_event = rx.recv() => {
                    let Some(event) = maybe_event else { break };
                    dispatch_engine_event(
                        &event, &mut rbs, &task_output_buffers,
                        &task_step_buffers, &storage_client, &store,
                    ).await;
                    if matches!(event, EngineEvent::TaskOutputDelta { .. } | EngineEvent::TaskBecameReady { .. }) {
                        continue;
                    }
                    write_loop_log_lifecycle(&loop_log, &event, &mut rbs.task_output_for_log).await;
                    write_storage_log_entry(&storage_client, &store, &event).await;
                    flush_buffered_events(&broadcast_tx, &mut rbs.delta_broadcast_buf, &mut rbs.ready_broadcast_buf);
                    debug!(?event, "Broadcasting engine event");
                    if broadcast_tx.send(event).is_err() {
                        warn!("No WebSocket subscribers for engine event");
                    }
                }
                _ = flush_interval.tick() => {
                    flush_buffered_events(&broadcast_tx, &mut rbs.delta_broadcast_buf, &mut rbs.ready_broadcast_buf);
                }
            }
        }
    });
}

fn flush_live_output(_store: &Arc<RocksStore>, _buffers: &TaskOutputBuffers) {
    // Live output is kept only in memory (task_output_buffers).
}

fn finalize_live_output(
    _store: &Arc<RocksStore>,
    buffers: &TaskOutputBuffers,
    task_id: &aura_core::TaskId,
) {
    if let Ok(mut bufs) = buffers.lock() {
        bufs.remove(task_id);
    }
}

fn finalize_all_live_output(_store: &Arc<RocksStore>, buffers: &TaskOutputBuffers) {
    if let Ok(mut bufs) = buffers.lock() {
        bufs.drain();
    }
}
