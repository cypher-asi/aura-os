use std::collections::HashMap;

use serde_json::Value;

use aura_os_core::{OrgId, OrgIntegration, OrgIntegrationKind};
use aura_os_harness::InstalledToolRuntimeIntegration;
use aura_os_integrations::{
    app_provider_contracts, app_provider_runtime_auth, app_provider_runtime_base_url,
};

use crate::state::AppState;

use super::secrets::load_integration_secret;

pub(super) async fn load_runtime_integrations(
    state: &AppState,
    org_id: &OrgId,
    integrations: &[OrgIntegration],
    bearer_token: Option<&str>,
) -> HashMap<String, Vec<InstalledToolRuntimeIntegration>> {
    let mut by_provider = HashMap::<String, Vec<InstalledToolRuntimeIntegration>>::new();
    for integration in integrations.iter().filter(|integration| {
        integration.enabled
            && integration.has_secret
            && matches!(integration.kind, OrgIntegrationKind::WorkspaceIntegration)
    }) {
        let Some(secret) = load_integration_secret(state, org_id, integration, bearer_token).await
        else {
            continue;
        };
        let kind = match app_provider_contract_by_tool_provider(&integration.provider) {
            Some(kind) => kind,
            None => continue,
        };
        by_provider
            .entry(integration.provider.clone())
            .or_default()
            .push(build_runtime_integration(integration, kind, &secret));
    }
    by_provider
}

fn build_runtime_integration(
    integration: &OrgIntegration,
    kind: aura_os_integrations::AppProviderKind,
    secret: &str,
) -> InstalledToolRuntimeIntegration {
    InstalledToolRuntimeIntegration {
        integration_id: integration.integration_id.clone(),
        base_url: app_provider_runtime_base_url(kind, secret, integration.provider_config.as_ref()),
        auth: app_provider_runtime_auth(kind, secret),
        provider_config: integration
            .provider_config
            .as_ref()
            .and_then(Value::as_object)
            .map(|config| {
                config
                    .iter()
                    .map(|(key, value)| (key.clone(), value.clone()))
                    .collect::<HashMap<_, _>>()
            })
            .unwrap_or_default(),
    }
}

fn app_provider_contract_by_tool_provider(
    provider: &str,
) -> Option<aura_os_integrations::AppProviderKind> {
    app_provider_contracts()
        .iter()
        .find(|contract| contract.kind.provider_id() == provider)
        .map(|contract| contract.kind)
}
