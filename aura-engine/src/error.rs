use aura_services::{AgentError, ClaudeClientError, ProjectError, SessionError, TaskError};
use aura_settings::SettingsError;
use aura_store::StoreError;

#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error("store error: {0}")]
    Store(#[from] StoreError),
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
    #[error("join error: {0}")]
    Join(String),
    #[error("loop already running")]
    AlreadyRunning,
    #[error("no loop running")]
    NotRunning,
}
