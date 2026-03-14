use aura_core::ProjectId;
use aura_store::StoreError;

#[derive(Debug, thiserror::Error)]
pub enum ProjectError {
    #[error("store error: {0}")]
    Store(#[from] StoreError),
    #[error("project not found: {0}")]
    NotFound(ProjectId),
    #[error("invalid input: {0}")]
    InvalidInput(String),
}
