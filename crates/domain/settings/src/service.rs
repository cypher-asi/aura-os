use std::sync::Arc;

use aura_core::ApiKeyInfo;
use aura_store::RocksStore;

use crate::error::SettingsError;

pub struct SettingsService {
    #[allow(dead_code)] // store retained for SettingsService::new(store) API; API key is from env
    store: Arc<RocksStore>,
}

impl SettingsService {
    pub fn new(store: Arc<RocksStore>) -> Self {
        Self { store }
    }

    pub fn get_decrypted_api_key(&self) -> Result<String, SettingsError> {
        std::env::var("ANTHROPIC_API_KEY").map_err(|_| SettingsError::ApiKeyNotSet)
    }

    pub fn get_api_key_info(&self) -> Result<ApiKeyInfo, SettingsError> {
        let configured = std::env::var("ANTHROPIC_API_KEY")
            .ok()
            .filter(|k| !k.is_empty())
            .is_some();
        Ok(ApiKeyInfo { configured })
    }

    pub fn has_api_key(&self) -> bool {
        std::env::var("ANTHROPIC_API_KEY").is_ok()
    }
}
