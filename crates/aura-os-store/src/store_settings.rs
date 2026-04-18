use aura_os_core::{JwtProvider, ZeroAuthSession};

use crate::error::{StoreError, StoreResult};
use crate::store::SettingsStore;

impl JwtProvider for SettingsStore {
    fn get_jwt(&self) -> Option<String> {
        self.session_cache
            .read()
            .expect("store lock poisoned")
            .as_ref()
            .map(|session| session.access_token.clone())
    }
}

impl SettingsStore {
    pub fn cache_zero_auth_session(&self, session: &ZeroAuthSession) {
        *self.session_cache.write().expect("store lock poisoned") = Some(session.clone());
    }

    pub fn get_cached_zero_auth_session(&self) -> Option<ZeroAuthSession> {
        self.session_cache
            .read()
            .expect("store lock poisoned")
            .clone()
    }

    pub fn clear_zero_auth_session_cache(&self) {
        *self.session_cache.write().expect("store lock poisoned") = None;
    }

    pub fn put_setting(&self, key: &str, value: &[u8]) -> StoreResult<()> {
        if key == "zero_auth_session" {
            let session: ZeroAuthSession = serde_json::from_slice(value)?;
            self.cache_zero_auth_session(&session);
            return Ok(());
        }
        self.put_cf_bytes("settings", key.as_bytes(), value)
    }

    pub fn get_setting(&self, key: &str) -> StoreResult<Vec<u8>> {
        if key == "zero_auth_session" {
            let session = self
                .get_cached_zero_auth_session()
                .ok_or_else(|| StoreError::NotFound("settings:zero_auth_session".to_string()))?;
            return Ok(serde_json::to_vec(&session)?);
        }
        self.get_cf_bytes("settings", key.as_bytes())?
            .ok_or_else(|| StoreError::NotFound(format!("settings:{key}")))
    }

    pub fn delete_setting(&self, key: &str) -> StoreResult<()> {
        if key == "zero_auth_session" {
            self.clear_zero_auth_session_cache();
            return Ok(());
        }
        self.with_cf_mut("settings", |cf| {
            cf.remove(key);
            Ok(())
        })
    }

    pub fn list_settings_with_prefix(&self, prefix: &str) -> StoreResult<Vec<(String, Vec<u8>)>> {
        self.with_cf("settings", |cf| {
            let mut values = Vec::new();
            for (key, value) in cf.range(prefix.to_string()..) {
                if !key.starts_with(prefix) {
                    break;
                }
                values.push((key.clone(), value.clone()));
            }
            Ok(values)
        })
    }
}
