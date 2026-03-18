use aura_core::OrgId;
use aura_store::StoreError;

#[derive(Debug, thiserror::Error)]
pub enum OrgError {
    #[error("store error: {0}")]
    Store(#[from] StoreError),
    #[error("org not found: {0}")]
    NotFound(OrgId),
}
