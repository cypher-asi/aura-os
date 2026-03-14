use aura_core::AgentStatus;
use aura_store::StoreError;

#[derive(Debug, thiserror::Error)]
pub enum AgentError {
    #[error("store error: {0}")]
    Store(#[from] StoreError),
    #[error("illegal agent transition from {current:?} to {target:?}")]
    IllegalTransition {
        current: AgentStatus,
        target: AgentStatus,
    },
    #[error("agent not found")]
    NotFound,
}
