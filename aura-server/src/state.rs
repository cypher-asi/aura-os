use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::{broadcast, mpsc, Mutex};

use aura_core::{AgentInstanceId, ProjectId, TaskId};
use aura_engine::{EngineEvent, LoopHandle, ProjectWriteCoordinator};
use aura_terminal::TerminalManager;
use aura_agents::{AgentService, AgentInstanceService};
use aura_auth::AuthService;
use aura_chat::ChatService;
use aura_claude::ClaudeClient;
use aura_github::GitHubService;
use aura_orgs::OrgService;
use aura_billing::{BillingClient, PricingService};
use aura_projects::ProjectService;
use aura_sessions::SessionService;
use aura_specs::SpecGenerationService;
use aura_tasks::{TaskExtractionService, TaskService};
use aura_settings::SettingsService;
use aura_store::RocksStore;

pub type TaskOutputBuffers = Arc<std::sync::Mutex<HashMap<TaskId, String>>>;

/// Tracks all active agent loops across projects.
pub type LoopRegistry = Arc<Mutex<HashMap<AgentInstanceId, LoopHandle>>>;

#[derive(Clone)]
pub struct AppState {
    pub store: Arc<RocksStore>,
    pub org_service: Arc<OrgService>,
    pub github_service: Arc<GitHubService>,
    pub auth_service: Arc<AuthService>,
    pub settings_service: Arc<SettingsService>,
    pub pricing_service: Arc<PricingService>,
    pub billing_client: Arc<BillingClient>,
    pub project_service: Arc<ProjectService>,
    pub spec_gen_service: Arc<SpecGenerationService>,
    pub task_extraction_service: Arc<TaskExtractionService>,
    pub task_service: Arc<TaskService>,
    pub agent_service: Arc<AgentService>,
    pub agent_instance_service: Arc<AgentInstanceService>,
    pub session_service: Arc<SessionService>,
    pub chat_service: Arc<ChatService>,
    pub claude_client: Arc<ClaudeClient>,
    pub event_tx: mpsc::UnboundedSender<EngineEvent>,
    pub event_broadcast: broadcast::Sender<EngineEvent>,
    pub loop_registry: LoopRegistry,
    pub write_coordinator: ProjectWriteCoordinator,
    pub task_output_buffers: TaskOutputBuffers,
    pub terminal_manager: Arc<TerminalManager>,
}

impl AppState {
    /// Remove finished loops from the registry.
    pub async fn gc_finished_loops(&self) {
        let mut reg = self.loop_registry.lock().await;
        reg.retain(|_, h| !h.is_finished());
    }

    /// Get all active loops for a given project.
    pub async fn loops_for_project(&self, project_id: &ProjectId) -> Vec<AgentInstanceId> {
        let reg = self.loop_registry.lock().await;
        reg.iter()
            .filter(|(_, h)| h.project_id == *project_id && !h.is_finished())
            .map(|(aid, _)| *aid)
            .collect()
    }
}
