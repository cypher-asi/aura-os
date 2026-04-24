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

use crate::agent_events::AgentEventListener;
use crate::harness_gateway::HarnessHttpGateway;
use crate::loop_log::LoopLogWriter;
use aura_os_browser::BrowserManager;
use aura_os_network::NetworkClient;
use aura_os_orgs::OrgService;
use aura_os_projects::ProjectService;
use aura_os_sessions::SessionService;
use aura_os_storage::StorageClient;
use aura_os_storage::StorageTaskFileChangeSummary;
use aura_os_store::SettingsStore;
use aura_os_tasks::TaskService;
use aura_os_terminal::TerminalManager;

use crate::error::ApiError;
use crate::sync_state::{TaskSyncCheckpoint, TaskSyncState};

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

/// Metadata from the last zOS validation (Pro entitlement fetch), carried alongside [`AuthSession`].
#[derive(Clone, Debug)]
pub(crate) struct AuthZeroProMeta {
    pub zero_pro_refresh_error: Option<String>,
}

#[async_trait]
impl<S: Send + Sync> FromRequestParts<S> for AuthZeroProMeta {
    type Rejection = (StatusCode, Json<ApiError>);

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        parts
            .extensions
            .get::<AuthZeroProMeta>()
            .cloned()
            .ok_or_else(|| ApiError::unauthorized("missing auth metadata"))
    }
}

// ---------------------------------------------------------------------------
// Validation cache — caches zOS session validation results per JWT
// ---------------------------------------------------------------------------

/// Cached validation result for a JWT token.
pub struct CachedSession {
    pub session: ZeroAuthSession,
    pub validated_at: Instant,
    /// Warning when zOS could not confirm ZERO Pro status (see `AuthSessionResult`).
    pub zero_pro_refresh_error: Option<String>,
}

/// Thread-safe in-memory cache keyed by JWT string.
pub type ValidationCache = Arc<DashMap<String, CachedSession>>;

pub(crate) fn persist_zero_auth_session(store: &SettingsStore, session: &ZeroAuthSession) {
    let payload = match serde_json::to_vec(session) {
        Ok(payload) => payload,
        Err(error) => {
            tracing::warn!(%error, "failed to encode zero_auth_session for persistence");
            return;
        }
    };
    if let Err(error) = store.put_setting("zero_auth_session", &payload) {
        tracing::warn!(%error, "failed to persist zero_auth_session");
    }
}

pub(crate) fn clear_zero_auth_session(store: &SettingsStore) {
    if let Err(error) = store.delete_setting("zero_auth_session") {
        tracing::warn!(%error, "failed to clear zero_auth_session");
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
                zero_pro_refresh_error: None,
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
                zero_pro_refresh_error: None,
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
                zero_pro_refresh_error: None,
            },
        );
        cache.insert(
            "expired".into(),
            CachedSession {
                session: make_session(),
                validated_at: Instant::now()
                    - CACHE_ENTRY_MAX_AGE
                    - std::time::Duration::from_secs(1),
                zero_pro_refresh_error: None,
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
    pub paused: bool,
    /// Set to `true` while the `forward_automaton_events` task for this
    /// automaton is still draining the harness event stream. Cleared when
    /// the forwarder terminates (normal end, stream close, or manual
    /// abort). `start_loop` reads this flag to decide whether an adopted
    /// automaton already has a live forwarder attached — without the
    /// check, adoption always spawned a second forwarder that fanned
    /// every harness event out to the client twice (duplicated "READ" /
    /// "WRITE" timeline entries in the sidekick Run tab).
    pub alive: Arc<std::sync::atomic::AtomicBool>,
    /// Handle to the `forward_automaton_events` tokio task so callers
    /// (e.g. `stop_loop`, or `start_loop` when replacing a stale entry)
    /// can proactively terminate the forwarder instead of waiting for
    /// the harness broadcast to close on its own.
    pub forwarder: Option<tokio::task::AbortHandle>,
    /// Task id the forwarder is currently streaming output for. Updated
    /// on `task_started` and cleared on `task_completed` / `task_failed`
    /// so `GET /loop/status` can report "which task is this automaton
    /// working on right now", letting the UI rehydrate the Run panel
    /// and the per-task "live" indicators after a page refresh. Mutated
    /// via `registry.lock().await.get_mut(&aiid)` from the forwarder
    /// task — same pattern as `paused`.
    pub current_task_id: Option<String>,
}
pub(crate) type AutomatonRegistry = Arc<Mutex<HashMap<AgentInstanceId, ActiveAutomaton>>>;

/// Reusable chat session for agent / instance chat endpoints.
pub struct ChatSession {
    #[allow(dead_code)]
    pub session_id: String,
    pub commands_tx: mpsc::UnboundedSender<HarnessInbound>,
    pub events_tx: broadcast::Sender<HarnessOutbound>,
    pub model: Option<String>,
    /// Aura agent id that owns this session, if known at startup.
    ///
    /// Populated from `SessionConfig::agent_id` when the session is
    /// first opened. Used by the permissions-update flow in
    /// `handlers::agents::crud::update_agent` to invalidate every live
    /// session owned by a given agent — direct `agent:{id}` sessions
    /// *and* any `instance:{id}` sessions whose underlying agent's
    /// capability bundle just changed — so the next chat turn cold-
    /// starts with a fresh `installed_tools` list via the unified
    /// `build_session_tools` filter.
    pub agent_id: Option<String>,
}

impl ChatSession {
    pub fn is_alive(&self) -> bool {
        !self.commands_tx.is_closed()
    }
}

pub type ChatSessionRegistry = Arc<Mutex<HashMap<String, ChatSession>>>;

/// Accumulated live output for a running or recently completed task.
#[derive(Clone, Default)]
pub struct CachedTaskOutput {
    pub live_output: String,
    pub build_steps: Vec<serde_json::Value>,
    pub test_steps: Vec<serde_json::Value>,
    pub git_steps: Vec<serde_json::Value>,
    pub sync_checkpoints: Vec<TaskSyncCheckpoint>,
    pub sync_state: Option<TaskSyncState>,
    /// Evidence of `cargo fmt --check` / `prettier --check` / equivalent
    /// being exercised during the task. Part of the Definition-of-Done gate
    /// the dev loop enforces before marking a task as done.
    pub format_steps: Vec<serde_json::Value>,
    /// Evidence of `cargo clippy -D warnings` / `eslint` / equivalent being
    /// exercised during the task. Part of the Definition-of-Done gate.
    pub lint_steps: Vec<serde_json::Value>,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_cache_creation_input_tokens: u64,
    pub total_cache_read_input_tokens: u64,
    pub estimated_context_tokens: u64,
    pub context_usage_estimate: Option<f64>,
    pub provider: Option<String>,
    pub model: Option<String>,
    /// Files the task mutated during its run.
    ///
    /// Populated from two independent signals:
    ///
    /// 1. Structured `files_changed` on `assistant_message_end`
    ///    (canonical path when the harness emits it).
    /// 2. Successful `write_file` / `edit_file` / `delete_file`
    ///    `tool_call_completed` events with a non-empty `input.path`.
    ///    This fallback exists because some runtime adapters emit
    ///    `AssistantMessageEnd` with `FilesChanged::default()` (empty),
    ///    which would otherwise leave the DoD gate believing zero
    ///    files changed even when writes landed on disk.
    pub files_changed: Vec<StorageTaskFileChangeSummary>,
    pub session_id: Option<String>,
    pub agent_instance_id: Option<String>,
    pub project_id: Option<String>,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub saw_rich_usage: bool,
    /// Count of `write_file` / `edit_file` `tool_call_completed`
    /// events the harness emitted with an empty or missing `path`
    /// input. These cannot land on disk and indicate the automaton
    /// misfired (the UI renders them as "Untitled file"). Only the
    /// `tool_call_completed` event is counted; the upstream
    /// `tool_call_started` / `tool_call_snapshot` events for the same
    /// call are deliberately ignored so a single misfire is counted
    /// exactly once.
    ///
    /// The completion gate rejects turns that produced at least one
    /// *and* never followed up with a successful file change. When
    /// `files_changed` is non-empty the empty-path events are treated
    /// as benign recovery history and the verification-step checks
    /// handle the real writes.
    pub empty_path_writes: u32,
    /// Per-tool-call failure history accumulated from `tool_call_failed`
    /// domain events during the task. Consulted by the Definition-of-Done
    /// gate (see `completion_validation_failure_reason`) so a generic
    /// "no build step" rejection can be upgraded to a specific diagnostic
    /// when the real cause is a kernel policy denial (e.g. `run_command`
    /// being blocked because the harness was deliberately locked down
    /// with `AURA_STRICT_MODE=1` or `ENABLE_CMD_TOOLS=false`).
    ///
    /// Populated by the event-handler loop; stays empty on runtimes that
    /// don't yet emit `tool_call_failed`, leaving the generic DoD reasons
    /// as the default.
    pub tool_call_failures: Vec<ToolCallFailureEntry>,
    /// Pending `tool_call_snapshot` inputs keyed by `tool_use_id`,
    /// consumed when the paired `tool_result` arrives.
    ///
    /// Acts as the version-skew fallback for the DoD gate: harness
    /// versions that pre-date the `tool_call_completed` emission still
    /// only send `tool_call_snapshot` (carries the input) and
    /// `tool_result` (carries the error flag). Joining them by id gives
    /// the gate the same `(path, op, is_error)` signal that a native
    /// `tool_call_completed` would.
    ///
    /// Entries are removed when the matching `tool_result` is
    /// processed. Snapshots without a matching result (e.g. the stream
    /// died mid-call) are harmless — they just pin a small amount of
    /// memory until the task output cache is dropped.
    pub tool_input_snapshots: HashMap<String, ToolInputSnapshotEntry>,
}

/// Cached `(name, input)` pair from a `tool_call_snapshot` event,
/// awaiting the paired `tool_result` so the DoD gate can recover the
/// file-change path on harness versions that don't emit the
/// authoritative `tool_call_completed` frame.
#[derive(Clone, Debug, Default)]
pub struct ToolInputSnapshotEntry {
    pub name: String,
    pub input: serde_json::Value,
}

/// One entry in [`CachedTaskOutput::tool_call_failures`]: the tool that
/// the harness attempted to invoke and the failure reason reported by
/// the runtime (policy denial string, adapter error, etc.).
#[derive(Clone, Debug, Default)]
pub struct ToolCallFailureEntry {
    pub tool_name: String,
    pub reason: String,
}

pub(crate) type TaskOutputCache = Arc<Mutex<HashMap<String, CachedTaskOutput>>>;

/// Simple time-based cache for billing credit checks.
pub struct CreditCache {
    pub last_check: Instant,
    pub has_credits: bool,
}
pub type CreditCacheRef = Arc<Mutex<HashMap<String, CreditCache>>>;

/// Cached result of `find_matching_project_agents` — the list of
/// project-agent bindings an org-level agent has across the caller's
/// orgs. Populating this avoids re-running the orgs → projects →
/// project_agents fan-out on every chat open or turn.
///
/// Bindings change only on explicit agent create / project-agent
/// create / delete flows, so a short TTL is enough and we don't wire
/// up invalidation paths: repeated reads within the TTL window
/// (e.g. the chat view's initial history fetch + sidebar preview
/// prefetches) all hit this cache.
#[derive(Clone)]
pub struct CachedAgentDiscovery {
    pub project_agents: Vec<aura_os_storage::StorageProjectAgent>,
    pub cached_at: Instant,
}

/// TTL for [`CachedAgentDiscovery`]. Kept short so a newly created
/// binding surfaces without requiring explicit invalidation.
pub const AGENT_DISCOVERY_TTL: std::time::Duration = std::time::Duration::from_secs(30);

pub type AgentDiscoveryCache = Arc<DashMap<String, CachedAgentDiscovery>>;

#[derive(Clone)]
pub struct AppState {
    pub data_dir: PathBuf,
    pub store: Arc<SettingsStore>,
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
    /// In-app browser sessions + project-aware URL resolver.
    pub browser_manager: Arc<BrowserManager>,
    /// Optional aura-network client. `None` when `AURA_NETWORK_URL` is not set.
    pub network_client: Option<Arc<NetworkClient>>,
    /// Optional aura-network client dedicated to the Feedback app. Falls back
    /// to `network_client` when `AURA_NETWORK_FEEDBACK_URL` is not set, so
    /// feedback requests hit the main aura-network once prod ships the
    /// feedback endpoints. Built separately during development so feedback
    /// traffic can target a local aura-network while everything else keeps
    /// using the deployed backend.
    pub feedback_network_client: Option<Arc<NetworkClient>>,
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
    /// Process-wide cooldown tracking for orbit "remote storage
    /// exhausted" push failures. Tripped by the dev-loop event
    /// forwarder when `classify_push_failure` returns
    /// `RemoteStorageExhausted` so subsequent push failures inside the
    /// cooldown window carry a `retry_after_secs` hint instead of
    /// silently thrashing orbit's rootfs with more `tmp_pack_*` objects.
    /// See [`crate::orbit_guard`] for details.
    pub orbit_capacity_guard: Arc<crate::orbit_guard::OrbitCapacityGuard>,
    /// Per-JWT validation cache. Avoids calling zOS on every request.
    pub validation_cache: ValidationCache,
    /// Per-(JWT,agent_id) cache of matched project-agent bindings.
    /// Short-TTL wrapper around `find_matching_project_agents` that
    /// eliminates the orgs/projects/project_agents fan-out on repeat
    /// chat opens and sidebar preview prefetches. See
    /// [`CachedAgentDiscovery`] for details.
    pub agent_discovery_cache: AgentDiscoveryCache,
    pub router_url: String,
    pub http_client: reqwest::Client,
    pub agent_event_listener: Arc<AgentEventListener>,
    /// Filesystem logger for the dev automation loop. Every active
    /// automaton gets a run bundle on disk containing the full event
    /// stream, per-category debug channels, and task outputs; the Debug
    /// UI app and `aura-run-analyze` read from the same directory.
    pub loop_log: Arc<LoopLogWriter>,
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

    /// Get the feedback-scoped aura-network client, falling back to the main
    /// `network_client` when no dedicated feedback URL is configured.
    /// Returns 503 if neither is set.
    pub(crate) fn require_feedback_network_client(
        &self,
    ) -> Result<&Arc<NetworkClient>, (StatusCode, Json<ApiError>)> {
        self.feedback_network_client
            .as_ref()
            .or(self.network_client.as_ref())
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
