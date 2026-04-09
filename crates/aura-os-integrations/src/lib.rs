pub mod client;
pub mod error;
pub mod trusted_methods;

pub use client::IntegrationsClient;
pub use error::IntegrationsError;
pub use trusted_methods::{
    is_trusted_integration_provider, trusted_integration_method_by_tool,
    trusted_integration_methods, TrustedIntegrationArgBinding, TrustedIntegrationArgValueType,
    TrustedIntegrationHttpMethod, TrustedIntegrationMethodDefinition,
    TrustedIntegrationResultExtraField, TrustedIntegrationResultField,
    TrustedIntegrationResultTransform, TrustedIntegrationRuntimeSpec,
    TrustedIntegrationSuccessGuard, TRUSTED_INTEGRATION_RUNTIME_METADATA_KEY,
};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use aura_os_core::{OrgId, OrgIntegration, OrgIntegrationKind};
use aura_os_link::{
    InstalledIntegration, InstalledTool, InstalledToolIntegrationRequirement,
    InstalledToolRuntimeAuth, InstalledToolRuntimeExecution, InstalledToolRuntimeIntegration,
    InstalledToolRuntimeProviderExecution, ToolAuth,
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
    Resend,
}

#[derive(Clone, Copy, Debug)]
pub struct AppProviderContract {
    pub kind: AppProviderKind,
    pub trusted: bool,
    pub request: AppProviderRequestContract,
}

#[derive(Clone, Copy, Debug)]
pub struct AppProviderRequestContract {
    pub env_base_url_key: Option<&'static str>,
    pub default_base_url: Option<&'static str>,
    pub auth_scheme: AppProviderAuthScheme,
    pub static_headers: &'static [(&'static str, &'static str)],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AppProviderAuthScheme {
    None,
    AuthorizationBearer,
    AuthorizationRaw,
    Header(&'static str),
    Basic { username: &'static str },
    QueryParam(&'static str),
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
            AppProviderKind::Resend => "resend",
        }
    }
}

pub fn app_provider_contracts() -> &'static [AppProviderContract] {
    &[
        AppProviderContract {
            kind: AppProviderKind::Github,
            trusted: true,
            request: AppProviderRequestContract {
                env_base_url_key: Some("AURA_GITHUB_API_BASE_URL"),
                default_base_url: Some("https://api.github.com"),
                auth_scheme: AppProviderAuthScheme::AuthorizationBearer,
                static_headers: &[
                    ("X-GitHub-Api-Version", "2022-11-28"),
                    ("User-Agent", "aura-os"),
                ],
            },
        },
        AppProviderContract {
            kind: AppProviderKind::Linear,
            trusted: true,
            request: AppProviderRequestContract {
                env_base_url_key: Some("AURA_LINEAR_API_BASE_URL"),
                default_base_url: Some("https://api.linear.app/graphql"),
                auth_scheme: AppProviderAuthScheme::AuthorizationRaw,
                static_headers: &[],
            },
        },
        AppProviderContract {
            kind: AppProviderKind::Slack,
            trusted: true,
            request: AppProviderRequestContract {
                env_base_url_key: Some("AURA_SLACK_API_BASE_URL"),
                default_base_url: Some("https://slack.com/api"),
                auth_scheme: AppProviderAuthScheme::AuthorizationBearer,
                static_headers: &[],
            },
        },
        AppProviderContract {
            kind: AppProviderKind::Notion,
            trusted: false,
            request: AppProviderRequestContract {
                env_base_url_key: Some("AURA_NOTION_API_BASE_URL"),
                default_base_url: Some("https://api.notion.com/v1"),
                auth_scheme: AppProviderAuthScheme::AuthorizationBearer,
                static_headers: &[("Notion-Version", "2022-06-28")],
            },
        },
        AppProviderContract {
            kind: AppProviderKind::BraveSearch,
            trusted: true,
            request: AppProviderRequestContract {
                env_base_url_key: Some("AURA_BRAVE_SEARCH_API_BASE_URL"),
                default_base_url: Some("https://api.search.brave.com"),
                auth_scheme: AppProviderAuthScheme::Header("X-Subscription-Token"),
                static_headers: &[],
            },
        },
        AppProviderContract {
            kind: AppProviderKind::Freepik,
            trusted: false,
            request: AppProviderRequestContract {
                env_base_url_key: Some("AURA_FREEPIK_API_BASE_URL"),
                default_base_url: Some("https://api.freepik.com"),
                auth_scheme: AppProviderAuthScheme::Header("x-freepik-api-key"),
                static_headers: &[],
            },
        },
        AppProviderContract {
            kind: AppProviderKind::Buffer,
            trusted: false,
            request: AppProviderRequestContract {
                env_base_url_key: Some("AURA_BUFFER_API_BASE_URL"),
                default_base_url: Some("https://api.bufferapp.com/1"),
                auth_scheme: AppProviderAuthScheme::QueryParam("access_token"),
                static_headers: &[],
            },
        },
        AppProviderContract {
            kind: AppProviderKind::Apify,
            trusted: false,
            request: AppProviderRequestContract {
                env_base_url_key: Some("AURA_APIFY_API_BASE_URL"),
                default_base_url: Some("https://api.apify.com/v2"),
                auth_scheme: AppProviderAuthScheme::AuthorizationBearer,
                static_headers: &[],
            },
        },
        AppProviderContract {
            kind: AppProviderKind::Metricool,
            trusted: false,
            request: AppProviderRequestContract {
                env_base_url_key: Some("AURA_METRICOOL_API_BASE_URL"),
                default_base_url: Some("https://app.metricool.com/api"),
                auth_scheme: AppProviderAuthScheme::Header("X-Mc-Auth"),
                static_headers: &[],
            },
        },
        AppProviderContract {
            kind: AppProviderKind::Mailchimp,
            trusted: false,
            request: AppProviderRequestContract {
                env_base_url_key: None,
                default_base_url: None,
                auth_scheme: AppProviderAuthScheme::Basic {
                    username: "anystring",
                },
                static_headers: &[],
            },
        },
        AppProviderContract {
            kind: AppProviderKind::Resend,
            trusted: true,
            request: AppProviderRequestContract {
                env_base_url_key: Some("AURA_RESEND_API_BASE_URL"),
                default_base_url: Some("https://api.resend.com"),
                auth_scheme: AppProviderAuthScheme::AuthorizationBearer,
                static_headers: &[],
            },
        },
    ]
}

pub fn app_provider_contract_by_tool(tool_name: &str) -> Option<&'static AppProviderContract> {
    let provider = trusted_integration_method_by_tool(tool_name)
        .map(|method| method.provider.as_str())
        .or_else(|| {
            legacy_org_integration_tool_manifest_entries()
                .iter()
                .find(|entry| entry.name == tool_name)
                .and_then(|entry| entry.provider.as_deref())
        })?;
    app_provider_contracts()
        .iter()
        .find(|contract| contract.kind.provider_id() == provider)
}

pub fn app_provider_request_contract(kind: AppProviderKind) -> &'static AppProviderRequestContract {
    &app_provider_contracts()
        .iter()
        .find(|contract| contract.kind == kind)
        .expect("every app provider kind must have a request contract")
        .request
}

pub fn app_provider_base_url(kind: AppProviderKind) -> Option<String> {
    let contract = app_provider_request_contract(kind);
    contract.default_base_url.map(|default_url| {
        contract
            .env_base_url_key
            .and_then(std::env::var_os)
            .and_then(|value| value.into_string().ok())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| default_url.to_string())
    })
}

pub fn app_provider_runtime_auth(kind: AppProviderKind, secret: &str) -> InstalledToolRuntimeAuth {
    match app_provider_request_contract(kind).auth_scheme {
        AppProviderAuthScheme::None => InstalledToolRuntimeAuth::None,
        AppProviderAuthScheme::AuthorizationBearer => {
            InstalledToolRuntimeAuth::AuthorizationBearer {
                token: secret.to_string(),
            }
        }
        AppProviderAuthScheme::AuthorizationRaw => InstalledToolRuntimeAuth::AuthorizationRaw {
            value: secret.to_string(),
        },
        AppProviderAuthScheme::Header(name) => InstalledToolRuntimeAuth::Header {
            name: name.to_string(),
            value: secret.to_string(),
        },
        AppProviderAuthScheme::Basic { username } => InstalledToolRuntimeAuth::Basic {
            username: username.to_string(),
            password: secret.to_string(),
        },
        AppProviderAuthScheme::QueryParam(name) => InstalledToolRuntimeAuth::QueryParam {
            name: name.to_string(),
            value: secret.to_string(),
        },
    }
}

pub fn installed_tool_runtime_execution_for_provider(
    kind: AppProviderKind,
    integrations: Vec<InstalledToolRuntimeIntegration>,
) -> Option<InstalledToolRuntimeExecution> {
    let base_url = app_provider_base_url(kind)?;
    let static_headers = app_provider_request_contract(kind)
        .static_headers
        .iter()
        .map(|(name, value)| ((*name).to_string(), (*value).to_string()))
        .collect::<HashMap<_, _>>();
    Some(InstalledToolRuntimeExecution::AppProvider(
        InstalledToolRuntimeProviderExecution {
            provider: kind.provider_id().to_string(),
            base_url,
            static_headers,
            integrations,
        },
    ))
}

pub fn app_provider_headers(kind: AppProviderKind, secret: &str) -> Result<HeaderMap, String> {
    let contract = app_provider_request_contract(kind);
    let mut headers = default_json_headers();

    for (name, value) in contract.static_headers {
        headers.insert(*name, HeaderValue::from_static(value));
    }

    match contract.auth_scheme {
        AppProviderAuthScheme::None | AppProviderAuthScheme::QueryParam(_) => {}
        AppProviderAuthScheme::AuthorizationBearer => {
            let value = HeaderValue::from_str(&format!("Bearer {secret}"))
                .map_err(|e| format!("invalid bearer auth header: {e}"))?;
            headers.insert(AUTHORIZATION, value);
        }
        AppProviderAuthScheme::AuthorizationRaw => {
            let value = HeaderValue::from_str(secret)
                .map_err(|e| format!("invalid raw authorization header: {e}"))?;
            headers.insert(AUTHORIZATION, value);
        }
        AppProviderAuthScheme::Header(name) => {
            let value =
                HeaderValue::from_str(secret).map_err(|e| format!("invalid {name} header: {e}"))?;
            headers.insert(name, value);
        }
        AppProviderAuthScheme::Basic { username } => {
            let basic_auth = BASE64_STANDARD.encode(format!("{username}:{secret}"));
            let value = HeaderValue::from_str(&format!("Basic {basic_auth}"))
                .map_err(|e| format!("invalid basic auth header: {e}"))?;
            headers.insert(AUTHORIZATION, value);
        }
    }

    Ok(headers)
}

pub fn app_provider_authenticated_url(
    kind: AppProviderKind,
    path: &str,
    secret: &str,
) -> Result<reqwest::Url, String> {
    let base_url = app_provider_base_url(kind).ok_or_else(|| {
        format!(
            "provider `{}` does not define a base url",
            kind.provider_id()
        )
    })?;
    let mut url = reqwest::Url::parse(&format!("{base_url}{path}"))
        .map_err(|e| format!("invalid {} base url: {e}", kind.provider_id()))?;

    if let AppProviderAuthScheme::QueryParam(param) =
        app_provider_request_contract(kind).auth_scheme
    {
        url.query_pairs_mut().append_pair(param, secret);
    }

    Ok(url)
}

fn default_json_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers
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
        let mut entries = legacy_org_integration_tool_manifest_entries()
            .iter()
            .filter(|entry| {
                entry.name == "list_org_integrations"
                    || entry
                        .provider
                        .as_deref()
                        .map(|provider| !is_trusted_integration_provider(provider))
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

fn legacy_org_integration_tool_manifest_entries() -> &'static [OrgIntegrationToolManifestEntry] {
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

    #[test]
    fn github_headers_use_bearer_and_static_headers() {
        let headers =
            app_provider_headers(AppProviderKind::Github, "ghp_test").expect("github headers");
        assert_eq!(
            headers
                .get(AUTHORIZATION)
                .and_then(|value| value.to_str().ok()),
            Some("Bearer ghp_test")
        );
        assert_eq!(
            headers
                .get("X-GitHub-Api-Version")
                .and_then(|value| value.to_str().ok()),
            Some("2022-11-28")
        );
        assert_eq!(
            headers
                .get("User-Agent")
                .and_then(|value| value.to_str().ok()),
            Some("aura-os")
        );
    }

    #[test]
    fn linear_headers_use_raw_authorization() {
        let headers =
            app_provider_headers(AppProviderKind::Linear, "lin_test").expect("linear headers");
        assert_eq!(
            headers
                .get(AUTHORIZATION)
                .and_then(|value| value.to_str().ok()),
            Some("lin_test")
        );
    }

    #[test]
    fn buffer_urls_use_query_token_auth() {
        let url =
            app_provider_authenticated_url(AppProviderKind::Buffer, "/profiles.json", "buf_test")
                .expect("buffer url");
        assert_eq!(
            url.query_pairs().find(|(key, _)| key == "access_token"),
            Some(("access_token".into(), "buf_test".into()))
        );
    }
}
