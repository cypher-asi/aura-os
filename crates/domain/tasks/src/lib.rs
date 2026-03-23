mod error;
mod task_service;

pub use error::TaskError;

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;

use aura_core::*;
use aura_storage::{StorageClient, StorageTask};
use aura_store::RocksStore;

pub struct TaskService {
    store: Arc<RocksStore>,
    storage_client: Option<Arc<StorageClient>>,
    claim_locks: Mutex<HashMap<ProjectId, Arc<Mutex<()>>>>,
}

impl TaskService {
    pub fn new(store: Arc<RocksStore>, storage_client: Option<Arc<StorageClient>>) -> Self {
        Self {
            store,
            storage_client,
            claim_locks: Mutex::new(HashMap::new()),
        }
    }

    async fn project_claim_lock(&self, project_id: &ProjectId) -> Arc<Mutex<()>> {
        let mut locks = self.claim_locks.lock().await;
        locks
            .entry(*project_id)
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    fn get_jwt(&self) -> Result<String, TaskError> {
        self.store.get_jwt().ok_or(TaskError::NoActiveSession)
    }

    fn require_storage(&self) -> Result<&Arc<StorageClient>, TaskError> {
        self.storage_client
            .as_ref()
            .ok_or(TaskError::StorageNotConfigured)
    }

    pub async fn list_tasks(&self, project_id: &ProjectId) -> Result<Vec<Task>, TaskError> {
        let storage = self.require_storage()?;
        let jwt = self.get_jwt()?;
        let storage_tasks = storage.list_tasks(&project_id.to_string(), &jwt).await?;
        let tasks = storage_tasks
            .into_iter()
            .filter_map(|s| {
                let id = s.id.clone();
                storage_task_to_task(s).map_err(|e| {
                    tracing::warn!(task_id = %id, error = %e, "Skipping task that failed conversion");
                    e
                }).ok()
            })
            .collect();
        Ok(tasks)
    }

    pub async fn list_tasks_by_spec(
        &self,
        project_id: &ProjectId,
        spec_id: &SpecId,
    ) -> Result<Vec<Task>, TaskError> {
        let storage = self.require_storage()?;
        let jwt = self.get_jwt()?;
        let storage_tasks = storage.list_tasks(&project_id.to_string(), &jwt).await?;
        let tasks = storage_tasks
            .into_iter()
            .filter_map(|s| {
                let id = s.id.clone();
                storage_task_to_task(s).map_err(|e| {
                    tracing::warn!(task_id = %id, error = %e, "Skipping task that failed conversion");
                    e
                }).ok()
            })
            .filter(|t| t.spec_id == *spec_id)
            .collect();
        Ok(tasks)
    }

    pub async fn get_task(
        &self,
        _project_id: &ProjectId,
        _spec_id: &SpecId,
        task_id: &TaskId,
    ) -> Result<Task, TaskError> {
        let storage = self.require_storage()?;
        let jwt = self.get_jwt()?;
        let st = storage.get_task(&task_id.to_string(), &jwt).await?;
        storage_task_to_task(st).map_err(TaskError::ParseError)
    }
}

/// Convert a `StorageTask` into a domain `Task`.
///
/// Delegates to the canonical `TryFrom<StorageTask>` impl in `aura_storage`.
pub fn storage_task_to_task(s: StorageTask) -> Result<Task, String> {
    Task::try_from(s)
}
