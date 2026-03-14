pub mod dto;
pub mod error;
pub mod handlers;
pub mod router;
pub mod state;

pub use router::{create_router, create_router_with_frontend};
pub use state::AppState;

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use tokio::sync::{broadcast, mpsc, Mutex};
use tokio::time::{interval, Duration};
use tracing::{debug, info, warn};

use crate::state::TaskOutputBuffers;

use aura_engine::EngineEvent;
use aura_terminal::TerminalManager;
use aura_services::{
    AgentService, AuthService, ChatService, ClaudeClient, GitHubService, OrgService,
    PricingService, ProjectService, SessionService, SpecGenerationService,
    TaskExtractionService, TaskService,
};
use aura_settings::SettingsService;
use aura_store::RocksStore;

const LIVE_OUTPUT_FLUSH_INTERVAL: u64 = 50;
const DELTA_BROADCAST_INTERVAL_MS: u64 = 100;

fn spawn_event_rebroadcast(
    mut rx: mpsc::UnboundedReceiver<EngineEvent>,
    broadcast_tx: broadcast::Sender<EngineEvent>,
    store: Arc<RocksStore>,
    task_output_buffers: TaskOutputBuffers,
) {
    tokio::spawn(async move {
        let mut write_count: u64 = 0;
        let mut delta_count: u64 = 0;
        let mut delta_broadcast_buf: HashMap<aura_core::TaskId, (aura_core::ProjectId, aura_core::AgentId, String)> = HashMap::new();
        let mut flush_interval = interval(Duration::from_millis(DELTA_BROADCAST_INTERVAL_MS));
        flush_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            tokio::select! {
                maybe_event = rx.recv() => {
                    let Some(event) = maybe_event else { break };
                    match &event {
                        EngineEvent::TaskOutputDelta { project_id, agent_id, task_id, delta } => {
                            if let Ok(mut bufs) = task_output_buffers.lock() {
                                bufs.entry(*task_id).or_default().push_str(delta);
                            }
                            delta_count += 1;
                            if delta_count % LIVE_OUTPUT_FLUSH_INTERVAL == 0 {
                                flush_live_output(&store, &task_output_buffers);
                            }
                            let entry = delta_broadcast_buf.entry(*task_id)
                                .or_insert_with(|| (*project_id, *agent_id, String::new()));
                            entry.2.push_str(delta);
                        }
                        EngineEvent::TaskCompleted { task_id, .. }
                        | EngineEvent::TaskFailed { task_id, .. } => {
                            finalize_live_output(&store, &task_output_buffers, task_id);
                        }
                        EngineEvent::LoopStopped { .. } | EngineEvent::LoopFinished { .. } => {
                            finalize_all_live_output(&store, &task_output_buffers);
                        }
                        _ => {}
                    }

                    if matches!(event, EngineEvent::TaskOutputDelta { .. }) {
                        continue;
                    }

                    if let Ok(json_bytes) = serde_json::to_vec(&event) {
                        if let Err(e) = store.append_log_entry(&json_bytes) {
                            warn!("Failed to persist log entry: {e}");
                        } else {
                            write_count += 1;
                            if write_count % 500 == 0 {
                                if let Err(e) = store.prune_log_entries_if_needed() {
                                    warn!("Failed to prune log entries: {e}");
                                }
                            }
                        }
                    }

                    // Flush any buffered deltas before broadcasting a non-delta event,
                    // so the WS client always sees deltas before the event that follows them.
                    for (task_id, (pid, aid, text)) in delta_broadcast_buf.drain() {
                        let coalesced = EngineEvent::TaskOutputDelta {
                            project_id: pid,
                            agent_id: aid,
                            task_id,
                            delta: text,
                        };
                        let _ = broadcast_tx.send(coalesced);
                    }

                    debug!(?event, "Broadcasting engine event");
                    if broadcast_tx.send(event).is_err() {
                        warn!("No WebSocket subscribers for engine event");
                    }
                }
                _ = flush_interval.tick() => {
                    for (task_id, (pid, aid, text)) in delta_broadcast_buf.drain() {
                        debug!(%task_id, len = text.len(), "Flushing coalesced delta");
                        let _ = broadcast_tx.send(EngineEvent::TaskOutputDelta {
                            project_id: pid,
                            agent_id: aid,
                            task_id,
                            delta: text,
                        });
                    }
                }
            }
        }
    });
}

fn flush_live_output(store: &Arc<RocksStore>, buffers: &TaskOutputBuffers) {
    let snapshot: Vec<(aura_core::TaskId, String)> = {
        let Ok(bufs) = buffers.lock() else { return };
        bufs.iter().map(|(k, v)| (*k, v.clone())).collect()
    };
    for (task_id, text) in snapshot {
        if let Ok(Some(mut task)) = store.find_task_by_id(&task_id) {
            task.live_output = text;
            if let Err(e) = store.put_task(&task) {
                warn!(%task_id, "Failed to flush live_output: {e}");
            }
        }
    }
}

fn finalize_live_output(
    store: &Arc<RocksStore>,
    buffers: &TaskOutputBuffers,
    task_id: &aura_core::TaskId,
) {
    let final_text = buffers.lock().ok().and_then(|mut bufs| bufs.remove(task_id));
    if let Some(text) = final_text {
        if let Ok(Some(mut task)) = store.find_task_by_id(task_id) {
            task.live_output = text;
            if let Err(e) = store.put_task(&task) {
                warn!(%task_id, "Failed to finalize live_output: {e}");
            }
        }
    }
}

fn finalize_all_live_output(store: &Arc<RocksStore>, buffers: &TaskOutputBuffers) {
    let entries: Vec<(aura_core::TaskId, String)> = {
        let Ok(mut bufs) = buffers.lock() else { return };
        let drained: Vec<_> = bufs.drain().collect();
        drained
    };
    for (task_id, text) in entries {
        if let Ok(Some(mut task)) = store.find_task_by_id(&task_id) {
            task.live_output = text;
            if let Err(e) = store.put_task(&task) {
                warn!(%task_id, "Failed to finalize live_output: {e}");
            }
        }
    }
}

pub fn build_app_state(db_path: &Path, data_dir: &Path) -> AppState {
    let store = Arc::new(RocksStore::open(db_path).expect("failed to open RocksDB"));
    let org_service = Arc::new(OrgService::new(store.clone()));
    let github_service = Arc::new(GitHubService::new(store.clone(), org_service.clone()));
    let mut auth_service = AuthService::new(store.clone());
    auth_service.set_org_service(org_service.clone());
    let auth_service = Arc::new(auth_service);
    let settings_service =
        Arc::new(SettingsService::new(store.clone(), data_dir).expect("failed to init settings"));
    let pricing_service = Arc::new(PricingService::new(store.clone()));
    let claude_client = Arc::new(ClaudeClient::new());
    let project_service = Arc::new(ProjectService::new(store.clone()));
    let spec_gen_service = Arc::new(SpecGenerationService::new(
        store.clone(),
        settings_service.clone(),
        claude_client.clone(),
    ));
    let task_extraction_service = Arc::new(TaskExtractionService::new(
        store.clone(),
        settings_service.clone(),
        claude_client.clone(),
    ));
    let task_service = Arc::new(TaskService::new(store.clone()));
    let agent_service = Arc::new(AgentService::new(store.clone()));
    let session_service = Arc::new(SessionService::new(store.clone()));
    let chat_service = Arc::new(ChatService::new(
        store.clone(),
        settings_service.clone(),
        claude_client.clone(),
        spec_gen_service.clone(),
        project_service.clone(),
        task_service.clone(),
    ));

    // Reset any tasks left InProgress from a previous unclean shutdown
    if let Ok(projects) = project_service.list_projects() {
        for project in &projects {
            match task_service.reset_in_progress_tasks(&project.project_id) {
                Ok(reset) if !reset.is_empty() => {
                    info!(
                        project_id = %project.project_id,
                        count = reset.len(),
                        "Reset orphaned InProgress tasks on startup"
                    );
                }
                Err(e) => {
                    warn!(
                        project_id = %project.project_id,
                        error = %e,
                        "Failed to reset orphaned tasks on startup"
                    );
                }
                _ => {}
            }
        }
    }

    let (event_tx, event_rx) = mpsc::unbounded_channel::<EngineEvent>();
    let (event_broadcast, _) = broadcast::channel::<EngineEvent>(4096);
    let task_output_buffers: TaskOutputBuffers =
        Arc::new(std::sync::Mutex::new(HashMap::new()));

    spawn_event_rebroadcast(
        event_rx,
        event_broadcast.clone(),
        store.clone(),
        task_output_buffers.clone(),
    );

    AppState {
        store,
        org_service,
        github_service,
        auth_service,
        settings_service,
        pricing_service,
        project_service,
        spec_gen_service,
        task_extraction_service,
        task_service,
        agent_service,
        session_service,
        chat_service,
        claude_client,
        event_tx,
        event_broadcast,
        loop_registry: Arc::new(Mutex::new(HashMap::new())),
        write_coordinator: aura_engine::ProjectWriteCoordinator::new(),
        task_output_buffers,
        terminal_manager: Arc::new(TerminalManager::new()),
    }
}
