use aura_billing::MeteredLlmError;
use aura_claude::ClaudeClientError;
use aura_core::ProjectId;
use aura_projects::ProjectError;
use aura_settings::SettingsError;
use aura_storage::StorageError;
use aura_store::StoreError;

#[derive(Debug, thiserror::Error)]
pub enum SpecGenError {
    #[error("store error: {0}")]
    Store(#[from] StoreError),
    #[error("storage error: {0}")]
    Storage(#[from] StorageError),
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
    #[error("insufficient credits")]
    InsufficientCredits,
}

impl From<ProjectError> for SpecGenError {
    fn from(e: ProjectError) -> Self {
        match e {
            ProjectError::NotFound(id) => SpecGenError::ProjectNotFound(id),
            _ => SpecGenError::ParseError(e.to_string()),
        }
    }
}

impl From<MeteredLlmError> for SpecGenError {
    fn from(e: MeteredLlmError) -> Self {
        match e {
            MeteredLlmError::InsufficientCredits => SpecGenError::InsufficientCredits,
            MeteredLlmError::Llm(e) => SpecGenError::Claude(e),
            MeteredLlmError::Billing(e) => SpecGenError::ParseError(e.to_string()),
        }
    }
}
