use aura_claude::ClaudeClientError;
use aura_core::ProjectId;
use aura_settings::SettingsError;
use aura_store::StoreError;

#[derive(Debug, thiserror::Error)]
pub enum SpecGenError {
    #[error("store error: {0}")]
    Store(#[from] StoreError),
    #[error("project not found: {0}")]
    ProjectNotFound(ProjectId),
    #[error("requirements file not found: {0}")]
    RequirementsFileNotFound(String),
    #[error("requirements file read error: {0}")]
    RequirementsFileRead(#[from] std::io::Error),
    #[error("Claude API error: {0}")]
    Claude(#[from] ClaudeClientError),
    #[error("settings error: {0}")]
    Settings(#[from] SettingsError),
    #[error("response parse error: {0}")]
    ParseError(String),
}
