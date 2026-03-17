use aura_store::StoreError;

#[derive(Debug, thiserror::Error)]
pub enum SettingsError {
    #[error("store error: {0}")]
    Store(#[from] StoreError),
    #[error("API key not set")]
    ApiKeyNotSet,
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}
