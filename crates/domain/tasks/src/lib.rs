mod error;
mod task_extraction;
mod task_progress;
mod task_service;

pub use error::TaskError;
pub use task_extraction::TaskExtractionService;
pub use task_progress::ProjectProgress;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use aura_core::*;
use aura_store::RocksStore;

pub struct TaskService {
    store: Arc<RocksStore>,
    claim_locks: Mutex<HashMap<ProjectId, Arc<Mutex<()>>>>,
}

impl TaskService {
    pub fn new(store: Arc<RocksStore>) -> Self {
        Self {
            store,
            claim_locks: Mutex::new(HashMap::new()),
        }
    }

    fn project_claim_lock(&self, project_id: &ProjectId) -> Arc<Mutex<()>> {
        let mut locks = self.claim_locks.lock().unwrap();
        locks.entry(*project_id).or_insert_with(|| Arc::new(Mutex::new(()))).clone()
    }
}
