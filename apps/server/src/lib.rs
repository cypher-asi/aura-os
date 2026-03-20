pub mod dto;
pub mod error;
pub mod handlers;
pub mod loop_log;
pub mod router;
pub mod session_init;
pub mod state;

pub use router::{create_router, create_router_with_frontend};
pub use state::AppState;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tokio::sync::{broadcast, mpsc, Mutex};
use tokio::time::{interval, Duration};
use tracing::{debug, info, warn};

use crate::loop_log::LoopLogWriter;
use crate::state::TaskOutputBuffers;

use aura_core::ZeroAuthSession;
use aura_engine::EngineEvent;
use aura_network::NetworkClient;
use aura_orbit::OrbitClient;
use aura_storage::StorageClient;
use aura_terminal::TerminalManager;
use aura_agents::{AgentService, AgentInstanceService};
use aura_auth::AuthService;
use aura_chat::ChatService;
use aura_claude::ClaudeClient;
use aura_orgs::OrgService;
use aura_billing::{BillingClient, MeteredLlm, PricingService};
use aura_projects::ProjectService;
use aura_sessions::SessionService;
use aura_specs::SpecGenerationService;
use aura_tasks::{TaskExtractionService, TaskService};
use aura_settings::SettingsService;
use aura_store::RocksStore;

use futures_util::StreamExt;
use tokio_tungstenite::tungstenite;

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
        | EngineEvent::TestFixAttempt { project_id, .. } => Some(*project_id),
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
struct TaskSessionEntry {
    project_id: aura_core::ProjectId,
    agent_instance_id: aura_core::AgentInstanceId,
    session_id: aura_core::SessionId,
}

fn spawn_event_rebroadcast(
    mut rx: mpsc::UnboundedReceiver<EngineEvent>,
    broadcast_tx: broadcast::Sender<EngineEvent>,
    store: Arc<RocksStore>,
    storage_client: Option<Arc<StorageClient>>,
    task_output_buffers: TaskOutputBuffers,
    loop_log: Arc<LoopLogWriter>,
) {
    tokio::spawn(async move {
        let mut delta_count: u64 = 0;
        let mut delta_broadcast_buf: HashMap<aura_core::TaskId, (aura_core::ProjectId, aura_core::AgentInstanceId, String)> = HashMap::new();
        let mut ready_broadcast_buf: Vec<(aura_core::ProjectId, aura_core::AgentInstanceId, aura_core::TaskId)> = Vec::new();
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
                            if let Ok(mut bufs) = task_output_buffers.lock() {
                                bufs.entry(*task_id).or_default().push_str(delta);
                            }
                            delta_count += 1;
                            if delta_count % LIVE_OUTPUT_FLUSH_INTERVAL == 0 {
                                flush_live_output(&store, &task_output_buffers);
                            }
                            let entry = delta_broadcast_buf.entry(*task_id)
                                .or_insert_with(|| (*project_id, *agent_instance_id, String::new()));
                            entry.2.push_str(delta);
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
                        }
                        EngineEvent::TaskCompleted { task_id, .. }
                        | EngineEvent::TaskFailed { task_id, .. } => {
                            let output = if let Ok(mut bufs) = task_output_buffers.lock() {
                                bufs.remove(task_id).unwrap_or_default()
                            } else {
                                String::new()
                            };
                            task_output_for_log = Some((*task_id, output.clone()));

                            if let Some(ref sc) = storage_client {
                                if let Some(jwt) = get_jwt_from_store(&store) {
                                    persist_task_to_storage(
                                        sc, &jwt, &event, &output,
                                        task_session_map.get(task_id),
                                    ).await;
                                }
                            }
                            task_session_map.remove(task_id);
                            finalize_live_output(&store, &task_output_buffers, task_id);
                        }
                        EngineEvent::LoopStopped { .. } | EngineEvent::LoopFinished { .. } => {
                            task_session_map.clear();
                            finalize_all_live_output(&store, &task_output_buffers);
                        }
                        _ => {}
                    }

                    if matches!(event, EngineEvent::TaskOutputDelta { .. } | EngineEvent::TaskBecameReady { .. }) {
                        continue;
                    }

                    // Loop log: write event and lifecycle hooks
                    loop_log.on_event(&event).await;
                    match &event {
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

                    // Write to aura-storage
                    if let Some(ref sc) = storage_client {
                        if let Some(pid) = event_project_id(&event) {
                            if let Some(jwt) = get_jwt_from_store(&store) {
                                let metadata = serde_json::to_value(&event).ok();
                                let req = aura_storage::CreateLogEntryRequest {
                                    level: event_log_level(&event).to_string(),
                                    message: event_summary(&event),
                                    metadata,
                                };
                                if let Err(e) = sc.create_log_entry(&pid.to_string(), &jwt, &req).await {
                                    debug!("Failed to write log entry to aura-storage: {e}");
                                }
                            }
                        }
                    }

                    // Flush any buffered deltas before broadcasting a non-delta event,
                    // so the WS client always sees deltas before the event that follows them.
                    for (task_id, (pid, aiid, text)) in delta_broadcast_buf.drain() {
                        let coalesced = EngineEvent::TaskOutputDelta {
                            project_id: pid,
                            agent_instance_id: aiid,
                            task_id,
                            delta: text,
                        };
                        let _ = broadcast_tx.send(coalesced);
                    }

                    // Flush buffered TaskBecameReady as a single batched event
                    if !ready_broadcast_buf.is_empty() {
                        let (pid, aiid, _) = ready_broadcast_buf[0];
                        let task_ids: Vec<aura_core::TaskId> = ready_broadcast_buf.drain(..).map(|(_, _, tid)| tid).collect();
                        let _ = broadcast_tx.send(EngineEvent::TasksBecameReady {
                            project_id: pid,
                            agent_instance_id: aiid,
                            task_ids,
                        });
                    }

                    debug!(?event, "Broadcasting engine event");
                    if broadcast_tx.send(event).is_err() {
                        warn!("No WebSocket subscribers for engine event");
                    }
                }
                _ = flush_interval.tick() => {
                    for (task_id, (pid, aiid, text)) in delta_broadcast_buf.drain() {
                        debug!(%task_id, len = text.len(), "Flushing coalesced delta");
                        let _ = broadcast_tx.send(EngineEvent::TaskOutputDelta {
                            project_id: pid,
                            agent_instance_id: aiid,
                            task_id,
                            delta: text,
                        });
                    }
                    if !ready_broadcast_buf.is_empty() {
                        let (pid, aiid, _) = ready_broadcast_buf[0];
                        let task_ids: Vec<aura_core::TaskId> = ready_broadcast_buf.drain(..).map(|(_, _, tid)| tid).collect();
                        debug!(count = task_ids.len(), "Flushing coalesced TasksBecameReady");
                        let _ = broadcast_tx.send(EngineEvent::TasksBecameReady {
                            project_id: pid,
                            agent_instance_id: aiid,
                            task_ids,
                        });
                    }
                }
            }
        }
    });
}

fn flush_live_output(_store: &Arc<RocksStore>, _buffers: &TaskOutputBuffers) {
    // Live output is kept only in memory (task_output_buffers).
    // Task persistence moved to aura-storage which doesn't store live_output.
}

fn finalize_live_output(
    _store: &Arc<RocksStore>,
    buffers: &TaskOutputBuffers,
    task_id: &aura_core::TaskId,
) {
    // Remove from buffer on task completion; output was already streamed via WS.
    if let Ok(mut bufs) = buffers.lock() {
        bufs.remove(task_id);
    }
}

fn finalize_all_live_output(_store: &Arc<RocksStore>, buffers: &TaskOutputBuffers) {
    if let Ok(mut bufs) = buffers.lock() {
        bufs.drain();
    }
}

async fn persist_task_to_storage(
    storage: &Arc<StorageClient>,
    jwt: &str,
    event: &EngineEvent,
    live_output: &str,
    session_entry: Option<&TaskSessionEntry>,
) {
    match event {
        EngineEvent::TaskCompleted {
            task_id,
            execution_notes,
            file_changes,
            input_tokens,
            output_tokens,
            model,
            ..
        } => {
            let files_changed: Vec<aura_storage::StorageTaskFileChangeSummary> = file_changes
                .iter()
                .map(|f| aura_storage::StorageTaskFileChangeSummary {
                    op: f.op.clone(),
                    path: f.path.clone(),
                    lines_added: f.lines_added,
                    lines_removed: f.lines_removed,
                })
                .collect();

            let update = aura_storage::UpdateTaskRequest {
                title: None,
                description: None,
                order_index: None,
                dependency_ids: None,
                execution_notes: Some(execution_notes.clone()),
                files_changed: Some(files_changed),
                model: model.clone(),
                total_input_tokens: *input_tokens,
                total_output_tokens: *output_tokens,
                session_id: session_entry.map(|e| e.session_id.to_string()),
                assigned_project_agent_id: session_entry.map(|e| e.agent_instance_id.to_string()),
            };

            if let Err(e) = storage.update_task(&task_id.to_string(), jwt, &update).await {
                warn!(task_id = %task_id, error = %e, "Failed to persist task execution data to aura-storage");
            } else {
                info!(task_id = %task_id, "Persisted task execution data to aura-storage");
            }
        }
        EngineEvent::TaskFailed {
            task_id,
            reason,
            model,
            ..
        } => {
            let update = aura_storage::UpdateTaskRequest {
                title: None,
                description: None,
                order_index: None,
                dependency_ids: None,
                execution_notes: Some(reason.clone()),
                files_changed: None,
                model: model.clone(),
                total_input_tokens: None,
                total_output_tokens: None,
                session_id: session_entry.map(|e| e.session_id.to_string()),
                assigned_project_agent_id: session_entry.map(|e| e.agent_instance_id.to_string()),
            };

            if let Err(e) = storage.update_task(&task_id.to_string(), jwt, &update).await {
                warn!(task_id = %task_id, error = %e, "Failed to persist failed task data to aura-storage");
            }
        }
        _ => return,
    }

    // Store live_output as a session message
    if let Some(entry) = session_entry {
        if !live_output.is_empty() {
            let task_id = match event {
                EngineEvent::TaskCompleted { task_id, .. }
                | EngineEvent::TaskFailed { task_id, .. } => task_id,
                _ => return,
            };
            let (input_tokens, output_tokens) = match event {
                EngineEvent::TaskCompleted { input_tokens, output_tokens, .. } => (*input_tokens, *output_tokens),
                _ => (None, None),
            };

            let msg_req = aura_storage::CreateMessageRequest {
                project_agent_id: entry.agent_instance_id.to_string(),
                project_id: entry.project_id.to_string(),
                role: "assistant".to_string(),
                content: live_output.to_string(),
                input_tokens,
                output_tokens,
            };

            if let Err(e) = storage
                .create_message(&entry.session_id.to_string(), jwt, &msg_req)
                .await
            {
                warn!(task_id = %task_id, session_id = %entry.session_id, error = %e, "Failed to persist task output as session message");
            } else {
                info!(task_id = %task_id, session_id = %entry.session_id, "Persisted task output as session message");
            }
        }
    }
}

/// Reads the stored JWT from RocksDB, returning `None` if unavailable.
fn get_jwt_from_store(store: &RocksStore) -> Option<String> {
    let bytes = store.get_setting("zero_auth_session").ok()?;
    let session: ZeroAuthSession = serde_json::from_slice(&bytes).ok()?;
    Some(session.access_token)
}

/// Connects to the aura-network WebSocket and rebroadcasts social events
/// (feed activity, follows, usage updates) on the local event_broadcast channel.
fn spawn_network_ws_bridge(
    client: Arc<NetworkClient>,
    store: Arc<RocksStore>,
    broadcast_tx: broadcast::Sender<EngineEvent>,
) {
    tokio::spawn(async move {
        let mut backoff = Duration::from_secs(2);
        let max_backoff = Duration::from_secs(60);

        loop {
            let jwt = match get_jwt_from_store(&store) {
                Some(jwt) => jwt,
                None => {
                    debug!("No session available for network WS bridge, retrying...");
                    tokio::time::sleep(Duration::from_secs(10)).await;
                    continue;
                }
            };

            let url = client.ws_events_url(&jwt);
            debug!("Connecting to aura-network WS...");

            match tokio_tungstenite::connect_async(&url).await {
                Ok((ws_stream, _)) => {
                    info!("Connected to aura-network WebSocket");
                    backoff = Duration::from_secs(2);

                    let (_, mut read) = ws_stream.split();
                    loop {
                        match read.next().await {
                            Some(Ok(tungstenite::Message::Text(text))) => {
                                match serde_json::from_str::<serde_json::Value>(&text) {
                                    Ok(value) => {
                                        let event_type = value
                                            .get("type")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("unknown")
                                            .to_string();

                                        let event = EngineEvent::NetworkEvent {
                                            network_event_type: event_type,
                                            payload: Some(value),
                                        };

                                        if broadcast_tx.send(event).is_err() {
                                            debug!("No local WS subscribers for network event");
                                        }
                                    }
                                    Err(e) => {
                                        debug!("Non-JSON message from network WS: {e}");
                                    }
                                }
                            }
                            Some(Ok(tungstenite::Message::Close(_))) | None => {
                                info!("aura-network WebSocket closed");
                                break;
                            }
                            Some(Ok(_)) => {}
                            Some(Err(e)) => {
                                warn!("aura-network WebSocket error: {e}");
                                break;
                            }
                        }
                    }
                }
                Err(e) => {
                    warn!(error = %e, "Failed to connect to aura-network WebSocket");
                }
            }

            info!(backoff_secs = backoff.as_secs(), "Reconnecting to aura-network WS...");
            tokio::time::sleep(backoff).await;
            backoff = (backoff * 2).min(max_backoff);
        }
    });
}

pub fn build_app_state(db_path: &Path) -> AppState {
    let data_dir = db_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| Path::new(".").to_path_buf());
    let store = Arc::new(RocksStore::open(db_path).expect("failed to open RocksDB"));
    let org_service = Arc::new(OrgService::new(store.clone()));
    let auth_service = Arc::new(AuthService::new(store.clone()));
    let settings_service = Arc::new(SettingsService::new(store.clone()));
    let pricing_service = Arc::new(PricingService::new(store.clone()));
    let billing_client = Arc::new(BillingClient::new());
    let claude_client: Arc<dyn aura_claude::LlmProvider> = Arc::new(ClaudeClient::new());
    let llm = Arc::new(MeteredLlm::new(
        claude_client,
        billing_client.clone(),
        store.clone(),
    ));
    let network_client = NetworkClient::from_env().map(Arc::new);
    let project_service = Arc::new(ProjectService::new_with_network(network_client.clone(), store.clone()));
    let storage_client = StorageClient::from_env().map(Arc::new);
    let spec_gen_service = Arc::new(SpecGenerationService::new(
        store.clone(),
        project_service.clone(),
        settings_service.clone(),
        llm.clone(),
        storage_client.clone(),
    ));
    let task_extraction_service = Arc::new(TaskExtractionService::new(
        store.clone(),
        settings_service.clone(),
        llm.clone(),
        storage_client.clone(),
    ));
    let task_service = Arc::new(TaskService::new(store.clone(), storage_client.clone()));
    let agent_service = Arc::new(AgentService::new(
        store.clone(),
        network_client.clone(),
    ));
    let runtime_agent_state: crate::state::RuntimeAgentStateMap =
        Arc::new(Mutex::new(HashMap::new()));
    let agent_instance_service = Arc::new(AgentInstanceService::new(
        store.clone(),
        storage_client.clone(),
        runtime_agent_state.clone(),
        network_client.clone(),
    ));
    let llm_config = aura_core::LlmConfig::from_env();
    let session_service = Arc::new(
        SessionService::new(store.clone(), llm_config.context_rollover_threshold, llm_config.max_context_tokens)
            .with_storage_client(storage_client.clone()),
    );
    let chat_service = Arc::new(ChatService::new(
        store.clone(),
        settings_service.clone(),
        llm.clone(),
        spec_gen_service.clone(),
        project_service.clone(),
        task_service.clone(),
        storage_client.clone(),
    ));

    // Task reset on startup removed: project list is org-scoped from network only.
    // Orphaned InProgress tasks could be reset later when listing projects by org if desired.

    let (event_tx, event_rx) = mpsc::unbounded_channel::<EngineEvent>();
    let (event_broadcast, _) = broadcast::channel::<EngineEvent>(4096);
    let task_output_buffers: TaskOutputBuffers =
        Arc::new(std::sync::Mutex::new(HashMap::new()));

    let loop_log_dir = std::env::var("AURA_LOOP_LOG_DIR")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| data_dir.join("loop-logs"));
    let loop_log = Arc::new(LoopLogWriter::new(loop_log_dir));

    spawn_event_rebroadcast(
        event_rx,
        event_broadcast.clone(),
        store.clone(),
        storage_client.clone(),
        task_output_buffers.clone(),
        loop_log,
    );

    let orbit_client = Arc::new(OrbitClient::new());
    let orbit_base_url = std::env::var("ORBIT_BASE_URL")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim_end_matches('/').to_string());
    let internal_service_token = std::env::var("INTERNAL_SERVICE_TOKEN")
        .ok()
        .filter(|s| !s.trim().is_empty());

    if let Some(ref client) = storage_client {
        let health_client = client.clone();
        tokio::spawn(async move {
            match health_client.health_check().await {
                Ok(()) => info!("aura-storage is reachable"),
                Err(e) => warn!(
                    error = %e,
                    "aura-storage health check failed on startup (will retry on first request)"
                ),
            }
        });
    } else {
        info!("aura-storage integration disabled (AURA_STORAGE_URL not set)");
    }

    if let Some(ref client) = network_client {
        let health_client = client.clone();
        tokio::spawn(async move {
            match health_client.health_check().await {
                Ok(h) => info!(
                    status = %h.status,
                    version = h.version.as_deref().unwrap_or("unknown"),
                    "aura-network is reachable"
                ),
                Err(e) => warn!(
                    error = %e,
                    "aura-network health check failed on startup (will retry on first request)"
                ),
            }
        });

        spawn_network_ws_bridge(
            client.clone(),
            store.clone(),
            event_broadcast.clone(),
        );
    } else {
        info!("aura-network integration disabled (AURA_NETWORK_URL not set)");
    }

    AppState {
        data_dir: data_dir.to_path_buf(),
        store,
        org_service,
        auth_service,
        settings_service,
        pricing_service,
        billing_client,
        project_service,
        spec_gen_service,
        task_extraction_service,
        task_service,
        agent_service,
        agent_instance_service,
        session_service,
        chat_service,
        llm,
        event_tx,
        event_broadcast,
        loop_registry: Arc::new(Mutex::new(HashMap::new())),
        write_coordinator: aura_engine::ProjectWriteCoordinator::new(),
        task_output_buffers,
        terminal_manager: Arc::new(TerminalManager::new()),
        network_client,
        storage_client,
        orbit_client,
        orbit_base_url,
        internal_service_token,
        runtime_agent_state,
    }
}
