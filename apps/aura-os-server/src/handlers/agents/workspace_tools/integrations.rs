use serde_json::Value;
use tracing::warn;

use aura_os_core::{OrgId, OrgIntegration};
use aura_os_harness::InstalledIntegration;
use aura_os_integrations::installed_workspace_integrations as build_installed_workspace_integrations;

use crate::handlers::trusted_mcp::{TOOL_SOURCE_KIND_METADATA_KEY, TOOL_TRUST_CLASS_METADATA_KEY};
use crate::state::AppState;

pub(crate) async fn integrations_for_org(state: &AppState, org_id: &OrgId) -> Vec<OrgIntegration> {
    integrations_for_org_with_token(state, org_id, None).await
}

pub(crate) async fn integrations_for_org_with_token(
    state: &AppState,
    org_id: &OrgId,
    bearer_token: Option<&str>,
) -> Vec<OrgIntegration> {
    if let Some(client) = &state.integrations_client {
        let canonical = if let Some(jwt) = bearer_token {
            client.list_integrations(org_id, jwt).await
        } else {
            client.list_integrations_internal(org_id).await
        };
        match canonical {
            Ok(integrations) => {
                if let Err(error) = state
                    .org_service
                    .sync_integrations_shadow(org_id, &integrations)
                {
                    warn!(
                        %org_id,
                        error = %error,
                        "failed to sync compatibility-only local integration shadow after canonical internal list"
                    );
                }
                return integrations;
            }
            Err(error) => warn!(
                %org_id,
                error = %error,
                "failed to load canonical aura-integrations list for workspace projection; falling back to compatibility-only local shadow"
            ),
        }
    }

    state
        .org_service
        .list_integrations(org_id)
        .unwrap_or_default()
}

#[allow(dead_code)]
pub(crate) async fn installed_workspace_integrations_for_org(
    state: &AppState,
    org_id: &OrgId,
) -> Vec<InstalledIntegration> {
    let integrations = integrations_for_org(state, org_id).await;
    let mut installed = build_installed_workspace_integrations(&integrations);
    annotate_mcp_integrations(&mut installed);
    installed
}

pub(crate) async fn installed_workspace_integrations_for_org_with_token(
    state: &AppState,
    org_id: &OrgId,
    bearer_token: &str,
) -> Vec<InstalledIntegration> {
    let integrations = integrations_for_org_with_token(state, org_id, Some(bearer_token)).await;
    installed_workspace_integrations_with_integrations(&integrations)
}

/// Variant of [`installed_workspace_integrations_for_org_with_token`]
/// that reuses a pre-fetched org-integrations slice. See
/// `installed_workspace_app_tools_with_integrations` for the
/// motivation.
pub(crate) fn installed_workspace_integrations_with_integrations(
    integrations: &[OrgIntegration],
) -> Vec<InstalledIntegration> {
    let mut installed = build_installed_workspace_integrations(integrations);
    annotate_mcp_integrations(&mut installed);
    installed
}

fn annotate_mcp_integrations(installed: &mut [InstalledIntegration]) {
    for integration in installed.iter_mut() {
        if integration.kind == "mcp_server" {
            integration.metadata.insert(
                TOOL_SOURCE_KIND_METADATA_KEY.to_string(),
                Value::String("mcp".to_string()),
            );
            integration.metadata.insert(
                TOOL_TRUST_CLASS_METADATA_KEY.to_string(),
                Value::String("trusted_mcp".to_string()),
            );
        }
    }
}
