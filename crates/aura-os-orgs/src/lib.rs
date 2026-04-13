mod error;
pub use error::OrgError;

use std::sync::Arc;

use aura_os_core::*;
use aura_os_store::RocksStore;
use chrono::Utc;

const ORG_BILLING_KEY_PREFIX: &str = "org_billing:";
const INTEGRATION_KEY_PREFIX: &str = "integration:";
const ORG_INTEGRATION_KEY_PREFIX: &str = "org_integration:";
const ORG_INTEGRATION_SECRET_KEY_PREFIX: &str = "org_integration_secret:";

fn org_billing_key(org_id: &OrgId) -> String {
    format!("{}{}", ORG_BILLING_KEY_PREFIX, org_id)
}

fn integration_key(org_id: &OrgId) -> String {
    format!("{}{}", INTEGRATION_KEY_PREFIX, org_id)
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

#[derive(Debug, Clone)]
pub enum IntegrationSecretUpdate {
    Preserve,
    Clear,
    Set(String),
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

    // -- Local IntegrationConfig (obsidian / web-search settings) -----------

    pub fn get_integration_config(
        &self,
        org_id: &OrgId,
    ) -> Result<Option<IntegrationConfig>, OrgError> {
        let key = integration_key(org_id);
        let bytes = match self.store.get_setting(&key) {
            Ok(b) => b,
            Err(aura_os_store::StoreError::NotFound(_)) => return Ok(None),
            Err(e) => return Err(OrgError::Store(e)),
        };
        let config: IntegrationConfig = serde_json::from_slice(&bytes)
            .map_err(|e| OrgError::Store(aura_os_store::StoreError::Serialization(e)))?;
        Ok(Some(config))
    }

    pub fn set_integration_config(
        &self,
        org_id: &OrgId,
        config: IntegrationConfig,
    ) -> Result<IntegrationConfig, OrgError> {
        let key = integration_key(org_id);
        let bytes = serde_json::to_vec(&config)
            .map_err(|e| OrgError::Store(aura_os_store::StoreError::Serialization(e)))?;
        self.store.put_setting(&key, &bytes)?;
        Ok(config)
    }

    // -- OrgIntegration CRUD (API-key-bearing provider integrations) --------
    // These methods back Aura OS's compatibility-only local shadow store when
    // `aura-integrations` is configured as the canonical integration backend.

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
        kind: OrgIntegrationKind,
        default_model: Option<String>,
        provider_config: Option<serde_json::Value>,
        enabled: Option<bool>,
        secret_update: IntegrationSecretUpdate,
    ) -> Result<OrgIntegration, OrgError> {
        let integration_id = integration_id
            .map(str::to_string)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let existing = self.get_integration(org_id, &integration_id)?;
        let now = Utc::now();
        let has_secret = match secret_update {
            IntegrationSecretUpdate::Set(secret_value) => {
                let bytes = secret_value.into_bytes();
                self.store
                    .put_setting(&org_integration_secret_key(&integration_id), &bytes)
                    .map_err(OrgError::Store)?;
                true
            }
            IntegrationSecretUpdate::Clear => {
                match self
                    .store
                    .delete_setting(&org_integration_secret_key(&integration_id))
                {
                    Ok(()) | Err(aura_os_store::StoreError::NotFound(_)) => {}
                    Err(e) => return Err(OrgError::Store(e)),
                }
                false
            }
            IntegrationSecretUpdate::Preserve => {
                existing.as_ref().map(|it| it.has_secret).unwrap_or(false)
            }
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
            kind,
            default_model,
            provider_config,
            has_secret,
            enabled: enabled
                .unwrap_or_else(|| existing.as_ref().map(|it| it.enabled).unwrap_or(true)),
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

    /// Mirror canonical integration metadata into the local compatibility shadow
    /// store while optionally updating the shadowed secret value.
    pub fn sync_integration_shadow(
        &self,
        integration: &OrgIntegration,
        secret_update: IntegrationSecretUpdate,
    ) -> Result<(), OrgError> {
        match secret_update {
            IntegrationSecretUpdate::Set(secret_value) => {
                self.store
                    .put_setting(
                        &org_integration_secret_key(&integration.integration_id),
                        secret_value.as_bytes(),
                    )
                    .map_err(OrgError::Store)?;
            }
            IntegrationSecretUpdate::Clear => match self
                .store
                .delete_setting(&org_integration_secret_key(&integration.integration_id))
            {
                Ok(()) | Err(aura_os_store::StoreError::NotFound(_)) => {}
                Err(e) => return Err(OrgError::Store(e)),
            },
            IntegrationSecretUpdate::Preserve => {}
        }

        let bytes = serde_json::to_vec(integration)
            .map_err(|e| OrgError::Store(aura_os_store::StoreError::Serialization(e)))?;
        self.store
            .put_setting(
                &org_integration_key(&integration.org_id, &integration.integration_id),
                &bytes,
            )
            .map_err(OrgError::Store)?;
        Ok(())
    }

    /// Refresh local compatibility shadow entries with canonical metadata
    /// returned by `aura-integrations` without destructively pruning fallback
    /// state.
    pub fn sync_integrations_shadow(
        &self,
        _org_id: &OrgId,
        integrations: &[OrgIntegration],
    ) -> Result<(), OrgError> {
        for integration in integrations {
            self.sync_integration_shadow(integration, IntegrationSecretUpdate::Preserve)?;
        }
        Ok(())
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

#[cfg(test)]
mod tests {
    use aura_os_core::OrgId;
    use aura_os_core::OrgIntegration;
    use aura_os_core::OrgIntegrationKind;

    use super::*;

    fn sample_integration(org_id: OrgId, integration_id: &str, has_secret: bool) -> OrgIntegration {
        let now = Utc::now();
        OrgIntegration {
            integration_id: integration_id.to_string(),
            org_id,
            name: format!("Integration {integration_id}"),
            provider: "github".to_string(),
            kind: OrgIntegrationKind::WorkspaceIntegration,
            default_model: None,
            provider_config: None,
            has_secret,
            enabled: true,
            secret_last4: if has_secret {
                Some("1234".to_string())
            } else {
                None
            },
            created_at: now,
            updated_at: now,
        }
    }

    #[test]
    fn sync_integration_shadow_preserves_canonical_metadata_and_secret() {
        let db_dir = tempfile::tempdir().unwrap();
        let store = Arc::new(RocksStore::open(db_dir.path()).unwrap());
        let service = OrgService::new(store);
        let org_id = OrgId::new();
        let integration = sample_integration(org_id, "integration-1", true);

        service
            .sync_integration_shadow(
                &integration,
                IntegrationSecretUpdate::Set("secret-value".to_string()),
            )
            .unwrap();

        assert_eq!(
            service.get_integration(&org_id, "integration-1").unwrap(),
            Some(integration.clone())
        );
        assert_eq!(
            service.get_integration_secret("integration-1").unwrap(),
            Some("secret-value".to_string())
        );
    }

    #[test]
    fn sync_integrations_shadow_preserves_fallback_entries_and_secrets() {
        let db_dir = tempfile::tempdir().unwrap();
        let store = Arc::new(RocksStore::open(db_dir.path()).unwrap());
        let service = OrgService::new(store);
        let org_id = OrgId::new();

        let stale = sample_integration(org_id, "stale", true);
        service
            .sync_integration_shadow(
                &stale,
                IntegrationSecretUpdate::Set("stale-secret".to_string()),
            )
            .unwrap();

        let retained = sample_integration(org_id, "retained", false);
        service
            .sync_integrations_shadow(&org_id, &[retained.clone()])
            .unwrap();

        assert_eq!(
            service.get_integration(&org_id, "stale").unwrap(),
            Some(stale)
        );
        assert_eq!(
            service.get_integration_secret("stale").unwrap(),
            Some("stale-secret".to_string())
        );
        assert_eq!(
            service.get_integration(&org_id, "retained").unwrap(),
            Some(retained)
        );
        assert_eq!(service.get_integration_secret("retained").unwrap(), None);
    }
}
