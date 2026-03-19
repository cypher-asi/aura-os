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
}
