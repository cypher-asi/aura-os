use std::collections::HashMap;
use std::collections::HashSet;
use std::sync::OnceLock;

use aura_os_integrations::{
    app_provider_contract_by_tool, app_provider_contracts, app_provider_runtime_auth,
    control_plane_api_base_url as shared_control_plane_api_base_url,
    installed_tool_runtime_execution_for_provider,
    installed_workspace_app_tools as build_installed_workspace_app_tools,
    installed_workspace_integrations as build_installed_workspace_integrations,
    org_integration_tool_manifest_entries,
};
use serde::Deserialize;
use serde_json::Value;
use tracing::warn;

use aura_os_core::{Agent, OrgId, OrgIntegration, OrgIntegrationKind};
use aura_os_link::{InstalledIntegration, InstalledTool, InstalledToolRuntimeIntegration};

use crate::state::AppState;

#[allow(dead_code)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum WorkspaceToolSourceKind {
    AuraNative,
    AppProvider,
    Mcp,
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

fn available_workspace_integration_providers_for_org(
    state: &AppState,
    org_id: &OrgId,
) -> HashSet<String> {
    state
        .org_service
        .list_integrations(org_id)
        .map(|integrations| {
            integrations
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
        })
        .unwrap_or_default()
}

pub(crate) fn active_workspace_tools_for_org(
    state: &AppState,
    org_id: &OrgId,
) -> Vec<&'static WorkspaceToolDefinition> {
    let available_providers = available_workspace_integration_providers_for_org(state, org_id);
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

pub(crate) fn active_workspace_tools<'a>(
    state: &'a AppState,
    agent: &'a Agent,
) -> Vec<&'static WorkspaceToolDefinition> {
    let Some(org_id) = agent.org_id.as_ref() else {
        return Vec::new();
    };

    active_workspace_tools_for_org(state, org_id)
}

pub(crate) fn control_plane_api_base_url() -> String {
    shared_control_plane_api_base_url()
}

pub(crate) async fn installed_workspace_app_tools(
    state: &AppState,
    org_id: &OrgId,
    bearer_token: &str,
) -> Vec<InstalledTool> {
    let Ok(integrations) = state.org_service.list_integrations(org_id) else {
        return Vec::new();
    };
    let runtime_integrations = load_runtime_integrations(state, org_id, &integrations).await;
    let mut tools = build_installed_workspace_app_tools(org_id, &integrations, bearer_token);
    for tool in &mut tools {
        let Some(contract) = app_provider_contract_by_tool(&tool.name) else {
            continue;
        };
        let Some(integrations) = runtime_integrations.get(contract.kind.provider_id()) else {
            continue;
        };
        tool.runtime_execution =
            installed_tool_runtime_execution_for_provider(contract.kind, integrations.clone());
    }
    tools
}

async fn load_runtime_integrations(
    state: &AppState,
    org_id: &OrgId,
    integrations: &[OrgIntegration],
) -> HashMap<String, Vec<InstalledToolRuntimeIntegration>> {
    let mut by_provider = HashMap::<String, Vec<InstalledToolRuntimeIntegration>>::new();
    for integration in integrations.iter().filter(|integration| {
        integration.enabled
            && integration.has_secret
            && matches!(integration.kind, OrgIntegrationKind::WorkspaceIntegration)
    }) {
        let Some(secret) = load_integration_secret(state, org_id, integration).await else {
            continue;
        };
        let auth = match app_provider_contract_by_tool_provider(&integration.provider) {
            Some(kind) => app_provider_runtime_auth(kind, &secret),
            None => continue,
        };
        by_provider
            .entry(integration.provider.clone())
            .or_default()
            .push(InstalledToolRuntimeIntegration {
                integration_id: integration.integration_id.clone(),
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
) -> Option<String> {
    if let Some(client) = &state.integrations_client {
        match client
            .get_integration_secret(org_id, &integration.integration_id)
            .await
        {
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

pub(crate) fn installed_workspace_integrations_for_org(
    state: &AppState,
    org_id: &OrgId,
) -> Vec<InstalledIntegration> {
    state
        .org_service
        .list_integrations(org_id)
        .map(|integrations| build_installed_workspace_integrations(&integrations))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    use aura_os_core::{OrgId, OrgIntegrationKind};
    use aura_os_integrations::IntegrationsClient;
    use aura_os_link::ToolAuth;
    use aura_os_orgs::IntegrationSecretUpdate;
    use axum::extract::Path;
    use axum::routing::get;
    use axum::Json;
    use axum::Router;
    use tokio::net::TcpListener;

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

        let integrations = installed_workspace_integrations_for_org(&state, &org_id);
        let ids = integrations
            .iter()
            .map(|integration| integration.provider.as_str())
            .collect::<Vec<_>>();

        assert!(ids.contains(&"brave_search"));
        assert!(ids.contains(&"mcp_server"));
    }

    async fn start_mock_integrations_server(secret: Option<&'static str>) -> String {
        let app = Router::new().route(
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

        let base_url = start_mock_integrations_server(Some("canonical-remote-secret")).await;
        state.integrations_client = Some(Arc::new(IntegrationsClient::with_base_url(
            &base_url,
            "internal-token",
        )));

        let secret = load_integration_secret(&state, &org_id, &integration).await;
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

        let base_url = start_mock_integrations_server(None).await;
        state.integrations_client = Some(Arc::new(IntegrationsClient::with_base_url(
            &base_url,
            "internal-token",
        )));

        let secret = load_integration_secret(&state, &org_id, &integration).await;
        assert_eq!(secret, Some("local-shadow-secret".to_string()));
    }
}
