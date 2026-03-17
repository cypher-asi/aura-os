use std::sync::Arc;

use chrono::Utc;

use aura_core::{ApiKeyInfo, SettingsEntry, SettingsValue};
use aura_store::RocksStore;

use crate::error::SettingsError;

pub struct SettingsService {
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

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), SettingsError> {
        let entry = SettingsEntry {
            key: key.to_string(),
            value: SettingsValue::PlainText(value.to_string()),
            updated_at: Utc::now(),
        };
        let serialized = serde_json::to_vec(&entry)?;
        self.store.put_setting(key, &serialized)?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, SettingsError> {
        match self.store.get_setting(key) {
            Ok(bytes) => {
                let entry: SettingsEntry = serde_json::from_slice(&bytes)?;
                match entry.value {
                    SettingsValue::PlainText(val) => Ok(Some(val)),
                }
            }
            Err(aura_store::StoreError::NotFound(_)) => Ok(None),
            Err(e) => Err(SettingsError::Store(e)),
        }
    }
}
