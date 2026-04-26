use aura_os_harness::signals::{HarnessFailureKind, HarnessSignal};

use crate::sync_state::{TaskRecoveryPoint, TaskSyncState, TaskSyncStatus};

mod wire;

pub const DEFAULT_MAX_RETRIES_PER_TASK: u32 = 3;

#[derive(Clone, Debug)]
pub struct ReconcileInputs<'a> {
    pub sync_state: &'a TaskSyncState,
    pub recovery_point: Option<&'a TaskRecoveryPoint>,
    pub latest_signal: Option<&'a HarnessSignal>,
    pub retry_count: u32,
    pub max_retries: u32,
    pub has_live_automaton: bool,
    pub auto_decompose_disabled: bool,
    /// True when the dev-loop accumulated at least one successful
    /// test-runner invocation (cargo test / pnpm vitest / pytest /
    /// ...) for this task. The "tests-as-truth" gate uses this to
    /// override a `CompletionContract` failure into a successful
    /// no-edit completion: passing tests are themselves verification.
    pub has_test_pass_evidence: bool,
}

impl<'a> ReconcileInputs<'a> {
    pub fn from_sync_state(sync_state: &'a TaskSyncState) -> Self {
        Self {
            sync_state,
            recovery_point: None,
            latest_signal: None,
            retry_count: 0,
            max_retries: DEFAULT_MAX_RETRIES_PER_TASK,
            has_live_automaton: false,
            auto_decompose_disabled: false,
            has_test_pass_evidence: false,
        }
    }

    fn retry_budget_remaining(&self) -> bool {
        self.retry_count < self.max_retries
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ReconcileAction {
    AdoptRun,
    RetryPush {
        commit_sha: String,
        retry_safe: bool,
    },
    RetryTask,
    Decompose,
    MarkTerminal {
        reason: TerminalReason,
    },
    /// Tests-as-truth: the harness reported a `CompletionContract`
    /// failure (no file edits, no `no_changes_needed: true`) but the
    /// dev-loop accumulated successful test-runner evidence during the
    /// run, so the task is bridged to `Done` instead of failing.
    MarkDone {
        reason: DoneReason,
    },
    Noop,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TerminalReason {
    RetryBudgetExhausted,
    RateLimited,
    CommitFailed,
    DecomposeDisabled,
    CompletionContract,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DoneReason {
    /// Successful test-runner invocation observed during the run; a
    /// `task_done` without file edits is accepted as a valid no-op
    /// completion.
    TestEvidenceAccepted,
}

pub fn decide_reconcile_action(inputs: &ReconcileInputs<'_>) -> ReconcileAction {
    if inputs.has_live_automaton {
        return ReconcileAction::AdoptRun;
    }

    if let Some(point) = inputs.recovery_point.filter(|point| point.retry_safe) {
        return retry_push(point.commit_sha.clone());
    }

    if matches!(
        inputs.sync_state.status,
        TaskSyncStatus::PendingPush | TaskSyncStatus::PushFailed
    ) && inputs.sync_state.retry_safe
    {
        if let Some(commit_sha) = inputs.sync_state.last_commit_sha.clone() {
            return retry_push(commit_sha);
        }
    }

    if inputs.sync_state.status == TaskSyncStatus::CommitFailed && !inputs.sync_state.retry_safe {
        return ReconcileAction::MarkTerminal {
            reason: TerminalReason::CommitFailed,
        };
    }

    let Some(failure) = inputs.latest_signal.and_then(HarnessSignal::failure_kind) else {
        return ReconcileAction::Noop;
    };

    match failure {
        HarnessFailureKind::RateLimited => ReconcileAction::MarkTerminal {
            reason: TerminalReason::RateLimited,
        },
        HarnessFailureKind::Truncation => {
            if inputs.auto_decompose_disabled {
                ReconcileAction::MarkTerminal {
                    reason: TerminalReason::DecomposeDisabled,
                }
            } else if inputs.retry_budget_remaining() {
                ReconcileAction::Decompose
            } else {
                budget_exhausted()
            }
        }
        HarnessFailureKind::CompletionContract => {
            if inputs.has_test_pass_evidence {
                ReconcileAction::MarkDone {
                    reason: DoneReason::TestEvidenceAccepted,
                }
            } else {
                ReconcileAction::MarkTerminal {
                    reason: TerminalReason::CompletionContract,
                }
            }
        }
        HarnessFailureKind::PushTimeout | HarnessFailureKind::Other => {
            if inputs.retry_budget_remaining() {
                ReconcileAction::RetryTask
            } else {
                budget_exhausted()
            }
        }
    }
}

fn budget_exhausted() -> ReconcileAction {
    ReconcileAction::MarkTerminal {
        reason: TerminalReason::RetryBudgetExhausted,
    }
}

fn retry_push(commit_sha: String) -> ReconcileAction {
    ReconcileAction::RetryPush {
        commit_sha,
        retry_safe: true,
    }
}
