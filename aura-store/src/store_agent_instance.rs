use std::sync::Arc;

use aura_core::*;

use crate::error::{StoreError, StoreResult};
use crate::store::RocksStore;

impl RocksStore {
    fn cf_agent_instances(&self) -> Arc<rocksdb::BoundColumnFamily<'_>> {
        self.cf_handle("agent_instances")
    }

    pub fn put_agent_instance(&self, instance: &AgentInstance) -> StoreResult<()> {
        let key = format!("{}:{}", instance.project_id, instance.agent_instance_id);
        let value = serde_json::to_vec(instance)?;
        self.db
            .put_cf(&self.cf_agent_instances(), key.as_bytes(), &value)?;
        Ok(())
    }

    pub fn get_agent_instance(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
    ) -> StoreResult<AgentInstance> {
        let key = format!("{project_id}:{agent_instance_id}");
        let bytes = self
            .db
            .get_cf(&self.cf_agent_instances(), key.as_bytes())?
            .ok_or_else(|| StoreError::NotFound(format!("agent_instance:{key}")))?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn delete_agent_instance(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
    ) -> StoreResult<()> {
        let key = format!("{project_id}:{agent_instance_id}");
        self.db
            .delete_cf(&self.cf_agent_instances(), key.as_bytes())?;
        Ok(())
    }

    pub fn list_agent_instances_by_project(
        &self,
        project_id: &ProjectId,
    ) -> StoreResult<Vec<AgentInstance>> {
        let prefix = format!("{project_id}:");
        self.scan_cf::<AgentInstance>(&self.cf_agent_instances(), Some(&prefix))
    }
}
