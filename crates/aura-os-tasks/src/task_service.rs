use std::collections::{HashMap, HashSet, VecDeque};

use aura_os_core::*;
use aura_os_storage::TransitionTaskRequest as StorageTransitionReq;

use crate::error::TaskError;
use crate::TaskService;

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

    pub fn validate_transition(current: TaskStatus, target: TaskStatus) -> Result<(), TaskError> {
        let legal = matches!(
            (current, target),
            (TaskStatus::Backlog, TaskStatus::ToDo)
                | (TaskStatus::Backlog, TaskStatus::Pending)
                | (TaskStatus::ToDo, TaskStatus::Pending)
                | (TaskStatus::ToDo, TaskStatus::Backlog)
                | (TaskStatus::Pending, TaskStatus::ToDo)
                | (TaskStatus::Pending, TaskStatus::Backlog)
                | (TaskStatus::Pending, TaskStatus::Ready)
                | (TaskStatus::Ready, TaskStatus::InProgress)
                | (TaskStatus::InProgress, TaskStatus::Done)
                | (TaskStatus::InProgress, TaskStatus::Failed)
                | (TaskStatus::InProgress, TaskStatus::Blocked)
                | (TaskStatus::InProgress, TaskStatus::Ready)
                | (TaskStatus::Failed, TaskStatus::Ready)
                | (TaskStatus::Failed, TaskStatus::InProgress)
                | (TaskStatus::Blocked, TaskStatus::Ready)
        );
        if legal {
            Ok(())
        } else {
            Err(TaskError::IllegalTransition { current, target })
        }
    }

    /// Resets a task to ready so it can be picked up again. Uses two-step transition
    /// (in_progress → failed → ready) when the task is in progress, because aura-storage
    /// does not allow a direct in_progress → ready transition.
    pub async fn reset_task_to_ready(
        &self,
        project_id: &ProjectId,
        spec_id: &SpecId,
        task_id: &TaskId,
    ) -> Result<Task, TaskError> {
        let current = self.get_task(project_id, spec_id, task_id).await?;
        if current.status == TaskStatus::InProgress {
            self.transition_task(project_id, spec_id, task_id, TaskStatus::Failed)
                .await?;
        }
        self.transition_task(project_id, spec_id, task_id, TaskStatus::Ready)
            .await
    }

    /// Resets all in-progress tasks to ready (e.g. after restart or loop error). Uses
    /// two-step transition (in_progress → failed → ready) because aura-storage does
    /// not allow a direct in_progress → ready transition.
    pub async fn reset_in_progress_tasks(
        &self,
        project_id: &ProjectId,
    ) -> Result<Vec<Task>, TaskError> {
        let all_tasks = self.list_tasks(project_id).await?;
        let mut reset = Vec::new();
        for task in &all_tasks {
            if task.status == TaskStatus::InProgress {
                self.transition_task(project_id, &task.spec_id, &task.task_id, TaskStatus::Failed)
                    .await?;
                let ready_task = self
                    .transition_task(project_id, &task.spec_id, &task.task_id, TaskStatus::Ready)
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
        Ok(task)
    }

    pub async fn retry_task(
        &self,
        project_id: &ProjectId,
        spec_id: &SpecId,
        task_id: &TaskId,
    ) -> Result<Task, TaskError> {
        let task = self.get_task(project_id, spec_id, task_id).await?;
        if task.status == TaskStatus::Ready {
            return Ok(task);
        }
        self.transition_task(project_id, spec_id, task_id, TaskStatus::Ready)
            .await
    }

    // -- Dependency resolution --

    pub async fn resolve_dependencies_after_completion(
        &self,
        project_id: &ProjectId,
        completed_task_id: &TaskId,
    ) -> Result<Vec<Task>, TaskError> {
        let all_tasks = self.list_tasks(project_id).await?;
        self.resolve_dependencies_with_tasks(project_id, completed_task_id, &all_tasks)
            .await
    }

    pub async fn resolve_dependencies_with_tasks(
        &self,
        project_id: &ProjectId,
        completed_task_id: &TaskId,
        all_tasks: &[Task],
    ) -> Result<Vec<Task>, TaskError> {
        let mut newly_ready = Vec::new();
        for task in all_tasks {
            if task.status != TaskStatus::Pending {
                continue;
            }
            if !task.dependency_ids.contains(completed_task_id) {
                continue;
            }
            let all_deps_done = task.dependency_ids.iter().all(|dep_id| {
                all_tasks
                    .iter()
                    .find(|t| &t.task_id == dep_id)
                    .is_some_and(|t| t.status == TaskStatus::Done)
            });
            if all_deps_done {
                let ready_task = self
                    .transition_task(project_id, &task.spec_id, &task.task_id, TaskStatus::Ready)
                    .await?;
                newly_ready.push(ready_task);
            }
        }
        Ok(newly_ready)
    }

    pub fn detect_cycles(tasks: &[Task]) -> Result<(), TaskError> {
        let task_ids: HashSet<TaskId> = tasks.iter().map(|t| t.task_id).collect();
        let mut in_degree: HashMap<TaskId, usize> = HashMap::new();
        let mut adj: HashMap<TaskId, Vec<TaskId>> = HashMap::new();

        for task in tasks {
            in_degree.entry(task.task_id).or_insert(0);
            adj.entry(task.task_id).or_default();
            for dep_id in &task.dependency_ids {
                if task_ids.contains(dep_id) {
                    adj.entry(*dep_id).or_default().push(task.task_id);
                    *in_degree.entry(task.task_id).or_insert(0) += 1;
                }
            }
        }

        let mut queue: VecDeque<TaskId> = in_degree
            .iter()
            .filter(|(_, &deg)| deg == 0)
            .map(|(&id, _)| id)
            .collect();

        let mut sorted_count = 0;

        while let Some(node) = queue.pop_front() {
            sorted_count += 1;
            if let Some(neighbors) = adj.get(&node) {
                for &neighbor in neighbors {
                    if let Some(deg) = in_degree.get_mut(&neighbor) {
                        *deg -= 1;
                        if *deg == 0 {
                            queue.push_back(neighbor);
                        }
                    }
                }
            }
        }

        if sorted_count < task_ids.len() {
            Err(TaskError::CycleDetected)
        } else {
            Ok(())
        }
    }

    pub async fn resolve_initial_readiness(
        &self,
        project_id: &ProjectId,
    ) -> Result<Vec<Task>, TaskError> {
        let all_tasks = self.list_tasks(project_id).await?;
        let done_ids: HashSet<TaskId> = all_tasks
            .iter()
            .filter(|t| t.status == TaskStatus::Done)
            .map(|t| t.task_id)
            .collect();

        let mut promoted = Vec::new();
        for task in &all_tasks {
            if task.status != TaskStatus::Pending {
                continue;
            }
            let deps_satisfied = task.dependency_ids.is_empty()
                || task.dependency_ids.iter().all(|d| done_ids.contains(d));
            if deps_satisfied {
                let ready_task = self
                    .transition_task(project_id, &task.spec_id, &task.task_id, TaskStatus::Ready)
                    .await?;
                promoted.push(ready_task);
            }
        }
        Ok(promoted)
    }

    // -- Next-task selection --

    pub async fn select_next_task(
        &self,
        project_id: &ProjectId,
    ) -> Result<Option<Task>, TaskError> {
        let all_tasks = self.list_tasks(project_id).await?;
        self.select_next_task_from(project_id, &all_tasks).await
    }

    pub async fn select_next_task_from(
        &self,
        project_id: &ProjectId,
        all_tasks: &[Task],
    ) -> Result<Option<Task>, TaskError> {
        let storage = self.require_storage()?;
        let jwt = self.get_jwt()?;
        let storage_specs = storage.list_specs(&project_id.to_string(), &jwt).await?;
        let specs: HashMap<SpecId, u32> = storage_specs
            .into_iter()
            .filter_map(|s| {
                let sid: SpecId = s.id.parse().ok()?;
                let title_order = s
                    .title
                    .as_deref()
                    .and_then(|t| t.trim().split(':').next())
                    .and_then(|p| p.trim().parse::<u32>().ok());
                Some((
                    sid,
                    title_order.unwrap_or(s.order_index.unwrap_or(0) as u32),
                ))
            })
            .collect();

        let mut ready: Vec<&Task> = all_tasks
            .iter()
            .filter(|t| t.status == TaskStatus::Ready)
            .collect();

        ready.sort_by(|a, b| {
            let spec_ord_a = specs.get(&a.spec_id).copied().unwrap_or(u32::MAX);
            let spec_ord_b = specs.get(&b.spec_id).copied().unwrap_or(u32::MAX);
            spec_ord_a
                .cmp(&spec_ord_b)
                .then(a.order_index.cmp(&b.order_index))
        });

        if let Some(task) = ready.first() {
            return Ok(Some((*task).clone()));
        }

        // Auto-promote: when the pipeline is empty (no Ready, InProgress, or
        // Blocked tasks), pick the next ToDo task and promote it through
        // ToDo -> Pending -> Ready so the automation loop can execute it.
        let pipeline_active = all_tasks.iter().any(|t| {
            matches!(
                t.status,
                TaskStatus::Ready | TaskStatus::InProgress | TaskStatus::Blocked
            )
        });

        if pipeline_active {
            return Ok(None);
        }

        let mut todo: Vec<&Task> = all_tasks
            .iter()
            .filter(|t| t.status == TaskStatus::ToDo)
            .collect();

        todo.sort_by(|a, b| {
            let spec_ord_a = specs.get(&a.spec_id).copied().unwrap_or(u32::MAX);
            let spec_ord_b = specs.get(&b.spec_id).copied().unwrap_or(u32::MAX);
            spec_ord_a
                .cmp(&spec_ord_b)
                .then(a.order_index.cmp(&b.order_index))
        });

        if let Some(candidate) = todo.first() {
            let tid = &candidate.task_id;
            let sid = &candidate.spec_id;
            self.transition_task(project_id, sid, tid, TaskStatus::Pending)
                .await?;
            let promoted = self
                .transition_task(project_id, sid, tid, TaskStatus::Ready)
                .await?;
            return Ok(Some(promoted));
        }

        Ok(None)
    }

    pub async fn claim_next_task(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
        session_id: Option<SessionId>,
    ) -> Result<Option<Task>, TaskError> {
        let lock = self.project_claim_lock(project_id).await;
        let _guard = lock.lock().await;

        let all_tasks = self.list_tasks(project_id).await?;
        let task = self.select_next_task_from(project_id, &all_tasks).await?;
        match task {
            Some(t) => {
                let assigned = self
                    .assign_task(AssignTaskParams {
                        project_id: *project_id,
                        spec_id: t.spec_id,
                        task_id: t.task_id,
                        agent_instance_id: *agent_instance_id,
                        session_id,
                    })
                    .await?;
                Ok(Some(assigned))
            }
            None => Ok(None),
        }
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
        };
        let created = storage.create_task(&pid, &jwt, &req).await?;
        crate::storage_task_to_task(created).map_err(TaskError::ParseError)
    }
}
