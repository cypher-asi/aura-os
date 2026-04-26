use std::collections::HashMap;

use futures_util::stream::{self, StreamExt};
use serde_json::Value;
use tracing::warn;

use aura_os_core::{OrgId, OrgIntegration, OrgIntegrationKind};
use aura_os_harness::{InstalledTool, ToolAuth};

use crate::handlers::trusted_mcp::{
    self, TrustedMcpToolDescriptor, MCP_INTEGRATION_ID_METADATA_KEY,
    MCP_INTEGRATION_NAME_METADATA_KEY, MCP_TOOL_NAME_METADATA_KEY, TOOL_SOURCE_KIND_METADATA_KEY,
    TOOL_TRUST_CLASS_METADATA_KEY,
};
use crate::state::AppState;

use super::secrets::load_integration_secret;
use super::types::{InstalledWorkspaceToolCatalog, InstalledWorkspaceToolWarning};

const TRUSTED_MCP_DISCOVERY_CONCURRENCY: usize = 4;

pub(super) async fn discovered_trusted_mcp_tool_catalog(
    state: &AppState,
    org_id: &OrgId,
    bearer_token: &str,
    integrations: &[OrgIntegration],
) -> InstalledWorkspaceToolCatalog {
    let base_url = super::control_plane_api_base_url();
    let trusted = select_trusted_mcp_integrations(integrations);
    let discovered = discover_trusted_mcp_tools(state, org_id, bearer_token, trusted).await;

    let mut tools = Vec::new();
    let mut warnings = Vec::new();
    for (_, integration, result) in discovered {
        match result {
            Ok(discovered_tools) => {
                let request = TrustedMcpToolBuildRequest {
                    base_url: &base_url,
                    org_id,
                    bearer_token,
                    integration: &integration,
                };
                tools.extend(build_trusted_mcp_tools(request, discovered_tools));
            }
            Err(error) => {
                log_trusted_mcp_discovery_failure(org_id, &integration, &error);
                warnings.push(build_discovery_warning(integration, error));
            }
        }
    }

    InstalledWorkspaceToolCatalog { tools, warnings }
}

fn select_trusted_mcp_integrations(
    integrations: &[OrgIntegration],
) -> Vec<(usize, OrgIntegration)> {
    integrations
        .iter()
        .enumerate()
        .filter_map(|(index, integration)| {
            (integration.enabled && matches!(integration.kind, OrgIntegrationKind::McpServer))
                .then_some((index, integration.clone()))
        })
        .collect()
}

type DiscoveryResult = Result<Vec<TrustedMcpToolDescriptor>, String>;

async fn discover_trusted_mcp_tools(
    state: &AppState,
    org_id: &OrgId,
    bearer_token: &str,
    trusted_integrations: Vec<(usize, OrgIntegration)>,
) -> Vec<(usize, OrgIntegration, DiscoveryResult)> {
    let mut discovered = stream::iter(trusted_integrations.into_iter().map(
        |(index, integration)| async move {
            let secret =
                load_integration_secret(state, org_id, &integration, Some(bearer_token)).await;
            let result = trusted_mcp::discover_tools(&integration, secret.as_deref()).await;
            (index, integration, result)
        },
    ))
    .buffer_unordered(TRUSTED_MCP_DISCOVERY_CONCURRENCY)
    .collect::<Vec<_>>()
    .await;
    discovered.sort_by_key(|(index, _, _)| *index);
    discovered
}

/// Reusable bundle of the borrowed inputs threaded through the
/// per-integration trusted-MCP tool builders. Grouping them keeps the
/// builders under the 5-parameter rule while preserving the original
/// borrow shape (no extra allocations beyond what the inline body did).
struct TrustedMcpToolBuildRequest<'a> {
    base_url: &'a str,
    org_id: &'a OrgId,
    bearer_token: &'a str,
    integration: &'a OrgIntegration,
}

fn build_trusted_mcp_tools(
    request: TrustedMcpToolBuildRequest<'_>,
    discovered: Vec<TrustedMcpToolDescriptor>,
) -> Vec<InstalledTool> {
    let mut tools = Vec::with_capacity(discovered.len());
    for tool in discovered {
        match build_trusted_mcp_tool(&request, tool) {
            Ok(installed) => tools.push(installed),
            Err(error) => warn!(
                org_id = %request.org_id,
                integration_id = %request.integration.integration_id,
                error = %error,
                "failed to build trusted MCP tool entry"
            ),
        }
    }
    tools
}

fn build_trusted_mcp_tool(
    request: &TrustedMcpToolBuildRequest<'_>,
    tool: TrustedMcpToolDescriptor,
) -> Result<InstalledTool, String> {
    let endpoint = discovered_mcp_tool_endpoint(
        request.base_url,
        request.org_id,
        &request.integration.integration_id,
        &tool.original_name,
    )?;
    let metadata = build_trusted_mcp_metadata(request.integration, &tool);
    Ok(InstalledTool {
        name: trusted_mcp::projected_tool_name(
            &request.integration.integration_id,
            &tool.original_name,
        ),
        description: format!("[{}] {}", request.integration.name, tool.description),
        input_schema: tool.input_schema,
        endpoint,
        auth: ToolAuth::Bearer {
            token: request.bearer_token.to_string(),
        },
        timeout_ms: Some(30_000),
        namespace: Some("aura_trusted_mcp".to_string()),
        required_integration: Some(aura_os_harness::InstalledToolIntegrationRequirement {
            integration_id: Some(request.integration.integration_id.clone()),
            provider: Some(request.integration.provider.clone()),
            kind: Some("mcp_server".to_string()),
        }),
        runtime_execution: None,
        metadata,
    })
}

fn build_trusted_mcp_metadata(
    integration: &OrgIntegration,
    tool: &TrustedMcpToolDescriptor,
) -> HashMap<String, Value> {
    let mut metadata = HashMap::new();
    metadata.insert(
        TOOL_SOURCE_KIND_METADATA_KEY.to_string(),
        Value::String("mcp".to_string()),
    );
    metadata.insert(
        TOOL_TRUST_CLASS_METADATA_KEY.to_string(),
        Value::String("trusted_mcp".to_string()),
    );
    metadata.insert(
        MCP_INTEGRATION_ID_METADATA_KEY.to_string(),
        Value::String(integration.integration_id.clone()),
    );
    metadata.insert(
        MCP_INTEGRATION_NAME_METADATA_KEY.to_string(),
        Value::String(integration.name.clone()),
    );
    metadata.insert(
        MCP_TOOL_NAME_METADATA_KEY.to_string(),
        Value::String(tool.original_name.clone()),
    );
    metadata
}

fn log_trusted_mcp_discovery_failure(org_id: &OrgId, integration: &OrgIntegration, error: &str) {
    warn!(
        %org_id,
        integration_id = %integration.integration_id,
        integration_name = %integration.name,
        error,
        "failed to discover trusted MCP tools; catalog will be partial"
    );
}

fn build_discovery_warning(
    integration: OrgIntegration,
    error: String,
) -> InstalledWorkspaceToolWarning {
    InstalledWorkspaceToolWarning {
        code: "trusted_mcp_discovery_failed".to_string(),
        message: format!(
            "Trusted MCP discovery failed for `{}`. The tool catalog is partial until this integration responds again.",
            integration.name
        ),
        detail: error,
        source_kind: "mcp".to_string(),
        trust_class: "trusted_mcp".to_string(),
        integration_id: integration.integration_id,
        integration_name: integration.name,
        provider: integration.provider,
    }
}

fn discovered_mcp_tool_endpoint(
    base_url: &str,
    org_id: &OrgId,
    integration_id: &str,
    original_tool_name: &str,
) -> Result<String, String> {
    let mut endpoint = reqwest::Url::parse(&format!(
        "{base_url}/api/orgs/{org_id}/tool-actions/mcp/{integration_id}"
    ))
    .map_err(|error| format!("invalid control plane base url: {error}"))?;
    endpoint
        .query_pairs_mut()
        .append_pair("tool_name", original_tool_name);
    Ok(endpoint.to_string())
}
