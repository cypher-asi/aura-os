use std::sync::Arc;

use aura_core::*;

use crate::error::{StoreError, StoreResult};
use crate::store::RocksStore;

impl RocksStore {
    fn cf_orgs(&self) -> Arc<rocksdb::BoundColumnFamily<'_>> {
        self.cf_handle("orgs")
    }

    pub fn put_org(&self, org: &Org) -> StoreResult<()> {
        let key = org.org_id.to_string();
        let value = serde_json::to_vec(org)?;
        self.db.put_cf(&self.cf_orgs(), key.as_bytes(), &value)?;
        Ok(())
    }

    pub fn get_org(&self, org_id: &OrgId) -> StoreResult<Org> {
        let key = org_id.to_string();
        let bytes = self
            .db
            .get_cf(&self.cf_orgs(), key.as_bytes())?
            .ok_or_else(|| StoreError::NotFound(format!("org:{org_id}")))?;
        Ok(serde_json::from_slice(&bytes)?)
    }
}
