use aura_claude::ClaudeClientError;
use aura_core::TaskStatus;
use aura_settings::SettingsError;
use aura_store::StoreError;

#[derive(Debug, thiserror::Error)]
pub enum TaskError {
    #[error("store error: {0}")]
    Store(#[from] StoreError),
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
    #[error("duplicate follow-up task")]
    DuplicateFollowUp,
}
