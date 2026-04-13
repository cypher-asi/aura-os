use thiserror::Error;

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("entity not found: {0}")]
    NotFound(String),
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("key encoding error: {0}")]
    KeyEncoding(String),
}

pub type StoreResult<T> = Result<T, StoreError>;
