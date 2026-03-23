use aura_core::TaskStatus;
use aura_storage::StorageError;
use aura_store::StoreError;

#[derive(Debug, thiserror::Error)]
pub enum TaskError {
    #[error("store error: {0}")]
    Store(#[from] StoreError),
    #[error("storage error: {0}")]
    Storage(#[from] StorageError),
    #[error("illegal transition from {current:?} to {target:?}")]
    IllegalTransition {
        current: TaskStatus,
        target: TaskStatus,
    },
    #[error("task not found")]
    NotFound,
    #[error("dependency cycle detected")]
    CycleDetected,
    #[error("task parse error: {0}")]
    ParseError(String),
    #[error("no active session for storage")]
    NoActiveSession,
    #[error("aura-storage is not configured")]
    StorageNotConfigured,
    #[error("duplicate follow-up task")]
    DuplicateFollowUp,
}
