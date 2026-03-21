pub(crate) mod channel_ext;
pub mod dto;
pub mod error;
pub mod handlers;
pub mod loop_log;
pub mod router;
pub mod session_init;
pub mod state;
mod persistence;
mod network_bridge;
mod app_builder;

pub use router::{create_router, create_router_with_frontend};
pub use state::AppState;
pub use app_builder::build_app_state;

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

/// Extract project_id from an EngineEvent (if available).
fn event_project_id(event: &EngineEvent) -> Option<aura_core::ProjectId> {
    match event {
        EngineEvent::LoopStarted { project_id, .. }
        | EngineEvent::TaskStarted { project_id, .. }
        | EngineEvent::TaskCompleted { project_id, .. }
        | EngineEvent::TaskFailed { project_id, .. }
        | EngineEvent::TaskRetrying { project_id, .. }
        | EngineEvent::TaskBecameReady { project_id, .. }
        | EngineEvent::TasksBecameReady { project_id, .. }
        | EngineEvent::FollowUpTaskCreated { project_id, .. }
        | EngineEvent::SessionRolledOver { project_id, .. }
        | EngineEvent::LoopPaused { project_id, .. }
        | EngineEvent::LoopStopped { project_id, .. }
        | EngineEvent::LoopFinished { project_id, .. }
        | EngineEvent::LoopIterationSummary { project_id, .. }
        | EngineEvent::FileOpsApplied { project_id, .. }
        | EngineEvent::SpecGenStarted { project_id, .. }
        | EngineEvent::SpecGenProgress { project_id, .. }
        | EngineEvent::SpecGenCompleted { project_id, .. }
        | EngineEvent::SpecGenFailed { project_id, .. }
        | EngineEvent::SpecSaved { project_id, .. }
        | EngineEvent::BuildVerificationSkipped { project_id, .. }
        | EngineEvent::BuildVerificationStarted { project_id, .. }
        | EngineEvent::BuildVerificationPassed { project_id, .. }
        | EngineEvent::BuildVerificationFailed { project_id, .. }
        | EngineEvent::BuildFixAttempt { project_id, .. }
        | EngineEvent::TestVerificationStarted { project_id, .. }
        | EngineEvent::TestVerificationPassed { project_id, .. }
        | EngineEvent::TestVerificationFailed { project_id, .. }
        | EngineEvent::TestFixAttempt { project_id, .. }
        | EngineEvent::GitCommitted { project_id, .. }
        | EngineEvent::GitPushed { project_id, .. } => Some(*project_id),
        EngineEvent::TaskOutputDelta { project_id, .. } => Some(*project_id),
        EngineEvent::LogLine { .. } | EngineEvent::NetworkEvent { .. } => None,
    }
}

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
        EngineEvent::TaskFailed { task_id, reason, .. } => {
            format!("Task {task_id} failed: {reason}")
        }
        EngineEvent::TaskRetrying { task_id, attempt, reason, .. } => {
            format!("Task {task_id} retrying (attempt {attempt}): {reason}")
        }
        EngineEvent::LoopFinished { outcome, .. } => format!("Dev loop finished: {outcome}"),
        EngineEvent::LoopStopped { completed_count, .. } => {
            format!("Dev loop stopped ({completed_count} tasks completed)")
        }
        EngineEvent::LoopPaused { completed_count, .. } => {
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
        EngineEvent::FileOpsApplied { files_written, files_deleted, .. } => {
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

type DeltaBroadcastBuf = HashMap<aura_core::TaskId, (aura_core::ProjectId, aura_core::AgentInstanceId, String)>;
type ReadyBroadcastBuf = Vec<(aura_core::ProjectId, aura_core::AgentInstanceId, aura_core::TaskId)>;

fn handle_task_output_delta(
    task_id: aura_core::TaskId,
    project_id: aura_core::ProjectId,
    agent_instance_id: aura_core::AgentInstanceId,
    delta: &str,
    task_output_buffers: &TaskOutputBuffers,
    delta_broadcast_buf: &mut DeltaBroadcastBuf,
    delta_count: &mut u64,
    store: &Arc<RocksStore>,
) {
    if let Ok(mut bufs) = task_output_buffers.lock() {
        bufs.entry(task_id).or_default().push_str(delta);
    }
    *delta_count += 1;
    if *delta_count % LIVE_OUTPUT_FLUSH_INTERVAL == 0 {
        flush_live_output(store, task_output_buffers);
    }
    let entry = delta_broadcast_buf.entry(task_id)
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
            if is_build { entry.0.push(val); } else { entry.1.push(val); }
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
                sc, &jwt, event, &output,
                task_session_map.get(task_id),
                &build_steps, &test_steps,
            ).await;
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
        EngineEvent::LoopStarted { project_id, agent_instance_id, .. } => {
            loop_log.on_loop_started(*project_id, *agent_instance_id).await;
        }
        EngineEvent::TaskStarted { project_id, agent_instance_id, task_id, .. } => {
            loop_log.on_task_started(*project_id, *agent_instance_id, *task_id).await;
        }
        EngineEvent::TaskCompleted { .. } | EngineEvent::TaskFailed { .. } => {
            if let Some((tid, ref out)) = task_output_for_log.take() {
                loop_log.on_task_end(tid, out).await;
            }
        }
        EngineEvent::LoopFinished { project_id, agent_instance_id, .. }
        | EngineEvent::LoopStopped { project_id, agent_instance_id, .. } => {
            loop_log.on_loop_ended(*project_id, *agent_instance_id).await;
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
        if let Some(pid) = event_project_id(event) {
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
        broadcast_or_log(&broadcast_tx, EngineEvent::TaskOutputDelta {
            project_id: pid,
            agent_instance_id: aiid,
            task_id,
            delta: text,
        });
    }
    if !ready_broadcast_buf.is_empty() {
        let (pid, aiid, _) = ready_broadcast_buf[0];
        let task_ids: Vec<aura_core::TaskId> = ready_broadcast_buf.drain(..).map(|(_, _, tid)| tid).collect();
        broadcast_or_log(&broadcast_tx, EngineEvent::TasksBecameReady {
            project_id: pid,
            agent_instance_id: aiid,
            task_ids,
        });
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
        let mut delta_count: u64 = 0;
        let mut delta_broadcast_buf: DeltaBroadcastBuf = HashMap::new();
        let mut ready_broadcast_buf: ReadyBroadcastBuf = Vec::new();
        let mut flush_interval = interval(Duration::from_millis(DELTA_BROADCAST_INTERVAL_MS));
        flush_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut task_output_for_log: Option<(aura_core::TaskId, String)> = None;
        let mut task_session_map: HashMap<aura_core::TaskId, TaskSessionEntry> = HashMap::new();

        loop {
            tokio::select! {
                maybe_event = rx.recv() => {
                    let Some(event) = maybe_event else { break };

                    match &event {
                        EngineEvent::TaskOutputDelta { project_id, agent_instance_id, task_id, delta } => {
                            handle_task_output_delta(
                                *task_id, *project_id, *agent_instance_id, delta,
                                &task_output_buffers, &mut delta_broadcast_buf,
                                &mut delta_count, &store,
                            );
                        }
                        EngineEvent::TaskBecameReady { project_id, agent_instance_id, task_id } => {
                            ready_broadcast_buf.push((*project_id, *agent_instance_id, *task_id));
                        }
                        EngineEvent::TaskStarted { project_id, agent_instance_id, task_id, session_id, .. } => {
                            task_session_map.insert(*task_id, TaskSessionEntry {
                                project_id: *project_id,
                                agent_instance_id: *agent_instance_id,
                                session_id: *session_id,
                            });
                            if let Ok(mut steps) = task_step_buffers.lock() {
                                steps.remove(task_id);
                            }
                        }
                        EngineEvent::BuildVerificationSkipped { task_id, .. }
                        | EngineEvent::BuildVerificationStarted { task_id, .. }
                        | EngineEvent::BuildVerificationPassed { task_id, .. }
                        | EngineEvent::BuildVerificationFailed { task_id, .. }
                        | EngineEvent::BuildFixAttempt { task_id, .. } => {
                            handle_verification_event(&event, task_id, true, &task_step_buffers);
                        }
                        EngineEvent::TestVerificationStarted { task_id, .. }
                        | EngineEvent::TestVerificationPassed { task_id, .. }
                        | EngineEvent::TestVerificationFailed { task_id, .. }
                        | EngineEvent::TestFixAttempt { task_id, .. } => {
                            handle_verification_event(&event, task_id, false, &task_step_buffers);
                        }
                        EngineEvent::TaskCompleted { task_id, .. }
                        | EngineEvent::TaskFailed { task_id, .. } => {
                            task_output_for_log = handle_task_end(
                                &event, task_id,
                                &task_output_buffers, &task_step_buffers,
                                &mut task_session_map, &storage_client, &store,
                            ).await;
                        }
                        EngineEvent::LoopStopped { .. } | EngineEvent::LoopFinished { .. } => {
                            task_session_map.clear();
                            finalize_all_live_output(&store, &task_output_buffers);
                            if let Ok(mut steps) = task_step_buffers.lock() {
                                steps.clear();
                            }
                        }
                        _ => {}
                    }

                    if matches!(event, EngineEvent::TaskOutputDelta { .. } | EngineEvent::TaskBecameReady { .. }) {
                        continue;
                    }

                    write_loop_log_lifecycle(&loop_log, &event, &mut task_output_for_log).await;
                    write_storage_log_entry(&storage_client, &store, &event).await;
                    flush_buffered_events(&broadcast_tx, &mut delta_broadcast_buf, &mut ready_broadcast_buf);

                    debug!(?event, "Broadcasting engine event");
                    if broadcast_tx.send(event).is_err() {
                        warn!("No WebSocket subscribers for engine event");
                    }
                }
                _ = flush_interval.tick() => {
                    flush_buffered_events(&broadcast_tx, &mut delta_broadcast_buf, &mut ready_broadcast_buf);
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
