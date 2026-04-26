//! Org integration tool manifest.
//!
//! Owns the shared `org-integration-tools.json` manifest that the
//! server uses to describe legacy org-integration tools, plus the
//! merged view that splices the trusted-method catalog on top so
//! callers see one canonical list of installable tools.

use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::trusted_methods::{is_trusted_integration_provider, trusted_integration_methods};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrgIntegrationToolManifestEntry {
    pub name: String,
    pub provider: Option<String>,
    pub description: String,
    pub prompt_signature: String,
    pub input_schema: Value,
}

pub fn org_integration_tool_manifest_entries() -> &'static [OrgIntegrationToolManifestEntry] {
    static ENTRIES: OnceLock<Vec<OrgIntegrationToolManifestEntry>> = OnceLock::new();
    ENTRIES.get_or_init(|| {
        let mut entries = legacy_org_integration_tool_manifest_entries()
            .iter()
            .filter(|entry| {
                entry.name == "list_org_integrations"
                    || entry
                        .provider
                        .as_deref()
                        .map(|provider| {
                            provider != "buffer" && !is_trusted_integration_provider(provider)
                        })
                        .unwrap_or(true)
            })
            .cloned()
            .collect::<Vec<_>>();
        entries.extend(trusted_integration_methods().iter().map(|method| {
            OrgIntegrationToolManifestEntry {
                name: method.name.clone(),
                provider: Some(method.provider.clone()),
                description: method.description.clone(),
                prompt_signature: method.prompt_signature.clone(),
                input_schema: method.input_schema.clone(),
            }
        }));
        entries
    })
}

pub(crate) fn legacy_org_integration_tool_manifest_entries(
) -> &'static [OrgIntegrationToolManifestEntry] {
    static ENTRIES: OnceLock<Vec<OrgIntegrationToolManifestEntry>> = OnceLock::new();
    ENTRIES.get_or_init(|| {
        serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../infra/shared/org-integration-tools.json"
        )))
        .expect("org integration tool manifest should parse")
    })
}
