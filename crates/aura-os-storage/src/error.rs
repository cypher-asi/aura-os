use thiserror::Error;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("HTTP request failed: {0}")]
    Request(#[from] reqwest::Error),

    #[error("aura-storage returned {status}: {body}")]
    Server { status: u16, body: String },

    #[error("Deserialization error: {0}")]
    Deserialize(String),

    #[error("aura-storage is not configured (AURA_STORAGE_URL not set)")]
    NotConfigured,

    #[error("validation error: {0}")]
    Validation(String),

    #[error("configured aura-storage base URL is invalid")]
    InvalidBaseUrl,

    #[error("aura-storage request URL is invalid")]
    InvalidRequestUrl,

    #[error("refusing to send aura-storage credentials to an untrusted origin")]
    UntrustedRequestOrigin,
}
