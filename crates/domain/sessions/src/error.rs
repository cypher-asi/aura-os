use aura_storage::StorageError;

#[derive(Debug, thiserror::Error)]
pub enum SessionError {
    #[error("storage error: {0}")]
    Storage(#[from] StorageError),
    #[error("session not found")]
    NotFound,
    #[error("parse error: {0}")]
    Parse(String),
}
