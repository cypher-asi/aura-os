use aura_store::StoreError;

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("store error: {0}")]
    Store(#[from] StoreError),
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("zOS API error {status}: {message}")]
    ZosApi { status: u16, message: String },
    #[error("no active session")]
    NoSession,
    #[error("session expired")]
    SessionExpired,
    #[error("invalid credentials")]
    InvalidCredentials,
    #[error("registration failed: {0}")]
    RegistrationFailed(String),
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}
