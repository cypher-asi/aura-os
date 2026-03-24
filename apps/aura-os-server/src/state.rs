use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use axum::http::StatusCode;
use axum::Json;
use tokio::sync::{broadcast, mpsc, Mutex};

use aura_os_agents::{AgentInstanceService, AgentService};
use aura_os_auth::AuthService;
use aura_os_billing::BillingClient;
use aura_os_core::{AgentInstanceId, HarnessMode, ProjectId, ZeroAuthSession};
use aura_os_link::{HarnessInbound, HarnessLink, HarnessOutbound};
use aura_os_network::NetworkClient;
use aura_os_orgs::OrgService;
use aura_os_projects::ProjectService;
use aura_os_sessions::SessionService;
use aura_os_storage::StorageClient;
use aura_os_store::RocksStore;
use aura_os_tasks::TaskService;
use aura_os_terminal::TerminalManager;

use crate::error::ApiError;

/// Active harness sessions: agent_instance_id → (session_id, commands_tx, project_id).
pub struct ActiveHarnessSession {
    pub session_id: String,
    pub commands_tx: tokio::sync::mpsc::UnboundedSender<HarnessInbound>,
    pub project_id: ProjectId,
}
pub(crate) type HarnessSessionRegistry = Arc<Mutex<HashMap<AgentInstanceId, ActiveHarnessSession>>>;

/// Reusable chat session for agent / instance chat endpoints.
pub(crate) struct ChatSession {
    #[allow(dead_code)]
    pub session_id: String,
    pub commands_tx: mpsc::UnboundedSender<HarnessInbound>,
    pub events_tx: broadcast::Sender<HarnessOutbound>,
}

impl ChatSession {
    pub fn is_alive(&self) -> bool {
        !self.commands_tx.is_closed()
    }
}

pub(crate) type ChatSessionRegistry = Arc<Mutex<HashMap<String, ChatSession>>>;

/// Simple time-based cache for billing credit checks.
pub(crate) struct CreditCache {
    pub last_check: Instant,
    pub has_credits: bool,
}
pub(crate) type CreditCacheRef = Arc<Mutex<Option<CreditCache>>>;

#[derive(Clone)]
pub struct AppState {
    pub data_dir: PathBuf,
    pub store: Arc<RocksStore>,
    pub org_service: Arc<OrgService>,
    pub auth_service: Arc<AuthService>,
    pub billing_client: Arc<BillingClient>,
    pub project_service: Arc<ProjectService>,
    pub task_service: Arc<TaskService>,
    pub agent_service: Arc<AgentService>,
    pub agent_instance_service: Arc<AgentInstanceService>,
    pub session_service: Arc<SessionService>,
    pub local_harness: Arc<dyn HarnessLink>,
    pub swarm_harness: Arc<dyn HarnessLink>,
    pub harness_sessions: HarnessSessionRegistry,
    pub terminal_manager: Arc<TerminalManager>,
    /// Optional aura-network client. `None` when `AURA_NETWORK_URL` is not set.
    pub network_client: Option<Arc<NetworkClient>>,
    /// Optional aura-storage client. `None` when `AURA_STORAGE_URL` is not set.
    pub storage_client: Option<Arc<StorageClient>>,
    /// Shared internal token used for service-to-service calls.
    pub internal_service_token: Option<String>,
    /// Broadcast channel for network/social events (JSON payloads).
    pub event_broadcast: broadcast::Sender<serde_json::Value>,
    /// When true, non-Pro users are blocked from API access.
    pub require_zero_pro: bool,
    /// Reusable chat sessions keyed by agent_id or agent_instance_id.
    pub(crate) chat_sessions: ChatSessionRegistry,
    /// Cached billing credit check result.
    pub(crate) credit_cache: CreditCacheRef,
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

    pub(crate) fn harness_for(&self, mode: HarnessMode) -> &dyn HarnessLink {
        match mode {
            HarnessMode::Local => self.local_harness.as_ref(),
            HarnessMode::Swarm => self.swarm_harness.as_ref(),
        }
    }
}
