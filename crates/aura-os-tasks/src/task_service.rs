use aura_os_core::*;
use aura_os_storage::TransitionTaskRequest as StorageTransitionReq;

use crate::error::TaskError;
use crate::TaskService;

mod dependencies;
mod selection;

#[derive(Debug, Clone, Copy)]
pub struct AssignTaskParams {
    pub project_id: ProjectId,
    pub spec_id: SpecId,
    pub task_id: TaskId,
    pub agent_instance_id: AgentInstanceId,
    pub session_id: Option<SessionId>,
}

#[derive(Debug)]
pub struct CompleteTaskParams {
    pub project_id: ProjectId,
    pub spec_id: SpecId,
    pub task_id: TaskId,
    pub notes: String,
    pub files_changed: Vec<FileChangeSummary>,
}

fn task_status_str(s: TaskStatus) -> String {
    serde_json::to_value(s)
        .ok()
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_else(|| "pending".to_string())
}

impl TaskService {
    // ------------------------------------------------------------------
    // Transition (async, always via StorageClient)
    // ------------------------------------------------------------------

    pub async fn transition_task(
        &self,
        _project_id: &ProjectId,
        _spec_id: &SpecId,
        task_id: &TaskId,
        new_status: TaskStatus,
    ) -> Result<Task, TaskError> {
        let storage = self.require_storage()?;
        let jwt = self.get_jwt()?;
        storage
            .transition_task(
                &task_id.to_string(),
                &jwt,
                &StorageTransitionReq {
                    status: task_status_str(new_status),
                },
            )
            .await?;
        let st = storage.get_task(&task_id.to_string(), &jwt).await?;
        crate::storage_task_to_task(st).map_err(TaskError::ParseError)
    }

    /// Checks whether `current -> target` is a **direct** legal edge. This
    /// mirrors aura-storage's own `validate_transition`
    /// (`aura-storage/crates/domain/tasks/src/repo.rs`): storage is the
    /// source of truth and rejects any target we pass to
    /// `POST /api/tasks/:id/transition` that isn't in this list.
    ///
    /// For **non-adjacent** transitions (e.g. `ready -> failed`,
    /// `in_progress -> ready`, `failed -> in_progress`) prefer
    /// [`crate::safe_transition`], which reads the current state and
    /// walks the necessary hop sequence. Extending this list with a
    /// bridge edge would re-introduce the class of bug where
    /// aura-os-server validated "OK" and storage then returned 400.
    ///
    /// The `Backlog`/`ToDo` edges in aura-os's state machine are
    /// validated locally but are not persisted by storage (not in the
    /// `tasks.status` CHECK constraint); callers must translate those
    /// states before hitting storage.
    pub fn validate_transition(current: TaskStatus, target: TaskStatus) -> Result<(), TaskError> {
        let legal = matches!(
            (current, target),
            // Storage-enforced direct edges (must stay in sync with
            // aura-storage repo.rs::validate_transition).
            (TaskStatus::Pending, TaskStatus::Ready)
                | (TaskStatus::Ready, TaskStatus::InProgress)
                | (TaskStatus::InProgress, TaskStatus::Done)
                | (TaskStatus::InProgress, TaskStatus::Failed)
                | (TaskStatus::InProgress, TaskStatus::Blocked)
                | (TaskStatus::Failed, TaskStatus::Ready)
                | (TaskStatus::Blocked, TaskStatus::Ready)
                // aura-os-only edges on Backlog/ToDo. Storage does not
                // persist these statuses; they only appear in-process
                // when the planner promotes tasks, before anything
                // calls storage.transition_task.
                | (TaskStatus::Backlog, TaskStatus::ToDo)
                | (TaskStatus::Backlog, TaskStatus::Pending)
                | (TaskStatus::ToDo, TaskStatus::Pending)
                | (TaskStatus::ToDo, TaskStatus::Backlog)
                | (TaskStatus::Pending, TaskStatus::ToDo)
                | (TaskStatus::Pending, TaskStatus::Backlog)
        );
        if legal {
            Ok(())
        } else {
            Err(TaskError::IllegalTransition { current, target })
        }
    }

    /// Resets a task to ready so it can be picked up again.
    ///
    /// Delegates to [`crate::safe_transition`], which bridges through the
    /// intermediate hops that aura-storage requires (e.g. `in_progress ->
    /// failed -> ready`; a direct `in_progress -> ready` is a 400).
    pub async fn reset_task_to_ready(
        &self,
        _project_id: &ProjectId,
        _spec_id: &SpecId,
        task_id: &TaskId,
    ) -> Result<Task, TaskError> {
        let storage = self.require_storage()?;
        let jwt = self.get_jwt()?;
        crate::safe_transition(storage, &jwt, &task_id.to_string(), TaskStatus::Ready).await
    }

    /// Resets all in-progress tasks to ready (e.g. after restart or loop error).
    ///
    /// Each reset goes through [`crate::safe_transition`] which walks
    /// `in_progress -> failed -> ready` under storage's rules.
    pub async fn reset_in_progress_tasks(
        &self,
        project_id: &ProjectId,
    ) -> Result<Vec<Task>, TaskError> {
        let storage = self.require_storage()?;
        let jwt = self.get_jwt()?;
        let all_tasks = self.list_tasks(project_id).await?;
        let mut reset = Vec::new();
        for task in &all_tasks {
            if task.status == TaskStatus::InProgress {
                let ready_task = crate::safe_transition(
                    storage,
                    &jwt,
                    &task.task_id.to_string(),
                    TaskStatus::Ready,
                )
                .await?;
                reset.push(ready_task);
            }
        }
        Ok(reset)
    }

    pub async fn assign_task(&self, params: AssignTaskParams) -> Result<Task, TaskError> {
        let AssignTaskParams {
            project_id,
            spec_id,
            task_id,
            agent_instance_id,
            session_id,
        } = params;
        let mut task = self
            .transition_task(&project_id, &spec_id, &task_id, TaskStatus::InProgress)
            .await?;
        task.assigned_agent_instance_id = Some(agent_instance_id);
        task.session_id = session_id;

        if let Ok(storage) = self.require_storage() {
            if let Ok(jwt) = self.get_jwt() {
                let update = aura_os_storage::UpdateTaskRequest {
                    title: None,
                    description: None,
                    order_index: None,
                    dependency_ids: None,
                    execution_notes: None,
                    files_changed: None,
                    model: None,
                    total_input_tokens: None,
                    total_output_tokens: None,
                    session_id: session_id.map(|s| s.to_string()),
                    assigned_project_agent_id: Some(agent_instance_id.to_string()),
                };
                if let Err(e) = storage
                    .update_task(&task_id.to_string(), &jwt, &update)
                    .await
                {
                    tracing::warn!(
                        task_id = %task_id,
                        error = %e,
                        "failed to persist session_id on task assignment"
                    );
                }
            }
        }

        Ok(task)
    }

    pub async fn complete_task(&self, params: CompleteTaskParams) -> Result<Task, TaskError> {
        let CompleteTaskParams {
            project_id,
            spec_id,
            task_id,
            notes,
            files_changed,
        } = params;
        let mut task = self
            .transition_task(&project_id, &spec_id, &task_id, TaskStatus::Done)
            .await?;
        task.completed_by_agent_instance_id = task.assigned_agent_instance_id;
        task.execution_notes = notes;
        task.files_changed = files_changed;

        let storage = self.require_storage()?;
        let jwt = self.get_jwt()?;
        let storage_files_changed: Vec<aura_os_storage::StorageTaskFileChangeSummary> = task
            .files_changed
            .iter()
            .map(|fc| aura_os_storage::StorageTaskFileChangeSummary {
                op: fc.op.clone(),
                path: fc.path.clone(),
                lines_added: fc.lines_added,
                lines_removed: fc.lines_removed,
            })
            .collect();
        let update = aura_os_storage::UpdateTaskRequest {
            execution_notes: Some(task.execution_notes.clone()),
            files_changed: Some(storage_files_changed),
            ..Default::default()
        };
        storage
            .update_task(&task_id.to_string(), &jwt, &update)
            .await?;

        Ok(task)
    }

    pub async fn fail_task(
        &self,
        project_id: &ProjectId,
        spec_id: &SpecId,
        task_id: &TaskId,
        reason: &str,
    ) -> Result<Task, TaskError> {
        let mut task = self
            .transition_task(project_id, spec_id, task_id, TaskStatus::Failed)
            .await?;
        task.execution_notes = reason.to_string();

        let storage = self.require_storage()?;
        let jwt = self.get_jwt()?;
        let update = aura_os_storage::UpdateTaskRequest {
            execution_notes: Some(task.execution_notes.clone()),
            ..Default::default()
        };
        storage
            .update_task(&task_id.to_string(), &jwt, &update)
            .await?;

        Ok(task)
    }

    pub async fn retry_task(
        &self,
        _project_id: &ProjectId,
        _spec_id: &SpecId,
        task_id: &TaskId,
    ) -> Result<Task, TaskError> {
        // `safe_transition` short-circuits when already at Ready and
        // correctly bridges `in_progress -> failed -> ready` for the
        // common case where the automaton died mid-task and left the
        // row in `in_progress`. A direct `transition_task(Ready)` would
        // 400 at storage for that state.
        let storage = self.require_storage()?;
        let jwt = self.get_jwt()?;
        crate::safe_transition(storage, &jwt, &task_id.to_string(), TaskStatus::Ready).await
    }

    // -- Follow-up task creation --

    pub async fn create_follow_up_task(
        &self,
        originating_task: &Task,
        title: String,
        description: String,
        dependency_ids: Vec<TaskId>,
    ) -> Result<Task, TaskError> {
        let storage = self.require_storage()?;
        let jwt = self.get_jwt()?;
        let pid = originating_task.project_id.to_string();

        let existing = storage.list_tasks(&pid, &jwt).await?;
        let norm_title = title.trim().to_lowercase();
        if existing
            .iter()
            .any(|t| t.title.as_deref().unwrap_or("").trim().to_lowercase() == norm_title)
        {
            return Err(TaskError::DuplicateFollowUp);
        }

        let status = if dependency_ids.is_empty() {
            "ready"
        } else {
            "pending"
        };
        let dep_ids: Vec<String> = dependency_ids.iter().map(|d| d.to_string()).collect();

        let req = aura_os_storage::CreateTaskRequest {
            spec_id: originating_task.spec_id.to_string(),
            title: title.clone(),
            org_id: None,
            description: Some(description),
            status: Some(status.to_string()),
            order_index: Some((originating_task.order_index + 1) as i32),
            dependency_ids: if dep_ids.is_empty() {
                None
            } else {
                Some(dep_ids)
            },
            assigned_project_agent_id: None,
        };
        let created = storage.create_task(&pid, &jwt, &req).await?;
        crate::storage_task_to_task(created).map_err(TaskError::ParseError)
    }
}
