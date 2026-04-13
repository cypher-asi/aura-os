use std::collections::HashMap;
use std::collections::HashSet;
use std::sync::OnceLock;

use aura_os_integrations::{
    app_provider_contract_by_tool, app_provider_contracts, app_provider_runtime_auth,
    app_provider_runtime_base_url, control_plane_api_base_url as shared_control_plane_api_base_url,
    installed_tool_runtime_execution_for_provider,
    installed_workspace_app_tools as build_installed_workspace_app_tools,
    installed_workspace_integrations as build_installed_workspace_integrations,
    org_integration_tool_manifest_entries, TRUSTED_INTEGRATION_RUNTIME_METADATA_KEY,
};
use futures_util::stream::{self, StreamExt};
use serde::Deserialize;
use serde_json::Value;
use tracing::warn;

use aura_os_core::{Agent, OrgId, OrgIntegration, OrgIntegrationKind};
use aura_os_link::{
    InstalledIntegration, InstalledTool, InstalledToolRuntimeIntegration, ToolAuth,
};

use crate::handlers::trusted_mcp::{
    self, MCP_INTEGRATION_ID_METADATA_KEY, MCP_INTEGRATION_NAME_METADATA_KEY,
    MCP_TOOL_NAME_METADATA_KEY, TOOL_SOURCE_KIND_METADATA_KEY, TOOL_TRUST_CLASS_METADATA_KEY,
};
use crate::state::AppState;

#[allow(dead_code)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum WorkspaceToolSourceKind {
    AuraNative,
    AppProvider,
    Mcp,
}

const TRUSTED_MCP_DISCOVERY_CONCURRENCY: usize = 4;

#[derive(Clone, Debug)]
pub(crate) struct InstalledWorkspaceToolCatalog {
    pub(crate) tools: Vec<InstalledTool>,
    pub(crate) warnings: Vec<InstalledWorkspaceToolWarning>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct InstalledWorkspaceToolWarning {
    pub(crate) code: String,
    pub(crate) message: String,
    pub(crate) detail: String,
    pub(crate) source_kind: String,
    pub(crate) trust_class: String,
    pub(crate) integration_id: String,
    pub(crate) integration_name: String,
    pub(crate) provider: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceToolManifestEntry {
    name: String,
    provider: Option<String>,
    description: String,
    prompt_signature: String,
    input_schema: Value,
    saved_event: Option<String>,
    saved_payload_key: Option<String>,
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub(crate) struct WorkspaceToolDefinition {
    pub(crate) name: String,
    pub(crate) provider: Option<String>,
    pub(crate) description: String,
    pub(crate) prompt_signature: String,
    pub(crate) input_schema: Value,
    pub(crate) saved_event: Option<String>,
    pub(crate) saved_payload_key: Option<String>,
    pub(crate) source_kind: WorkspaceToolSourceKind,
    #[allow(dead_code)]
    pub(crate) source_id: String,
}

fn load_manifest_entries(
    entries: &[WorkspaceToolManifestEntry],
    label: &str,
    source_kind: WorkspaceToolSourceKind,
    source_id: &str,
) -> Vec<WorkspaceToolDefinition> {
    entries
        .iter()
        .cloned()
        .map(|tool| {
            assert!(
                tool.input_schema.is_object(),
                "{label} workspace tool `{}` must declare an object input schema",
                tool.name
            );
            WorkspaceToolDefinition {
                name: tool.name,
                provider: tool.provider,
                description: tool.description,
                prompt_signature: tool.prompt_signature,
                input_schema: tool.input_schema,
                saved_event: tool.saved_event,
                saved_payload_key: tool.saved_payload_key,
                source_kind,
                source_id: source_id.to_string(),
            }
        })
        .collect()
}

pub(crate) fn shared_workspace_tools() -> &'static [WorkspaceToolDefinition] {
    static TOOLS: OnceLock<Vec<WorkspaceToolDefinition>> = OnceLock::new();
    TOOLS.get_or_init(|| {
        let mut tools = Vec::new();
        let project_entries: Vec<WorkspaceToolManifestEntry> =
            serde_json::from_str(include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../infra/shared/project-control-plane-tools.json"
            )))
            .expect("workspace tool manifest should parse");
        tools.extend(load_manifest_entries(
            &project_entries,
            "aura native",
            WorkspaceToolSourceKind::AuraNative,
            "aura_project_control_plane",
        ));
        let integration_entries = org_integration_tool_manifest_entries()
            .iter()
            .cloned()
            .map(|entry| WorkspaceToolManifestEntry {
                name: entry.name,
                provider: entry.provider,
                description: entry.description,
                prompt_signature: entry.prompt_signature,
                input_schema: entry.input_schema,
                saved_event: None,
                saved_payload_key: None,
            })
            .collect::<Vec<_>>();
        tools.extend(load_manifest_entries(
            &integration_entries,
            "app provider",
            WorkspaceToolSourceKind::AppProvider,
            "builtin_app_providers",
        ));
        tools
    })
}

pub(crate) fn workspace_tool(name: &str) -> Option<&'static WorkspaceToolDefinition> {
    shared_workspace_tools()
        .iter()
        .find(|tool| tool.name == name)
}

async fn available_workspace_integration_providers_for_org(
    state: &AppState,
    org_id: &OrgId,
) -> HashSet<String> {
    integrations_for_org(state, org_id)
        .await
        .into_iter()
        .filter(|integration| {
            integration.has_secret
                && integration.enabled
                && matches!(
                    integration.kind,
                    aura_os_core::OrgIntegrationKind::WorkspaceIntegration
                )
        })
        .map(|integration| integration.provider)
        .collect()
}

pub(crate) async fn active_workspace_tools_for_org(
    state: &AppState,
    org_id: &OrgId,
) -> Vec<&'static WorkspaceToolDefinition> {
    let available_providers =
        available_workspace_integration_providers_for_org(state, org_id).await;
    shared_workspace_tools()
        .iter()
        .filter(|tool| {
            tool.provider
                .as_deref()
                .map(|provider| available_providers.contains(provider))
                .unwrap_or(true)
        })
        .collect()
}

pub(crate) async fn active_workspace_tools<'a>(
    state: &'a AppState,
    agent: &'a Agent,
) -> Vec<&'static WorkspaceToolDefinition> {
    let Some(org_id) = agent.org_id.as_ref() else {
        return Vec::new();
    };

    active_workspace_tools_for_org(state, org_id).await
}

pub(crate) fn control_plane_api_base_url() -> String {
    shared_control_plane_api_base_url()
}

pub(crate) async fn installed_workspace_app_tools(
    state: &AppState,
    org_id: &OrgId,
    bearer_token: &str,
) -> Vec<InstalledTool> {
    installed_workspace_app_tool_catalog(state, org_id, bearer_token)
        .await
        .tools
}

pub(crate) async fn installed_workspace_app_tool_catalog(
    state: &AppState,
    org_id: &OrgId,
    bearer_token: &str,
) -> InstalledWorkspaceToolCatalog {
    let integrations = integrations_for_org_with_token(state, org_id, Some(bearer_token)).await;
    let runtime_integrations =
        load_runtime_integrations(state, org_id, &integrations, Some(bearer_token)).await;
    let mut tools = build_installed_workspace_app_tools(org_id, &integrations, bearer_token);
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
        discovered_trusted_mcp_tool_catalog(state, org_id, bearer_token, &integrations).await;
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

async fn discovered_trusted_mcp_tool_catalog(
    state: &AppState,
    org_id: &OrgId,
    bearer_token: &str,
    integrations: &[OrgIntegration],
) -> InstalledWorkspaceToolCatalog {
    let base_url = control_plane_api_base_url();
    let mut tools = Vec::new();
    let mut warnings = Vec::new();
    let trusted_integrations = integrations
        .iter()
        .enumerate()
        .filter_map(|(index, integration)| {
            (integration.enabled && matches!(integration.kind, OrgIntegrationKind::McpServer))
                .then_some((index, integration.clone()))
        })
        .collect::<Vec<_>>();

    let mut discovered = stream::iter(trusted_integrations.into_iter().map(
        |(index, integration)| async move {
            let secret =
                load_integration_secret(state, org_id, &integration, Some(bearer_token)).await;
            let discovered = trusted_mcp::discover_tools(&integration, secret.as_deref()).await;
            (index, integration, discovered)
        },
    ))
    .buffer_unordered(TRUSTED_MCP_DISCOVERY_CONCURRENCY)
    .collect::<Vec<_>>()
    .await;
    discovered.sort_by_key(|(index, _, _)| *index);

    for (_, integration, discovered) in discovered {
        match discovered {
            Ok(discovered) => {
                for tool in discovered {
                    let endpoint = match discovered_mcp_tool_endpoint(
                        &base_url,
                        org_id,
                        &integration.integration_id,
                        &tool.original_name,
                    ) {
                        Ok(endpoint) => endpoint,
                        Err(error) => {
                            warn!(
                                %org_id,
                                integration_id = %integration.integration_id,
                                tool_name = %tool.original_name,
                                error = %error,
                                "failed to build trusted MCP tool endpoint"
                            );
                            continue;
                        }
                    };
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

                    tools.push(InstalledTool {
                        name: trusted_mcp::projected_tool_name(
                            &integration.integration_id,
                            &tool.original_name,
                        ),
                        description: format!("[{}] {}", integration.name, tool.description),
                        input_schema: tool.input_schema,
                        endpoint,
                        auth: ToolAuth::Bearer {
                            token: bearer_token.to_string(),
                        },
                        timeout_ms: Some(30_000),
                        namespace: Some("aura_trusted_mcp".to_string()),
                        required_integration: Some(
                            aura_os_link::InstalledToolIntegrationRequirement {
                                integration_id: Some(integration.integration_id.clone()),
                                provider: Some(integration.provider.clone()),
                                kind: Some("mcp_server".to_string()),
                            },
                        ),
                        runtime_execution: None,
                        metadata,
                    });
                }
            }
            Err(error) => {
                warn!(
                    %org_id,
                    integration_id = %integration.integration_id,
                    integration_name = %integration.name,
                    error = %error,
                    "failed to discover trusted MCP tools; catalog will be partial"
                );
                warnings.push(InstalledWorkspaceToolWarning {
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
                });
            }
        }
    }

    InstalledWorkspaceToolCatalog { tools, warnings }
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

async fn load_runtime_integrations(
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
        let auth = app_provider_runtime_auth(kind, &secret);
        by_provider
            .entry(integration.provider.clone())
            .or_default()
            .push(InstalledToolRuntimeIntegration {
                integration_id: integration.integration_id.clone(),
                base_url: app_provider_runtime_base_url(
                    kind,
                    &secret,
                    integration.provider_config.as_ref(),
                ),
                auth,
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
            });
    }
    by_provider
}

fn app_provider_contract_by_tool_provider(
    provider: &str,
) -> Option<aura_os_integrations::AppProviderKind> {
    app_provider_contracts()
        .iter()
        .find(|contract| contract.kind.provider_id() == provider)
        .map(|contract| contract.kind)
}

async fn load_integration_secret(
    state: &AppState,
    org_id: &OrgId,
    integration: &OrgIntegration,
    bearer_token: Option<&str>,
) -> Option<String> {
    if let Some(client) = &state.integrations_client {
        let canonical = if let Some(jwt) = bearer_token {
            client
                .get_integration_secret_authed(org_id, &integration.integration_id, jwt)
                .await
        } else {
            client
                .get_integration_secret(org_id, &integration.integration_id)
                .await
        };
        match canonical {
            Ok(secret) => {
                if let Some(secret) = secret.filter(|value| !value.trim().is_empty()) {
                    return Some(secret);
                }
                warn!(
                    %org_id,
                    integration_id = %integration.integration_id,
                    provider = %integration.provider,
                    "canonical aura-integrations secret missing or empty; falling back to compatibility-only local shadow"
                );
            }
            Err(error) => warn!(
                %org_id,
                integration_id = %integration.integration_id,
                provider = %integration.provider,
                error = %error,
                "failed to load canonical aura-integrations secret; falling back to compatibility-only local shadow"
            ),
        }
    }
    state
        .org_service
        .get_integration_secret(&integration.integration_id)
        .ok()
        .flatten()
        .filter(|value| !value.trim().is_empty())
}

#[allow(dead_code)]
pub(crate) async fn installed_workspace_integrations_for_org(
    state: &AppState,
    org_id: &OrgId,
) -> Vec<InstalledIntegration> {
    let integrations = integrations_for_org(state, org_id).await;
    let mut installed = build_installed_workspace_integrations(&integrations);
    for integration in &mut installed {
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
    installed
}

pub(crate) async fn installed_workspace_integrations_for_org_with_token(
    state: &AppState,
    org_id: &OrgId,
    bearer_token: &str,
) -> Vec<InstalledIntegration> {
    let integrations = integrations_for_org_with_token(state, org_id, Some(bearer_token)).await;
    let mut installed = build_installed_workspace_integrations(&integrations);
    for integration in &mut installed {
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
    installed
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, OnceLock};

    use aura_os_core::{OrgId, OrgIntegrationKind};
    use aura_os_integrations::IntegrationsClient;
    use aura_os_link::ToolAuth;
    use aura_os_orgs::IntegrationSecretUpdate;
    use axum::extract::Path;
    use axum::http::{header, HeaderMap, StatusCode};
    use axum::routing::get;
    use axum::Json;
    use axum::Router;
    use tokio::net::TcpListener;
    use tokio::sync::Mutex as AsyncMutex;

    fn trusted_mcp_script_test_lock() -> &'static AsyncMutex<()> {
        static LOCK: OnceLock<AsyncMutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| AsyncMutex::new(()))
    }

    #[tokio::test]
    async fn installed_workspace_app_tools_include_saved_provider_tools() {
        let db_dir = tempfile::tempdir().unwrap();
        let db_path = db_dir.path().join("settings.db");
        let state = crate::build_app_state(&db_path).expect("build app state");
        let org_id = OrgId::new();

        state
            .org_service
            .upsert_integration(
                &org_id,
                None,
                "Brave Search".to_string(),
                "brave_search".to_string(),
                OrgIntegrationKind::WorkspaceIntegration,
                None,
                None,
                Some(true),
                IntegrationSecretUpdate::Set("brave-secret".to_string()),
            )
            .expect("save brave integration");

        let tools = installed_workspace_app_tools(&state, &org_id, "jwt-123").await;
        let tool_names = tools
            .iter()
            .map(|tool| tool.name.as_str())
            .collect::<Vec<_>>();

        assert!(tool_names.contains(&"list_org_integrations"));
        assert!(tool_names.contains(&"brave_search_web"));
        assert!(tool_names.contains(&"brave_search_news"));

        let brave = tools
            .iter()
            .find(|tool| tool.name == "brave_search_web")
            .expect("brave_search_web installed");
        assert!(brave.endpoint.contains("/api/orgs/"));
        assert!(brave.endpoint.ends_with("/tool-actions/brave_search_web"));
        assert!(matches!(brave.auth, ToolAuth::Bearer { .. }));
        assert!(matches!(
            brave.runtime_execution,
            Some(aura_os_link::InstalledToolRuntimeExecution::AppProvider(_))
        ));
        assert_eq!(
            brave
                .required_integration
                .as_ref()
                .and_then(|requirement| requirement.provider.as_deref()),
            Some("brave_search")
        );
        assert_eq!(
            brave
                .required_integration
                .as_ref()
                .and_then(|requirement| requirement.kind.as_deref()),
            Some("workspace_integration")
        );
    }

    #[tokio::test]
    async fn installed_workspace_integrations_include_enabled_runtime_capabilities() {
        let db_dir = tempfile::tempdir().unwrap();
        let db_path = db_dir.path().join("settings.db");
        let state = crate::build_app_state(&db_path).expect("build app state");
        let org_id = OrgId::new();

        state
            .org_service
            .upsert_integration(
                &org_id,
                None,
                "Brave Search".to_string(),
                "brave_search".to_string(),
                OrgIntegrationKind::WorkspaceIntegration,
                None,
                None,
                Some(true),
                IntegrationSecretUpdate::Set("brave-secret".to_string()),
            )
            .expect("save brave integration");

        state
            .org_service
            .upsert_integration(
                &org_id,
                None,
                "Filesystem MCP".to_string(),
                "mcp_server".to_string(),
                OrgIntegrationKind::McpServer,
                None,
                Some(serde_json::json!({"command":"npx","args":["-y","pkg"]})),
                Some(true),
                IntegrationSecretUpdate::Preserve,
            )
            .expect("save mcp integration");

        let integrations = installed_workspace_integrations_for_org(&state, &org_id).await;
        let ids = integrations
            .iter()
            .map(|integration| integration.provider.as_str())
            .collect::<Vec<_>>();

        assert!(ids.contains(&"brave_search"));
        assert!(ids.contains(&"mcp_server"));
    }

    #[tokio::test]
    async fn installed_workspace_app_tools_include_discovered_trusted_mcp_tools() {
        let _script_lock = trusted_mcp_script_test_lock().lock().await;
        let script_dir = tempfile::tempdir().unwrap();
        let script_path = script_dir.path().join("trusted-mcp-mock.sh");
        std::fs::write(
            &script_path,
            r#"#!/bin/sh
printf '%s' '[{"originalName":"search_docs","description":"Search docs","inputSchema":{"type":"object","properties":{"query":{"type":"string"}}}}]'
"#,
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&script_path).unwrap().permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&script_path, perms).unwrap();
        }
        crate::handlers::trusted_mcp::set_script_override_for_tests(script_path);

        let db_dir = tempfile::tempdir().unwrap();
        let db_path = db_dir.path().join("settings.db");
        let state = crate::build_app_state(&db_path).expect("build app state");
        let org_id = OrgId::new();

        state
            .org_service
            .upsert_integration(
                &org_id,
                None,
                "Docs MCP".to_string(),
                "mcp_server".to_string(),
                OrgIntegrationKind::McpServer,
                None,
                Some(serde_json::json!({"transport":"stdio","command":"demo"})),
                Some(true),
                IntegrationSecretUpdate::Preserve,
            )
            .expect("save mcp integration");

        let integration = state
            .org_service
            .list_integrations(&org_id)
            .expect("list integrations")
            .into_iter()
            .find(|integration| integration.provider == "mcp_server")
            .expect("mcp integration exists");
        let discovered = crate::handlers::trusted_mcp::discover_tools(&integration, None)
            .await
            .expect("discover trusted MCP tools");
        assert_eq!(discovered.len(), 1);
        assert_eq!(discovered[0].original_name, "search_docs");

        let tools = installed_workspace_app_tools(&state, &org_id, "jwt-123").await;
        let tool = tools
            .iter()
            .find(|tool| tool.name.contains("search_docs"))
            .expect("trusted MCP tool installed");

        assert_eq!(tool.namespace.as_deref(), Some("aura_trusted_mcp"));
        assert!(tool.endpoint.contains("/tool-actions/mcp/"));
        assert!(matches!(tool.auth, ToolAuth::Bearer { .. }));
        assert_eq!(
            tool.metadata.get(TOOL_TRUST_CLASS_METADATA_KEY),
            Some(&Value::String("trusted_mcp".to_string()))
        );
    }

    async fn start_mock_integrations_server(
        integrations: Vec<OrgIntegration>,
        secret: Option<&'static str>,
    ) -> String {
        let listed_integrations = integrations.clone();
        let app = Router::new()
            .route(
                "/internal/orgs/:org_id/integrations",
                get(move |Path(_org_id): Path<String>| {
                    let integrations = listed_integrations.clone();
                    async move { Json(integrations) }
                }),
            )
            .route(
                "/internal/orgs/:org_id/integrations/:integration_id/secret",
                get(
                    move |Path((_org_id, _integration_id)): Path<(String, String)>| async move {
                        Json(serde_json::json!({ "secret": secret }))
                    },
                ),
            );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        format!("http://{address}")
    }

    async fn start_mock_public_integrations_server(
        expected_bearer: &'static str,
        integrations: Vec<OrgIntegration>,
        secret: Option<&'static str>,
    ) -> String {
        let listed_integrations = integrations.clone();
        let expected_auth = format!("Bearer {expected_bearer}");
        let list_expected_auth = expected_auth.clone();
        let secret_expected_auth = expected_auth.clone();
        let app = Router::new()
            .route(
                "/api/orgs/:org_id/integrations",
                get(move |Path(_org_id): Path<String>, headers: HeaderMap| {
                    let integrations = listed_integrations.clone();
                    let expected_auth = list_expected_auth.clone();
                    async move {
                        if headers
                            .get(header::AUTHORIZATION)
                            .and_then(|value| value.to_str().ok())
                            != Some(expected_auth.as_str())
                        {
                            return (
                                StatusCode::UNAUTHORIZED,
                                Json(serde_json::json!({ "error": "unauthorized" })),
                            );
                        }
                        (
                            StatusCode::OK,
                            Json(
                                serde_json::to_value(integrations).expect("serialize integrations"),
                            ),
                        )
                    }
                }),
            )
            .route(
                "/api/orgs/:org_id/integrations/:integration_id/secret",
                get(
                    move |Path((_org_id, _integration_id)): Path<(String, String)>,
                          headers: HeaderMap| {
                        let expected_auth = secret_expected_auth.clone();
                        async move {
                            if headers
                                .get(header::AUTHORIZATION)
                                .and_then(|value| value.to_str().ok())
                                != Some(expected_auth.as_str())
                            {
                                return (
                                    StatusCode::UNAUTHORIZED,
                                    Json(serde_json::json!({ "error": "unauthorized" })),
                                );
                            }
                            (
                                StatusCode::OK,
                                Json(serde_json::json!({ "secret": secret })),
                            )
                        }
                    },
                ),
            );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        format!("http://{address}")
    }

    #[tokio::test]
    async fn canonical_secret_source_wins_over_local_shadow() {
        let db_dir = tempfile::tempdir().unwrap();
        let db_path = db_dir.path().join("settings.db");
        let mut state = crate::build_app_state(&db_path).expect("build app state");
        let org_id = OrgId::new();

        let integration = state
            .org_service
            .upsert_integration(
                &org_id,
                None,
                "Brave Search".to_string(),
                "brave_search".to_string(),
                OrgIntegrationKind::WorkspaceIntegration,
                None,
                None,
                Some(true),
                IntegrationSecretUpdate::Set("local-shadow-secret".to_string()),
            )
            .expect("save brave integration");

        let base_url =
            start_mock_integrations_server(Vec::new(), Some("canonical-remote-secret")).await;
        state.integrations_client = Some(Arc::new(IntegrationsClient::with_base_url(
            &base_url,
            "internal-token",
        )));

        let secret = load_integration_secret(&state, &org_id, &integration, None).await;
        assert_eq!(secret, Some("canonical-remote-secret".to_string()));
    }

    #[tokio::test]
    async fn canonical_secret_falls_back_to_local_shadow_when_missing() {
        let db_dir = tempfile::tempdir().unwrap();
        let db_path = db_dir.path().join("settings.db");
        let mut state = crate::build_app_state(&db_path).expect("build app state");
        let org_id = OrgId::new();

        let integration = state
            .org_service
            .upsert_integration(
                &org_id,
                None,
                "Brave Search".to_string(),
                "brave_search".to_string(),
                OrgIntegrationKind::WorkspaceIntegration,
                None,
                None,
                Some(true),
                IntegrationSecretUpdate::Set("local-shadow-secret".to_string()),
            )
            .expect("save brave integration");

        let base_url = start_mock_integrations_server(Vec::new(), None).await;
        state.integrations_client = Some(Arc::new(IntegrationsClient::with_base_url(
            &base_url,
            "internal-token",
        )));

        let secret = load_integration_secret(&state, &org_id, &integration, None).await;
        assert_eq!(secret, Some("local-shadow-secret".to_string()));
    }

    #[tokio::test]
    async fn jwt_backed_integrations_for_org_uses_public_routes() {
        let db_dir = tempfile::tempdir().unwrap();
        let db_path = db_dir.path().join("settings.db");
        let mut state = crate::build_app_state(&db_path).expect("build app state");
        let org_id = OrgId::new();
        let canonical = OrgIntegration {
            integration_id: "canonical-brave".to_string(),
            org_id,
            name: "Canonical Brave".to_string(),
            provider: "brave_search".to_string(),
            kind: OrgIntegrationKind::WorkspaceIntegration,
            default_model: None,
            provider_config: None,
            has_secret: true,
            enabled: true,
            secret_last4: Some("1234".to_string()),
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        };
        let base_url = start_mock_public_integrations_server(
            "jwt-123",
            vec![canonical.clone()],
            Some("canonical-remote-secret"),
        )
        .await;
        state.integrations_client = Some(Arc::new(IntegrationsClient::with_base_url(
            &base_url,
            "unused-internal-token",
        )));

        let integrations = integrations_for_org_with_token(&state, &org_id, Some("jwt-123")).await;
        assert_eq!(integrations.len(), 1);
        assert_eq!(integrations[0].integration_id, canonical.integration_id);
        assert_eq!(integrations[0].provider, "brave_search");
    }

    #[tokio::test]
    async fn jwt_backed_secret_load_uses_public_routes() {
        let db_dir = tempfile::tempdir().unwrap();
        let db_path = db_dir.path().join("settings.db");
        let mut state = crate::build_app_state(&db_path).expect("build app state");
        let org_id = OrgId::new();
        let integration = state
            .org_service
            .upsert_integration(
                &org_id,
                Some("canonical-brave"),
                "Brave Search".to_string(),
                "brave_search".to_string(),
                OrgIntegrationKind::WorkspaceIntegration,
                None,
                None,
                Some(true),
                IntegrationSecretUpdate::Set("local-shadow-secret".to_string()),
            )
            .expect("save brave integration");

        let base_url = start_mock_public_integrations_server(
            "jwt-123",
            vec![integration.clone()],
            Some("canonical-remote-secret"),
        )
        .await;
        state.integrations_client = Some(Arc::new(IntegrationsClient::with_base_url(
            &base_url,
            "unused-internal-token",
        )));

        let secret = load_integration_secret(&state, &org_id, &integration, Some("jwt-123")).await;
        assert_eq!(secret, Some("canonical-remote-secret".to_string()));
    }

    #[tokio::test]
    async fn active_workspace_tools_for_org_prefers_canonical_provider_list() {
        let db_dir = tempfile::tempdir().unwrap();
        let db_path = db_dir.path().join("settings.db");
        let mut state = crate::build_app_state(&db_path).expect("build app state");
        let org_id = OrgId::new();

        state
            .org_service
            .upsert_integration(
                &org_id,
                Some("local-brave"),
                "Local Disabled Brave".to_string(),
                "brave_search".to_string(),
                OrgIntegrationKind::WorkspaceIntegration,
                None,
                None,
                Some(false),
                IntegrationSecretUpdate::Set("local-shadow-secret".to_string()),
            )
            .expect("save local shadow");

        let canonical = OrgIntegration {
            integration_id: "canonical-brave".to_string(),
            org_id,
            name: "Canonical Brave".to_string(),
            provider: "brave_search".to_string(),
            kind: OrgIntegrationKind::WorkspaceIntegration,
            default_model: None,
            provider_config: None,
            has_secret: true,
            enabled: true,
            secret_last4: Some("1234".to_string()),
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        };
        let base_url =
            start_mock_integrations_server(vec![canonical], Some("canonical-remote-secret")).await;
        state.integrations_client = Some(Arc::new(IntegrationsClient::with_base_url(
            &base_url,
            "internal-token",
        )));

        let tools = active_workspace_tools_for_org(&state, &org_id).await;
        let tool_names = tools
            .iter()
            .map(|tool| tool.name.as_str())
            .collect::<Vec<_>>();

        assert!(tool_names.contains(&"brave_search_web"));
        assert!(tool_names.contains(&"brave_search_news"));
    }

    #[tokio::test]
    async fn installed_workspace_tool_catalog_surfaces_trusted_mcp_discovery_warnings() {
        let _script_lock = trusted_mcp_script_test_lock().lock().await;
        let script_dir = tempfile::tempdir().unwrap();
        let script_path = script_dir.path().join("trusted-mcp-fail.sh");
        std::fs::write(
            &script_path,
            r#"#!/bin/sh
echo 'bridge failure' >&2
exit 1
"#,
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&script_path).unwrap().permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&script_path, perms).unwrap();
        }
        crate::handlers::trusted_mcp::set_script_override_for_tests(script_path);

        let db_dir = tempfile::tempdir().unwrap();
        let db_path = db_dir.path().join("settings.db");
        let state = crate::build_app_state(&db_path).expect("build app state");
        let org_id = OrgId::new();

        state
            .org_service
            .upsert_integration(
                &org_id,
                Some("mcp-1"),
                "Docs MCP".to_string(),
                "mcp_server".to_string(),
                OrgIntegrationKind::McpServer,
                None,
                Some(serde_json::json!({"transport":"stdio","command":"demo"})),
                Some(true),
                IntegrationSecretUpdate::Preserve,
            )
            .expect("save mcp integration");

        let catalog = installed_workspace_app_tool_catalog(&state, &org_id, "jwt-123").await;

        assert_eq!(catalog.warnings.len(), 1);
        assert_eq!(catalog.warnings[0].code, "trusted_mcp_discovery_failed");
        assert_eq!(catalog.warnings[0].integration_id, "mcp-1");
        assert_eq!(catalog.warnings[0].integration_name, "Docs MCP");
        assert_eq!(catalog.warnings[0].source_kind, "mcp");
        assert_eq!(catalog.warnings[0].trust_class, "trusted_mcp");
        assert!(catalog.warnings[0]
            .message
            .contains("tool catalog is partial"));
        assert!(catalog
            .tools
            .iter()
            .all(|tool| tool.namespace.as_deref() != Some("aura_trusted_mcp")));
    }
}
