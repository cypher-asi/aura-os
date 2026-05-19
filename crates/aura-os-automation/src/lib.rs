//! Domain logic for dev-loop and chat agent automation.
//!
//! This crate owns the pure logic that the dev-loop, the chat agent,
//! and (later) other automation surfaces share: transient/restart
//! classifiers, push-failure classification, and the retry budget
//! constants. It has no Axum, no [`aura_os_server`] state, no
//! [`aura_os_storage`] dependency, and no [`anyhow`] in its library
//! surface — failures travel through the [`AutomationError`] enum.
//!
//! The current surface covers Phases G1 + G2 + G3a:
//!
//! * `progress/` — spinner/activity mapping (Section A, Phase G2).
//! * `failure/` — fallback `task_failed` reason synthesis (Section B,
//!   Phase G3a).
//! * `resilience/` — tool-call + task-level retry trackers and the
//!   loop-start orphan-recovery planner (Sections D / E, Phase G3a).
//!
//! Phase G4 will add `task_context/`, `permissions/`, `dispatch/`,
//! `stream/` for the product-level resilience work (Sections F2–F5).
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

pub use budget::{TASK_LEVEL_RETRY_BUDGET, TOOL_CALL_RETRY_BUDGET};
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
    }
}
