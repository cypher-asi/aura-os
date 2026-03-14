use aura_core::OrgId;
use aura_store::StoreError;

#[derive(Debug, thiserror::Error)]
pub enum OrgError {
    #[error("store error: {0}")]
    Store(#[from] StoreError),
    #[error("org not found: {0}")]
    NotFound(OrgId),
    #[error("forbidden: {0}")]
    Forbidden(String),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("invite not found")]
    InviteNotFound,
    #[error("invite expired or revoked")]
    InviteInvalid,
    #[error("already a member")]
    AlreadyMember,
}
