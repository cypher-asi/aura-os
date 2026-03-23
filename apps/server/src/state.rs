use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use axum::http::StatusCode;
use axum::Json;
use tokio::sync::{broadcast, Mutex};

use aura_os_agents::{AgentInstanceService, AgentService};
use aura_os_auth::AuthService;
use aura_os_billing::{BillingClient, PricingService};
use aura_os_core::{AgentInstanceId, ProjectId, ZeroAuthSession};
use aura_os_link::SwarmClient;
use aura_os_network::NetworkClient;
use aura_os_orbit::OrbitClient;
use aura_os_orgs::OrgService;
use aura_os_projects::ProjectService;
use aura_os_sessions::SessionService;
use aura_os_settings::SettingsService;
use aura_os_storage::StorageClient;
use aura_os_store::RocksStore;
use aura_os_tasks::TaskService;
use aura_os_terminal::TerminalManager;

use crate::error::ApiError;

/// Tracks running automatons: agent_instance_id → (automaton_id, project_id).
pub(crate) type AutomatonRegistry = Arc<Mutex<HashMap<AgentInstanceId, (String, ProjectId)>>>;

#[derive(Clone)]
pub(crate) struct AppState {
    pub data_dir: PathBuf,
    pub store: Arc<RocksStore>,
    pub org_service: Arc<OrgService>,
    pub auth_service: Arc<AuthService>,
    pub settings_service: Arc<SettingsService>,
    pub pricing_service: Arc<PricingService>,
    pub billing_client: Arc<BillingClient>,
    pub project_service: Arc<ProjectService>,
    pub task_service: Arc<TaskService>,
    pub agent_service: Arc<AgentService>,
    pub agent_instance_service: Arc<AgentInstanceService>,
    pub session_service: Arc<SessionService>,
    pub swarm_client: Arc<SwarmClient>,
    pub automaton_registry: AutomatonRegistry,
    pub terminal_manager: Arc<TerminalManager>,
    /// Optional aura-network client. `None` when `AURA_NETWORK_URL` is not set.
    pub network_client: Option<Arc<NetworkClient>>,
    /// Optional aura-storage client. `None` when `AURA_STORAGE_URL` is not set.
    pub storage_client: Option<Arc<StorageClient>>,
    /// Orbit REST client (always present).
    pub orbit_client: Arc<OrbitClient>,
    /// URL of the standalone Orbit service; `None` when `ORBIT_BASE_URL` is not set.
    pub orbit_base_url: Option<String>,
    /// Shared internal token used for service-to-service calls.
    pub internal_service_token: Option<String>,
    /// Broadcast channel for network/social events (JSON payloads).
    pub event_broadcast: broadcast::Sender<serde_json::Value>,
    /// When true, non-Pro users are blocked from API access.
    pub require_zero_pro: bool,
}

impl AppState {
    /// Load the full zOS auth session from storage.
    pub(crate) fn get_session(&self) -> Result<ZeroAuthSession, (StatusCode, Json<ApiError>)> {
        let bytes = self
            .store
            .get_setting("zero_auth_session")
            .map_err(|_| ApiError::unauthorized("no active session"))?;
        let session: ZeroAuthSession =
            serde_json::from_slice(&bytes).map_err(|e| ApiError::internal(e.to_string()))?;

        if self.require_zero_pro && !session.is_zero_pro {
            return Err(ApiError::forbidden("ZERO Pro subscription required"));
        }

        Ok(session)
    }

    /// Extract the JWT access token from the stored zOS session.
    pub(crate) fn get_jwt(&self) -> Result<String, (StatusCode, Json<ApiError>)> {
        self.get_session().map(|s| s.access_token)
    }

    /// Get the network client, returning 503 if not configured.
    pub(crate) fn require_network_client(
        &self,
    ) -> Result<&Arc<NetworkClient>, (StatusCode, Json<ApiError>)> {
        self.network_client
            .as_ref()
            .ok_or_else(|| ApiError::service_unavailable("aura-network is not configured"))
    }

    /// Get the storage client, returning 503 if not configured.
    pub(crate) fn require_storage_client(
        &self,
    ) -> Result<&Arc<StorageClient>, (StatusCode, Json<ApiError>)> {
        self.storage_client
            .as_ref()
            .ok_or_else(|| ApiError::service_unavailable("aura-storage is not configured"))
    }
}
