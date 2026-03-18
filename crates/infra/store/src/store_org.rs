use std::sync::Arc;

use aura_core::*;

use crate::error::{StoreError, StoreResult};
use crate::store::RocksStore;

impl RocksStore {
    fn cf_orgs(&self) -> Arc<rocksdb::BoundColumnFamily<'_>> {
        self.cf_handle("orgs")
    }

    fn cf_org_members(&self) -> Arc<rocksdb::BoundColumnFamily<'_>> {
        self.cf_handle("org_members")
    }

    // -- Org CRUD --

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

    // -- OrgMember (for local permission checks) --

    pub fn put_org_member(&self, member: &OrgMember) -> StoreResult<()> {
        let key = format!("{}:{}", member.org_id, member.user_id);
        let value = serde_json::to_vec(member)?;
        self.db
            .put_cf(&self.cf_org_members(), key.as_bytes(), &value)?;
        Ok(())
    }

    pub fn get_org_member(&self, org_id: &OrgId, user_id: &str) -> StoreResult<OrgMember> {
        let key = format!("{org_id}:{user_id}");
        let bytes = self
            .db
            .get_cf(&self.cf_org_members(), key.as_bytes())?
            .ok_or_else(|| StoreError::NotFound(format!("org_member:{key}")))?;
        Ok(serde_json::from_slice(&bytes)?)
    }
}
