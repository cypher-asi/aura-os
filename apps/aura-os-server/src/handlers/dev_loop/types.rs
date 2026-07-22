use std::sync::{
    atomic::{AtomicBool, AtomicI64},
    Arc,
};
use std::time::Duration;

use serde::Deserialize;
use tokio::sync::broadcast;

use super::health::HealthBaselineTracker;
use aura_os_core::{AgentId, AgentInstanceId, AgentPermissions, Project, ProjectId, SessionId};
use aura_os_harness::{HarnessLink, WsReaderHandle};
use aura_os_loops::LoopHandle;
use aura_protocol::IntentClassifierSpec;

use crate::state::AppState;

#[derive(Debug, Deserialize, Default)]
pub(crate) struct LoopQueryParams {
    pub agent_instance_id: Option<AgentInstanceId>,
    pub model: Option<String>,
}

pub(super) struct StartContext {
    /// Canonical harness transport for this run's mode. Local runs share
    /// `state.local_harness`; swarm runs get a per-request transport
    /// pointed at the gateway's `/v1/agents/:id` base with the caller
    /// JWT installed as transport auth.
    pub(super) client: Arc<dyn HarnessLink>,
    /// Base URL the `client` talks to. Retained separately because the
    /// `HarnessLink` trait is transport-only (no `base_url()` accessor);
    /// stored on the `automaton_registry` entry so control / credit
    /// teardown can rebuild a lifecycle client against the same harness.
    pub(super) harness_base_url: String,
    /// Bearer token applied to this transport's HTTP / WS calls. `None`
    /// for local runs (the local harness reads identity from the request
    /// body, matching the pre-migration no-auth `AutomatonClient`);
    /// `Some(jwt)` for swarm gateway runs.
    pub(super) harness_auth_token: Option<String>,
    pub(super) project_id: ProjectId,
    pub(super) project: Option<Project>,
    pub(super) model: Option<String>,
    pub(super) workspace_root: String,
    /// Org-level agent id backing the project-agent instance. Needed
    /// for `LoopId` construction so loop events can be filtered by
    /// `AgentId` topic in addition to `AgentInstanceId`.
    pub(super) agent_id: AgentId,
    /// Operator-authored system prompt (the "system prompt" textarea
    /// on the agent template). PR C forwards this on the wire as
    /// `agent_system_prompt` so the harness `SystemPromptBuilder`
    /// renders it inside `<agent_system_prompt>...</agent_system_prompt>`.
    pub(super) agent_system_prompt: String,
    /// Free-form agent identity surfaced into the dev-loop system
    /// prompt's `<agent_identity>` section. Loaded from the
    /// `agent_instance` row alongside `agent_system_prompt` so all
    /// three identity inputs share the same persistence path.
    pub(super) agent_name: String,
    pub(super) agent_role: String,
    pub(super) agent_personality: String,
    /// Operator-curated skills list rendered as `<agent_skills>`.
    /// Empty list ⇒ the harness drops the section entirely.
    pub(super) agent_skills: Vec<String>,
    pub(super) agent_org_id: Option<aura_os_core::OrgId>,
    pub(super) intent_classifier: Option<IntentClassifierSpec>,
    /// Permission bundle applied to the harness automaton kernel policy.
    /// Mirrors the chat path's session permissions so capability-gated
    /// tools like `run_command` behave consistently in dev-loop runs.
    pub(super) permissions: AgentPermissions,
}

pub(super) struct StartedAutomaton {
    pub(super) automaton_id: String,
    pub(super) event_stream_url: Option<String>,
    pub(super) adopted: bool,
}

pub(super) enum ControlAction {
    Pause,
    Resume,
    Stop,
}

pub(super) struct ForwarderContext {
    pub(super) state: AppState,
    pub(super) project_id: ProjectId,
    pub(super) agent_instance_id: AgentInstanceId,
    pub(super) automaton_id: String,
    pub(super) task_id: Option<String>,
    pub(super) events_tx: broadcast::Sender<serde_json::Value>,
    pub(super) ws_reader_handle: WsReaderHandle,
    pub(super) alive: Arc<AtomicBool>,
    pub(super) timeout: Duration,
    /// Handle into [`aura_os_loops::LoopRegistry`] for this loop. The
    /// forwarder owns a clone and publishes `LoopActivityChanged`
    /// transitions through it as harness events arrive. On completion
    /// it calls `mark_completed` / `mark_failed`; on stream collapse,
    /// the handle's RAII drop emits a `Cancelled` event. Stashed as
    /// `Arc<LoopHandle>` so the `automaton_registry` entry can hold a
    /// second clone and call `mark_cancelled()` synchronously on stop
    /// (before the forwarder unwinds), guaranteeing `LoopEnded` lands
    /// on the wire before any rapid-restart `LoopOpened`.
    pub(super) loop_handle: Arc<LoopHandle>,
    /// Shared millis-since-epoch cell updated on every harness event
    /// the forwarder consumes. The `automaton_registry` entry holds a
    /// clone so [`crate::handlers::dev_loop::registry::can_reuse_forwarder`]
    /// can refuse the adopt-shortcut on a forwarder that has gone
    /// silent (harness-side wedge), forcing a clean rebuild instead of
    /// inheriting a dead pipe.
    pub(super) last_forwarder_event_at: Arc<AtomicI64>,
    /// JWT captured from the HTTP request that started this loop, used
    /// by the forwarder for best-effort background writes back to
    /// aura-storage (e.g. persisting `tasks.execution_notes` on a
    /// `task_failed` event so the fail reason survives a page reload
    /// even after the WS stream is gone). `None` in tests or when the
    /// caller didn't have one to hand; the forwarder skips the write
    /// silently in that case. Expiry is tolerated: if storage rejects
    /// the write with 401, the forwarder logs a warning and moves on.
    pub(super) jwt: Option<String>,
    /// Storage `Session` id created for this automation run, if any.
    ///
    /// When set, the forwarder routes harness lifecycle events into
    /// `SessionService` so `total_sessions` and `tasks_worked_count`
    /// reflect automation activity (mirroring what the chat path
    /// already does). On `task_started` we increment
    /// `tasks_worked_count`, on terminal status we transition the
    /// session to `Completed` / `Failed`. The id is also used to
    /// stamp outgoing `LegacyJsonEvent.session_id` so subscribers can
    /// correlate live events with the persisted session.
    pub(super) session_id: Option<SessionId>,
    /// Per-loop state owned by the forwarder.
    ///
    /// Per-task retry counts live in storage; this shared state retains only
    /// run-scoped coordination that cannot be reconstructed from a task row.
    pub(super) retry_state: Arc<LoopRetryState>,
}

/// Per-loop forwarder state.
///
/// Per-task attempts remain persisted on task rows. This bundle holds the
/// workspace-health baseline and the one-shot provider circuit state shared by
/// every event belonging to the same automaton run.
#[derive(Debug)]
pub(super) struct LoopRetryState {
    /// Per-task `WorkspaceHealth` baseline captured at
    /// `task_started` by the async snapshot runner in
    /// [`super::signals::snapshot_workspace_health`]. The completion
    /// gate reads it back at `task_done` via
    /// [`HealthBaselineTracker::get`]; missing entries fall through
    /// to the existing `workspace_health_unknown_baseline` path.
    pub(super) health_baseline: HealthBaselineTracker,
    /// Stable run identity used when terminal provider failures stop the
    /// enclosing automaton after the per-task retry budget is exhausted.
    pub(super) automaton_id: String,
    /// Run-level latch preventing duplicate stop requests and duplicate
    /// operator events if terminal provider failures race during shutdown.
    pub(super) provider_circuit_open: AtomicBool,
}

impl LoopRetryState {
    /// Construct a fresh per-loop state bundle.
    pub(super) fn new(automaton_id: String) -> Self {
        Self {
            health_baseline: HealthBaselineTracker::default(),
            automaton_id,
            provider_circuit_open: AtomicBool::new(false),
        }
    }
}
