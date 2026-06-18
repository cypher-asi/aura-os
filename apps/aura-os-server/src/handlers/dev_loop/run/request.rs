//! Inputs to the shared run controller [`super::run_automaton`].
//!
//! Adapter handlers translate their HTTP-extracted state into a
//! [`RunRequest`] before dispatching here. The mode flag selects the
//! handful of mode-specific branches that survived the unification:
//! adopt-shortcut, orphan recovery, session-reuse vs always-begin,
//! and the `loop_started` vs `task_started` lifecycle event.

use aura_os_core::{AgentInstanceId, ProjectId, TaskId, UserId};

use super::super::loop_engineering::LoopEngineeringContract;

use crate::state::AppState;

/// Mode flag selecting between long-lived dev-loop bootstrap and
/// one-shot single-task execution. Both modes share the same six-step
/// pipeline (credit preflight, context resolution, automaton start,
/// stream connect, session materialisation, forwarder registration);
/// the controller branches on [`RunMode`] only at the points the
/// pre-refactor `start_loop` / `run_single_task` handlers genuinely
/// diverged.
#[derive(Debug, Clone, Copy)]
pub(in crate::handlers::dev_loop) enum RunMode {
    /// Long-lived dev-loop. Adopts existing harness automatons,
    /// reuses storage sessions when adopting, runs orphan recovery
    /// before the scheduler comes online, emits `loop_started`.
    Automation,
    /// One-shot single-task run. Always mints a fresh ephemeral
    /// executor (the adapter allocates the row before dispatching)
    /// and a fresh storage session tagged with `task_id`; emits
    /// `task_started`.
    SingleTask { task_id: TaskId },
}

/// Bundle of inputs for [`super::run_automaton`].
pub(in crate::handlers::dev_loop) struct RunRequest {
    pub(in crate::handlers::dev_loop) state: AppState,
    pub(in crate::handlers::dev_loop) project_id: ProjectId,
    /// Registry-key instance id. For [`RunMode::Automation`] this is
    /// the bound Loop instance; for [`RunMode::SingleTask`] this is
    /// the freshly-minted ephemeral executor id (the adapter
    /// allocates the row before dispatching here so concurrent
    /// task runs can coexist under different ephemeral ids in the
    /// `automaton_registry`).
    pub(in crate::handlers::dev_loop) agent_instance_id: AgentInstanceId,
    /// Template instance id used to resolve the [`super::super::types::StartContext`]
    /// (workspace, agent template, permissions). Equals
    /// `agent_instance_id` for [`RunMode::Automation`]; for
    /// [`RunMode::SingleTask`] it points at the caller-supplied (or
    /// project-default) template the ephemeral was minted from.
    pub(in crate::handlers::dev_loop) template_agent_instance_id: AgentInstanceId,
    /// JWT extracted from the request. The controller clones this
    /// once for the forwarder before [`super::super::start::build_start_params`]
    /// consumes the original.
    pub(in crate::handlers::dev_loop) jwt: String,
    /// Auth-session network user id (string form). Forwarded into
    /// `build_start_params` and `begin_session` as the `user_id`
    /// argument.
    pub(in crate::handlers::dev_loop) user_id: String,
    /// Caller-supplied model override. `None` falls back to the
    /// instance / agent default inside `resolve_start_context`.
    pub(in crate::handlers::dev_loop) model: Option<String>,
    pub(in crate::handlers::dev_loop) mode: RunMode,
    /// Optional Loop Engineering contract layered onto a normal
    /// long-lived dev-loop run. `None` keeps legacy automation and
    /// single-task starts on their existing prompt path.
    pub(in crate::handlers::dev_loop) loop_engineering: Option<LoopEngineeringContract>,
    /// Resolved typed user id for [`aura_os_events::LoopId`]
    /// construction. The adapter resolves this from the auth session
    /// (via `loop_user_id`) before dispatching.
    pub(in crate::handlers::dev_loop) loop_user_id: UserId,
}
