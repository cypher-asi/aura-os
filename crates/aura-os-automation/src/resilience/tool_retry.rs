//! Per-task tool-call retry tracker (Section D).
//!
//! Counts how many `tool_result`-with-`is_error: true` events the
//! dev-loop forwarder has observed for a given task and decides
//! whether the next failure should be treated as a retryable hop or
//! a give-up. The budget is shared with the harness's own
//! streaming-retry count via
//! [`crate::budget::tool_retry::TOOL_CALL_RETRY_BUDGET`] so a single
//! tracker handles both ends of the handshake.

use std::collections::HashMap;
use std::sync::Mutex;

use aura_os_core::TaskId;

use crate::budget::tool_retry::TOOL_CALL_RETRY_BUDGET;

/// Outcome of a single [`ToolRetryTracker::record_failure`] call.
///
/// Carries the post-increment `attempt` count so the caller can plumb
/// it straight into the `task_retrying` UI signal payload without
/// re-querying the tracker.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum RetryDecision {
    /// The failure stays under budget; the caller should emit a
    /// `task_retrying` UI signal and let the loop continue. `attempt`
    /// is the 1-based count for this failure (the first failure
    /// returns `attempt: 1`).
    Retry {
        /// 1-based attempt count after recording this failure.
        attempt: u32,
    },
    /// The failure pushed the per-task counter past
    /// [`TOOL_CALL_RETRY_BUDGET`]; the caller should fall through to
    /// the existing failure-handling path (typically letting the
    /// `task_failed` event propagate).
    GiveUp,
}

/// In-memory counter keyed by [`TaskId`] gating tool-call retries
/// against [`TOOL_CALL_RETRY_BUDGET`].
///
/// The struct is `Default` + `Send` + `Sync` so the server can hold
/// it on the per-loop `ForwarderContext` behind an `Arc` without
/// extra wrapping. Internal poison recovery turns a panic-induced
/// lock-poison into an "act on whatever the previous holder left
/// behind" — that is strictly safer for a retry counter than
/// re-panicking, because a missed increment at worst lets one extra
/// retry through.
#[derive(Debug, Default)]
pub struct ToolRetryTracker {
    counts: Mutex<HashMap<TaskId, u32>>,
}

impl ToolRetryTracker {
    /// Construct a tracker with no recorded failures.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Record one tool-call failure for `task_id` and return the
    /// resulting [`RetryDecision`].
    ///
    /// Increments the per-task counter by one (saturating at
    /// [`u32::MAX`]). Returns [`RetryDecision::Retry`] while the
    /// post-increment count is `<= TOOL_CALL_RETRY_BUDGET` and
    /// [`RetryDecision::GiveUp`] once the budget is exceeded.
    pub fn record_failure(&self, task_id: TaskId) -> RetryDecision {
        let attempt = self.bump(task_id);
        if attempt > TOOL_CALL_RETRY_BUDGET {
            RetryDecision::GiveUp
        } else {
            RetryDecision::Retry { attempt }
        }
    }

    /// Reset the counter for `task_id`. Called from the `task_completed`
    /// arm so a long-running loop that retries the *next* task starts
    /// from zero. A no-op when the task is not tracked.
    pub fn clear(&self, task_id: TaskId) {
        let mut counts = self.locked_counts();
        counts.remove(&task_id);
    }

    /// Read the current attempt count for `task_id` without
    /// mutating it. Returns `0` when the task has never failed.
    /// Exposed for tests and observability.
    #[must_use]
    pub fn attempts(&self, task_id: TaskId) -> u32 {
        let counts = self.locked_counts();
        counts.get(&task_id).copied().unwrap_or(0)
    }

    fn bump(&self, task_id: TaskId) -> u32 {
        let mut counts = self.locked_counts();
        let entry = counts.entry(task_id).or_insert(0);
        *entry = entry.saturating_add(1);
        *entry
    }

    fn locked_counts(&self) -> std::sync::MutexGuard<'_, HashMap<TaskId, u32>> {
        match self.counts.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_failure_returns_retry_with_attempt_one() {
        let tracker = ToolRetryTracker::new();
        let task = TaskId::new();
        assert_eq!(
            tracker.record_failure(task),
            RetryDecision::Retry { attempt: 1 },
        );
        assert_eq!(tracker.attempts(task), 1);
    }

    #[test]
    fn respects_tool_call_retry_budget_of_eight() {
        let tracker = ToolRetryTracker::new();
        let task = TaskId::new();
        for attempt in 1..=TOOL_CALL_RETRY_BUDGET {
            assert_eq!(
                tracker.record_failure(task),
                RetryDecision::Retry { attempt },
                "failure {attempt} must stay under budget",
            );
        }
        assert_eq!(
            tracker.record_failure(task),
            RetryDecision::GiveUp,
            "the (budget + 1)th failure must give up",
        );
        assert_eq!(
            tracker.record_failure(task),
            RetryDecision::GiveUp,
            "subsequent failures must keep giving up",
        );
    }

    #[test]
    fn clear_resets_the_counter() {
        let tracker = ToolRetryTracker::new();
        let task = TaskId::new();
        let _ = tracker.record_failure(task);
        let _ = tracker.record_failure(task);
        assert_eq!(tracker.attempts(task), 2);
        tracker.clear(task);
        assert_eq!(tracker.attempts(task), 0);
        assert_eq!(
            tracker.record_failure(task),
            RetryDecision::Retry { attempt: 1 },
            "after clear, the first failure must look fresh",
        );
    }

    #[test]
    fn distinct_tasks_track_independent_counters() {
        let tracker = ToolRetryTracker::new();
        let task_a = TaskId::new();
        let task_b = TaskId::new();
        let _ = tracker.record_failure(task_a);
        let _ = tracker.record_failure(task_a);
        let _ = tracker.record_failure(task_b);
        assert_eq!(tracker.attempts(task_a), 2);
        assert_eq!(tracker.attempts(task_b), 1);
    }

    #[test]
    fn clear_unknown_task_is_a_no_op() {
        let tracker = ToolRetryTracker::new();
        let task = TaskId::new();
        tracker.clear(task);
        assert_eq!(tracker.attempts(task), 0);
    }
}
