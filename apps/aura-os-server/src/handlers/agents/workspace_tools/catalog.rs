use serde_json::Value;

use aura_os_core::{OrgId, OrgIntegration};
use aura_os_harness::InstalledTool;
use aura_os_integrations::{
    app_provider_contract_by_tool, installed_tool_runtime_execution_for_provider,
    installed_workspace_app_tools as build_installed_workspace_app_tools,
    TRUSTED_INTEGRATION_RUNTIME_METADATA_KEY,
};

use crate::handlers::trusted_mcp::{TOOL_SOURCE_KIND_METADATA_KEY, TOOL_TRUST_CLASS_METADATA_KEY};
use crate::state::AppState;

use super::integrations::integrations_for_org_with_token;
use super::runtime::load_runtime_integrations;
use super::trusted_mcp::discovered_trusted_mcp_tool_catalog;
use super::types::InstalledWorkspaceToolCatalog;

pub(crate) async fn installed_workspace_app_tools(
    state: &AppState,
    org_id: &OrgId,
    bearer_token: &str,
) -> Vec<InstalledTool> {
    installed_workspace_app_tool_catalog(state, org_id, bearer_token)
        .await
        .tools
}

/// Variant of [`installed_workspace_app_tools`] that reuses a pre-fetched
/// org-integrations slice. The chat handler calls this alongside
/// `installed_workspace_integrations_with_integrations` so a single
/// `integrations_for_org_with_token` round-trip drives both.
pub(crate) async fn installed_workspace_app_tools_with_integrations(
    state: &AppState,
    org_id: &OrgId,
    bearer_token: &str,
    integrations: &[OrgIntegration],
) -> Vec<InstalledTool> {
    installed_workspace_app_tool_catalog_with_integrations(
        state,
        org_id,
        bearer_token,
        integrations,
    )
    .await
    .tools
}

pub(crate) async fn installed_workspace_app_tool_catalog(
    state: &AppState,
    org_id: &OrgId,
    bearer_token: &str,
) -> InstalledWorkspaceToolCatalog {
    let integrations = integrations_for_org_with_token(state, org_id, Some(bearer_token)).await;
    installed_workspace_app_tool_catalog_with_integrations(
        state,
        org_id,
        bearer_token,
        &integrations,
    )
    .await
}

pub(crate) async fn installed_workspace_app_tool_catalog_with_integrations(
    state: &AppState,
    org_id: &OrgId,
    bearer_token: &str,
    integrations: &[OrgIntegration],
) -> InstalledWorkspaceToolCatalog {
    let runtime_integrations =
        load_runtime_integrations(state, org_id, integrations, Some(bearer_token)).await;
    let mut tools = build_installed_workspace_app_tools(org_id, integrations, bearer_token);
    for tool in &mut tools {
        annotate_tool_metadata(tool);
        let Some(contract) = app_provider_contract_by_tool(&tool.name) else {
            continue;
        };
        let Some(integrations) = runtime_integrations.get(contract.kind.provider_id()) else {
            continue;
        };
        tool.runtime_execution =
            installed_tool_runtime_execution_for_provider(contract.kind, integrations.clone());
    }
    let trusted_mcp_catalog =
        discovered_trusted_mcp_tool_catalog(state, org_id, bearer_token, integrations).await;
    tools.extend(trusted_mcp_catalog.tools);
    InstalledWorkspaceToolCatalog {
        tools,
        warnings: trusted_mcp_catalog.warnings,
    }
}

fn annotate_tool_metadata(tool: &mut InstalledTool) {
    if tool
        .metadata
        .contains_key(TRUSTED_INTEGRATION_RUNTIME_METADATA_KEY)
    {
        tool.metadata.insert(
            TOOL_SOURCE_KIND_METADATA_KEY.to_string(),
            Value::String("app_provider".to_string()),
        );
        tool.metadata.insert(
            TOOL_TRUST_CLASS_METADATA_KEY.to_string(),
            Value::String("trusted".to_string()),
        );
        return;
    }

    if tool.required_integration.is_some() {
        tool.metadata.insert(
            TOOL_SOURCE_KIND_METADATA_KEY.to_string(),
            Value::String("app_provider".to_string()),
        );
        tool.metadata.insert(
            TOOL_TRUST_CLASS_METADATA_KEY.to_string(),
            Value::String("general".to_string()),
        );
        return;
    }

    tool.metadata.insert(
        TOOL_SOURCE_KIND_METADATA_KEY.to_string(),
        Value::String("aura_native".to_string()),
    );
    tool.metadata.insert(
        TOOL_TRUST_CLASS_METADATA_KEY.to_string(),
        Value::String("platform".to_string()),
    );
}
