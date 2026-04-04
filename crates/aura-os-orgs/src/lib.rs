mod error;
pub use error::OrgError;

use std::sync::Arc;

use aura_os_core::*;
use aura_os_store::RocksStore;
use chrono::Utc;

const ORG_BILLING_KEY_PREFIX: &str = "org_billing:";
const ORG_INTEGRATION_KEY_PREFIX: &str = "org_integration:";
const ORG_INTEGRATION_SECRET_KEY_PREFIX: &str = "org_integration_secret:";

fn org_billing_key(org_id: &OrgId) -> String {
    format!("{}{}", ORG_BILLING_KEY_PREFIX, org_id)
}

fn org_integration_key(org_id: &OrgId, integration_id: &str) -> String {
    format!("{ORG_INTEGRATION_KEY_PREFIX}{org_id}:{integration_id}")
}

fn org_integration_prefix(org_id: &OrgId) -> String {
    format!("{ORG_INTEGRATION_KEY_PREFIX}{org_id}:")
}

fn org_integration_secret_key(integration_id: &str) -> String {
    format!("{ORG_INTEGRATION_SECRET_KEY_PREFIX}{integration_id}")
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
            Err(aura_os_store::StoreError::NotFound(_)) => return Ok(None),
            Err(e) => return Err(OrgError::Store(e)),
        };
        let billing: OrgBilling = serde_json::from_slice(&bytes)
            .map_err(|e| OrgError::Store(aura_os_store::StoreError::Serialization(e)))?;
        Ok(Some(billing))
    }

    /// Set org billing in settings (network has no billing fields).
    pub fn set_billing(&self, org_id: &OrgId, billing: OrgBilling) -> Result<OrgBilling, OrgError> {
        let key = org_billing_key(org_id);
        let bytes = serde_json::to_vec(&billing)
            .map_err(|e| OrgError::Store(aura_os_store::StoreError::Serialization(e)))?;
        self.store.put_setting(&key, &bytes)?;
        Ok(billing)
    }

    pub fn list_integrations(&self, org_id: &OrgId) -> Result<Vec<OrgIntegration>, OrgError> {
        let prefix = org_integration_prefix(org_id);
        let mut integrations = Vec::new();
        for (_key, value) in self
            .store
            .list_settings_with_prefix(&prefix)
            .map_err(OrgError::Store)?
        {
            let integration: OrgIntegration = serde_json::from_slice(&value)
                .map_err(|e| OrgError::Store(aura_os_store::StoreError::Serialization(e)))?;
            integrations.push(integration);
        }
        integrations.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(integrations)
    }

    pub fn get_integration(
        &self,
        org_id: &OrgId,
        integration_id: &str,
    ) -> Result<Option<OrgIntegration>, OrgError> {
        let key = org_integration_key(org_id, integration_id);
        let bytes = match self.store.get_setting(&key) {
            Ok(b) => b,
            Err(aura_os_store::StoreError::NotFound(_)) => return Ok(None),
            Err(e) => return Err(OrgError::Store(e)),
        };
        let integration: OrgIntegration = serde_json::from_slice(&bytes)
            .map_err(|e| OrgError::Store(aura_os_store::StoreError::Serialization(e)))?;
        Ok(Some(integration))
    }

    pub fn upsert_integration(
        &self,
        org_id: &OrgId,
        integration_id: Option<&str>,
        name: String,
        provider: String,
        default_model: Option<String>,
        secret: Option<String>,
    ) -> Result<OrgIntegration, OrgError> {
        let integration_id = integration_id
            .map(str::to_string)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let existing = self.get_integration(org_id, &integration_id)?;
        let now = Utc::now();
        let has_secret = if let Some(secret_value) = secret {
            let bytes = secret_value.into_bytes();
            self.store
                .put_setting(&org_integration_secret_key(&integration_id), &bytes)
                .map_err(OrgError::Store)?;
            true
        } else {
            existing.as_ref().map(|it| it.has_secret).unwrap_or(false)
        };
        let secret_last4 = self
            .get_integration_secret(&integration_id)
            .ok()
            .flatten()
            .and_then(|value| {
                let trimmed = value.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(
                        trimmed
                            .chars()
                            .rev()
                            .take(4)
                            .collect::<String>()
                            .chars()
                            .rev()
                            .collect(),
                    )
                }
            });

        let integration = OrgIntegration {
            integration_id: integration_id.clone(),
            org_id: *org_id,
            name,
            provider,
            default_model,
            has_secret,
            secret_last4,
            created_at: existing.as_ref().map(|it| it.created_at).unwrap_or(now),
            updated_at: now,
        };

        let bytes = serde_json::to_vec(&integration)
            .map_err(|e| OrgError::Store(aura_os_store::StoreError::Serialization(e)))?;
        self.store
            .put_setting(&org_integration_key(org_id, &integration_id), &bytes)
            .map_err(OrgError::Store)?;
        Ok(integration)
    }

    pub fn delete_integration(&self, org_id: &OrgId, integration_id: &str) -> Result<(), OrgError> {
        let key = org_integration_key(org_id, integration_id);
        match self.store.delete_setting(&key) {
            Ok(()) => {}
            Err(aura_os_store::StoreError::NotFound(_)) => {}
            Err(e) => return Err(OrgError::Store(e)),
        }
        match self
            .store
            .delete_setting(&org_integration_secret_key(integration_id))
        {
            Ok(()) | Err(aura_os_store::StoreError::NotFound(_)) => Ok(()),
            Err(e) => Err(OrgError::Store(e)),
        }
    }

    pub fn get_integration_secret(&self, integration_id: &str) -> Result<Option<String>, OrgError> {
        let key = org_integration_secret_key(integration_id);
        let bytes = match self.store.get_setting(&key) {
            Ok(b) => b,
            Err(aura_os_store::StoreError::NotFound(_)) => return Ok(None),
            Err(e) => return Err(OrgError::Store(e)),
        };
        Ok(Some(String::from_utf8_lossy(&bytes).into_owned()))
    }
}
