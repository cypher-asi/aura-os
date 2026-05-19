//! Axum route surface for the dev-loop: hosts the cold-start, single-task, pause/resume/stop/status handlers, and re-exports the shared `emit_domain_event` helper for sibling modules.

mod common;
mod run_single;
mod start_loop;

use axum::extract::{Path, Query, State};
use axum::Json;

use aura_os_core::ProjectId;

use crate::dto::LoopStatusResponse;
use crate::error::ApiResult;
use crate::state::AppState;

use super::control::control_loop;
use super::registry::status_response;
use super::types::{ControlAction, LoopQueryParams};

pub(crate) use super::streaming::emit_domain_event;

pub(crate) use run_single::run_single_task;
pub(crate) use start_loop::start_loop;

pub(crate) async fn pause_loop(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
    Query(params): Query<LoopQueryParams>,
) -> ApiResult<Json<LoopStatusResponse>> {
    control_loop(
        &state,
        project_id,
        params.agent_instance_id,
        ControlAction::Pause,
    )
    .await
}

pub(crate) async fn stop_loop(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
    Query(params): Query<LoopQueryParams>,
) -> ApiResult<Json<LoopStatusResponse>> {
    control_loop(
        &state,
        project_id,
        params.agent_instance_id,
        ControlAction::Stop,
    )
    .await
}

pub(crate) async fn resume_loop(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
    Query(params): Query<LoopQueryParams>,
) -> ApiResult<Json<LoopStatusResponse>> {
    control_loop(
        &state,
        project_id,
        params.agent_instance_id,
        ControlAction::Resume,
    )
    .await
}

pub(crate) async fn get_loop_status(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<LoopStatusResponse>> {
    Ok(Json(status_response(&state, project_id, None).await))
}

#[cfg(test)]
mod orphan_recovery_tests {
    //! Section E regression: the loop-start orphan-recovery sweep must
    //! plan a `safe_transition(InProgress -> Ready)` for every task
    //! left mid-run by a previous loop. The pure planner is unit-tested
    //! in `aura_os_automation::resilience::orphan`; here we just pin
    //! the integration shape (the App-layer wrapper feeds the planner
    //! a real `Vec<Task>` and walks the resulting plans).

    use aura_os_automation::recover_orphans;
    use aura_os_core::{ProjectId, SpecId, Task, TaskId, TaskStatus};
    use chrono::Utc;

    fn task_in(status: TaskStatus) -> Task {
        let now = Utc::now();
        Task {
            task_id: TaskId::new(),
            project_id: ProjectId::new(),
            spec_id: SpecId::new(),
            title: String::new(),
            description: String::new(),
            status,
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

    #[test]
    fn loop_start_sweep_targets_only_in_progress_tasks() {
        let in_progress = task_in(TaskStatus::InProgress);
        let tasks = vec![
            task_in(TaskStatus::Ready),
            in_progress.clone(),
            task_in(TaskStatus::Done),
            task_in(TaskStatus::Failed),
        ];
        let plans = recover_orphans(&tasks);
        assert_eq!(
            plans.len(),
            1,
            "exactly one InProgress task should be planned for recovery",
        );
        let plan = plans[0];
        assert_eq!(plan.task_id, in_progress.task_id);
        assert_eq!(plan.current_status, TaskStatus::InProgress);
        assert_eq!(
            plan.target_status,
            TaskStatus::Ready,
            "Section E target: orphans return to Ready so the scheduler picks them up",
        );
    }

    #[test]
    fn loop_start_sweep_no_orphans_returns_empty_plan() {
        // No InProgress tasks → no plans, no transitions issued.
        let tasks = vec![
            task_in(TaskStatus::Ready),
            task_in(TaskStatus::Done),
            task_in(TaskStatus::Failed),
        ];
        assert!(recover_orphans(&tasks).is_empty());
    }
}
