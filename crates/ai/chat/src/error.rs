use aura_settings::SettingsError;
use aura_storage::StorageError;
use aura_store::StoreError;

#[derive(Debug, thiserror::Error)]
pub enum ChatError {
    #[error("store error: {0}")]
    Store(#[from] StoreError),
    #[error("storage error: {0}")]
    Storage(#[from] StorageError),
    #[error("chat session not found")]
    NotFound,
    #[error("settings error: {0}")]
    Settings(#[from] SettingsError),
}
