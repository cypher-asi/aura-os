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
use tracing::{debug, warn};

use aura_engine::EngineEvent;
use aura_services::{
    AgentService, ChatService, ClaudeClient, ProjectService, SessionService,
    SpecGenerationService, TaskExtractionService, TaskService,
};
use aura_settings::SettingsService;
use aura_store::RocksStore;

fn spawn_event_rebroadcast(
    mut rx: mpsc::UnboundedReceiver<EngineEvent>,
    broadcast_tx: broadcast::Sender<EngineEvent>,
) {
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            debug!(?event, "Broadcasting engine event");
            if broadcast_tx.send(event).is_err() {
                warn!("No WebSocket subscribers for engine event");
            }
        }
    });
}

pub fn build_app_state(db_path: &Path, data_dir: &Path) -> AppState {
    let store = Arc::new(RocksStore::open(db_path).expect("failed to open RocksDB"));
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

    let (event_tx, event_rx) = mpsc::unbounded_channel::<EngineEvent>();
    let (event_broadcast, _) = broadcast::channel::<EngineEvent>(256);

    spawn_event_rebroadcast(event_rx, event_broadcast.clone());

    AppState {
        store,
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
