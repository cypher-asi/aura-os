use aura_billing::MeteredLlmError;
use aura_claude::ClaudeClientError;
use aura_core::TaskStatus;
use aura_settings::SettingsError;
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
    #[error("Claude API error: {0}")]
    Claude(#[from] ClaudeClientError),
    #[error("settings error: {0}")]
    Settings(#[from] SettingsError),
    #[error("task extraction parse error: {0}")]
    ParseError(String),
    #[error("no active session for storage")]
    NoActiveSession,
    #[error("aura-storage is not configured")]
    StorageNotConfigured,
    #[error("duplicate follow-up task")]
    DuplicateFollowUp,
    #[error("insufficient credits")]
    InsufficientCredits,
}

impl From<MeteredLlmError> for TaskError {
    fn from(e: MeteredLlmError) -> Self {
        match e {
            MeteredLlmError::InsufficientCredits => TaskError::InsufficientCredits,
            MeteredLlmError::Llm(e) => TaskError::Claude(e),
            MeteredLlmError::Billing(e) => TaskError::ParseError(e.to_string()),
        }
    }
}
