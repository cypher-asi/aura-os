use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use axum::async_trait;
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::http::StatusCode;
use axum::Json;
use dashmap::DashMap;
use tokio::sync::{broadcast, mpsc, Mutex};

use aura_os_agents::{AgentInstanceService, AgentService};
use aura_os_auth::AuthService;
use aura_os_billing::BillingClient;
use aura_os_core::{AgentInstanceId, HarnessMode, ProjectId, ZeroAuthSession};
use aura_os_integrations::IntegrationsClient;
use aura_os_link::{AutomatonClient, HarnessInbound, HarnessLink, HarnessOutbound};

use crate::harness_gateway::HarnessHttpGateway;
use aura_os_network::NetworkClient;
use aura_os_orgs::OrgService;
use aura_os_projects::ProjectService;
use aura_os_sessions::SessionService;
use aura_os_storage::StorageClient;
use aura_os_storage::StorageTaskFileChangeSummary;
use aura_os_store::RocksStore;
use aura_os_super_agent::SuperAgentService;
use aura_os_tasks::TaskService;
use aura_os_terminal::TerminalManager;
use tracing::warn;

use crate::error::ApiError;

// ---------------------------------------------------------------------------
// Per-request auth extractors (set by `require_verified_session` middleware)
// ---------------------------------------------------------------------------

/// JWT access token extracted from the `Authorization: Bearer <token>` header.
/// Injected as an Axum Extension by the auth middleware.
#[derive(Clone, Debug)]
pub(crate) struct AuthJwt(pub String);

#[async_trait]
impl<S: Send + Sync> FromRequestParts<S> for AuthJwt {
    type Rejection = (StatusCode, Json<ApiError>);

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        parts
            .extensions
            .get::<AuthJwt>()
            .cloned()
            .ok_or_else(|| ApiError::unauthorized("missing auth token"))
    }
}

/// Full authenticated session, available after middleware validation.
/// Injected as an Axum Extension by the auth middleware.
#[derive(Clone, Debug)]
pub(crate) struct AuthSession(pub ZeroAuthSession);

#[async_trait]
impl<S: Send + Sync> FromRequestParts<S> for AuthSession {
    type Rejection = (StatusCode, Json<ApiError>);

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        parts
            .extensions
            .get::<AuthSession>()
            .cloned()
            .ok_or_else(|| ApiError::unauthorized("missing auth session"))
    }
}

// ---------------------------------------------------------------------------
// Validation cache — caches zOS session validation results per JWT
// ---------------------------------------------------------------------------

/// Cached validation result for a JWT token.
pub struct CachedSession {
    pub session: ZeroAuthSession,
    pub validated_at: Instant,
}

/// Thread-safe in-memory cache keyed by JWT string.
pub type ValidationCache = Arc<DashMap<String, CachedSession>>;

pub(crate) fn persist_zero_auth_session(store: &RocksStore, session: &ZeroAuthSession) {
    match serde_json::to_vec(session) {
        Ok(bytes) => {
            if let Err(error) = store.put_setting("zero_auth_session", &bytes) {
                warn!(%error, "failed to persist zero auth session");
            }
        }
        Err(error) => {
            warn!(%error, "failed to serialize zero auth session");
        }
    }
}

pub(crate) fn clear_zero_auth_session(store: &RocksStore) {
    if let Err(error) = store.delete_setting("zero_auth_session") {
        if !matches!(error, aura_os_store::StoreError::NotFound(_)) {
            warn!(%error, "failed to clear zero auth session");
        }
    }
}

/// Maximum age before a cached entry is considered expired and eligible for eviction.
const CACHE_ENTRY_MAX_AGE: std::time::Duration = std::time::Duration::from_secs(10 * 60);

/// How often the background eviction task runs.
const CACHE_EVICTION_INTERVAL: std::time::Duration = std::time::Duration::from_secs(5 * 60);

/// Spawn a background task that periodically removes expired entries from the validation cache.
pub(crate) fn spawn_cache_eviction(cache: ValidationCache) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(CACHE_EVICTION_INTERVAL).await;
            let before = cache.len();
            cache.retain(|_, entry| entry.validated_at.elapsed() < CACHE_ENTRY_MAX_AGE);
            let removed = before.saturating_sub(cache.len());
            if removed > 0 {
                tracing::debug!(
                    removed,
                    remaining = cache.len(),
                    "evicted expired auth cache entries"
                );
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn make_session() -> ZeroAuthSession {
        ZeroAuthSession {
            user_id: "u1".into(),
            network_user_id: None,
            profile_id: None,
            display_name: "Test".into(),
            profile_image: String::new(),
            primary_zid: "0://test".into(),
            zero_wallet: "0x0".into(),
            wallets: vec![],
            access_token: "tok".into(),
            is_zero_pro: false,
            is_access_granted: false,
            created_at: Utc::now(),
            validated_at: Utc::now(),
        }
    }

    #[test]
    fn cache_retains_fresh_entries() {
        let cache: ValidationCache = Arc::new(DashMap::new());
        cache.insert(
            "fresh".into(),
            CachedSession {
                session: make_session(),
                validated_at: Instant::now(),
            },
        );
        cache.retain(|_, entry| entry.validated_at.elapsed() < CACHE_ENTRY_MAX_AGE);
        assert_eq!(cache.len(), 1);
    }

    #[test]
    fn cache_evicts_expired_entries() {
        let cache: ValidationCache = Arc::new(DashMap::new());
        cache.insert(
            "expired".into(),
            CachedSession {
                session: make_session(),
                validated_at: Instant::now()
                    - CACHE_ENTRY_MAX_AGE
                    - std::time::Duration::from_secs(1),
            },
        );
        cache.retain(|_, entry| entry.validated_at.elapsed() < CACHE_ENTRY_MAX_AGE);
        assert_eq!(cache.len(), 0);
    }

    #[test]
    fn cache_mixed_fresh_and_expired() {
        let cache: ValidationCache = Arc::new(DashMap::new());
        cache.insert(
            "fresh".into(),
            CachedSession {
                session: make_session(),
                validated_at: Instant::now(),
            },
        );
        cache.insert(
            "expired".into(),
            CachedSession {
                session: make_session(),
                validated_at: Instant::now()
                    - CACHE_ENTRY_MAX_AGE
                    - std::time::Duration::from_secs(1),
            },
        );
        cache.retain(|_, entry| entry.validated_at.elapsed() < CACHE_ENTRY_MAX_AGE);
        assert_eq!(cache.len(), 1);
        assert!(cache.contains_key("fresh"));
        assert!(!cache.contains_key("expired"));
    }
}

/// Active harness sessions: agent_instance_id → (session_id, commands_tx, project_id).
pub struct ActiveHarnessSession {
    pub session_id: String,
    pub commands_tx: tokio::sync::mpsc::UnboundedSender<HarnessInbound>,
    pub project_id: ProjectId,
}
pub(crate) type HarnessSessionRegistry = Arc<Mutex<HashMap<AgentInstanceId, ActiveHarnessSession>>>;

/// Active automaton (dev loop or single-task run) tracked per agent instance.
pub struct ActiveAutomaton {
    pub automaton_id: String,
    pub project_id: ProjectId,
    pub harness_base_url: String,
}
pub(crate) type AutomatonRegistry = Arc<Mutex<HashMap<AgentInstanceId, ActiveAutomaton>>>;

/// Reusable chat session for agent / instance chat endpoints.
pub struct ChatSession {
    #[allow(dead_code)]
    pub session_id: String,
    pub commands_tx: mpsc::UnboundedSender<HarnessInbound>,
    pub events_tx: broadcast::Sender<HarnessOutbound>,
    pub model: Option<String>,
}

impl ChatSession {
    pub fn is_alive(&self) -> bool {
        !self.commands_tx.is_closed()
    }
}

pub type ChatSessionRegistry = Arc<Mutex<HashMap<String, ChatSession>>>;

/// In-memory cache of super-agent conversation messages (full Claude API format
/// including tool_use / tool_result blocks). Keyed by session key, e.g.
/// `"super_agent:{agent_id}"`.
pub type SuperAgentConversationCache = Arc<Mutex<HashMap<String, Vec<serde_json::Value>>>>;

/// Accumulated live output for a running or recently completed task.
#[derive(Clone, Default)]
pub struct CachedTaskOutput {
    pub live_output: String,
    pub build_steps: Vec<serde_json::Value>,
    pub test_steps: Vec<serde_json::Value>,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_cache_creation_input_tokens: u64,
    pub total_cache_read_input_tokens: u64,
    pub estimated_context_tokens: u64,
    pub context_usage_estimate: Option<f64>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub files_changed: Vec<StorageTaskFileChangeSummary>,
    pub session_id: Option<String>,
    pub agent_instance_id: Option<String>,
    pub project_id: Option<String>,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub saw_rich_usage: bool,
}
pub(crate) type TaskOutputCache = Arc<Mutex<HashMap<String, CachedTaskOutput>>>;

/// Simple time-based cache for billing credit checks.
pub struct CreditCache {
    pub last_check: Instant,
    pub has_credits: bool,
}
pub type CreditCacheRef = Arc<Mutex<Option<CreditCache>>>;

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
    /// Optional aura-integrations client. `None` when `AURA_INTEGRATIONS_URL` is not set.
    pub integrations_client: Option<Arc<IntegrationsClient>>,
    /// Broadcast channel for network/social events (JSON payloads).
    pub event_broadcast: broadcast::Sender<serde_json::Value>,
    /// When true, non-Pro users are blocked from API access.
    pub require_zero_pro: bool,
    /// Reusable chat sessions keyed by agent_id or agent_instance_id.
    pub chat_sessions: ChatSessionRegistry,
    /// Cached billing credit check result.
    pub credit_cache: CreditCacheRef,
    /// REST client for the harness automaton API.
    pub automaton_client: Arc<AutomatonClient>,
    /// Shared JSON HTTP client for harness REST paths proxied by [`crate::handlers::harness_proxy`].
    pub harness_http: Arc<HarnessHttpGateway>,
    /// Active automatons (dev loops, task runs) per agent instance.
    pub automaton_registry: AutomatonRegistry,
    /// Base URL for the aura-swarm gateway (e.g. `http://gateway:8080`).
    /// `None` when `SWARM_BASE_URL` is not set.
    pub swarm_base_url: Option<String>,
    /// In-memory cache of accumulated task output (live + completed).
    pub task_output_cache: TaskOutputCache,
    /// Optional Orbit client for repo operations. `None` when `ORBIT_BASE_URL` is not set.
    pub orbit_client: Option<Arc<aura_os_network::OrbitClient>>,
    /// Per-JWT validation cache. Avoids calling zOS on every request.
    pub validation_cache: ValidationCache,
    pub super_agent_service: Arc<SuperAgentService>,
    /// In-memory cache of super-agent conversation messages so multi-turn
    /// context survives across requests (mirrors how the harness keeps state
    /// for normal agents).
    pub super_agent_messages: SuperAgentConversationCache,
}

impl AppState {
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
