use std::sync::Arc;

use aura_core::*;

use crate::error::{StoreError, StoreResult};
use crate::store::RocksStore;

impl RocksStore {
    fn cf_agents(&self) -> Arc<rocksdb::BoundColumnFamily<'_>> {
        self.cf_handle("agents")
    }

    fn cf_sessions(&self) -> Arc<rocksdb::BoundColumnFamily<'_>> {
        self.cf_handle("sessions")
    }

    fn cf_settings(&self) -> Arc<rocksdb::BoundColumnFamily<'_>> {
        self.cf_handle("settings")
    }

    // -- Agent CRUD --

    pub fn put_agent(&self, agent: &Agent) -> StoreResult<()> {
        let key = format!("{}:{}", agent.project_id, agent.agent_id);
        let value = serde_json::to_vec(agent)?;
        self.db.put_cf(&self.cf_agents(), key.as_bytes(), &value)?;
        Ok(())
    }

    pub fn get_agent(&self, project_id: &ProjectId, agent_id: &AgentId) -> StoreResult<Agent> {
        let key = format!("{project_id}:{agent_id}");
        let bytes = self
            .db
            .get_cf(&self.cf_agents(), key.as_bytes())?
            .ok_or_else(|| StoreError::NotFound(format!("agent:{key}")))?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn delete_agent(&self, project_id: &ProjectId, agent_id: &AgentId) -> StoreResult<()> {
        let key = format!("{project_id}:{agent_id}");
        self.db.delete_cf(&self.cf_agents(), key.as_bytes())?;
        Ok(())
    }

    pub fn list_agents_by_project(&self, project_id: &ProjectId) -> StoreResult<Vec<Agent>> {
        let prefix = format!("{project_id}:");
        self.scan_cf::<Agent>(&self.cf_agents(), Some(&prefix))
    }

    // -- Session CRUD --

    pub fn put_session(&self, session: &Session) -> StoreResult<()> {
        let key = format!(
            "{}:{}:{}",
            session.project_id, session.agent_id, session.session_id
        );
        let value = serde_json::to_vec(session)?;
        self.db
            .put_cf(&self.cf_sessions(), key.as_bytes(), &value)?;
        Ok(())
    }

    pub fn get_session(
        &self,
        project_id: &ProjectId,
        agent_id: &AgentId,
        session_id: &SessionId,
    ) -> StoreResult<Session> {
        let key = format!("{project_id}:{agent_id}:{session_id}");
        let bytes = self
            .db
            .get_cf(&self.cf_sessions(), key.as_bytes())?
            .ok_or_else(|| StoreError::NotFound(format!("session:{key}")))?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn delete_session(
        &self,
        project_id: &ProjectId,
        agent_id: &AgentId,
        session_id: &SessionId,
    ) -> StoreResult<()> {
        let key = format!("{project_id}:{agent_id}:{session_id}");
        self.db.delete_cf(&self.cf_sessions(), key.as_bytes())?;
        Ok(())
    }

    pub fn list_sessions_by_agent(
        &self,
        project_id: &ProjectId,
        agent_id: &AgentId,
    ) -> StoreResult<Vec<Session>> {
        let prefix = format!("{project_id}:{agent_id}:");
        self.scan_cf::<Session>(&self.cf_sessions(), Some(&prefix))
    }

    pub fn list_sessions_by_project(
        &self,
        project_id: &ProjectId,
    ) -> StoreResult<Vec<Session>> {
        let prefix = format!("{project_id}:");
        self.scan_cf::<Session>(&self.cf_sessions(), Some(&prefix))
    }

    // -- Settings CRUD --

    pub fn put_setting(&self, key: &str, value: &[u8]) -> StoreResult<()> {
        self.db.put_cf(&self.cf_settings(), key.as_bytes(), value)?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> StoreResult<Vec<u8>> {
        let bytes = self
            .db
            .get_cf(&self.cf_settings(), key.as_bytes())?
            .ok_or_else(|| StoreError::NotFound(format!("settings:{key}")))?;
        Ok(bytes)
    }

    pub fn delete_setting(&self, key: &str) -> StoreResult<()> {
        self.db.delete_cf(&self.cf_settings(), key.as_bytes())?;
        Ok(())
    }
}
