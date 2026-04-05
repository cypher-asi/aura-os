use std::collections::HashSet;
use std::sync::OnceLock;

use serde::Deserialize;
use serde_json::Value;

use aura_os_core::Agent;

use crate::state::AppState;

#[allow(dead_code)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum WorkspaceToolSourceKind {
    AuraNative,
    Plugin,
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

fn load_manifest(
    manifest: &str,
    label: &str,
    source_kind: WorkspaceToolSourceKind,
    source_id: &str,
) -> Vec<WorkspaceToolDefinition> {
    let entries: Vec<WorkspaceToolManifestEntry> =
        serde_json::from_str(manifest).expect("workspace tool manifest should parse");
    entries
        .into_iter()
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
        tools.extend(load_manifest(
            include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../shared/project-control-plane-tools.json"
            )),
            "aura native",
            WorkspaceToolSourceKind::AuraNative,
            "aura_project_control_plane",
        ));
        tools.extend(load_manifest(
            include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../shared/org-integration-tools.json"
            )),
            "builtin plugin",
            WorkspaceToolSourceKind::Plugin,
            "builtin_workspace_integrations",
        ));
        tools
    })
}

pub(crate) fn workspace_tool(name: &str) -> Option<&'static WorkspaceToolDefinition> {
    shared_workspace_tools().iter().find(|tool| tool.name == name)
}

fn available_workspace_integration_providers(state: &AppState, agent: &Agent) -> HashSet<String> {
    let Some(org_id) = agent.org_id else {
        return HashSet::new();
    };

    state
        .org_service
        .list_integrations(&org_id)
        .map(|integrations| {
            integrations
                .into_iter()
                .filter(|integration| {
                    integration.has_secret
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

pub(crate) fn active_workspace_tools<'a>(
    state: &'a AppState,
    agent: &'a Agent,
) -> Vec<&'static WorkspaceToolDefinition> {
    let available_providers = available_workspace_integration_providers(state, agent);
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
