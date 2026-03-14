use std::sync::Arc;

use aura_core::*;

use crate::error::{StoreError, StoreResult};
use crate::store::RocksStore;

impl RocksStore {
    fn cf_chat_sessions(&self) -> Arc<rocksdb::BoundColumnFamily<'_>> {
        self.cf_handle("chat_sessions")
    }

    fn cf_chat_messages(&self) -> Arc<rocksdb::BoundColumnFamily<'_>> {
        self.cf_handle("chat_messages")
    }

    // -- ChatSession CRUD --

    pub fn put_chat_session(&self, session: &ChatSession) -> StoreResult<()> {
        let key = format!("{}:{}", session.project_id, session.chat_session_id);
        let value = serde_json::to_vec(session)?;
        self.db
            .put_cf(&self.cf_chat_sessions(), key.as_bytes(), &value)?;
        Ok(())
    }

    pub fn get_chat_session(
        &self,
        project_id: &ProjectId,
        chat_session_id: &ChatSessionId,
    ) -> StoreResult<ChatSession> {
        let key = format!("{project_id}:{chat_session_id}");
        let bytes = self
            .db
            .get_cf(&self.cf_chat_sessions(), key.as_bytes())?
            .ok_or_else(|| StoreError::NotFound(format!("chat_session:{key}")))?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn delete_chat_session(
        &self,
        project_id: &ProjectId,
        chat_session_id: &ChatSessionId,
    ) -> StoreResult<()> {
        let key = format!("{project_id}:{chat_session_id}");
        self.db
            .delete_cf(&self.cf_chat_sessions(), key.as_bytes())?;
        Ok(())
    }

    pub fn list_chat_sessions(&self, project_id: &ProjectId) -> StoreResult<Vec<ChatSession>> {
        let prefix = format!("{project_id}:");
        self.scan_cf::<ChatSession>(&self.cf_chat_sessions(), Some(&prefix))
    }

    // -- ChatMessage CRUD --

    pub fn put_chat_message(&self, message: &ChatMessage) -> StoreResult<()> {
        let key = format!(
            "{}:{}:{}",
            message.project_id, message.chat_session_id, message.message_id
        );
        let value = serde_json::to_vec(message)?;
        self.db
            .put_cf(&self.cf_chat_messages(), key.as_bytes(), &value)?;
        Ok(())
    }

    pub fn list_chat_messages(
        &self,
        project_id: &ProjectId,
        chat_session_id: &ChatSessionId,
    ) -> StoreResult<Vec<ChatMessage>> {
        let prefix = format!("{project_id}:{chat_session_id}:");
        self.scan_cf::<ChatMessage>(&self.cf_chat_messages(), Some(&prefix))
    }

    pub fn count_messages_by_project(&self, project_id: &ProjectId) -> StoreResult<usize> {
        let prefix = format!("{project_id}:");
        let cf = self.cf_chat_messages();
        let iter = self.db.prefix_iterator_cf(&cf, prefix.as_bytes());
        let mut count = 0;
        for item in iter {
            let (key, _) = item?;
            if !key.starts_with(prefix.as_bytes()) {
                break;
            }
            count += 1;
        }
        Ok(count)
    }

    pub fn delete_chat_messages_by_session(
        &self,
        project_id: &ProjectId,
        chat_session_id: &ChatSessionId,
    ) -> StoreResult<()> {
        let prefix = format!("{project_id}:{chat_session_id}:");
        let cf = self.cf_chat_messages();
        let iter = self.db.prefix_iterator_cf(&cf, prefix.as_bytes());
        for item in iter {
            let (key, _) = item?;
            if !key.starts_with(prefix.as_bytes()) {
                break;
            }
            self.db.delete_cf(&cf, &key)?;
        }
        Ok(())
    }
}
