use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use axum::async_trait;
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::http::StatusCode;
use axum::Json;
use dashmap::DashMap;
use tokio::sync::{broadcast, Mutex};

use aura_os_agents::{AgentInstanceService, AgentService};
use aura_os_auth::AuthService;
use aura_os_billing::BillingClient;
use aura_os_core::{
    AgentId, AgentInstanceId, HarnessMode, ProjectId, SessionId, TaskId, ZeroAuthSession,
};
use aura_os_events::EventHub;
use aura_os_harness::{AutomatonClient, HarnessCommandSender, HarnessLink, HarnessOutbound};
use aura_os_integrations::IntegrationsClient;
use aura_os_loops::LoopRegistry;

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

mod auth_extractors;
mod caches;

pub(crate) use auth_extractors::{AuthJwt, AuthSession, AuthZeroProMeta};
pub(crate) use caches::{
    clear_zero_auth_session, persist_zero_auth_session, spawn_cache_eviction, AgentDiscoveryCache,
    CachedAgentDiscovery, CreditCache, CreditCacheRef, TaskOutputCache, ValidationCache,
    AGENT_DISCOVERY_TTL,
};
#[cfg(test)]
pub(crate) use caches::CACHE_ENTRY_MAX_AGE;
pub use caches::{CachedSession, CachedTaskOutput, TestPassEvidence};

#[cfg(test)]
mod tests;

/// Active automaton (dev loop or single-task run) tracked per
/// `(project_id, agent_instance_id)` pair.
pub struct ActiveAutomaton {
    pub automaton_id: String,
    pub project_id: ProjectId,
    /// Stable Aura agent template id this automaton was started under.
    ///
    /// Populated at every `automaton_registry.insert(...)` site
    /// (`start_loop`, `run_single_task`) from the `AgentInstance`'s
    /// parent template. Lets the chat-vs-automation conflict guard in
    /// `chat::busy::reject_if_partition_busy` answer "is any
    /// automaton attached to this template's partition?" in O(N)
    /// without doing async `agent_instance_service.get_instance`
    /// lookups while the registry mutex is held.
    pub template_agent_id: AgentId,
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
    /// Storage `Session` id materialised for this automation run via
    /// `SessionService::create_session`, or `None` when no session
    /// could be created (e.g. tests without a configured storage
    /// client). Populated by `start_loop` / `run_single_task` so the
    /// forwarder can hand the same id to `record_task_worked` on
    /// `task_started` events and to `end_session` on terminal status.
    /// Cold-start `start_loop` calls also use this for adopted-reuse:
    /// when the registry already has a live forwarder for the same
    /// `(project_id, agent_instance_id, automaton_id)` we reuse the
    /// existing session id instead of opening a fresh one, so adoption
    /// doesn't double-count `total_sessions` on the project stats.
    pub session_id: Option<SessionId>,
}
/// Composite key for the automaton registry. Including `ProjectId`
/// guarantees that two projects can never collide on the same
/// `AgentInstanceId` even if a caller mints a fresh UUID without first
/// validating it against `project_agents`.
pub type AutomatonRegistryKey = (ProjectId, AgentInstanceId);

pub(crate) type AutomatonRegistry = Arc<Mutex<HashMap<AutomatonRegistryKey, ActiveAutomaton>>>;

/// Reusable chat session for agent / instance chat endpoints.
pub struct ChatSession {
    #[allow(dead_code)]
    pub session_id: String,
    pub commands_tx: HarnessCommandSender,
    pub events_tx: broadcast::Sender<HarnessOutbound>,
    pub model: Option<String>,
    /// Upstream harness `agent_id` partition key for this session.
    ///
    /// Populated from `SessionConfig::agent_id`. After Phase 1b this
    /// is the partitioned `{template}::{instance}` (or
    /// `{template}::default`) string built by
    /// `aura_os_core::harness_agent_id`, NOT the bare template id.
    /// Treated as opaque by every consumer in this module — use
    /// `template_agent_id` below for any logic that needs to identify
    /// "all sessions owned by this agent template".
    pub agent_id: Option<String>,
    /// Stable Aura template id this session was opened against.
    ///
    /// Populated from `SessionConfig::template_agent_id`. Used by the
    /// permissions-update flow in
    /// `handlers::agents::crud::update_agent` to invalidate every live
    /// session owned by a given agent template — direct bare-agent
    /// sessions *and* any project-instance sessions whose underlying
    /// agent's capability bundle just changed — so the next chat turn
    /// cold-starts with a fresh `installed_tools` list via the unified
    /// `build_session_tools` filter.
    pub template_agent_id: Option<String>,
}

impl ChatSession {
    pub fn is_alive(&self) -> bool {
        !self.commands_tx.is_closed()
    }
}

pub type ChatSessionRegistry = Arc<Mutex<HashMap<String, ChatSession>>>;

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
    /// Broadcast channel for legacy network/social events (JSON payloads).
    ///
    /// Retained for migration only: every producer also fans events
    /// through [`AppState::event_hub`] as a typed [`aura_os_events::DomainEvent`].
    /// New code MUST publish through `event_hub`.
    pub event_broadcast: broadcast::Sender<serde_json::Value>,
    /// Topic-scoped event hub. Use this for all new event production
    /// and consumption; subscribers receive only events whose
    /// [`aura_os_events::Topic`] matches their filter, eliminating the
    /// cross-loop bleed that the legacy global `event_broadcast`
    /// allowed.
    pub event_hub: EventHub,
    /// Registry of currently-active loops (chat, automation, task run,
    /// spec gen). Source of truth for the unified circular progress
    /// indicator surfaced via the `/api/loops` snapshot endpoint and
    /// `LoopActivityChanged` events.
    pub loop_registry: LoopRegistry,
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
