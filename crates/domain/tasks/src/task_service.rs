use std::collections::{HashMap, HashSet, VecDeque};

use chrono::Utc;

use aura_core::*;

use crate::error::TaskError;
use crate::TaskService;

impl TaskService {
    pub fn transition_task(
        &self,
        project_id: &ProjectId,
        spec_id: &SpecId,
        task_id: &TaskId,
        new_status: TaskStatus,
    ) -> Result<Task, TaskError> {
        let _guard = self.store.lock_task_writes();
        let mut task = self
            .store
            .get_task(project_id, spec_id, task_id)
            .map_err(|e| match e {
                aura_store::StoreError::NotFound(_) => TaskError::NotFound,
                other => TaskError::Store(other),
            })?;
        Self::validate_transition(task.status, new_status)?;
        task.status = new_status;
        task.updated_at = Utc::now();
        self.store.put_task(&task)?;
        Ok(task)
    }

    pub fn validate_transition(current: TaskStatus, target: TaskStatus) -> Result<(), TaskError> {
        let legal = matches!(
            (current, target),
            (TaskStatus::Pending, TaskStatus::Ready)
                | (TaskStatus::Ready, TaskStatus::InProgress)
                | (TaskStatus::InProgress, TaskStatus::Done)
                | (TaskStatus::InProgress, TaskStatus::Failed)
                | (TaskStatus::InProgress, TaskStatus::Blocked)
                | (TaskStatus::InProgress, TaskStatus::Ready)
                | (TaskStatus::Failed, TaskStatus::Ready)
                | (TaskStatus::Blocked, TaskStatus::Ready)
                | (TaskStatus::Done, TaskStatus::Ready)
        );
        if legal {
            Ok(())
        } else {
            Err(TaskError::IllegalTransition { current, target })
        }
    }

    /// Reset a single in-progress task back to `Ready`, clearing its agent
    /// assignment. Used when a task is interrupted by pause/stop mid-execution.
    pub fn reset_task_to_ready(
        &self,
        project_id: &ProjectId,
        spec_id: &SpecId,
        task_id: &TaskId,
    ) -> Result<Task, TaskError> {
        let _guard = self.store.lock_task_writes();
        let mut task = self
            .store
            .get_task(project_id, spec_id, task_id)
            .map_err(|e| match e {
                aura_store::StoreError::NotFound(_) => TaskError::NotFound,
                other => TaskError::Store(other),
            })?;
        Self::validate_transition(task.status, TaskStatus::Ready)?;
        task.status = TaskStatus::Ready;
        task.assigned_agent_instance_id = None;
        task.session_id = None;
        task.updated_at = Utc::now();
        self.store.put_task(&task)?;
        Ok(task)
    }

    /// Reset any orphaned `InProgress` tasks back to `Ready`.
    /// Called on loop start to recover from crashes or unclean shutdowns.
    pub fn reset_in_progress_tasks(&self, project_id: &ProjectId) -> Result<Vec<Task>, TaskError> {
        let all_tasks = self.store.list_tasks_by_project(project_id)?;
        let mut reset = Vec::new();
        for task in &all_tasks {
            if task.status == TaskStatus::InProgress {
                let ready_task = self.transition_task(
                    project_id,
                    &task.spec_id,
                    &task.task_id,
                    TaskStatus::Ready,
                )?;
                reset.push(ready_task);
            }
        }
        Ok(reset)
    }

    pub fn assign_task(
        &self,
        project_id: &ProjectId,
        spec_id: &SpecId,
        task_id: &TaskId,
        agent_instance_id: &AgentInstanceId,
        session_id: Option<SessionId>,
    ) -> Result<Task, TaskError> {
        let _guard = self.store.lock_task_writes();
        let mut task = self
            .store
            .get_task(project_id, spec_id, task_id)
            .map_err(|e| match e {
                aura_store::StoreError::NotFound(_) => TaskError::NotFound,
                other => TaskError::Store(other),
            })?;
        Self::validate_transition(task.status, TaskStatus::InProgress)?;
        task.status = TaskStatus::InProgress;
        task.assigned_agent_instance_id = Some(*agent_instance_id);
        task.session_id = session_id;
        task.updated_at = Utc::now();
        self.store.put_task(&task)?;
        Ok(task)
    }

    pub fn complete_task(
        &self,
        project_id: &ProjectId,
        spec_id: &SpecId,
        task_id: &TaskId,
        notes: &str,
        files_changed: Vec<FileChangeSummary>,
    ) -> Result<Task, TaskError> {
        let _guard = self.store.lock_task_writes();
        let mut task = self
            .store
            .get_task(project_id, spec_id, task_id)
            .map_err(|e| match e {
                aura_store::StoreError::NotFound(_) => TaskError::NotFound,
                other => TaskError::Store(other),
            })?;
        Self::validate_transition(task.status, TaskStatus::Done)?;
        task.status = TaskStatus::Done;
        task.completed_by_agent_instance_id = task.assigned_agent_instance_id;
        task.execution_notes = notes.to_string();
        task.files_changed = files_changed;
        task.updated_at = Utc::now();
        self.store.put_task(&task)?;
        Ok(task)
    }

    pub fn fail_task(
        &self,
        project_id: &ProjectId,
        spec_id: &SpecId,
        task_id: &TaskId,
        reason: &str,
    ) -> Result<Task, TaskError> {
        let _guard = self.store.lock_task_writes();
        let mut task = self
            .store
            .get_task(project_id, spec_id, task_id)
            .map_err(|e| match e {
                aura_store::StoreError::NotFound(_) => TaskError::NotFound,
                other => TaskError::Store(other),
            })?;
        Self::validate_transition(task.status, TaskStatus::Failed)?;
        task.status = TaskStatus::Failed;
        task.execution_notes = reason.to_string();
        task.updated_at = Utc::now();
        self.store.put_task(&task)?;
        Ok(task)
    }

    pub fn retry_task(
        &self,
        project_id: &ProjectId,
        spec_id: &SpecId,
        task_id: &TaskId,
    ) -> Result<Task, TaskError> {
        let _guard = self.store.lock_task_writes();
        let mut task = self
            .store
            .get_task(project_id, spec_id, task_id)
            .map_err(|e| match e {
                aura_store::StoreError::NotFound(_) => TaskError::NotFound,
                other => TaskError::Store(other),
            })?;

        if task.status == TaskStatus::Ready {
            return Ok(task);
        }

        Self::validate_transition(task.status, TaskStatus::Ready)?;
        task.status = TaskStatus::Ready;
        task.assigned_agent_instance_id = None;
        task.session_id = None;
        task.build_steps.clear();
        task.test_steps.clear();
        task.live_output.clear();
        task.updated_at = Utc::now();
        self.store.put_task(&task)?;
        Ok(task)
    }

    // -- Dependency resolution --

    pub fn resolve_dependencies_after_completion(
        &self,
        project_id: &ProjectId,
        completed_task_id: &TaskId,
    ) -> Result<Vec<Task>, TaskError> {
        let all_tasks = self.store.list_tasks_by_project(project_id)?;
        let mut newly_ready = Vec::new();

        for task in &all_tasks {
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
                let ready_task = self.transition_task(
                    project_id,
                    &task.spec_id,
                    &task.task_id,
                    TaskStatus::Ready,
                )?;
                newly_ready.push(ready_task);
            }
        }
        Ok(newly_ready)
    }

    /// Detect cycles using Kahn's algorithm. Returns error if a cycle exists.
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

    /// Promote any Pending tasks with no (or all-done) dependencies to Ready.
    /// Called at loop start to fix tasks that were stored as Pending without
    /// an initial readiness pass.
    pub fn resolve_initial_readiness(&self, project_id: &ProjectId) -> Result<Vec<Task>, TaskError> {
        let all_tasks = self.store.list_tasks_by_project(project_id)?;
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
                let ready_task = self.transition_task(
                    project_id,
                    &task.spec_id,
                    &task.task_id,
                    TaskStatus::Ready,
                )?;
                promoted.push(ready_task);
            }
        }
        Ok(promoted)
    }

    // -- Next-task selection --

    pub fn select_next_task(&self, project_id: &ProjectId) -> Result<Option<Task>, TaskError> {
        let all_tasks = self.store.list_tasks_by_project(project_id)?;
        let specs = self.store.list_specs_by_project(project_id)?;

        let spec_order: HashMap<SpecId, u32> =
            specs.iter().map(|s| (s.spec_id, s.order_index)).collect();

        let mut ready: Vec<&Task> = all_tasks
            .iter()
            .filter(|t| t.status == TaskStatus::Ready)
            .collect();

        ready.sort_by(|a, b| {
            let spec_ord_a = spec_order.get(&a.spec_id).copied().unwrap_or(u32::MAX);
            let spec_ord_b = spec_order.get(&b.spec_id).copied().unwrap_or(u32::MAX);
            spec_ord_a
                .cmp(&spec_ord_b)
                .then(a.order_index.cmp(&b.order_index))
        });

        Ok(ready.first().cloned().cloned())
    }

    /// Atomically select the next ready task and assign it to an agent.
    /// Uses a per-project mutex so two agents can never claim the same task.
    pub fn claim_next_task(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
        session_id: Option<SessionId>,
    ) -> Result<Option<Task>, TaskError> {
        let lock = self.project_claim_lock(project_id);
        let _guard = lock.lock().unwrap();

        let task = self.select_next_task(project_id)?;
        match task {
            Some(t) => {
                let assigned = self.assign_task(project_id, &t.spec_id, &t.task_id, agent_instance_id, session_id)?;
                Ok(Some(assigned))
            }
            None => Ok(None),
        }
    }

    // -- Follow-up task creation --

    pub fn create_follow_up_task(
        &self,
        originating_task: &Task,
        title: String,
        description: String,
        dependency_ids: Vec<TaskId>,
    ) -> Result<Task, TaskError> {
        let existing = self
            .store
            .list_tasks_by_spec(&originating_task.project_id, &originating_task.spec_id)?;
        let norm_title = title.trim().to_lowercase();
        if existing.iter().any(|t| t.title.trim().to_lowercase() == norm_title) {
            return Err(TaskError::DuplicateFollowUp);
        }

        let now = Utc::now();
        let task = Task {
            task_id: TaskId::new(),
            project_id: originating_task.project_id,
            spec_id: originating_task.spec_id,
            title,
            description,
            status: if dependency_ids.is_empty() {
                TaskStatus::Ready
            } else {
                TaskStatus::Pending
            },
            order_index: originating_task.order_index + 1,
            dependency_ids,
            parent_task_id: Some(originating_task.task_id),
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
        };
        self.store.put_task(&task)?;
        Ok(task)
    }
}
