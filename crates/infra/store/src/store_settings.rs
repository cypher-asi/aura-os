use std::sync::Arc;

use aura_core::ZeroAuthSession;

use crate::error::{StoreError, StoreResult};
use crate::store::RocksStore;

impl RocksStore {
    pub(crate) fn cf_settings(&self) -> StoreResult<Arc<rocksdb::BoundColumnFamily<'_>>> {
        self.cf_handle("settings")
    }

    pub fn put_setting(&self, key: &str, value: &[u8]) -> StoreResult<()> {
        self.db.put_cf(&self.cf_settings()?, key.as_bytes(), value)?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> StoreResult<Vec<u8>> {
        let bytes = self
            .db
            .get_cf(&self.cf_settings()?, key.as_bytes())?
            .ok_or_else(|| StoreError::NotFound(format!("settings:{key}")))?;
        Ok(bytes)
    }

    pub fn delete_setting(&self, key: &str) -> StoreResult<()> {
        self.db.delete_cf(&self.cf_settings()?, key.as_bytes())?;
        Ok(())
    }

    pub fn list_settings_with_prefix(&self, prefix: &str) -> StoreResult<Vec<(String, Vec<u8>)>> {
        let iter = self.db.prefix_iterator_cf(&self.cf_settings()?, prefix.as_bytes());
        let mut values = Vec::new();
        for item in iter {
            let (key, value) = item?;
            if !key.starts_with(prefix.as_bytes()) {
                break;
            }
            values.push((String::from_utf8_lossy(&key).into_owned(), value.to_vec()));
        }
        Ok(values)
    }

    /// Extract the JWT access token from the stored zOS auth session.
    /// Returns `None` when no session is stored or it cannot be parsed.
    pub fn get_jwt(&self) -> Option<String> {
        let bytes = self.get_setting("zero_auth_session").ok()?;
        let session: ZeroAuthSession = serde_json::from_slice(&bytes).ok()?;
        Some(session.access_token)
    }
}
