use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::async_trait;
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::http::StatusCode;
use axum::Json;
use dashmap::DashMap;
use tokio::sync::{broadcast, Mutex, OnceCell};

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
use crate::stability_metrics::StabilityMetrics;
use crate::sync_state::{TaskSyncCheckpoint, TaskSyncState};

mod auth_extractors;
mod caches;

#[allow(unused_imports)]
pub(crate) use auth_extractors::AuthGuestJwt;
pub(crate) use auth_extractors::{AuthJwt, AuthSession, AuthZeroProMeta};
#[cfg(test)]
pub(crate) use caches::CACHE_ENTRY_MAX_AGE;
pub(crate) use caches::{
    clear_zero_auth_session, persist_zero_auth_session, spawn_cache_eviction, AgentDiscoveryCache,
    CachedAgentDiscovery, CreditCache, CreditCacheRef, TaskOutputCache, ValidationCache,
    AGENT_DISCOVERY_TTL,
};
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

/// Composite key for the chat-session registry.
///
/// Phase 4 of the agent-stream reliability plan splits the previous
/// flat `String` partition key into `(session_key, model)` so two
/// clients on the same partition picking different models can run in
/// parallel cleanly. Before this split, `streaming::try_reuse_session`
/// evicted the harness session whenever the requested model differed
/// from the resident one, which torpedoed any user that had a Sonnet
/// chat in one tab and an Opus chat in another against the same
/// agent instance.
///
/// The `session_key` field is the same partitioned `harness_agent_id`
/// (`{template}::{instance}` or `{template}::default`) used before
/// — the registry just gains a second axis. `model` is `None` when
/// the caller didn't pin a model (rare; falls back to the agent's
/// default), so two `(session_key, None)` callers still share an
/// entry the way the legacy single-key registry did.
#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub struct ChatSessionKey {
    /// Partitioned harness `agent_id` built by
    /// `aura_os_core::harness_agent_id`. Takes one of three shapes:
    ///   - `{template}::default` — bare-template partition (legacy
    ///     bare-agent chat with no resolved storage session, plus
    ///     loop / public chat / Swarm-tools paths that opt out of the
    ///     session segment).
    ///   - `{template}::{agent_instance_id}` — per-instance partition
    ///     (legacy instance-bound chat with no resolved storage
    ///     session).
    ///   - `{template}::{instance|default}::{session_id}` — per-
    ///     storage-session partition. Phase 1 of parallel-session-chats:
    ///     chat routes fold the resolved storage `session_id` in so
    ///     two POSTs against the same instance with different
    ///     sessions take distinct turn slots and stream concurrently.
    pub session_key: String,
    /// Optional model selector. `None` when the request didn't pin a
    /// model; otherwise the exact model string sent with the chat
    /// request. Two requests with `Some("opus")` and `Some("sonnet")`
    /// for the same `session_key` get separate registry entries and
    /// run in parallel.
    pub model: Option<String>,
}

impl ChatSessionKey {
    /// Build a `(session_key, model)` key in one call.
    #[must_use]
    pub fn new(session_key: impl Into<String>, model: Option<String>) -> Self {
        Self {
            session_key: session_key.into(),
            model,
        }
    }
}

/// Reusable chat session for agent / instance chat endpoints.
pub struct ChatSession {
    #[allow(dead_code)]
    pub session_id: String,
    pub commands_tx: HarnessCommandSender,
    pub events_tx: broadcast::Sender<HarnessOutbound>,
    /// Model the harness session was opened with. After Phase 4 this
    /// field is **NOT** consulted for cache invalidation — the
    /// registry now lives on a `(session_key, model)` composite key
    /// (`ChatSessionKey`), so every model lives in its own entry and
    /// `try_reuse_session` simply looks up by the full key. The field
    /// is kept as a diagnostic / sanity sentinel so logs and the
    /// permissions-update sweep can tell which model an entry was
    /// opened with at insert time.
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
    /// Per-partition turn slot. Held for the duration of one user-message
    /// turn so a second turn arriving on the same partition queues
    /// (waits for the active turn to terminate) instead of racing the WS
    /// writer and triggering the upstream "turn in progress" error.
    ///
    /// Released by a sentinel task that watches the harness broadcast for
    /// the terminal event of each turn (`AssistantMessageEnd` / `Error`).
    /// See `chat::turn_slot` for the implementation.
    pub turn_slot: Arc<Mutex<()>>,
    /// Number of turn-slot acquirers currently in flight on this
    /// partition (the one holding the lock plus any queued waiters).
    /// Bounds the queue depth at 1 waiter: when this counter is already
    /// `>= 2` a third concurrent send is rejected with
    /// `ApiError::agent_busy { reason: "queue full" }` instead of
    /// stacking unbounded behind the mutex.
    pub turn_pending_count: Arc<std::sync::atomic::AtomicUsize>,
}

impl ChatSession {
    pub fn is_alive(&self) -> bool {
        !self.commands_tx.is_closed()
    }
}

/// Phase 4: process-wide chat-session registry.
///
/// Backed by a [`DashMap`] (no surrounding `Mutex`) keyed on
/// [`ChatSessionKey`] so per-key reads / writes don't fight a single
/// process-wide lock. Every legacy call site was already a brief
/// synchronous read followed by a clone of the channel handles; the
/// migration drops the `Mutex` entirely and operates directly on the
/// shard-locked DashMap entries.
///
/// Care contract: callers MUST drop any [`dashmap::mapref::one::Ref`]
/// returned by `chat_sessions.get(...)` before awaiting on the cloned
/// handles — holding a `Ref` across `.await` would block other
/// partitions on the same shard. `streaming::try_reuse_session`
/// follows this pattern: the `Ref` is consumed inside a synchronous
/// block that clones out the channel handles plus the turn-slot
/// `Arc`s, then dropped before the slot `await`.
pub type ChatSessionRegistry = Arc<DashMap<ChatSessionKey, ChatSession>>;

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
    /// Configured upstream WS-slot cap. Read from
    /// `AURA_HARNESS_WS_SLOTS` at startup (default `128`, matching
    /// the doc-comment in
    /// `crates/aura-os-harness/src/automaton_client.rs` lines 33-34)
    /// and forwarded to the autospawned local harness child process
    /// so both ends agree on the cap. Surfaced through
    /// `ApiError::harness_capacity_exhausted` so the operator-visible
    /// error message includes the cap that just got hit. NOTE: the
    /// upstream `aura-node` harness binary is expected to read the
    /// same env var to size its semaphore; if it currently does not,
    /// the server's view is still authoritative for error messaging
    /// but the actual upstream limit may stay at the harness default.
    pub harness_ws_slots: usize,
    /// First-event watchdog window for chat turns. Sourced from
    /// `AURA_TURN_FIRST_EVENT_TIMEOUT_SECS` at startup (default
    /// `120s`, see `app_builder::DEFAULT_TURN_FIRST_EVENT_TIMEOUT_SECS`).
    /// Synthesizes `stream_stalled` only when the harness emits zero
    /// events inside this window — chosen to comfortably accommodate
    /// Opus router cold-start + first thinking delta.
    pub turn_first_event_timeout: Duration,
    /// Sliding idle ceiling for chat turns. Sourced from
    /// `AURA_TURN_MAX_TIMEOUT_SECS` at startup (default `1800s`,
    /// 30 min). Resets on every non-terminal event observed by the
    /// chat watchdog so a long Opus turn with regular text-deltas or
    /// tool events never trips, but a truly hung session does after
    /// the idle window elapses.
    pub turn_max_idle_timeout: Duration,
    /// Auto-fork threshold for chat sessions sourced from
    /// `AURA_CHAT_AUTO_FORK_THRESHOLD` at startup (default `0.80`,
    /// see `app_builder::DEFAULT_CHAT_AUTO_FORK_THRESHOLD`). When the
    /// most recent `assistant_message_end.usage.context_utilization`
    /// for an active chat session crosses this value, the persist
    /// task flags the storage row `rolled_over`, writes a
    /// `rollover_summary` event with a one-paragraph summary, and the
    /// next user send transparently lands in a fresh session via
    /// `SessionService::create_chat_followup_session`. The chat UI
    /// surfaces a single `progress: forked_for_context` SSE event
    /// rather than asking the user to click "+". Range-checked to
    /// `(0.0, 1.0]`; out-of-range values clamp to the default at
    /// startup with a `warn!`.
    pub chat_auto_fork_threshold: f64,
    /// Process-wide stability counters (Phase 5 of the agent-stream
    /// reliability plan). Lock-free `AtomicU64` counters covering the
    /// reliability decisions added in phases 1-4 — turn lifecycle,
    /// watchdog firings, broadcast lag, harness ws health, auto-fork
    /// triggers/applies, and the new `X-Aura-Client-Retry` header
    /// path. Snapshotted by `/api/admin/health`. Held by `Arc` so
    /// every clone of `AppState` (every request) hands out the same
    /// instance.
    pub stability_metrics: Arc<StabilityMetrics>,
    /// Process start time used by `/api/admin/health` to compute
    /// `uptime_seconds`. Captured once in `build_app_state`.
    pub started_at: Instant,
    /// Configured per-partition broadcast capacity (env
    /// `AURA_HARNESS_BROADCAST_CAPACITY`, default `1024`). Surfaced
    /// through `/api/admin/health.config.harness_broadcast_capacity`
    /// so an operator can see the runtime config the binary is
    /// actually using.
    pub harness_broadcast_capacity: usize,
    /// Process-wide rate limiter for the public anonymous endpoint
    /// family (`/api/public/*`). Tracks per-guest turn counts and
    /// per-IP daily ceilings. Cheap to clone — both internal maps
    /// sit behind `Arc<DashMap<...>>`. See
    /// [`crate::handlers::public::RateLimiter`] for the surface and
    /// [`crate::handlers::public::PUBLIC_TURN_LIMIT`] /
    /// [`crate::handlers::public::PUBLIC_IP_DAILY_CEILING`] for the
    /// caps.
    pub public_rate_limiter: crate::handlers::public::RateLimiter,
    /// Lazily-provisioned [`AgentId`] of the system-owned demo agent
    /// every public chat turn targets. The first call to
    /// [`crate::handlers::public::ensure_public_demo_agent`] runs the
    /// slow path (build the canonical [`aura_os_core::Agent`] record
    /// then persist a shadow); every later call is an atomic load.
    /// The synchronous `app_builder::build_app_state` cannot block on
    /// async storage I/O at boot, so the cell starts empty and
    /// initialises on first public-chat hit.
    pub public_demo_agent_id: Arc<OnceCell<AgentId>>,
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
