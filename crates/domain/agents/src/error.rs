use aura_core::AgentStatus;
use aura_store::StoreError;

#[derive(Debug, thiserror::Error)]
pub enum AgentError {
    #[error("store error: {0}")]
    Store(#[from] StoreError),
    #[error("network error: {0}")]
    Network(#[from] aura_network::NetworkError),
    #[error("storage service error: {0}")]
    Storage(#[from] aura_storage::StorageError),
    #[error("illegal agent transition from {current:?} to {target:?}")]
    IllegalTransition {
        current: AgentStatus,
        target: AgentStatus,
    },
    #[error("agent not found")]
    NotFound,
    #[error("no active session for storage auth")]
    NoSession,
    #[error("parse error: {0}")]
    Parse(String),
}
