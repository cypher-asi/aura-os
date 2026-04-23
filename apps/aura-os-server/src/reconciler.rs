//! Task recovery reconciler.
//!
//! This module owns the *decision* half of the autonomy recovery loop.
//! Given a task's persisted [`TaskSyncState`] and [`TaskRecoveryPoint`]
//! plus a small amount of execution context (retry count, terminal
//! status, failure class), it decides which durable next action the
//! supervisor should take.
//!
//! The function is deliberately pure: no storage, no harness calls, no
//! logging. That keeps it cheap to unit-test and easy to reuse from
//! both the existing request-driven dev loop and a future background
//! reconciliation worker. Callers are responsible for carrying out the
//! chosen action (harness adoption, storage transitions, scheduling a
//! push retry, spawning skeleton/fill children, etc.).
//!
//! The decision vocabulary mirrors the five reconciliation branches
//! called out in the autonomy plan:
//!
//! * [`ReconcileAction::AdoptRun`] — re-attach to a live automaton.
//! * [`ReconcileAction::RetryPush`] — the task has a local commit but
//!   the remote is not in sync; schedule a push-only retry.
//! * [`ReconcileAction::RetryTask`] — re-run the task from the ready
//!   state (retry-safe failure within the retry budget).
//! * [`ReconcileAction::Decompose`] — the failure looks like a
//!   truncation / "needs decomposition" shape; spawn skeleton/fill.
//! * [`ReconcileAction::MarkTerminal`] — no safe automated recovery;
//!   leave the task in its terminal state for a human to inspect.
//! * [`ReconcileAction::Noop`] — nothing actionable right now.

use crate::sync_state::{TaskRecoveryPoint, TaskSyncState, TaskSyncStatus};

/// Default retry budget. Mirrors the `MAX_RETRIES_PER_TASK` constant in
/// `handlers::dev_loop` so a reconciler that does not override the
/// budget matches the existing remediation path.
pub const DEFAULT_MAX_RETRIES_PER_TASK: u32 = 3;

/// How the caller classifies the most recent task failure. This is a
/// shallow summary of `handlers::dev_loop`'s `classify_failure` output;
/// keeping it here lets the reconciler stay independent of the full
/// dev-loop enum while still making the same decision.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FailureClass {
    /// Task has not terminally failed (still running, succeeded, or
    /// pending). Recovery only looks at sync state.
    None,
    /// Truncation / "needs decomposition" style failure.
    Truncation,
    /// Provider rate limit or overload. Handled elsewhere via infra
    /// cooldowns; reconciler should not fan this out into extra retries.
    RateLimited,
    /// Post-commit `git push` timeout. The local commit exists, the
    /// remote may or may not; reconciler should drive a push retry.
    PushTimeout,
    /// Any other terminal failure (crash, validation failure, etc.).
    Other,
}

impl FailureClass {
    fn is_terminal(self) -> bool {
        !matches!(self, FailureClass::None)
    }
}

/// Inputs to [`decide_reconcile_action`].
///
/// Grouped into a struct so callers can extend the reconciler with new
/// signals (e.g. current cooldown class, adopt hints) without churning
/// the function signature.
#[derive(Clone, Debug)]
pub struct ReconcileInputs<'a> {
    /// Aggregated sync state derived from persisted checkpoints.
    pub sync_state: &'a TaskSyncState,
    /// Optional recovery point (pending_push / retry_push) derived from
    /// [`sync_state`]. Callers can pass `None` when the checkpoint
    /// summary does not surface one.
    pub recovery_point: Option<&'a TaskRecoveryPoint>,
    /// How many remediation attempts have already been spent on this
    /// task. Must be ≤ `max_retries` for a retry action to be chosen.
    pub retry_count: u32,
    /// Maximum retry budget. Defaults to
    /// [`DEFAULT_MAX_RETRIES_PER_TASK`] when callers don't plumb it.
    pub max_retries: u32,
    /// Latest failure classification. Use [`FailureClass::None`] when
    /// the task is still running or already succeeded.
    pub failure_class: FailureClass,
    /// True when a live automaton is known to still be running for the
    /// task's agent instance. Reconciler prefers adopting over
    /// restarting whenever this is set.
    pub has_live_automaton: bool,
    /// True when `auto_decompose_disabled()` is active (env flag or
    /// task-level opt-out). Suppresses [`ReconcileAction::Decompose`].
    pub auto_decompose_disabled: bool,
}

impl<'a> ReconcileInputs<'a> {
    /// Build inputs with [`DEFAULT_MAX_RETRIES_PER_TASK`] and every
    /// optional signal set to its neutral value. Useful for tests and
    /// for callers that only know the persisted sync state.
    pub fn from_sync_state(sync_state: &'a TaskSyncState) -> Self {
        Self {
            sync_state,
            recovery_point: None,
            retry_count: 0,
            max_retries: DEFAULT_MAX_RETRIES_PER_TASK,
            failure_class: FailureClass::None,
            has_live_automaton: false,
            auto_decompose_disabled: false,
        }
    }

    fn retry_budget_remaining(&self) -> bool {
        self.retry_count < self.max_retries
    }
}

/// Durable next action the supervisor should take for a task.
///
/// Equality is derived so tests can assert exact branches without
/// stringly-typed matching.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ReconcileAction {
    /// Re-attach to an existing live automaton instead of restarting.
    AdoptRun,
    /// Schedule a push-only retry against the already-local commit.
    RetryPush { commit_sha: String, retry_safe: bool },
    /// Re-run the task from its ready state within the retry budget.
    RetryTask,
    /// Spawn skeleton/fill children via the existing decomposition
    /// pipeline.
    Decompose,
    /// Leave the task in its terminal state; no safe automated recovery.
    MarkTerminal { reason: TerminalReason },
    /// Nothing to do right now.
    Noop,
}

/// Why the reconciler chose to leave a task terminal instead of
/// retrying. Kept narrow so the supervisor can translate these into
/// operator-facing messages without inventing new strings.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TerminalReason {
    /// The task burned through its retry budget.
    RetryBudgetExhausted,
    /// Provider is rate-limiting; remediation is handled by the
    /// cooldown path, not by the reconciler.
    RateLimited,
    /// Commit itself failed on disk; reconciler cannot push what was
    /// never committed.
    CommitFailed,
    /// Auto-decompose is disabled; truncation is a terminal outcome
    /// until the operator re-enables the decomposition path.
    DecomposeDisabled,
}

/// Decide what to do with a task based on its persisted recovery state
/// and a small amount of execution context.
///
/// Ordering of the rules matters: adoption wins over everything (no
/// point starting new work when a live automaton is already
/// executing), then sync recovery, then failure classification. Within
/// failure classification we prefer push recovery first because it's
/// the cheapest, most local remediation.
pub fn decide_reconcile_action(inputs: &ReconcileInputs<'_>) -> ReconcileAction {
    // 1. Live automaton — adopt rather than restart.
    if inputs.has_live_automaton {
        return ReconcileAction::AdoptRun;
    }

    // 2. Push recovery is the cheapest remediation, so try it first
    //    even when the task has also failed. If the reconciler can get
    //    the commit to the remote, the task is effectively done.
    if let Some(point) = inputs.recovery_point {
        if point.retry_safe {
            return ReconcileAction::RetryPush {
                commit_sha: point.commit_sha.clone(),
                retry_safe: true,
            };
        }
    }

    // Fallback push-recovery path: derived from sync status alone when
    // no explicit recovery point was supplied. Mirrors
    // `derive_recovery_point` so tests pass the same signal from either
    // angle.
    if matches!(
        inputs.sync_state.status,
        TaskSyncStatus::PendingPush | TaskSyncStatus::PushFailed
    ) && inputs.sync_state.retry_safe
    {
        if let Some(commit_sha) = inputs.sync_state.last_commit_sha.clone() {
            return ReconcileAction::RetryPush {
                commit_sha,
                retry_safe: true,
            };
        }
    }

    // 3. Non-terminal state: defer to other systems.
    if !inputs.failure_class.is_terminal() {
        return ReconcileAction::Noop;
    }

    // 4. Commit failed without a retry-safe checkpoint: no recovery.
    if inputs.sync_state.status == TaskSyncStatus::CommitFailed && !inputs.sync_state.retry_safe {
        return ReconcileAction::MarkTerminal {
            reason: TerminalReason::CommitFailed,
        };
    }

    // 5. Terminal failure classification.
    match inputs.failure_class {
        FailureClass::RateLimited => ReconcileAction::MarkTerminal {
            reason: TerminalReason::RateLimited,
        },
        FailureClass::PushTimeout => {
            // Should already have been caught by the recovery-point
            // branch above, but a push timeout without a recorded
            // commit is still a retryable task-level retry rather than
            // terminal — the harness will re-run and produce a fresh
            // commit.
            if inputs.retry_budget_remaining() {
                ReconcileAction::RetryTask
            } else {
                ReconcileAction::MarkTerminal {
                    reason: TerminalReason::RetryBudgetExhausted,
                }
            }
        }
        FailureClass::Truncation => {
            if inputs.auto_decompose_disabled {
                ReconcileAction::MarkTerminal {
                    reason: TerminalReason::DecomposeDisabled,
                }
            } else if inputs.retry_budget_remaining() {
                ReconcileAction::Decompose
            } else {
                ReconcileAction::MarkTerminal {
                    reason: TerminalReason::RetryBudgetExhausted,
                }
            }
        }
        FailureClass::Other => {
            if inputs.retry_budget_remaining() {
                ReconcileAction::RetryTask
            } else {
                ReconcileAction::MarkTerminal {
                    reason: TerminalReason::RetryBudgetExhausted,
                }
            }
        }
        FailureClass::None => ReconcileAction::Noop,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync_state::{TaskRecoveryPoint, TaskRecoveryPointKind, TaskSyncState, TaskSyncStatus};

    fn sync_state(status: TaskSyncStatus, commit: Option<&str>, retry_safe: bool) -> TaskSyncState {
        TaskSyncState {
            status,
            last_commit_sha: commit.map(str::to_owned),
            retry_safe,
            ..Default::default()
        }
    }

    #[test]
    fn live_automaton_is_adopted_over_retry() {
        let state = sync_state(TaskSyncStatus::PendingPush, Some("abc123"), true);
        let mut inputs = ReconcileInputs::from_sync_state(&state);
        inputs.has_live_automaton = true;
        inputs.failure_class = FailureClass::Other;
        assert_eq!(decide_reconcile_action(&inputs), ReconcileAction::AdoptRun);
    }

    #[test]
    fn pending_push_triggers_push_retry_from_recovery_point() {
        let state = sync_state(TaskSyncStatus::PendingPush, Some("abc123"), true);
        let point = TaskRecoveryPoint {
            kind: TaskRecoveryPointKind::PendingPush,
            commit_sha: "abc123".to_string(),
            retry_safe: true,
        };
        let mut inputs = ReconcileInputs::from_sync_state(&state);
        inputs.recovery_point = Some(&point);
        assert_eq!(
            decide_reconcile_action(&inputs),
            ReconcileAction::RetryPush {
                commit_sha: "abc123".to_string(),
                retry_safe: true,
            }
        );
    }

    #[test]
    fn push_failed_with_commit_triggers_push_retry_without_explicit_point() {
        let state = sync_state(TaskSyncStatus::PushFailed, Some("def456"), true);
        let mut inputs = ReconcileInputs::from_sync_state(&state);
        inputs.failure_class = FailureClass::PushTimeout;
        assert_eq!(
            decide_reconcile_action(&inputs),
            ReconcileAction::RetryPush {
                commit_sha: "def456".to_string(),
                retry_safe: true,
            }
        );
    }

    #[test]
    fn push_timeout_without_commit_falls_back_to_task_retry() {
        let state = sync_state(TaskSyncStatus::NotAttempted, None, false);
        let mut inputs = ReconcileInputs::from_sync_state(&state);
        inputs.failure_class = FailureClass::PushTimeout;
        assert_eq!(decide_reconcile_action(&inputs), ReconcileAction::RetryTask);
    }

    #[test]
    fn push_timeout_after_budget_marks_terminal() {
        let state = sync_state(TaskSyncStatus::NotAttempted, None, false);
        let mut inputs = ReconcileInputs::from_sync_state(&state);
        inputs.failure_class = FailureClass::PushTimeout;
        inputs.retry_count = DEFAULT_MAX_RETRIES_PER_TASK;
        assert_eq!(
            decide_reconcile_action(&inputs),
            ReconcileAction::MarkTerminal {
                reason: TerminalReason::RetryBudgetExhausted,
            }
        );
    }

    #[test]
    fn truncation_within_budget_decomposes() {
        let state = sync_state(TaskSyncStatus::NotAttempted, None, false);
        let mut inputs = ReconcileInputs::from_sync_state(&state);
        inputs.failure_class = FailureClass::Truncation;
        assert_eq!(decide_reconcile_action(&inputs), ReconcileAction::Decompose);
    }

    #[test]
    fn truncation_with_auto_decompose_disabled_marks_terminal() {
        let state = sync_state(TaskSyncStatus::NotAttempted, None, false);
        let mut inputs = ReconcileInputs::from_sync_state(&state);
        inputs.failure_class = FailureClass::Truncation;
        inputs.auto_decompose_disabled = true;
        assert_eq!(
            decide_reconcile_action(&inputs),
            ReconcileAction::MarkTerminal {
                reason: TerminalReason::DecomposeDisabled,
            }
        );
    }

    #[test]
    fn truncation_after_budget_marks_terminal() {
        let state = sync_state(TaskSyncStatus::NotAttempted, None, false);
        let mut inputs = ReconcileInputs::from_sync_state(&state);
        inputs.failure_class = FailureClass::Truncation;
        inputs.retry_count = DEFAULT_MAX_RETRIES_PER_TASK;
        assert_eq!(
            decide_reconcile_action(&inputs),
            ReconcileAction::MarkTerminal {
                reason: TerminalReason::RetryBudgetExhausted,
            }
        );
    }

    #[test]
    fn rate_limited_failure_is_terminal_for_reconciler() {
        let state = sync_state(TaskSyncStatus::NotAttempted, None, false);
        let mut inputs = ReconcileInputs::from_sync_state(&state);
        inputs.failure_class = FailureClass::RateLimited;
        assert_eq!(
            decide_reconcile_action(&inputs),
            ReconcileAction::MarkTerminal {
                reason: TerminalReason::RateLimited,
            }
        );
    }

    #[test]
    fn other_failure_within_budget_retries_task() {
        let state = sync_state(TaskSyncStatus::NotAttempted, None, false);
        let mut inputs = ReconcileInputs::from_sync_state(&state);
        inputs.failure_class = FailureClass::Other;
        assert_eq!(decide_reconcile_action(&inputs), ReconcileAction::RetryTask);
    }

    #[test]
    fn other_failure_after_budget_marks_terminal() {
        let state = sync_state(TaskSyncStatus::NotAttempted, None, false);
        let mut inputs = ReconcileInputs::from_sync_state(&state);
        inputs.failure_class = FailureClass::Other;
        inputs.retry_count = DEFAULT_MAX_RETRIES_PER_TASK;
        assert_eq!(
            decide_reconcile_action(&inputs),
            ReconcileAction::MarkTerminal {
                reason: TerminalReason::RetryBudgetExhausted,
            }
        );
    }

    #[test]
    fn commit_failed_without_retry_safety_is_terminal() {
        let state = sync_state(TaskSyncStatus::CommitFailed, None, false);
        let mut inputs = ReconcileInputs::from_sync_state(&state);
        inputs.failure_class = FailureClass::Other;
        assert_eq!(
            decide_reconcile_action(&inputs),
            ReconcileAction::MarkTerminal {
                reason: TerminalReason::CommitFailed,
            }
        );
    }

    #[test]
    fn no_failure_and_no_recovery_is_noop() {
        let state = sync_state(TaskSyncStatus::NotAttempted, None, false);
        let inputs = ReconcileInputs::from_sync_state(&state);
        assert_eq!(decide_reconcile_action(&inputs), ReconcileAction::Noop);
    }

    #[test]
    fn pushed_state_with_no_failure_is_noop() {
        let state = sync_state(TaskSyncStatus::Pushed, Some("abc123"), false);
        let inputs = ReconcileInputs::from_sync_state(&state);
        assert_eq!(decide_reconcile_action(&inputs), ReconcileAction::Noop);
    }

    #[test]
    fn recovery_point_wins_over_failure_classification() {
        // A commit that hasn't been pushed yet should drive a push
        // retry even if the harness emitted a terminal failure for
        // some other reason. Push-recovery is cheaper than a full
        // task retry.
        let state = sync_state(TaskSyncStatus::PendingPush, Some("abc123"), true);
        let point = TaskRecoveryPoint {
            kind: TaskRecoveryPointKind::PendingPush,
            commit_sha: "abc123".to_string(),
            retry_safe: true,
        };
        let mut inputs = ReconcileInputs::from_sync_state(&state);
        inputs.recovery_point = Some(&point);
        inputs.failure_class = FailureClass::Other;
        assert_eq!(
            decide_reconcile_action(&inputs),
            ReconcileAction::RetryPush {
                commit_sha: "abc123".to_string(),
                retry_safe: true,
            }
        );
    }
}
