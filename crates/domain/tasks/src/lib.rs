mod error;
mod task_extraction;
mod task_progress;
mod task_service;

pub use error::TaskError;
pub use task_extraction::TaskExtractionService;
pub use task_progress::ProjectProgress;

use std::collections::HashMap;
use std::sync::Arc;

use chrono::{DateTime, Utc};
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
        locks.entry(*project_id).or_insert_with(|| Arc::new(Mutex::new(()))).clone()
    }

    fn get_jwt(&self) -> Result<String, TaskError> {
        let bytes = self
            .store
            .get_setting("zero_auth_session")
            .map_err(|_| TaskError::ParseError("no active session for storage".into()))?;
        let session: ZeroAuthSession =
            serde_json::from_slice(&bytes).map_err(|e| TaskError::ParseError(e.to_string()))?;
        Ok(session.access_token)
    }

    fn require_storage(&self) -> Result<&Arc<StorageClient>, TaskError> {
        self.storage_client.as_ref().ok_or_else(|| {
            TaskError::ParseError("aura-storage is not configured".into())
        })
    }

    pub async fn list_tasks(&self, project_id: &ProjectId) -> Result<Vec<Task>, TaskError> {
        let storage = self.require_storage()?;
        let jwt = self.get_jwt()?;
        let storage_tasks = storage
            .list_tasks(&project_id.to_string(), &jwt)
            .await?;
        let tasks = storage_tasks
            .into_iter()
            .filter_map(|s| storage_task_to_task(s).ok())
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
        let storage_tasks = storage
            .list_tasks(&project_id.to_string(), &jwt)
            .await?;
        let tasks = storage_tasks
            .into_iter()
            .filter_map(|s| storage_task_to_task(s).ok())
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

fn parse_dt(s: &Option<String>) -> DateTime<Utc> {
    s.as_deref()
        .and_then(|v| DateTime::parse_from_rfc3339(v).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(Utc::now)
}

fn parse_task_status(s: &str) -> TaskStatus {
    serde_json::from_str(&format!("\"{s}\"")).unwrap_or(TaskStatus::Pending)
}

pub fn storage_task_to_task(s: StorageTask) -> Result<Task, String> {
    Ok(Task {
        task_id: s.id.parse().map_err(|e| format!("invalid task id: {e}"))?,
        project_id: s
            .project_id
            .as_deref()
            .unwrap_or("")
            .parse()
            .map_err(|e| format!("invalid project id: {e}"))?,
        spec_id: s
            .spec_id
            .as_deref()
            .unwrap_or("")
            .parse()
            .map_err(|e| format!("invalid spec id: {e}"))?,
        title: s.title.unwrap_or_default(),
        description: s.description.unwrap_or_default(),
        status: parse_task_status(s.status.as_deref().unwrap_or("pending")),
        order_index: s.order_index.unwrap_or(0) as u32,
        dependency_ids: s
            .dependency_ids
            .unwrap_or_default()
            .into_iter()
            .filter_map(|id| id.parse().ok())
            .collect(),
        parent_task_id: None,
        assigned_agent_instance_id: None,
        completed_by_agent_instance_id: None,
        session_id: None,
        execution_notes: String::new(),
        files_changed: vec![],
        live_output: String::new(),
        build_steps: vec![],
        test_steps: vec![],
        user_id: None,
        model: None,
        total_input_tokens: 0,
        total_output_tokens: 0,
        created_at: parse_dt(&s.created_at),
        updated_at: parse_dt(&s.updated_at),
    })
}
