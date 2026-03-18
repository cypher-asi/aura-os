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

use aura_core::ZeroAuthSession;
use aura_engine::EngineEvent;
use aura_network::NetworkClient;
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

fn spawn_event_rebroadcast(
    mut rx: mpsc::UnboundedReceiver<EngineEvent>,
    broadcast_tx: broadcast::Sender<EngineEvent>,
    store: Arc<RocksStore>,
    task_output_buffers: TaskOutputBuffers,
) {
    tokio::spawn(async move {
        let mut write_count: u64 = 0;
        let mut delta_count: u64 = 0;
        let mut delta_broadcast_buf: HashMap<aura_core::TaskId, (aura_core::ProjectId, aura_core::AgentInstanceId, String)> = HashMap::new();
        let mut flush_interval = interval(Duration::from_millis(DELTA_BROADCAST_INTERVAL_MS));
        flush_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

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
                    for (task_id, (pid, aiid, text)) in delta_broadcast_buf.drain() {
                        let coalesced = EngineEvent::TaskOutputDelta {
                            project_id: pid,
                            agent_instance_id: aiid,
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
                    for (task_id, (pid, aiid, text)) in delta_broadcast_buf.drain() {
                        debug!(%task_id, len = text.len(), "Flushing coalesced delta");
                        let _ = broadcast_tx.send(EngineEvent::TaskOutputDelta {
                            project_id: pid,
                            agent_instance_id: aiid,
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
        if let Err(e) = store.atomic_update_task_by_id(&task_id, |task| {
            task.live_output = text;
        }) {
            warn!(%task_id, "Failed to flush live_output: {e}");
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
        if let Err(e) = store.atomic_update_task_by_id(task_id, |task| {
            task.live_output = text;
        }) {
            warn!(%task_id, "Failed to finalize live_output: {e}");
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
        if let Err(e) = store.atomic_update_task_by_id(&task_id, |task| {
            task.live_output = text;
        }) {
            warn!(%task_id, "Failed to finalize live_output: {e}");
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
    let project_service = Arc::new(ProjectService::new(store.clone()));
    project_service.cleanup_empty_projects();
    let spec_gen_service = Arc::new(SpecGenerationService::new(
        store.clone(),
        settings_service.clone(),
        llm.clone(),
    ));
    let task_extraction_service = Arc::new(TaskExtractionService::new(
        store.clone(),
        settings_service.clone(),
        llm.clone(),
    ));
    let task_service = Arc::new(TaskService::new(store.clone()));
    let agent_service = Arc::new(AgentService::new(store.clone()));
    let agent_instance_service = Arc::new(AgentInstanceService::new(store.clone()));
    let llm_config = aura_core::LlmConfig::from_env();
    let session_service = Arc::new(SessionService::new(store.clone(), llm_config.context_rollover_threshold, llm_config.max_context_tokens));
    let chat_service = Arc::new(ChatService::new(
        store.clone(),
        settings_service.clone(),
        llm.clone(),
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

    let network_client = NetworkClient::from_env().map(Arc::new);

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
        data_dir,
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
    }
}
