use aura_claude::ClaudeClientError;
use aura_store::StoreError;

#[derive(Debug, thiserror::Error)]
pub enum SessionError {
    #[error("store error: {0}")]
    Store(#[from] StoreError),
    #[error("session not found")]
    NotFound,
    #[error("Claude API error: {0}")]
    Claude(ClaudeClientError),
}
