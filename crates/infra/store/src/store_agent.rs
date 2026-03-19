use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use aura_core::*;

use crate::error::{StoreError, StoreResult};
use crate::store::RocksStore;

impl RocksStore {
    fn cf_agents(&self) -> Arc<rocksdb::BoundColumnFamily<'_>> {
        self.cf_handle("agents")
    }

    fn cf_settings(&self) -> Arc<rocksdb::BoundColumnFamily<'_>> {
        self.cf_handle("settings")
    }

    // -- Agent CRUD (user-level) --

    pub fn put_agent(&self, agent: &Agent) -> StoreResult<()> {
        let key = format!("{}:{}", agent.user_id, agent.agent_id);
        let value = serde_json::to_vec(agent)?;
        self.db.put_cf(&self.cf_agents(), key.as_bytes(), &value)?;
        Ok(())
    }

    pub fn get_agent(&self, user_id: &str, agent_id: &AgentId) -> StoreResult<Agent> {
        let key = format!("{user_id}:{agent_id}");
        let bytes = self
            .db
            .get_cf(&self.cf_agents(), key.as_bytes())?
            .ok_or_else(|| StoreError::NotFound(format!("agent:{key}")))?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn delete_agent(&self, user_id: &str, agent_id: &AgentId) -> StoreResult<()> {
        let key = format!("{user_id}:{agent_id}");
        self.db.delete_cf(&self.cf_agents(), key.as_bytes())?;
        Ok(())
    }

    pub fn list_agents_by_user(&self, user_id: &str) -> StoreResult<Vec<Agent>> {
        let prefix = format!("{user_id}:");
        let mut opts = rocksdb::ReadOptions::default();
        opts.set_total_order_seek(true);
        let iter = self.db.iterator_cf_opt(
            &self.cf_agents(),
            opts,
            rocksdb::IteratorMode::From(prefix.as_bytes(), rocksdb::Direction::Forward),
        );
        let mut results = Vec::new();
        for item in iter {
            let (key, value) = item?;
            if !key.starts_with(prefix.as_bytes()) {
                break;
            }
            match serde_json::from_slice(&value) {
                Ok(v) => results.push(v),
                Err(e) => {
                    let key_str = String::from_utf8_lossy(&key);
                    tracing::warn!("Skipping unreadable agent entry {key_str}: {e}");
                }
            }
        }
        Ok(results)
    }

    /// Re-key agents stored under `"default"` to the real authenticated user ID.
    /// Skips any agent whose name already exists for the target user to avoid
    /// creating duplicates across server restarts.
    pub fn migrate_agents_from_default(&self, new_user_id: &str) -> StoreResult<usize> {
        if new_user_id == "default" {
            return Ok(0);
        }
        let old_agents = self.list_agents_by_user("default")?;
        if old_agents.is_empty() {
            return Ok(0);
        }
        let existing_names: HashSet<String> = self
            .list_agents_by_user(new_user_id)?
            .into_iter()
            .map(|a| a.name)
            .collect();
        let mut count = 0;
        for mut agent in old_agents {
            let old_key = format!("default:{}", agent.agent_id);
            if !existing_names.contains(&agent.name) {
                agent.user_id = new_user_id.to_string();
                self.put_agent(&agent)?;
                count += 1;
            }
            self.db.delete_cf(&self.cf_agents(), old_key.as_bytes())?;
        }
        if count > 0 {
            tracing::info!("Migrated {count} agents from 'default' to '{new_user_id}'");
        }
        Ok(count)
    }

    /// Remove duplicate agents that accumulated from repeated seed+migrate cycles.
    /// For each user, keeps only the oldest agent per name and deletes the rest.
    /// Runs only once (guarded by a persistent setting flag).
    pub fn dedup_agents_by_user(&self) -> StoreResult<()> {
        if self.get_setting("agents_deduped_v1").is_ok() {
            return Ok(());
        }
        let mut opts = rocksdb::ReadOptions::default();
        opts.set_total_order_seek(true);
        let iter = self.db.iterator_cf_opt(
            &self.cf_agents(),
            opts,
            rocksdb::IteratorMode::Start,
        );
        let mut by_user: HashMap<String, Vec<Agent>> = HashMap::new();
        for item in iter {
            let (_key, value) = item?;
            if let Ok(agent) = serde_json::from_slice::<Agent>(&value) {
                by_user.entry(agent.user_id.clone()).or_default().push(agent);
            }
        }
        let mut total_removed = 0;
        for (user_id, agents) in &by_user {
            let mut seen: HashMap<&str, &Agent> = HashMap::new();
            for agent in agents {
                if let Some(existing) = seen.get(agent.name.as_str()) {
                    let to_delete = if agent.created_at < existing.created_at {
                        let evicted = *existing;
                        seen.insert(&agent.name, agent);
                        evicted
                    } else {
                        agent
                    };
                    self.delete_agent(&user_id, &to_delete.agent_id)?;
                    total_removed += 1;
                } else {
                    seen.insert(&agent.name, agent);
                }
            }
        }
        if total_removed > 0 {
            tracing::info!("Dedup: removed {total_removed} duplicate agents");
        }
        self.put_setting("agents_deduped_v1", b"1")?;
        Ok(())
    }

    // -- Session stubs (migrated to aura-storage, full cleanup in Phase 9) --

    #[deprecated(note = "sessions migrated to aura-storage")]
    pub fn put_session(&self, _session: &Session) -> StoreResult<()> {
        Ok(())
    }

    #[deprecated(note = "sessions migrated to aura-storage")]
    pub fn get_session(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
        session_id: &SessionId,
    ) -> StoreResult<Session> {
        Err(StoreError::NotFound(format!(
            "session:{project_id}:{agent_instance_id}:{session_id} (migrated to aura-storage)"
        )))
    }

    #[deprecated(note = "sessions migrated to aura-storage")]
    pub fn delete_session(
        &self,
        _project_id: &ProjectId,
        _agent_instance_id: &AgentInstanceId,
        _session_id: &SessionId,
    ) -> StoreResult<()> {
        Ok(())
    }

    #[deprecated(note = "sessions migrated to aura-storage")]
    pub fn list_sessions_by_agent(
        &self,
        _project_id: &ProjectId,
        _agent_instance_id: &AgentInstanceId,
    ) -> StoreResult<Vec<Session>> {
        Ok(Vec::new())
    }

    #[deprecated(note = "sessions migrated to aura-storage")]
    pub fn list_sessions_by_project(
        &self,
        _project_id: &ProjectId,
    ) -> StoreResult<Vec<Session>> {
        Ok(Vec::new())
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
