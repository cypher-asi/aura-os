use std::collections::HashMap;

use aura_os_core::*;

use crate::error::TaskError;
use crate::TaskService;

use super::AssignTaskParams;

impl TaskService {
    // -- Next-task selection --

    pub async fn select_next_task(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
    ) -> Result<Option<Task>, TaskError> {
        let all_tasks = self.list_tasks(project_id).await?;
        self.select_next_task_from(project_id, agent_instance_id, &all_tasks)
            .await
    }

    /// Pick the next task this `agent_instance_id` is allowed to claim.
    ///
    /// Tasks with an `assigned_agent_instance_id` set to a *different*
    /// instance are filtered out so two parallel agents in the same
    /// project can't fight over the same row. Unassigned `Ready` tasks
    /// are first-come-first-serve. The auto-promote `ToDo -> Ready`
    /// path inherits the same filter so a foreign-assigned `ToDo`
    /// task is never promoted by the wrong agent.
    pub async fn select_next_task_from(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
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

        let claimable_for_agent = |t: &&Task| -> bool {
            match t.assigned_agent_instance_id {
                Some(assigned) => assigned == *agent_instance_id,
                None => true,
            }
        };

        let mut ready: Vec<&Task> = all_tasks
            .iter()
            .filter(|t| t.status == TaskStatus::Ready)
            .filter(claimable_for_agent)
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
            .filter(claimable_for_agent)
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
        let task = self
            .select_next_task_from(project_id, agent_instance_id, &all_tasks)
            .await?;
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
}
