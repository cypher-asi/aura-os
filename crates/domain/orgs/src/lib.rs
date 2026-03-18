mod error;
pub use error::OrgError;

use std::sync::Arc;

use chrono::Utc;

use aura_core::*;
use aura_store::RocksStore;

pub struct OrgService {
    store: Arc<RocksStore>,
}

impl OrgService {
    pub fn new(store: Arc<RocksStore>) -> Self {
        Self { store }
    }

    pub fn get_org(&self, org_id: &OrgId) -> Result<Org, OrgError> {
        self.store.get_org(org_id).map_err(|e| match e {
            aura_store::StoreError::NotFound(_) => OrgError::NotFound(*org_id),
            other => OrgError::Store(other),
        })
    }

    pub fn set_billing(&self, org_id: &OrgId, billing: OrgBilling) -> Result<Org, OrgError> {
        let mut org = self.get_org(org_id)?;
        org.billing = Some(billing);
        org.updated_at = Utc::now();
        self.store.put_org(&org)?;
        Ok(org)
    }

    pub fn get_billing(&self, org_id: &OrgId) -> Result<Option<OrgBilling>, OrgError> {
        let org = self.get_org(org_id)?;
        Ok(org.billing)
    }

    pub fn set_github(&self, org_id: &OrgId, connected_by: &str, github_org: &str) -> Result<Org, OrgError> {
        let mut org = self.get_org(org_id)?;
        org.github = Some(OrgGithub { github_org: github_org.to_string(), connected_by: connected_by.to_string(), connected_at: Utc::now() });
        org.updated_at = Utc::now();
        self.store.put_org(&org)?;
        Ok(org)
    }

    pub fn remove_github(&self, org_id: &OrgId) -> Result<Org, OrgError> {
        let mut org = self.get_org(org_id)?;
        org.github = None;
        org.updated_at = Utc::now();
        self.store.put_org(&org)?;
        Ok(org)
    }

    pub fn get_github(&self, org_id: &OrgId) -> Result<Option<OrgGithub>, OrgError> {
        let org = self.get_org(org_id)?;
        Ok(org.github)
    }
}
