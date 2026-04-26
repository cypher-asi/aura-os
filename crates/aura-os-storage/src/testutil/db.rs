use std::sync::Arc;

use tokio::sync::Mutex;

use crate::types::*;

#[derive(Debug, Clone, Default)]
pub struct MockStorageDb {
    pub sessions: Vec<StorageSession>,
    pub tasks: Vec<StorageTask>,
    pub specs: Vec<StorageSpec>,
    pub project_agents: Vec<StorageProjectAgent>,
    pub events: Vec<StorageSessionEvent>,
}

pub type SharedDb = Arc<Mutex<MockStorageDb>>;

pub(crate) fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}
