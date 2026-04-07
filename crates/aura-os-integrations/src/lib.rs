use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use aura_os_core::{OrgId, OrgIntegration, OrgIntegrationKind};
use aura_os_link::{
    InstalledIntegration, InstalledTool, InstalledToolIntegrationRequirement, ToolAuth,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AppProviderKind {
    Github,
    Linear,
    Slack,
    Notion,
    BraveSearch,
    Freepik,
    Buffer,
    Apify,
    Metricool,
    Mailchimp,
}

#[derive(Clone, Copy, Debug)]
pub struct AppProviderContract {
    pub kind: AppProviderKind,
    pub tool_names: &'static [&'static str],
}

impl AppProviderKind {
    pub fn provider_id(self) -> &'static str {
        match self {
            AppProviderKind::Github => "github",
            AppProviderKind::Linear => "linear",
            AppProviderKind::Slack => "slack",
            AppProviderKind::Notion => "notion",
            AppProviderKind::BraveSearch => "brave_search",
            AppProviderKind::Freepik => "freepik",
            AppProviderKind::Buffer => "buffer",
            AppProviderKind::Apify => "apify",
            AppProviderKind::Metricool => "metricool",
            AppProviderKind::Mailchimp => "mailchimp",
        }
    }
}

pub fn app_provider_contracts() -> &'static [AppProviderContract] {
    &[
        AppProviderContract {
            kind: AppProviderKind::Github,
            tool_names: &["github_list_repos", "github_create_issue"],
        },
        AppProviderContract {
            kind: AppProviderKind::Linear,
            tool_names: &["linear_list_teams", "linear_create_issue"],
        },
        AppProviderContract {
            kind: AppProviderKind::Slack,
            tool_names: &["slack_list_channels", "slack_post_message"],
        },
        AppProviderContract {
            kind: AppProviderKind::Notion,
            tool_names: &["notion_search_pages", "notion_create_page"],
        },
        AppProviderContract {
            kind: AppProviderKind::BraveSearch,
            tool_names: &["brave_search_web", "brave_search_news"],
        },
        AppProviderContract {
            kind: AppProviderKind::Freepik,
            tool_names: &["freepik_list_icons", "freepik_improve_prompt"],
        },
        AppProviderContract {
            kind: AppProviderKind::Buffer,
            tool_names: &["buffer_list_profiles", "buffer_create_update"],
        },
        AppProviderContract {
            kind: AppProviderKind::Apify,
            tool_names: &["apify_list_actors", "apify_run_actor"],
        },
        AppProviderContract {
            kind: AppProviderKind::Metricool,
            tool_names: &["metricool_list_brands", "metricool_list_posts"],
        },
        AppProviderContract {
            kind: AppProviderKind::Mailchimp,
            tool_names: &["mailchimp_list_audiences", "mailchimp_list_campaigns"],
        },
    ]
}

pub fn app_provider_contract_by_tool(tool_name: &str) -> Option<&'static AppProviderContract> {
    app_provider_contracts()
        .iter()
        .find(|contract| contract.tool_names.iter().any(|name| *name == tool_name))
}

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
        serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../infra/shared/org-integration-tools.json"
        )))
        .expect("org integration tool manifest should parse")
    })
}

pub fn control_plane_api_base_url() -> String {
    if let Some(url) = std::env::var("AURA_CONTROL_PLANE_API_BASE_URL")
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
    {
        return url;
    }

    let port = std::env::var("AURA_SERVER_PORT")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "3100".to_string());
    let host = std::env::var("AURA_SERVER_HOST")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "127.0.0.1".to_string());

    let normalized_host = match host.as_str() {
        "0.0.0.0" | "::" => "127.0.0.1".to_string(),
        other if other.contains(':') && !other.starts_with('[') => format!("[{other}]"),
        other => other.to_string(),
    };

    format!("http://{normalized_host}:{port}")
}

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
            metadata: HashMap::new(),
        })
        .collect()
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
            let expected = contract.tool_names.iter().copied().collect::<HashSet<_>>();
            assert_eq!(actual, expected);
        }
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
