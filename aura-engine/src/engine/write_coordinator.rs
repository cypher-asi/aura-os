use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;

use aura_core::ProjectId;

/// Serializes filesystem writes and build/test verification per project,
/// so parallel agents don't step on each other's file edits.
#[derive(Debug, Clone, Default)]
pub struct ProjectWriteCoordinator {
    locks: Arc<Mutex<HashMap<ProjectId, Arc<Mutex<()>>>>>,
}

impl ProjectWriteCoordinator {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn acquire(&self, project_id: &ProjectId) -> tokio::sync::OwnedMutexGuard<()> {
        let lock = {
            let mut map = self.locks.lock().await;
            map.entry(*project_id)
                .or_insert_with(|| Arc::new(Mutex::new(())))
                .clone()
        };
        lock.lock_owned().await
    }
}
