use std::sync::Arc;

use aura_core::*;

use crate::error::{StoreError, StoreResult};
use crate::store::RocksStore;

impl RocksStore {
    fn cf_projects(&self) -> Arc<rocksdb::BoundColumnFamily<'_>> {
        self.cf_handle("projects")
    }

    fn cf_specs(&self) -> Arc<rocksdb::BoundColumnFamily<'_>> {
        self.cf_handle("specs")
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

    // Task CRUD has been migrated to aura-storage.
    // Full cleanup in Phase 9.
}
