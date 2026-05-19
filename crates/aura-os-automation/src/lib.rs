//! Domain logic for dev-loop and chat agent automation.
//!
//! This crate owns the pure logic that the dev-loop, the chat agent,
//! and (later) other automation surfaces share: transient/restart
//! classifiers, push-failure classification, the retry budget
//! constants, and (Phase G4a) the task-context resolver +
//! exploration-budget scaling helper. It has no Axum, no
//! [`aura_os_server`] state, no [`aura_os_storage`] dependency, and
//! no [`anyhow`] in its library surface — failures travel through
//! the [`AutomationError`] enum.
//!
//! The current surface covers Phases G1 + G2 + G3a + G4a:
//!
//! * `progress/` — spinner/activity mapping (Section A, Phase G2).
//! * `failure/` — fallback `task_failed` reason synthesis (Section B,
//!   Phase G3a).
//! * `resilience/` — tool-call + task-level retry trackers and the
//!   loop-start orphan-recovery planner (Sections D / E, Phase G3a).
//! * `task_context/` — cached resolver + pure builder for the
//!   `get_task_context` tool's wire payload (Section F2,
//!   Phase G4a). Storage I/O stays in the App layer; this crate
//!   only owns the shaping + cache.
//! * `budget/exploration` — soft/hard exploration ceiling that
//!   scales with task complexity, replacing the harness's fixed
//!   "STRONG WARNING" block with advisory framing (Section F5,
//!   Phase G4a).
//!
//! Phase G4b will add `permissions/`, `dispatch/`, `stream/` for
//! the auto-build forwarder and allowlisted run_command (Sections
//! F3 / F4).
//!
//! See `c:\Users\n3o\.cursor\plans\fix_dev-loop_progress_signal_*.plan.md`
//! Sections G.0–G.6 for the full migration plan.

#![warn(missing_docs)]

pub mod budget;
pub mod classify;
pub mod error;
pub mod event_kinds;
pub mod failure;
pub mod progress;
pub mod resilience;
pub mod task_context;

pub use budget::{
    ExplorationBudget, ExplorationStatus, EXPLORATION_DEPENDENCY_BONUS,
    EXPLORATION_DESCRIPTION_DIVISOR, EXPLORATION_HARD_FLOOR, EXPLORATION_SOFT_CEILING,
    EXPLORATION_SOFT_FLOOR, TASK_LEVEL_RETRY_BUDGET, TOOL_CALL_RETRY_BUDGET,
};
pub use classify::{
    classify_push_failure, classify_restart_reason, is_agent_stuck_terminal_signal,
    is_git_push_timeout, is_insufficient_credits, is_provider_internal, is_rate_limited,
    looks_like_unclassified_transient, should_restart_on_error, tool_call_failed_should_retry,
};
pub use error::AutomationError;
pub use failure::{synthesize_failure_reason, FailureContext};
pub use progress::{apply_loop_activity, LoopActivityTransition};
pub use resilience::{
    recover_orphans, OrphanRecoveryPlan, RetryDecision, TaskRetryTracker, ToolRetryTracker,
    ORPHAN_RECOVERY_REASON,
};
pub use task_context::{
    build_task_context, TaskContext, TaskContextCache, TaskContextInputs, TaskContextResolver,
    TaskRef, MAX_CACHE_ENTRIES, MAX_EXECUTION_NOTES_LEN,
};

#[cfg(test)]
mod smoke {
    //! Compile-time check that the documented public re-export shape
    //! resolves. Catches accidental renames before downstream crates
    //! see them.

    #[test]
    fn public_reexports_resolve() {
        let _ = crate::TOOL_CALL_RETRY_BUDGET;
        let _ = crate::TASK_LEVEL_RETRY_BUDGET;
        let _ = crate::is_rate_limited("rate limit");
        let _ = crate::is_provider_internal("internal server error");
        let _ = crate::is_insufficient_credits("payment_required");
        let _ = crate::is_git_push_timeout("git push timed out");
        let _ = crate::looks_like_unclassified_transient("dns lookup failed");
        let _ = crate::is_agent_stuck_terminal_signal("agent is stuck");
        let _ = crate::should_restart_on_error("rate limit");
        let _ = crate::tool_call_failed_should_retry("rate limit", 0);
        let _ = crate::classify_restart_reason("rate limit");
        let _ = crate::classify_push_failure("git push timed out");
        let _: &str = crate::event_kinds::TEXT_DELTA;
        // Compile-time check that `apply_loop_activity` is reachable
        // through the crate root. The progress module's own table
        // tests cover behaviour; here we just want a `let _ = ...`
        // that pins the public name.
        fn _assert_callable(
            activity: &aura_os_events::LoopActivity,
        ) -> Option<crate::LoopActivityTransition> {
            crate::apply_loop_activity(activity, crate::event_kinds::TEXT_DELTA)
        }
        // Phase G3a: pin the failure + resilience public surface.
        let _ = crate::synthesize_failure_reason(&crate::FailureContext::default());
        let _tool_tracker = crate::ToolRetryTracker::new();
        let _task_tracker = crate::TaskRetryTracker::new();
        let _: Vec<crate::OrphanRecoveryPlan> = crate::recover_orphans(&[]);
        // RetryDecision must be reachable through the crate root for
        // the server's pattern matches.
        let _retry = crate::RetryDecision::GiveUp;
        // Phase G4a: pin the task-context + exploration-budget
        // public surface.
        let _resolver = crate::TaskContextResolver::new();
        let _cache = crate::TaskContextCache::new();
        let _ref_cap: usize = crate::MAX_CACHE_ENTRIES;
        let _notes_cap: usize = crate::MAX_EXECUTION_NOTES_LEN;
        let budget = crate::ExplorationBudget::for_task(0, 0);
        let _ = budget.classify(0);
        let _ = budget.advisory_text(0);
        let _: u32 = crate::EXPLORATION_SOFT_FLOOR;
        let _: u32 = crate::EXPLORATION_SOFT_CEILING;
        let _: u32 = crate::EXPLORATION_HARD_FLOOR;
        let _: usize = crate::EXPLORATION_DESCRIPTION_DIVISOR;
        let _: u32 = crate::EXPLORATION_DEPENDENCY_BONUS;
        // Make sure the wire types compose into the tool-result JSON.
        let task = dummy_task();
        let inputs = crate::TaskContextInputs {
            task: &task,
            parent: None,
            children: &[],
            spec: None,
            task_version: 0,
        };
        let ctx = crate::build_task_context(&inputs);
        let _: crate::TaskContext = ctx;
        let _ref_type: Option<crate::TaskRef> = None;
    }

    fn dummy_task() -> aura_os_core::Task {
        let now = chrono::Utc::now();
        aura_os_core::Task {
            task_id: aura_os_core::TaskId::new(),
            project_id: aura_os_core::ProjectId::new(),
            spec_id: aura_os_core::SpecId::new(),
            title: String::new(),
            description: String::new(),
            status: aura_os_core::TaskStatus::Ready,
            order_index: 0,
            dependency_ids: Vec::new(),
            parent_task_id: None,
            skip_auto_decompose: false,
            assigned_agent_instance_id: None,
            completed_by_agent_instance_id: None,
            session_id: None,
            execution_notes: String::new(),
            files_changed: Vec::new(),
            live_output: String::new(),
            build_steps: Vec::new(),
            test_steps: Vec::new(),
            user_id: None,
            model: None,
            total_input_tokens: 0,
            total_output_tokens: 0,
            created_at: now,
            updated_at: now,
        }
    }
}
