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

/// Media-generation tool calls regularly run for minutes (video renders,
/// `gpt-image-2` high-quality tiers), so they get a much larger HTTP
/// timeout than ordinary org tools. The harness aborts the callback at
/// this deadline; the server side keeps draining the router SSE
/// regardless, so a generous ceiling here only bounds true hangs.
const GENERATION_TOOL_TIMEOUT_MS: u64 = 600_000;

/// Default timeout for ordinary (non-generation) org tool callbacks.
const DEFAULT_TOOL_TIMEOUT_MS: u64 = 30_000;

/// Cloud-only Brave credential used for Aura-funded Web Search.
pub const PLATFORM_BRAVE_KEY_ENV: &str = "BRAVE_SEARCH_PLATFORM_KEY";

/// Reserved capability id; it is never persisted as an org integration.
pub const PLATFORM_WEB_SEARCH_INTEGRATION_ID: &str = "platform-brave-search";
const PLATFORM_WEB_SEARCH_NAME: &str = "Web Search";
const BRAVE_SEARCH_PROVIDER: &str = "brave_search";

/// Ephemeral metadata for Aura-funded Web Search.
pub fn platform_web_search_integration(org_id: &OrgId) -> OrgIntegration {
    let now = std::time::SystemTime::now().into();
    OrgIntegration {
        integration_id: PLATFORM_WEB_SEARCH_INTEGRATION_ID.to_string(),
        org_id: *org_id,
        name: PLATFORM_WEB_SEARCH_NAME.to_string(),
        provider: BRAVE_SEARCH_PROVIDER.to_string(),
        kind: OrgIntegrationKind::WorkspaceIntegration,
        default_model: None,
        provider_config: None,
        has_secret: false,
        enabled: true,
        secret_last4: None,
        created_at: now,
        updated_at: now,
    }
}

/// Public cloud API origin used by desktop Web Search callbacks.
pub const PLATFORM_TOOL_ACTION_BASE_URL_ENV: &str = "AURA_PLATFORM_TOOL_ACTION_BASE_URL";

pub fn platform_web_search_key_present() -> bool {
    std::env::var(PLATFORM_BRAVE_KEY_ENV)
        .map(|key| !key.trim().is_empty())
        .unwrap_or(false)
}

pub fn platform_tool_action_base_url() -> Option<String> {
    read_trimmed_base_url_env(PLATFORM_TOOL_ACTION_BASE_URL_ENV)
}

/// Cloud executes with a local key; desktop executes through the cloud callback.
pub fn platform_web_search_available() -> bool {
    platform_web_search_key_present() || platform_tool_action_base_url().is_some()
}

fn read_trimmed_base_url_env(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
}

fn tool_timeout_ms(tool_name: &str) -> u64 {
    match tool_name {
        "generate_image" | "generate_video" | "generate_3d_model" => GENERATION_TOOL_TIMEOUT_MS,
        _ => DEFAULT_TOOL_TIMEOUT_MS,
    }
}

fn available_workspace_integration_providers(integrations: &[OrgIntegration]) -> HashSet<&str> {
    let mut providers: HashSet<&str> = integrations
        .iter()
        .filter(|integration| is_enabled_workspace_integration(integration))
        .map(|integration| integration.provider.as_str())
        .collect();
    if platform_web_search_available() {
        providers.insert(BRAVE_SEARCH_PROVIDER);
    }
    providers
}

fn is_enabled_workspace_integration(integration: &OrgIntegration) -> bool {
    integration.enabled
        && integration.has_secret
        && matches!(integration.kind, OrgIntegrationKind::WorkspaceIntegration)
}

pub fn installed_workspace_app_tools(
    org_id: &OrgId,
    integrations: &[OrgIntegration],
    bearer_token: &str,
) -> Vec<InstalledTool> {
    let base_url = control_plane_api_base_url();
    let platform_base_url = platform_tool_action_base_url();
    let has_brave_byok = integrations.iter().any(|integration| {
        integration.provider == BRAVE_SEARCH_PROVIDER
            && is_enabled_workspace_integration(integration)
    });
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
            endpoint: format!(
                "{}/api/orgs/{org_id}/tool-actions/{}",
                tool_action_base_url_for_tool(
                    tool.provider.as_deref(),
                    &base_url,
                    platform_base_url.as_deref(),
                    has_brave_byok,
                ),
                tool.name
            ),
            auth: ToolAuth::Bearer {
                token: bearer_token.to_string(),
            },
            timeout_ms: Some(tool_timeout_ms(&tool.name)),
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

fn tool_action_base_url_for_tool<'a>(
    provider: Option<&str>,
    default_base_url: &'a str,
    platform_base_url: Option<&'a str>,
    has_brave_byok: bool,
) -> &'a str {
    if provider == Some(BRAVE_SEARCH_PROVIDER) && !has_brave_byok {
        platform_base_url.unwrap_or(default_base_url)
    } else {
        default_base_url
    }
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
    let mut installed: Vec<_> = integrations
        .iter()
        .filter(|integration| {
            integration.enabled
                && match integration.kind {
                    OrgIntegrationKind::WorkspaceIntegration => integration.has_secret,
                    OrgIntegrationKind::McpServer => true,
                    OrgIntegrationKind::WorkspaceConnection => false,
                }
        })
        .map(to_installed_integration)
        .collect();

    if platform_web_search_available()
        && !installed
            .iter()
            .any(|integration| integration.provider == BRAVE_SEARCH_PROVIDER)
    {
        installed.push(InstalledIntegration {
            integration_id: PLATFORM_WEB_SEARCH_INTEGRATION_ID.to_string(),
            name: PLATFORM_WEB_SEARCH_NAME.to_string(),
            provider: BRAVE_SEARCH_PROVIDER.to_string(),
            kind: "workspace_integration".to_string(),
            metadata: HashMap::new(),
        });
    }

    installed
}

fn to_installed_integration(integration: &OrgIntegration) -> InstalledIntegration {
    InstalledIntegration {
        integration_id: integration.integration_id.clone(),
        name: integration.name.clone(),
        provider: integration.provider.clone(),
        kind: match integration.kind {
            OrgIntegrationKind::WorkspaceConnection => "workspace_connection",
            OrgIntegrationKind::WorkspaceIntegration => "workspace_integration",
            OrgIntegrationKind::McpServer => "mcp_server",
        }
        .to_string(),
        metadata: installed_integration_metadata(integration),
    }
}

const XAI_REMOTE_MCP_METADATA_KEY: &str = "xai_remote_mcp";

fn installed_integration_metadata(
    integration: &OrgIntegration,
) -> HashMap<String, serde_json::Value> {
    let mut metadata = HashMap::new();
    if let Some(config) = xai_remote_mcp_metadata(integration) {
        metadata.insert(XAI_REMOTE_MCP_METADATA_KEY.to_string(), config);
    }
    metadata
}

fn xai_remote_mcp_metadata(integration: &OrgIntegration) -> Option<serde_json::Value> {
    if integration.kind != OrgIntegrationKind::McpServer {
        return None;
    }
    let config = integration.provider_config.as_ref()?.as_object()?;
    let transport = config.get("transport")?.as_str()?.trim();
    if !matches!(transport, "http" | "streamable_http") {
        return None;
    }
    let server_url = config.get("url")?.as_str()?.trim();
    if !server_url.starts_with("https://") {
        return None;
    }

    let mut remote = serde_json::Map::new();
    remote.insert(
        "type".to_string(),
        serde_json::Value::String("mcp".to_string()),
    );
    remote.insert(
        "server_url".to_string(),
        serde_json::Value::String(server_url.to_string()),
    );
    remote.insert(
        "server_label".to_string(),
        serde_json::Value::String(integration.name.clone()),
    );
    remote.insert(
        "server_description".to_string(),
        serde_json::Value::String(format!("Aura workspace MCP server {}", integration.name)),
    );
    if let Some(allowed_tools) = config
        .get("allowedTools")
        .and_then(serde_json::Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(|value| value.as_str().map(str::trim))
                .filter(|value| !value.is_empty())
                .map(|value| serde_json::Value::String(value.to_string()))
                .collect::<Vec<_>>()
        })
        .filter(|values| !values.is_empty())
    {
        remote.insert(
            "allowed_tools".to_string(),
            serde_json::Value::Array(allowed_tools),
        );
    }
    Some(serde_json::Value::Object(remote))
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

    fn test_integration_with_config(
        name: &str,
        provider: &str,
        kind: OrgIntegrationKind,
        has_secret: bool,
        enabled: bool,
        provider_config: serde_json::Value,
    ) -> OrgIntegration {
        let mut integration = test_integration(name, provider, kind, has_secret, enabled);
        integration.provider_config = Some(provider_config);
        integration
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
    fn installed_mcp_integrations_include_xai_remote_mcp_metadata_for_https_servers() {
        let integrations = vec![
            test_integration_with_config(
                "DeepWiki",
                "mcp_server",
                OrgIntegrationKind::McpServer,
                false,
                true,
                serde_json::json!({
                    "transport": "streamable_http",
                    "url": "https://mcp.deepwiki.com/mcp",
                    "allowedTools": ["read_wiki", "search_wiki"]
                }),
            ),
            test_integration_with_config(
                "Local GitHub",
                "mcp_server",
                OrgIntegrationKind::McpServer,
                false,
                true,
                serde_json::json!({
                    "transport": "stdio",
                    "command": "npx"
                }),
            ),
        ];

        let installed = installed_workspace_integrations(&integrations);
        let deepwiki = installed
            .iter()
            .find(|integration| integration.name == "DeepWiki")
            .expect("deepwiki integration");
        assert_eq!(
            deepwiki.metadata["xai_remote_mcp"]["server_url"],
            "https://mcp.deepwiki.com/mcp"
        );
        assert_eq!(
            deepwiki.metadata["xai_remote_mcp"]["allowed_tools"][1],
            "search_wiki"
        );

        let local = installed
            .iter()
            .find(|integration| integration.name == "Local GitHub")
            .expect("local integration");
        assert!(
            !local.metadata.contains_key("xai_remote_mcp"),
            "stdio MCP servers are projected through Aura's trusted MCP bridge, not xAI Remote MCP"
        );
    }

    #[test]
    fn generation_tools_are_provider_less_and_always_installed() {
        // Empty integrations on purpose: the media-generation tools have
        // no provider gate, so every chat / dev-loop agent must see all
        // three regardless of which workspace integrations the org has
        // enabled.
        let org_id = OrgId::new();
        let integrations: Vec<OrgIntegration> = Vec::new();

        let tools = installed_workspace_app_tools(&org_id, &integrations, "jwt-media");
        for name in ["generate_image", "generate_video", "generate_3d_model"] {
            let tool = tools
                .iter()
                .find(|tool| tool.name == name)
                .unwrap_or_else(|| panic!("{name} should ship for every org"));
            assert!(tool.endpoint.ends_with(&format!("/tool-actions/{name}")));
            assert_eq!(
                tool.timeout_ms,
                Some(GENERATION_TOOL_TIMEOUT_MS),
                "{name} must carry the long generation timeout",
            );
        }

        // Non-generation tools keep the ordinary timeout.
        let list = tools
            .iter()
            .find(|tool| tool.name == "list_org_integrations")
            .expect("list_org_integrations tool");
        assert_eq!(list.timeout_ms, Some(DEFAULT_TOOL_TIMEOUT_MS));
    }

    #[test]
    fn generate_video_schema_exposes_full_parameter_set() {
        let entry = org_integration_tool_manifest_entries()
            .iter()
            .find(|entry| entry.name == "generate_video")
            .expect("generate_video manifest entry");
        let properties = entry.input_schema["properties"]
            .as_object()
            .expect("inputSchema.properties");
        for param in [
            "prompt",
            "model",
            "aspect_ratio",
            "duration_seconds",
            "resolution",
            "generate_audio",
            "images",
            "project_id",
        ] {
            assert!(
                properties.contains_key(param),
                "generate_video schema missing `{param}`",
            );
        }
    }

    #[test]
    fn generate_image_schema_exposes_quality() {
        let entry = org_integration_tool_manifest_entries()
            .iter()
            .find(|entry| entry.name == "generate_image")
            .expect("generate_image manifest entry");
        let quality = &entry.input_schema["properties"]["quality"];
        assert_eq!(
            quality["enum"],
            serde_json::json!(["auto", "low", "medium", "high"]),
        );
    }

    #[test]
    fn generate_image_tool_is_provider_less_and_always_installed() {
        // Empty integrations on purpose: `generate_image` has no provider
        // gate, so every chat agent must see it regardless of which
        // workspace integrations the org has enabled.
        let org_id = OrgId::new();
        let integrations: Vec<OrgIntegration> = Vec::new();

        let tools = installed_workspace_app_tools(&org_id, &integrations, "jwt-image");
        let generate_image = tools
            .iter()
            .find(|tool| tool.name == "generate_image")
            .expect("generate_image tool should ship for every org");
        assert!(generate_image
            .endpoint
            .ends_with("/tool-actions/generate_image"));
        assert!(matches!(generate_image.auth, ToolAuth::Bearer { .. }));
        assert!(
            generate_image.required_integration.is_none()
                || generate_image
                    .required_integration
                    .as_ref()
                    .and_then(|req| req.provider.as_deref())
                    .is_none(),
            "generate_image must not be gated on any workspace integration provider",
        );
    }

    // Environment-mutating tests share a process and must run serially.
    fn platform_key_env_lock() -> &'static std::sync::Mutex<()> {
        static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
        &LOCK
    }

    struct EnvVarGuard {
        key: &'static str,
        prev: Option<String>,
    }

    impl EnvVarGuard {
        fn set(key: &'static str, value: &str) -> Self {
            let prev = std::env::var(key).ok();
            std::env::set_var(key, value);
            Self { key, prev }
        }

        fn unset(key: &'static str) -> Self {
            let prev = std::env::var(key).ok();
            std::env::remove_var(key);
            Self { key, prev }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            match &self.prev {
                Some(value) => std::env::set_var(self.key, value),
                None => std::env::remove_var(self.key),
            }
        }
    }

    #[test]
    fn platform_key_set_no_org_brave_emits_brave_tools() {
        let _lock = platform_key_env_lock()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _env = EnvVarGuard::set(PLATFORM_BRAVE_KEY_ENV, "test-platform-key");
        let _platform_base = EnvVarGuard::unset(PLATFORM_TOOL_ACTION_BASE_URL_ENV);
        let org_id = OrgId::new();
        let integrations: Vec<OrgIntegration> = Vec::new();
        let tools = installed_workspace_app_tools(&org_id, &integrations, "jwt-test");
        let names: HashSet<&str> = tools.iter().map(|t| t.name.as_str()).collect();
        assert!(
            names.contains("brave_search_web"),
            "brave_search_web must be emitted when platform key is set"
        );
        assert!(
            names.contains("brave_search_news"),
            "brave_search_news must be emitted when platform key is set"
        );
    }

    #[test]
    fn platform_key_absent_no_org_brave_no_brave_tools() {
        let _lock = platform_key_env_lock()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _env = EnvVarGuard::unset(PLATFORM_BRAVE_KEY_ENV);
        let _platform_base = EnvVarGuard::unset(PLATFORM_TOOL_ACTION_BASE_URL_ENV);
        let org_id = OrgId::new();
        let integrations: Vec<OrgIntegration> = Vec::new();
        let tools = installed_workspace_app_tools(&org_id, &integrations, "jwt-test");
        let names: HashSet<&str> = tools.iter().map(|t| t.name.as_str()).collect();
        assert!(
            !names.contains("brave_search_web"),
            "brave_search_web must not be emitted when platform key is absent"
        );
        assert!(
            !names.contains("brave_search_news"),
            "brave_search_news must not be emitted when platform key is absent"
        );
    }

    #[test]
    fn platform_web_search_uses_server_callback_execution() {
        let _lock = platform_key_env_lock()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _env = EnvVarGuard::set(PLATFORM_BRAVE_KEY_ENV, "test-platform-key");
        let _platform_base = EnvVarGuard::unset(PLATFORM_TOOL_ACTION_BASE_URL_ENV);
        let org_id = OrgId::new();
        let integrations: Vec<OrgIntegration> = Vec::new();
        let tools = installed_workspace_app_tools(&org_id, &integrations, "jwt-test");
        let brave = tools
            .iter()
            .find(|t| t.name == "brave_search_web")
            .expect("brave_search_web must be present when platform key is set");
        assert!(
            brave.runtime_execution.is_none(),
            "platform Web Search must use the server callback path"
        );
    }

    #[test]
    fn platform_tool_action_base_set_no_org_brave_emits_cloud_endpoint() {
        let _lock = platform_key_env_lock()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _env = EnvVarGuard::unset(PLATFORM_BRAVE_KEY_ENV);
        let _platform_base = EnvVarGuard::set(
            PLATFORM_TOOL_ACTION_BASE_URL_ENV,
            "https://api.example.com/",
        );
        let org_id = OrgId::new();
        let integrations: Vec<OrgIntegration> = Vec::new();
        let tools = installed_workspace_app_tools(&org_id, &integrations, "jwt-test");
        let brave = tools
            .iter()
            .find(|t| t.name == "brave_search_web")
            .expect("brave_search_web must be present with a platform callback base");

        assert!(brave
            .endpoint
            .starts_with("https://api.example.com/api/orgs/"));
        assert!(
            brave.runtime_execution.is_none(),
            "desktop platform Web Search must keep the server-callback path"
        );
    }

    #[test]
    fn platform_tool_action_base_does_not_override_real_byok_brave_endpoint() {
        let _lock = platform_key_env_lock()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _env = EnvVarGuard::unset(PLATFORM_BRAVE_KEY_ENV);
        let _platform_base = EnvVarGuard::set(
            PLATFORM_TOOL_ACTION_BASE_URL_ENV,
            "https://platform.example.com",
        );
        let org_id = OrgId::new();
        let integrations = vec![test_integration(
            "Brave Search",
            "brave_search",
            OrgIntegrationKind::WorkspaceIntegration,
            true,
            true,
        )];
        let tools = installed_workspace_app_tools(&org_id, &integrations, "jwt-test");
        let brave = tools
            .iter()
            .find(|t| t.name == "brave_search_web")
            .expect("brave_search_web must be present with a real org key");

        assert!(!brave.endpoint.starts_with("https://platform.example.com/"));
    }

    #[test]
    fn installed_integrations_include_platform_search_without_duplicating_byok() {
        let _lock = platform_key_env_lock()
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let _key = EnvVarGuard::set(PLATFORM_BRAVE_KEY_ENV, "test-platform-key");
        let _platform_base = EnvVarGuard::unset(PLATFORM_TOOL_ACTION_BASE_URL_ENV);

        let installed = installed_workspace_integrations(&[]);
        assert_eq!(installed.len(), 1);
        assert_eq!(
            installed[0].integration_id,
            PLATFORM_WEB_SEARCH_INTEGRATION_ID
        );

        let byok = test_integration(
            "Brave Search",
            "brave_search",
            OrgIntegrationKind::WorkspaceIntegration,
            true,
            true,
        );
        let installed = installed_workspace_integrations(&[byok]);
        assert_eq!(
            installed
                .iter()
                .filter(|integration| integration.provider == "brave_search")
                .count(),
            1
        );
        assert_ne!(
            installed[0].integration_id,
            PLATFORM_WEB_SEARCH_INTEGRATION_ID
        );
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
