use super::*;

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
pub(crate) const CACHE_ENTRY_MAX_AGE: std::time::Duration = std::time::Duration::from_secs(10 * 60);

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

/// Accumulated live output for a running or recently completed task.
#[derive(Clone, Default)]
pub struct CachedTaskOutput {
    pub live_output: String,
    pub build_steps: Vec<serde_json::Value>,
    pub test_steps: Vec<serde_json::Value>,
    pub git_steps: Vec<serde_json::Value>,
    pub sync_checkpoints: Vec<TaskSyncCheckpoint>,
    pub sync_state: Option<TaskSyncState>,
    /// Harness-reported evidence of `cargo fmt --check` / `prettier --check`
    /// / equivalent being exercised during the task. aura-os stores this for
    /// display; the harness owns whether it satisfies Definition-of-Done.
    pub format_steps: Vec<serde_json::Value>,
    /// Harness-reported evidence of `cargo clippy -D warnings` / `eslint` /
    /// equivalent being exercised during the task. Stored for display only.
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
    ///    which would otherwise leave the UI showing zero files changed even
    ///    when writes landed on disk.
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
    /// The harness owns completion semantics; aura-os keeps this count as
    /// diagnostic history alongside recovered file changes.
    pub empty_path_writes: u32,
    /// Per-tool-call failure history accumulated from `tool_call_failed`
    /// domain events during the task. Stored so the UI and persisted task
    /// output can explain harness/runtime failures without aura-os
    /// reclassifying them as Definition-of-Done failures.
    ///
    /// Populated by the event-handler loop; stays empty on runtimes that
    /// don't yet emit `tool_call_failed`.
    pub tool_call_failures: Vec<ToolCallFailureEntry>,
    /// Pending `tool_call_snapshot` inputs keyed by `tool_use_id`,
    /// consumed when the paired `tool_result` arrives.
    ///
    /// Acts as the version-skew fallback for file-change display: harness
    /// versions that pre-date the `tool_call_completed` emission still
    /// only send `tool_call_snapshot` (carries the input) and
    /// `tool_result` (carries the error flag). Joining them by id gives
    /// aura-os the same `(path, op, is_error)` signal that a native
    /// `tool_call_completed` would.
    ///
    /// Entries are removed when the matching `tool_result` is
    /// processed. Snapshots without a matching result (e.g. the stream
    /// died mid-call) are harmless — they just pin a small amount of
    /// memory until the task output cache is dropped.
    pub tool_input_snapshots: HashMap<String, ToolInputSnapshotEntry>,
    /// Set of tool-call identifiers that were observed emitting a
    /// `write_file` / `edit_file` with an empty or missing `path` and
    /// have *not* yet been reconciled by a subsequent successful pathed
    /// write/edit. Kept as diagnostic state for retry observability; the
    /// harness owns Definition-of-Done decisions.
    pub outstanding_empty_path_write_ids: HashSet<String>,
    /// Most recent successful test-runner invocation observed in the
    /// stream (cargo test / pnpm vitest / pytest / ...). When set, the
    /// completion gate accepts a `task_done` without file edits as a
    /// successful completion via test-pass evidence — see
    /// [`super::super::handlers::dev_loop::signals::is_successful_test_run_event`].
    pub test_pass_evidence: Option<TestPassEvidence>,
    /// True once the dev-loop's `CompletionContract` override has fired
    /// for this task (we transitioned the task to `Done` on the back of
    /// `test_pass_evidence`). Kept so a subsequent `task_failed` re-emit
    /// from a reconnect doesn't re-run the bridge or double-emit a
    /// synthetic `task_completed`.
    pub completion_override_applied: bool,
}

/// Snapshot of the most recent successful test-runner invocation that
/// the dev-loop observed for a task. Stored on [`CachedTaskOutput`] and
/// projected into the synthetic `task_completed` event when the gate
/// accepts a no-edit completion via test-pass evidence.
#[derive(Clone, Debug, Default)]
pub struct TestPassEvidence {
    /// Stable runner label from
    /// `signals::recognized_test_runner_label` — e.g. `"cargo test"`,
    /// `"vitest"`, `"pytest"`. Used in UI strings and persisted notes.
    pub runner: &'static str,
    /// Verbatim command text the harness passed to the shell tool, so
    /// retrospection can verify *which* test target was exercised.
    pub command: String,
    /// Wall-clock UTC timestamp (RFC 3339) of when the evidence landed.
    pub recorded_at: String,
}

/// Cached `(name, input)` pair from a `tool_call_snapshot` event,
/// awaiting the paired `tool_result` so aura-os can recover the
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

/// Composite key for the task output cache. Including `ProjectId`
/// guarantees that two tasks with identical task ids in different
/// projects (extremely unlikely but possible) never bleed output
/// into each other's cache entry.
pub type TaskOutputKey = (ProjectId, TaskId);

pub(crate) type TaskOutputCache = Arc<Mutex<HashMap<TaskOutputKey, CachedTaskOutput>>>;

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
