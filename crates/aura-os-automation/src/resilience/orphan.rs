//! Loop-start orphan recovery (Section E).
//!
//! When the server restarts mid-loop, a task that was previously
//! `InProgress` is left stranded — no harness is still working on
//! it, but the storage row still claims it's running, so the task
//! scheduler skips it. [`recover_orphans`] computes the set of
//! tasks that need a `safe_transition` back to `Ready` so the next
//! scheduler tick picks them up again.
//!
//! Pure function. The App-layer caller is responsible for the
//! actual `aura_os_tasks::safe_transition` invocations.

use aura_os_core::{Task, TaskId, TaskStatus};

/// Stable static reason string the App-layer caller passes into
/// `safe_transition` (or logs alongside the transition) so the
/// resulting storage update is traceable to this recovery path.
pub const ORPHAN_RECOVERY_REASON: &str = "orphan recovery: loop killed mid-run";

/// One planned `safe_transition` the App layer should apply on
/// loop start.
///
/// Fields are public-by-value so callers can pattern-match without
/// going through accessors.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OrphanRecoveryPlan {
    /// Task that needs recovery.
    pub task_id: TaskId,
    /// Status the task is currently stuck in (always
    /// [`TaskStatus::InProgress`] in the v1 sweep — the field
    /// exists so callers can log the pre-transition state without
    /// re-querying storage).
    pub current_status: TaskStatus,
    /// Target status the caller should `safe_transition` to. Always
    /// [`TaskStatus::Ready`] in the v1 sweep.
    pub target_status: TaskStatus,
    /// Static reason string for telemetry and logs. Mirrors
    /// [`ORPHAN_RECOVERY_REASON`].
    pub reason: &'static str,
}

/// Compute the set of orphan-recovery plans for `tasks`.
///
/// Today's policy: every task observed in
/// [`TaskStatus::InProgress`] gets a plan to transition back to
/// [`TaskStatus::Ready`]. `Done`, `Failed`, `Blocked`, `Pending`,
/// `Ready`, `Backlog`, and `ToDo` are all left untouched — only
/// `InProgress` is the orphan signal (the scheduler picks `Ready`
/// tasks and pushes them into `InProgress` when it dispatches; a
/// stuck `Failed` task is handled by the task-level retry tracker,
/// not by orphan recovery).
///
/// An empty input slice returns an empty plan.
#[must_use]
pub fn recover_orphans(tasks: &[Task]) -> Vec<OrphanRecoveryPlan> {
    tasks
        .iter()
        .filter(|task| task.status == TaskStatus::InProgress)
        .map(|task| OrphanRecoveryPlan {
            task_id: task.task_id,
            current_status: task.status,
            target_status: TaskStatus::Ready,
            reason: ORPHAN_RECOVERY_REASON,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    use aura_os_core::{ProjectId, SpecId};
    use chrono::Utc;

    fn task_in(status: TaskStatus) -> Task {
        // Inlined fixture so the production-only Cargo deps stay
        // minimal: enabling `aura-os-core/test-utils` from this
        // crate's dev-dependencies would pull in `tempfile` for
        // every cargo test run even though the resilience suite
        // does not touch the filesystem.
        let now = Utc::now();
        Task {
            task_id: TaskId::new(),
            project_id: ProjectId::new(),
            spec_id: SpecId::new(),
            title: String::new(),
            description: String::new(),
            status,
            order_index: 0,
            dependency_ids: vec![],
            parent_task_id: None,
            skip_auto_decompose: false,
            assigned_agent_instance_id: None,
            completed_by_agent_instance_id: None,
            session_id: None,
            execution_notes: String::new(),
            files_changed: vec![],
            live_output: String::new(),
            build_steps: vec![],
            test_steps: vec![],
            user_id: None,
            model: None,
            total_input_tokens: 0,
            total_output_tokens: 0,
            created_at: now,
            updated_at: now,
        }
    }

    #[test]
    fn empty_input_returns_empty_plan() {
        assert!(recover_orphans(&[]).is_empty());
    }

    #[test]
    fn picks_only_in_progress_tasks() {
        let tasks = vec![
            task_in(TaskStatus::Pending),
            task_in(TaskStatus::Ready),
            task_in(TaskStatus::InProgress),
            task_in(TaskStatus::Done),
            task_in(TaskStatus::Failed),
            task_in(TaskStatus::Blocked),
        ];
        let plans = recover_orphans(&tasks);
        assert_eq!(
            plans.len(),
            1,
            "exactly one InProgress task must be recovered"
        );
        let plan = plans[0];
        assert_eq!(plan.current_status, TaskStatus::InProgress);
        assert_eq!(plan.target_status, TaskStatus::Ready);
        assert_eq!(plan.reason, ORPHAN_RECOVERY_REASON);
    }

    #[test]
    fn returns_one_plan_per_orphan() {
        let tasks = vec![
            task_in(TaskStatus::InProgress),
            task_in(TaskStatus::InProgress),
            task_in(TaskStatus::Done),
            task_in(TaskStatus::InProgress),
        ];
        let plans = recover_orphans(&tasks);
        assert_eq!(plans.len(), 3, "every InProgress task gets its own plan");
        for plan in &plans {
            assert_eq!(plan.target_status, TaskStatus::Ready);
        }
    }

    #[test]
    fn ignores_backlog_and_todo_states_too() {
        let tasks = vec![task_in(TaskStatus::Backlog), task_in(TaskStatus::ToDo)];
        assert!(recover_orphans(&tasks).is_empty());
    }
}
