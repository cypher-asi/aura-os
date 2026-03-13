use std::path::Path;
use std::sync::Arc;

use chrono::Utc;

use aura_core::{ApiKeyInfo, ApiKeyStatus, SettingsEntry, SettingsValue};
use aura_store::RocksStore;

use crate::encryption::KeyEncryption;
use crate::error::SettingsError;
use crate::mask::mask_api_key;

const API_KEY_SETTING: &str = "claude_api_key";
const API_KEY_STATUS_SETTING: &str = "claude_api_key_status";
const API_KEY_VALIDATED_AT_SETTING: &str = "claude_api_key_validated_at";

pub struct SettingsService {
    store: Arc<RocksStore>,
    encryption: KeyEncryption,
}

impl SettingsService {
    pub fn new(store: Arc<RocksStore>, data_dir: &Path) -> Result<Self, SettingsError> {
        let encryption = KeyEncryption::init(data_dir)?;
        Ok(Self { store, encryption })
    }

    /// Store or update the Claude API key (encrypts before writing).
    pub fn set_api_key(&self, plaintext_key: &str) -> Result<ApiKeyInfo, SettingsError> {
        let blob = self.encryption.encrypt(plaintext_key.as_bytes())?;
        let now = Utc::now();

        let entry = SettingsEntry {
            key: API_KEY_SETTING.to_string(),
            value: SettingsValue::Encrypted(blob),
            updated_at: now,
        };

        let serialized = serde_json::to_vec(&entry)?;
        self.store.put_setting(API_KEY_SETTING, &serialized)?;

        self.store.put_setting(
            API_KEY_STATUS_SETTING,
            serde_json::to_vec(&ApiKeyStatus::ValidationPending)?.as_slice(),
        )?;

        let masked = mask_api_key(plaintext_key);

        Ok(ApiKeyInfo {
            status: ApiKeyStatus::ValidationPending,
            masked_key: Some(masked),
            last_validated_at: None,
            updated_at: Some(now),
        })
    }

    /// Retrieve the API key info for display (never returns plaintext).
    pub fn get_api_key_info(&self) -> Result<ApiKeyInfo, SettingsError> {
        let entry_bytes = match self.store.get_setting(API_KEY_SETTING) {
            Ok(bytes) => bytes,
            Err(aura_store::StoreError::NotFound(_)) => {
                return Ok(ApiKeyInfo {
                    status: ApiKeyStatus::NotSet,
                    masked_key: None,
                    last_validated_at: None,
                    updated_at: None,
                });
            }
            Err(e) => return Err(SettingsError::Store(e)),
        };

        let entry: SettingsEntry = serde_json::from_slice(&entry_bytes)?;

        let masked = match &entry.value {
            SettingsValue::Encrypted(blob) => {
                let plaintext = self.encryption.decrypt(blob)?;
                let key_str = String::from_utf8(plaintext)
                    .map_err(|e| SettingsError::Encryption(e.to_string()))?;
                Some(mask_api_key(&key_str))
            }
            SettingsValue::PlainText(_) => None,
        };

        let status = self
            .store
            .get_setting(API_KEY_STATUS_SETTING)
            .ok()
            .and_then(|b| serde_json::from_slice::<ApiKeyStatus>(&b).ok())
            .unwrap_or(ApiKeyStatus::ValidationPending);

        let last_validated_at = self
            .store
            .get_setting(API_KEY_VALIDATED_AT_SETTING)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok());

        Ok(ApiKeyInfo {
            status,
            masked_key: masked,
            last_validated_at,
            updated_at: Some(entry.updated_at),
        })
    }

    /// Internal: decrypt the API key for use by Claude client.
    pub(crate) fn decrypt_api_key(&self) -> Result<String, SettingsError> {
        let entry_bytes = match self.store.get_setting(API_KEY_SETTING) {
            Ok(bytes) => bytes,
            Err(aura_store::StoreError::NotFound(_)) => return Err(SettingsError::ApiKeyNotSet),
            Err(e) => return Err(SettingsError::Store(e)),
        };

        let entry: SettingsEntry = serde_json::from_slice(&entry_bytes)?;

        match &entry.value {
            SettingsValue::Encrypted(blob) => {
                let plaintext = self.encryption.decrypt(blob)?;
                String::from_utf8(plaintext)
                    .map_err(|e| SettingsError::Encryption(e.to_string()))
            }
            SettingsValue::PlainText(val) => Ok(val.clone()),
        }
    }

    /// Expose decrypt_api_key for other crates in the workspace.
    pub fn get_decrypted_api_key(&self) -> Result<String, SettingsError> {
        self.decrypt_api_key()
    }

    /// Delete the stored API key.
    pub fn delete_api_key(&self) -> Result<(), SettingsError> {
        let _ = self.store.delete_setting(API_KEY_SETTING);
        let _ = self.store.delete_setting(API_KEY_STATUS_SETTING);
        let _ = self.store.delete_setting(API_KEY_VALIDATED_AT_SETTING);
        Ok(())
    }

    /// Update the API key validation status.
    pub fn update_api_key_status(&self, status: ApiKeyStatus) -> Result<(), SettingsError> {
        self.store.put_setting(
            API_KEY_STATUS_SETTING,
            serde_json::to_vec(&status)?.as_slice(),
        )?;

        if status == ApiKeyStatus::Valid || status == ApiKeyStatus::Invalid {
            let now = Utc::now();
            self.store.put_setting(
                API_KEY_VALIDATED_AT_SETTING,
                serde_json::to_vec(&now)?.as_slice(),
            )?;
        }

        Ok(())
    }

    /// Set a plain-text setting (non-secret).
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

    /// Get a plain-text setting.
    pub fn get_setting(&self, key: &str) -> Result<Option<String>, SettingsError> {
        match self.store.get_setting(key) {
            Ok(bytes) => {
                let entry: SettingsEntry = serde_json::from_slice(&bytes)?;
                match entry.value {
                    SettingsValue::PlainText(val) => Ok(Some(val)),
                    SettingsValue::Encrypted(_) => Ok(None),
                }
            }
            Err(aura_store::StoreError::NotFound(_)) => Ok(None),
            Err(e) => Err(SettingsError::Store(e)),
        }
    }
}
