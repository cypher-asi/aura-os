mod error;
pub use error::OrgError;

use std::sync::Arc;

use aura_core::*;
use aura_store::RocksStore;

const ORG_BILLING_KEY_PREFIX: &str = "org_billing:";

fn org_billing_key(org_id: &OrgId) -> String {
    format!("{}{}", ORG_BILLING_KEY_PREFIX, org_id)
}

pub struct OrgService {
    store: Arc<RocksStore>,
}

impl OrgService {
    pub fn new(store: Arc<RocksStore>) -> Self {
        Self { store }
    }

    /// Get org billing from settings (network has no billing fields).
    pub fn get_billing(&self, org_id: &OrgId) -> Result<Option<OrgBilling>, OrgError> {
        let key = org_billing_key(org_id);
        let bytes = match self.store.get_setting(&key) {
            Ok(b) => b,
            Err(aura_store::StoreError::NotFound(_)) => return Ok(None),
            Err(e) => return Err(OrgError::Store(e)),
        };
        let billing: OrgBilling =
            serde_json::from_slice(&bytes).map_err(|e| OrgError::Store(aura_store::StoreError::Serialization(e)))?;
        Ok(Some(billing))
    }

    /// Set org billing in settings (network has no billing fields).
    pub fn set_billing(&self, org_id: &OrgId, billing: OrgBilling) -> Result<OrgBilling, OrgError> {
        let key = org_billing_key(org_id);
        let bytes = serde_json::to_vec(&billing).map_err(|e| OrgError::Store(aura_store::StoreError::Serialization(e)))?;
        self.store.put_setting(&key, &bytes)?;
        Ok(billing)
    }
}
