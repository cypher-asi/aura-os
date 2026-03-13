use aura_core::{AgentStatus, OrgId, ProjectId, TaskStatus};
use aura_settings::SettingsError;
use aura_store::StoreError;

#[derive(Debug, thiserror::Error)]
pub enum ProjectError {
    #[error("store error: {0}")]
    Store(#[from] StoreError),
    #[error("project not found: {0}")]
    NotFound(ProjectId),
    #[error("invalid input: {0}")]
    InvalidInput(String),
}

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

#[derive(Debug, thiserror::Error)]
pub enum ClaudeClientError {
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("API error {status}: {message}")]
    Api { status: u16, message: String },
    #[error("response truncated: output hit max_tokens limit ({max_tokens}). Increase MAX_TOKENS or reduce input size.")]
    Truncated { max_tokens: u32 },
    #[error("response parse error: {0}")]
    Parse(String),
}

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
}

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

#[derive(Debug, thiserror::Error)]
pub enum SessionError {
    #[error("store error: {0}")]
    Store(#[from] StoreError),
    #[error("session not found")]
    NotFound,
    #[error("Claude API error: {0}")]
    Claude(ClaudeClientError),
}

#[derive(Debug, thiserror::Error)]
pub enum ChatError {
    #[error("store error: {0}")]
    Store(#[from] StoreError),
    #[error("chat session not found")]
    NotFound,
    #[error("settings error: {0}")]
    Settings(#[from] SettingsError),
}

#[derive(Debug, thiserror::Error)]
pub enum OrgError {
    #[error("store error: {0}")]
    Store(#[from] StoreError),
    #[error("org not found: {0}")]
    NotFound(OrgId),
    #[error("forbidden: {0}")]
    Forbidden(String),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("invite not found")]
    InviteNotFound,
    #[error("invite expired or revoked")]
    InviteInvalid,
    #[error("already a member")]
    AlreadyMember,
}

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("store error: {0}")]
    Store(#[from] StoreError),
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("zOS API error {status}: {message}")]
    ZosApi {
        status: u16,
        code: String,
        message: String,
    },
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}
