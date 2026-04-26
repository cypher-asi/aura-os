use std::collections::{HashMap, HashSet, VecDeque};

use aura_os_core::*;

use crate::error::TaskError;
use crate::TaskService;

impl TaskService {
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
}
