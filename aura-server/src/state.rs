use std::sync::Arc;

use tokio::sync::{broadcast, mpsc, Mutex};

use aura_engine::{EngineEvent, LoopHandle};
use aura_services::{
    AgentService, ChatService, ClaudeClient, ProjectService, SessionService,
    SpecGenerationService, TaskExtractionService, TaskService,
};
use aura_settings::SettingsService;
use aura_store::RocksStore;

#[derive(Clone)]
pub struct AppState {
    pub store: Arc<RocksStore>,
    pub settings_service: Arc<SettingsService>,
    pub project_service: Arc<ProjectService>,
    pub spec_gen_service: Arc<SpecGenerationService>,
    pub task_extraction_service: Arc<TaskExtractionService>,
    pub task_service: Arc<TaskService>,
    pub agent_service: Arc<AgentService>,
    pub session_service: Arc<SessionService>,
    pub chat_service: Arc<ChatService>,
    pub claude_client: Arc<ClaudeClient>,
    pub event_tx: mpsc::UnboundedSender<EngineEvent>,
    pub event_broadcast: broadcast::Sender<EngineEvent>,
    pub loop_handle: Arc<Mutex<Option<LoopHandle>>>,
    pub loop_project_id: Arc<Mutex<Option<aura_core::ProjectId>>>,
}
