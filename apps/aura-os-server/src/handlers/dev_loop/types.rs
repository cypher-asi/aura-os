use std::sync::{atomic::AtomicBool, Arc};
use std::time::Duration;

use serde::Deserialize;
use tokio::sync::broadcast;

use aura_os_automation::{TaskRetryTracker, ToolRetryTracker};
use aura_os_core::{AgentId, AgentInstanceId, AgentPermissions, Project, ProjectId, SessionId};
use aura_os_harness::{AutomatonClient, WsReaderHandle};
use aura_os_loops::LoopHandle;
use aura_protocol::IntentClassifierSpec;

use crate::state::AppState;

#[derive(Debug, Deserialize, Default)]
pub(crate) struct LoopQueryParams {
    pub agent_instance_id: Option<AgentInstanceId>,
    pub model: Option<String>,
}

pub(super) struct StartContext {
    pub(super) client: Arc<AutomatonClient>,
    pub(super) project_id: ProjectId,
    pub(super) project: Option<Project>,
    pub(super) model: Option<String>,
    pub(super) workspace_root: String,
    /// Org-level agent id backing the project-agent instance. Needed
    /// for `LoopId` construction so loop events can be filtered by
    /// `AgentId` topic in addition to `AgentInstanceId`.
    pub(super) agent_id: AgentId,
    pub(super) agent_system_prompt: String,
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
    /// forwarder owns the handle and publishes `LoopActivityChanged`
    /// transitions through it as harness events arrive. On completion
    /// it calls `mark_completed` / `mark_failed`; on stream collapse,
    /// the handle's RAII drop emits a `Cancelled` event.
    pub(super) loop_handle: LoopHandle,
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
    /// Per-loop retry state (Sections D + E of the dev-loop progress
    /// signal plan). Holds the tool-call and task-level retry
    /// trackers so the forwarder's side-effects worker can decide,
    /// per arriving `tool_result` / `task_failed` event, whether to
    /// emit a `task_retrying` UI signal or to drive a
    /// `safe_transition(Failed -> Ready)` retry hop.
    ///
    /// Defaulted on cold start; survives only as long as the loop
    /// itself does — see the module-level rationale in
    /// `aura_os_automation::resilience` for why the counters do not
    /// need to be persisted yet.
    pub(super) retry_state: Arc<LoopRetryState>,
}

/// Per-loop retry state owned by the dev-loop forwarder.
///
/// Bundles the two retry trackers from `aura_os_automation::resilience`
/// so the forwarder can pass a single `Arc<LoopRetryState>` into the
/// side-effects worker rather than two unrelated `Arc`s. Both fields
/// stay `pub(super)` so callers in the `dev_loop` module can reach
/// the underlying trackers without going through a wrapper API the
/// trackers themselves already provide.
#[derive(Debug, Default)]
pub(super) struct LoopRetryState {
    /// Tool-call infra-retry counter. Gates the
    /// `task_retrying` signal emission and the harness restart.
    pub(super) tool_retry: ToolRetryTracker,
    /// Task-level auto-retry counter. Gates the
    /// `safe_transition(Failed -> Ready)` hop in the `task_failed`
    /// arm of the side-effects worker.
    pub(super) task_retry: TaskRetryTracker,
}

impl LoopRetryState {
    /// Construct a fresh retry-state bundle. Both trackers start
    /// empty so the first failure for any task counts as attempt 1.
    pub(super) fn new() -> Self {
        Self::default()
    }
}
