use aura_agents::AgentError;
use aura_billing::MeteredLlmError;
use aura_claude::ClaudeClientError;
use aura_projects::ProjectError;
use aura_sessions::SessionError;
use aura_storage::StorageError;
use aura_tasks::TaskError;
use aura_settings::SettingsError;
use aura_store::StoreError;

#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error("store error: {0}")]
    Store(#[from] StoreError),
    #[error("storage error: {0}")]
    Storage(#[from] StorageError),
    #[error("project error: {0}")]
    Project(#[from] ProjectError),
    #[error("task error: {0}")]
    Task(#[from] TaskError),
    #[error("agent error: {0}")]
    Agent(#[from] AgentError),
    #[error("session error: {0}")]
    Session(#[from] SessionError),
    #[error("settings error: {0}")]
    Settings(#[from] SettingsError),
    #[error("Claude API error: {0}")]
    Claude(#[from] ClaudeClientError),
    #[error("IO error: {0}")]
    Io(String),
    #[error("path escape attempt: {0}")]
    PathEscape(String),
    #[error("response parse error: {0}")]
    Parse(String),
    #[error("build command failed: {0}")]
    Build(String),
    #[error("join error: {0}")]
    Join(String),
    #[error("LLM error: {0}")]
    LlmError(String),
    #[error("insufficient credits")]
    InsufficientCredits,
    #[error("loop already running")]
    AlreadyRunning,
    #[error("no loop running")]
    NotRunning,
}

impl From<MeteredLlmError> for EngineError {
    fn from(e: MeteredLlmError) -> Self {
        match e {
            MeteredLlmError::InsufficientCredits => EngineError::InsufficientCredits,
            MeteredLlmError::Llm(e) => EngineError::Claude(e),
            MeteredLlmError::Billing(e) => EngineError::Io(e.to_string()),
        }
    }
}
