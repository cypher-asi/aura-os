use std::sync::Arc;

use aura_core::*;

use crate::error::{StoreError, StoreResult};
use crate::store::RocksStore;

impl RocksStore {
    fn cf_projects(&self) -> Arc<rocksdb::BoundColumnFamily<'_>> {
        self.cf_handle("projects")
    }

    fn cf_sprints(&self) -> Arc<rocksdb::BoundColumnFamily<'_>> {
        self.cf_handle("sprints")
    }

    fn cf_specs(&self) -> Arc<rocksdb::BoundColumnFamily<'_>> {
        self.cf_handle("specs")
    }

    fn cf_tasks(&self) -> Arc<rocksdb::BoundColumnFamily<'_>> {
        self.cf_handle("tasks")
    }

    // -- Project CRUD --

    pub fn put_project(&self, project: &Project) -> StoreResult<()> {
        let key = project.project_id.to_string();
        let value = serde_json::to_vec(project)?;
        self.db
            .put_cf(&self.cf_projects(), key.as_bytes(), &value)?;
        Ok(())
    }

    pub fn get_project(&self, id: &ProjectId) -> StoreResult<Project> {
        let key = id.to_string();
        let bytes = self
            .db
            .get_cf(&self.cf_projects(), key.as_bytes())?
            .ok_or_else(|| StoreError::NotFound(format!("project:{id}")))?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn delete_project(&self, id: &ProjectId) -> StoreResult<()> {
        let key = id.to_string();
        self.db.delete_cf(&self.cf_projects(), key.as_bytes())?;
        Ok(())
    }

    pub fn list_projects(&self) -> StoreResult<Vec<Project>> {
        self.scan_cf::<Project>(&self.cf_projects(), None)
    }

    // -- Sprint CRUD --

    pub fn put_sprint(&self, sprint: &Sprint) -> StoreResult<()> {
        let key = format!("{}:{}", sprint.project_id, sprint.sprint_id);
        let value = serde_json::to_vec(sprint)?;
        self.db
            .put_cf(&self.cf_sprints(), key.as_bytes(), &value)?;
        Ok(())
    }

    pub fn get_sprint(
        &self,
        project_id: &ProjectId,
        sprint_id: &SprintId,
    ) -> StoreResult<Sprint> {
        let key = format!("{project_id}:{sprint_id}");
        let bytes = self
            .db
            .get_cf(&self.cf_sprints(), key.as_bytes())?
            .ok_or_else(|| StoreError::NotFound(format!("sprint:{key}")))?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn delete_sprint(
        &self,
        project_id: &ProjectId,
        sprint_id: &SprintId,
    ) -> StoreResult<()> {
        let key = format!("{project_id}:{sprint_id}");
        self.db.delete_cf(&self.cf_sprints(), key.as_bytes())?;
        Ok(())
    }

    pub fn list_sprints_by_project(&self, project_id: &ProjectId) -> StoreResult<Vec<Sprint>> {
        let prefix = format!("{project_id}:");
        self.scan_cf::<Sprint>(&self.cf_sprints(), Some(&prefix))
    }

    // -- Spec CRUD --

    pub fn put_spec(&self, spec: &Spec) -> StoreResult<()> {
        let key = format!("{}:{}", spec.project_id, spec.spec_id);
        let value = serde_json::to_vec(spec)?;
        self.db.put_cf(&self.cf_specs(), key.as_bytes(), &value)?;
        Ok(())
    }

    pub fn get_spec(&self, project_id: &ProjectId, spec_id: &SpecId) -> StoreResult<Spec> {
        let key = format!("{project_id}:{spec_id}");
        let bytes = self
            .db
            .get_cf(&self.cf_specs(), key.as_bytes())?
            .ok_or_else(|| StoreError::NotFound(format!("spec:{key}")))?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn delete_spec(&self, project_id: &ProjectId, spec_id: &SpecId) -> StoreResult<()> {
        let key = format!("{project_id}:{spec_id}");
        self.db.delete_cf(&self.cf_specs(), key.as_bytes())?;
        Ok(())
    }

    pub fn list_specs_by_project(&self, project_id: &ProjectId) -> StoreResult<Vec<Spec>> {
        let prefix = format!("{project_id}:");
        self.scan_cf::<Spec>(&self.cf_specs(), Some(&prefix))
    }

    // -- Task CRUD --

    pub fn put_task(&self, task: &Task) -> StoreResult<()> {
        let key = format!("{}:{}:{}", task.project_id, task.spec_id, task.task_id);
        let value = serde_json::to_vec(task)?;
        self.db.put_cf(&self.cf_tasks(), key.as_bytes(), &value)?;
        Ok(())
    }

    pub fn get_task(
        &self,
        project_id: &ProjectId,
        spec_id: &SpecId,
        task_id: &TaskId,
    ) -> StoreResult<Task> {
        let key = format!("{project_id}:{spec_id}:{task_id}");
        let bytes = self
            .db
            .get_cf(&self.cf_tasks(), key.as_bytes())?
            .ok_or_else(|| StoreError::NotFound(format!("task:{key}")))?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn delete_task(
        &self,
        project_id: &ProjectId,
        spec_id: &SpecId,
        task_id: &TaskId,
    ) -> StoreResult<()> {
        let key = format!("{project_id}:{spec_id}:{task_id}");
        self.db.delete_cf(&self.cf_tasks(), key.as_bytes())?;
        Ok(())
    }

    pub fn list_tasks_by_spec(
        &self,
        project_id: &ProjectId,
        spec_id: &SpecId,
    ) -> StoreResult<Vec<Task>> {
        let prefix = format!("{project_id}:{spec_id}:");
        self.scan_cf::<Task>(&self.cf_tasks(), Some(&prefix))
    }

    pub fn list_tasks_by_project(&self, project_id: &ProjectId) -> StoreResult<Vec<Task>> {
        let prefix = format!("{project_id}:");
        self.scan_cf::<Task>(&self.cf_tasks(), Some(&prefix))
    }

    /// Scan all tasks to find one by its task_id alone (no project/spec prefix needed).
    pub fn find_task_by_id(&self, task_id: &TaskId) -> StoreResult<Option<Task>> {
        let all: Vec<Task> = self.scan_cf::<Task>(&self.cf_tasks(), None)?;
        Ok(all.into_iter().find(|t| t.task_id == *task_id))
    }
}
