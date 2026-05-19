//! Per-task task-level retry tracker (Section E).
//!
//! Mirrors [`super::tool_retry::ToolRetryTracker`] but is gated by
//! [`crate::budget::task_retry::TASK_LEVEL_RETRY_BUDGET`] instead of
//! the tool-call budget. Coarser than the tool-call tracker: a task
//! has to fail end-to-end (a `task_failed` event arriving after the
//! tool-call budget was already exhausted) before this counter
//! moves.
//!
//! State model and poison-recovery rules match
//! [`super::tool_retry::ToolRetryTracker`]; see that module's docs
//! for the rationale.

use std::collections::HashMap;
use std::sync::Mutex;

use aura_os_core::TaskId;

use crate::budget::task_retry::TASK_LEVEL_RETRY_BUDGET;
use crate::resilience::tool_retry::RetryDecision;

/// In-memory counter keyed by [`TaskId`] gating task-level
/// `Failed → Ready` auto-retries against
/// [`TASK_LEVEL_RETRY_BUDGET`].
#[derive(Debug, Default)]
pub struct TaskRetryTracker {
    counts: Mutex<HashMap<TaskId, u32>>,
}

impl TaskRetryTracker {
    /// Construct a tracker with no recorded failures.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Record one task-level failure for `task_id` and return the
    /// resulting [`RetryDecision`].
    ///
    /// Increments the per-task counter by one (saturating at
    /// [`u32::MAX`]). Returns [`RetryDecision::Retry`] while the
    /// post-increment count is `<= TASK_LEVEL_RETRY_BUDGET` and
    /// [`RetryDecision::GiveUp`] once the budget is exceeded.
    pub fn record_failure(&self, task_id: TaskId) -> RetryDecision {
        let attempt = self.bump(task_id);
        if attempt > TASK_LEVEL_RETRY_BUDGET {
            RetryDecision::GiveUp
        } else {
            RetryDecision::Retry { attempt }
        }
    }

    /// Reset the counter for `task_id`. Called from `task_completed`
    /// so a subsequent run of the same task starts from zero.
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
        let tracker = TaskRetryTracker::new();
        let task = TaskId::new();
        assert_eq!(
            tracker.record_failure(task),
            RetryDecision::Retry { attempt: 1 },
        );
    }

    #[test]
    fn respects_task_level_retry_budget_of_three() {
        let tracker = TaskRetryTracker::new();
        let task = TaskId::new();
        for attempt in 1..=TASK_LEVEL_RETRY_BUDGET {
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
    }

    #[test]
    fn clear_resets_the_counter() {
        let tracker = TaskRetryTracker::new();
        let task = TaskId::new();
        let _ = tracker.record_failure(task);
        tracker.clear(task);
        assert_eq!(tracker.attempts(task), 0);
    }

    #[test]
    fn distinct_tasks_track_independent_counters() {
        let tracker = TaskRetryTracker::new();
        let task_a = TaskId::new();
        let task_b = TaskId::new();
        let _ = tracker.record_failure(task_a);
        let _ = tracker.record_failure(task_a);
        let _ = tracker.record_failure(task_b);
        assert_eq!(tracker.attempts(task_a), 2);
        assert_eq!(tracker.attempts(task_b), 1);
    }
}
