use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;

use chrono::Utc;
use serde::{Deserialize, Serialize};

use aura_core::*;
use aura_store::RocksStore;

use crate::error::TaskError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectProgress {
    pub project_id: ProjectId,
    pub total_tasks: usize,
    pub pending_tasks: usize,
    pub ready_tasks: usize,
    pub in_progress_tasks: usize,
    pub blocked_tasks: usize,
    pub done_tasks: usize,
    pub failed_tasks: usize,
    pub completion_percentage: f64,
    pub total_tokens: u64,
    pub total_cost: f64,
    pub lines_changed: u64,
    pub lines_of_code: u64,
    pub total_commits: u64,
    pub total_pull_requests: u64,
    pub total_messages: u64,
    pub total_sessions: u64,
}

pub struct TaskService {
    store: Arc<RocksStore>,
}

impl TaskService {
    pub fn new(store: Arc<RocksStore>) -> Self {
        Self { store }
    }

    pub fn transition_task(
        &self,
        project_id: &ProjectId,
        spec_id: &SpecId,
        task_id: &TaskId,
        new_status: TaskStatus,
    ) -> Result<Task, TaskError> {
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
        let mut task = self
            .store
            .get_task(project_id, spec_id, task_id)
            .map_err(|e| match e {
                aura_store::StoreError::NotFound(_) => TaskError::NotFound,
                other => TaskError::Store(other),
            })?;
        Self::validate_transition(task.status, TaskStatus::Ready)?;
        task.status = TaskStatus::Ready;
        task.assigned_agent_id = None;
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
        agent_id: &AgentId,
        session_id: Option<SessionId>,
    ) -> Result<Task, TaskError> {
        let mut task = self
            .store
            .get_task(project_id, spec_id, task_id)
            .map_err(|e| match e {
                aura_store::StoreError::NotFound(_) => TaskError::NotFound,
                other => TaskError::Store(other),
            })?;
        Self::validate_transition(task.status, TaskStatus::InProgress)?;
        task.status = TaskStatus::InProgress;
        task.assigned_agent_id = Some(*agent_id);
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
        let mut task = self
            .store
            .get_task(project_id, spec_id, task_id)
            .map_err(|e| match e {
                aura_store::StoreError::NotFound(_) => TaskError::NotFound,
                other => TaskError::Store(other),
            })?;
        Self::validate_transition(task.status, TaskStatus::Done)?;
        task.status = TaskStatus::Done;
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
        self.transition_task(project_id, spec_id, task_id, TaskStatus::Ready)
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

    // -- Follow-up task creation --

    pub fn create_follow_up_task(
        &self,
        originating_task: &Task,
        title: String,
        description: String,
        dependency_ids: Vec<TaskId>,
    ) -> Result<Task, TaskError> {
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
            assigned_agent_id: None,
            session_id: None,
            execution_notes: String::new(),
            files_changed: vec![],
            live_output: String::new(),
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

    // -- Progress --

    pub fn get_project_progress(
        &self,
        project_id: &ProjectId,
    ) -> Result<ProjectProgress, TaskError> {
        let tasks = self.store.list_tasks_by_project(project_id)?;
        let total = tasks.len();
        let done = tasks
            .iter()
            .filter(|t| t.status == TaskStatus::Done)
            .count();
        let pct = if total == 0 {
            0.0
        } else {
            (done as f64 / total as f64) * 100.0
        };

        let lines_changed: u64 = tasks
            .iter()
            .flat_map(|t| &t.files_changed)
            .map(|f| (f.lines_added as u64) + (f.lines_removed as u64))
            .sum();

        Ok(ProjectProgress {
            project_id: *project_id,
            total_tasks: total,
            pending_tasks: tasks
                .iter()
                .filter(|t| t.status == TaskStatus::Pending)
                .count(),
            ready_tasks: tasks
                .iter()
                .filter(|t| t.status == TaskStatus::Ready)
                .count(),
            in_progress_tasks: tasks
                .iter()
                .filter(|t| t.status == TaskStatus::InProgress)
                .count(),
            blocked_tasks: tasks
                .iter()
                .filter(|t| t.status == TaskStatus::Blocked)
                .count(),
            done_tasks: done,
            failed_tasks: tasks
                .iter()
                .filter(|t| t.status == TaskStatus::Failed)
                .count(),
            completion_percentage: pct,
            total_tokens: 0,
            total_cost: 0.0,
            lines_changed,
            lines_of_code: 0,
            total_commits: 0,
            total_pull_requests: 0,
            total_messages: 0,
            total_sessions: 0,
        })
    }
}
