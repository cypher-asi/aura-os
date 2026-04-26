//! Workspace tool / integration installer.
//!
//! Builds the lists of [`InstalledTool`] and [`InstalledIntegration`]
//! that the harness manifest exposes for a given org based on the
//! enabled workspace integrations and the manifest catalog. Trusted
//! tools also get the runtime metadata payload attached so the harness
//! can dispatch them through the trusted-runtime path.

use std::collections::{HashMap, HashSet};

use aura_os_core::{OrgId, OrgIntegration, OrgIntegrationKind};
use aura_os_harness::{
    InstalledIntegration, InstalledTool, InstalledToolIntegrationRequirement, ToolAuth,
};

use crate::control_plane::control_plane_api_base_url;
use crate::manifest::org_integration_tool_manifest_entries;
use crate::trusted_methods::{
    trusted_integration_method_by_tool, TRUSTED_INTEGRATION_RUNTIME_METADATA_KEY,
};

fn available_workspace_integration_providers(integrations: &[OrgIntegration]) -> HashSet<&str> {
    integrations
        .iter()
        .filter(|integration| {
            integration.enabled
                && integration.has_secret
                && matches!(integration.kind, OrgIntegrationKind::WorkspaceIntegration)
        })
        .map(|integration| integration.provider.as_str())
        .collect()
}

pub fn installed_workspace_app_tools(
    org_id: &OrgId,
    integrations: &[OrgIntegration],
    bearer_token: &str,
) -> Vec<InstalledTool> {
    let base_url = control_plane_api_base_url();
    let available_providers = available_workspace_integration_providers(integrations);

    org_integration_tool_manifest_entries()
        .iter()
        .filter(|tool| {
            tool.provider
                .as_deref()
                .map(|provider| available_providers.contains(provider))
                .unwrap_or(true)
        })
        .map(|tool| InstalledTool {
            name: tool.name.clone(),
            description: tool.description.clone(),
            input_schema: tool.input_schema.clone(),
            endpoint: format!("{base_url}/api/orgs/{org_id}/tool-actions/{}", tool.name),
            auth: ToolAuth::Bearer {
                token: bearer_token.to_string(),
            },
            timeout_ms: Some(30_000),
            namespace: Some("aura_org_tools".to_string()),
            required_integration: Some(InstalledToolIntegrationRequirement {
                integration_id: None,
                provider: tool.provider.clone(),
                kind: Some("workspace_integration".to_string()),
            }),
            runtime_execution: None,
            metadata: trusted_tool_metadata(&tool.name),
        })
        .collect()
}

fn trusted_tool_metadata(tool_name: &str) -> HashMap<String, serde_json::Value> {
    let mut metadata = HashMap::new();
    if let Some(method) = trusted_integration_method_by_tool(tool_name) {
        if let Ok(runtime) = serde_json::to_value(&method.runtime) {
            metadata.insert(
                TRUSTED_INTEGRATION_RUNTIME_METADATA_KEY.to_string(),
                runtime,
            );
        }
    }
    metadata
}

pub fn installed_workspace_integrations(
    integrations: &[OrgIntegration],
) -> Vec<InstalledIntegration> {
    integrations
        .iter()
        .filter(|integration| {
            integration.enabled
                && match integration.kind {
                    OrgIntegrationKind::WorkspaceIntegration => integration.has_secret,
                    OrgIntegrationKind::McpServer => true,
                    OrgIntegrationKind::WorkspaceConnection => false,
                }
        })
        .map(|integration| InstalledIntegration {
            integration_id: integration.integration_id.clone(),
            name: integration.name.clone(),
            provider: integration.provider.clone(),
            kind: match integration.kind {
                OrgIntegrationKind::WorkspaceConnection => "workspace_connection",
                OrgIntegrationKind::WorkspaceIntegration => "workspace_integration",
                OrgIntegrationKind::McpServer => "mcp_server",
            }
            .to_string(),
            metadata: HashMap::new(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use chrono::Utc;

    use super::*;
    use crate::provider::app_provider_contracts;
    use crate::trusted_methods::{is_trusted_integration_provider, trusted_integration_methods};
    use aura_os_core::OrgIntegrationKind;

    #[test]
    fn manifest_matches_provider_contracts() {
        let manifest_by_provider = org_integration_tool_manifest_entries().iter().fold(
            HashMap::<&str, HashSet<&str>>::new(),
            |mut acc, entry| {
                if let Some(provider) = entry.provider.as_deref() {
                    acc.entry(provider).or_default().insert(entry.name.as_str());
                }
                acc
            },
        );

        for contract in app_provider_contracts() {
            let actual = manifest_by_provider
                .get(contract.kind.provider_id())
                .cloned()
                .unwrap_or_default();
            let expected = org_integration_tool_manifest_entries()
                .iter()
                .filter(|entry| entry.provider.as_deref() == Some(contract.kind.provider_id()))
                .map(|entry| entry.name.as_str())
                .collect::<HashSet<_>>();
            assert_eq!(actual, expected);
        }
    }

    #[test]
    fn trusted_method_catalog_matches_manifest_entries() {
        let manifest_entries = org_integration_tool_manifest_entries()
            .iter()
            .filter_map(|entry| {
                let provider = entry.provider.as_deref()?;
                is_trusted_integration_provider(provider).then_some((entry.name.as_str(), provider))
            })
            .collect::<HashSet<_>>();
        let trusted_methods = trusted_integration_methods()
            .iter()
            .map(|method| (method.name.as_str(), method.provider.as_str()))
            .collect::<HashSet<_>>();

        assert_eq!(
            manifest_entries, trusted_methods,
            "trusted integration methods drifted from the shared manifest"
        );
    }

    #[test]
    fn trusted_workspace_tools_include_runtime_metadata() {
        let org_id = OrgId::new();
        let integrations = vec![
            test_integration(
                "Slack",
                "slack",
                OrgIntegrationKind::WorkspaceIntegration,
                true,
                true,
            ),
            test_integration(
                "Linear",
                "linear",
                OrgIntegrationKind::WorkspaceIntegration,
                true,
                true,
            ),
            test_integration(
                "Freepik",
                "freepik",
                OrgIntegrationKind::WorkspaceIntegration,
                true,
                true,
            ),
            test_integration(
                "Apify",
                "apify",
                OrgIntegrationKind::WorkspaceIntegration,
                true,
                true,
            ),
        ];

        let tools = installed_workspace_app_tools(&org_id, &integrations, "bearer-token");
        let slack = tools
            .iter()
            .find(|tool| tool.name == "slack_post_message")
            .expect("slack tool");
        let linear = tools
            .iter()
            .find(|tool| tool.name == "linear_list_teams")
            .expect("linear tool");
        let freepik = tools
            .iter()
            .find(|tool| tool.name == "freepik_improve_prompt")
            .expect("freepik tool");
        let apify = tools
            .iter()
            .find(|tool| tool.name == "apify_run_actor")
            .expect("apify tool");

        assert!(
            slack
                .metadata
                .contains_key(TRUSTED_INTEGRATION_RUNTIME_METADATA_KEY),
            "trusted slack tool should carry runtime metadata",
        );
        assert!(
            linear
                .metadata
                .contains_key(TRUSTED_INTEGRATION_RUNTIME_METADATA_KEY),
            "trusted linear tool should carry runtime metadata",
        );
        assert!(
            freepik
                .metadata
                .contains_key(TRUSTED_INTEGRATION_RUNTIME_METADATA_KEY),
            "trusted freepik tool should carry runtime metadata",
        );
        assert!(
            apify
                .metadata
                .contains_key(TRUSTED_INTEGRATION_RUNTIME_METADATA_KEY),
            "trusted apify tool should carry runtime metadata",
        );
    }

    fn test_integration(
        name: &str,
        provider: &str,
        kind: OrgIntegrationKind,
        has_secret: bool,
        enabled: bool,
    ) -> OrgIntegration {
        OrgIntegration {
            integration_id: format!("{provider}-id"),
            org_id: OrgId::new(),
            name: name.to_string(),
            provider: provider.to_string(),
            kind,
            default_model: None,
            provider_config: None,
            has_secret,
            enabled,
            secret_last4: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn installed_workspace_app_tools_only_include_enabled_provider_tools() {
        let org_id = OrgId::new();
        let integrations = vec![
            test_integration(
                "Brave Search",
                "brave_search",
                OrgIntegrationKind::WorkspaceIntegration,
                true,
                true,
            ),
            test_integration(
                "GitHub",
                "github",
                OrgIntegrationKind::WorkspaceIntegration,
                false,
                true,
            ),
            test_integration(
                "Buffer",
                "buffer",
                OrgIntegrationKind::WorkspaceIntegration,
                true,
                true,
            ),
        ];

        let tools = installed_workspace_app_tools(&org_id, &integrations, "jwt-123");
        let names = tools
            .iter()
            .map(|tool| tool.name.as_str())
            .collect::<HashSet<_>>();
        assert!(names.contains("list_org_integrations"));
        assert!(names.contains("brave_search_web"));
        assert!(names.contains("brave_search_news"));
        assert!(!names.contains("github_list_repos"));
        assert!(!names.contains("buffer_create_update"));

        let brave = tools
            .iter()
            .find(|tool| tool.name == "brave_search_web")
            .expect("brave tool");
        assert!(brave.endpoint.ends_with("/tool-actions/brave_search_web"));
        assert!(matches!(brave.auth, ToolAuth::Bearer { .. }));
    }

    #[test]
    fn installed_workspace_integrations_include_enabled_runtime_capabilities() {
        let integrations = vec![
            test_integration(
                "Brave Search",
                "brave_search",
                OrgIntegrationKind::WorkspaceIntegration,
                true,
                true,
            ),
            test_integration(
                "Claude API",
                "anthropic",
                OrgIntegrationKind::WorkspaceConnection,
                true,
                true,
            ),
            test_integration(
                "Example MCP",
                "example",
                OrgIntegrationKind::McpServer,
                false,
                true,
            ),
        ];

        let runtime_integrations = installed_workspace_integrations(&integrations);
        let names = runtime_integrations
            .iter()
            .map(|integration| integration.name.as_str())
            .collect::<HashSet<_>>();

        assert!(names.contains("Brave Search"));
        assert!(names.contains("Example MCP"));
        assert!(!names.contains("Claude API"));
    }
}
