use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use axum::http::StatusCode;
use axum::Json;
use tokio::sync::{broadcast, mpsc, Mutex};

use aura_core::{AgentInstanceId, ProjectId, TaskId, ZeroAuthSession};
use aura_engine::{DevLoopEngine, EngineEvent, LoopHandle, ProjectWriteCoordinator};
use aura_network::NetworkClient;
use aura_orbit::OrbitClient;
use aura_storage::StorageClient;
use aura_terminal::TerminalManager;
use aura_agents::{AgentService, AgentInstanceService};
pub use aura_agents::RuntimeAgentStateMap;
use aura_auth::AuthService;
use aura_chat::ChatService;
use aura_orgs::OrgService;
use aura_billing::{BillingClient, MeteredLlm, PricingService};
use aura_projects::ProjectService;
use aura_sessions::SessionService;
use aura_specs::SpecGenerationService;
use aura_tasks::{TaskExtractionService, TaskService};
use aura_settings::SettingsService;
use aura_store::RocksStore;

use crate::error::ApiError;

pub type TaskOutputBuffers = Arc<std::sync::Mutex<HashMap<TaskId, String>>>;

/// Tracks all active agent loops across projects.
pub type LoopRegistry = Arc<Mutex<HashMap<AgentInstanceId, LoopHandle>>>;

#[derive(Clone)]
pub struct AppState {
    pub data_dir: PathBuf,
    pub store: Arc<RocksStore>,
    pub org_service: Arc<OrgService>,
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
    pub llm: Arc<MeteredLlm>,
    pub event_tx: mpsc::UnboundedSender<EngineEvent>,
    pub event_broadcast: broadcast::Sender<EngineEvent>,
    pub loop_registry: LoopRegistry,
    pub write_coordinator: ProjectWriteCoordinator,
    pub task_output_buffers: TaskOutputBuffers,
    pub terminal_manager: Arc<TerminalManager>,
    /// Optional aura-network client. `None` when `AURA_NETWORK_URL` is not set.
    pub network_client: Option<Arc<NetworkClient>>,
    /// Optional aura-storage client. `None` when `AURA_STORAGE_URL` is not set.
    pub storage_client: Option<Arc<StorageClient>>,
    /// Orbit REST client (always present).
    pub orbit_client: Arc<OrbitClient>,
    /// URL of the standalone Orbit service; `None` when `ORBIT_BASE_URL` is not set. Aura does not run Orbit; it only connects as a client.
    pub orbit_base_url: Option<String>,
    /// In-memory runtime state for agent instances (current_task_id, current_session_id).
    pub runtime_agent_state: RuntimeAgentStateMap,
}

impl AppState {
    /// Load the full zOS auth session from storage.
    pub fn get_session(&self) -> Result<ZeroAuthSession, (StatusCode, Json<ApiError>)> {
        let bytes = self
            .store
            .get_setting("zero_auth_session")
            .map_err(|_| ApiError::unauthorized("no active session"))?;
        serde_json::from_slice(&bytes).map_err(|e| ApiError::internal(e.to_string()))
    }

    /// Extract the JWT access token from the stored zOS session.
    pub fn get_jwt(&self) -> Result<String, (StatusCode, Json<ApiError>)> {
        self.get_session().map(|s| s.access_token)
    }

    /// Get the network client, returning 503 if not configured.
    pub fn require_network_client(&self) -> Result<&Arc<NetworkClient>, (StatusCode, Json<ApiError>)> {
        self.network_client
            .as_ref()
            .ok_or_else(|| ApiError::service_unavailable("aura-network is not configured"))
    }

    /// Get the storage client, returning 503 if not configured.
    pub fn require_storage_client(&self) -> Result<&Arc<StorageClient>, (StatusCode, Json<ApiError>)> {
        self.storage_client
            .as_ref()
            .ok_or_else(|| ApiError::service_unavailable("aura-storage is not configured"))
    }

    /// Build a new `DevLoopEngine` wired to this application's services.
    pub fn build_engine(&self) -> Arc<DevLoopEngine> {
        Arc::new(
            DevLoopEngine::new(
                self.store.clone(),
                self.settings_service.clone(),
                self.llm.clone(),
                self.project_service.clone(),
                self.task_service.clone(),
                self.agent_instance_service.clone(),
                self.session_service.clone(),
                self.event_tx.clone(),
            )
            .with_write_coordinator(self.write_coordinator.clone())
            .with_storage_client(self.storage_client.clone()),
        )
    }

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
