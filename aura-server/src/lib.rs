pub mod dto;
pub mod error;
pub mod handlers;
pub mod router;
pub mod state;

pub use router::{create_router, create_router_with_frontend};
pub use state::AppState;

use std::path::Path;
use std::sync::Arc;

use tokio::sync::{broadcast, mpsc, Mutex};
use tracing::{debug, info, warn};

use aura_engine::EngineEvent;
use aura_services::{
    AgentService, AuthService, ChatService, ClaudeClient, GitHubService, OrgService,
    ProjectService, SessionService, SpecGenerationService, TaskExtractionService, TaskService,
};
use aura_settings::SettingsService;
use aura_store::RocksStore;

fn spawn_event_rebroadcast(
    mut rx: mpsc::UnboundedReceiver<EngineEvent>,
    broadcast_tx: broadcast::Sender<EngineEvent>,
    store: Arc<RocksStore>,
) {
    tokio::spawn(async move {
        let mut write_count: u64 = 0;
        while let Some(event) = rx.recv().await {
            if !matches!(event, EngineEvent::TaskOutputDelta { .. }) {
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
            }

            debug!(?event, "Broadcasting engine event");
            if broadcast_tx.send(event).is_err() {
                warn!("No WebSocket subscribers for engine event");
            }
        }
    });
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
    let (event_broadcast, _) = broadcast::channel::<EngineEvent>(256);

    spawn_event_rebroadcast(event_rx, event_broadcast.clone(), store.clone());

    AppState {
        store,
        org_service,
        github_service,
        auth_service,
        settings_service,
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
        loop_handle: Arc::new(Mutex::new(None)),
        loop_project_id: Arc::new(Mutex::new(None)),
    }
}
