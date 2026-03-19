use std::sync::Arc;

use crate::error::{StoreError, StoreResult};
use crate::store::RocksStore;

impl RocksStore {
    pub(crate) fn cf_settings(&self) -> Arc<rocksdb::BoundColumnFamily<'_>> {
        self.cf_handle("settings")
    }

    pub fn put_setting(&self, key: &str, value: &[u8]) -> StoreResult<()> {
        self.db.put_cf(&self.cf_settings(), key.as_bytes(), value)?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> StoreResult<Vec<u8>> {
        let bytes = self
            .db
            .get_cf(&self.cf_settings(), key.as_bytes())?
            .ok_or_else(|| StoreError::NotFound(format!("settings:{key}")))?;
        Ok(bytes)
    }

    pub fn delete_setting(&self, key: &str) -> StoreResult<()> {
        self.db.delete_cf(&self.cf_settings(), key.as_bytes())?;
        Ok(())
    }
}
