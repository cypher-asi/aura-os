use aura_billing::MeteredLlmError;
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
    #[error("insufficient credits")]
    InsufficientCredits,
}

impl From<MeteredLlmError> for SessionError {
    fn from(e: MeteredLlmError) -> Self {
        match e {
            MeteredLlmError::InsufficientCredits => SessionError::InsufficientCredits,
            MeteredLlmError::Llm(e) => SessionError::Claude(e),
            MeteredLlmError::Billing(_) => SessionError::InsufficientCredits,
        }
    }
}
