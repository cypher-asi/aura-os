//! Diagnostic endpoint that exposes the exact `installed_tools` list the
//! server would ship to the harness for a given agent, annotated with
//! per-tool metadata about whether the server can actually dispatch the
//! name. Intended to back the "Active harness tools" panel in the
//! agents sidekick so wiring gaps (for example a `Capability`-driven
//! tool name that isn't registered in the dispatcher) are visible
//! without having to run a chat session.

use std::collections::HashSet;

use axum::extract::{Path, State};
use axum::Json;
use serde::Serialize;

use aura_os_agent_tools::all_dispatchable_tool_names;
use aura_os_agent_tools::ceo::{
    absolutize_agent_tool_endpoints, aura_native_project_tool_origin, build_cross_agent_tools,
    AGENT_TOOL_PATH_PREFIX,
};
use aura_os_core::{Agent, AgentId, AgentPermissions, Capability};
use aura_os_link::InstalledTool;
use aura_protocol::AgentPermissionsWire;

use crate::error::{map_network_error, ApiError, ApiResult};
use crate::handlers::agents::harness_target::harness_target_is_remote;
use crate::handlers::agents::tool_dedupe::dedupe_installed_tools_by_name;
use crate::handlers::agents::workspace_tools::{
    installed_workspace_app_tools, installed_workspace_integrations_for_org_with_token,
};
use crate::state::{AppState, AuthJwt};

use super::conversions::agent_from_network;

/// Per-tool diagnostic row. Mirrors the wire shape consumed by
/// `PermissionsTab` on the frontend.
#[derive(Debug, Clone, Serialize)]
pub(crate) struct InstalledToolDiagnosticRow {
    pub name: String,
    pub endpoint: String,
    /// `"workspace"`, `"cross_agent"`, or `"integration"`.
    pub source: &'static str,
    /// Capability variant that caused a `cross_agent` tool to be added,
    /// serialised using the same camelCase wire form as
    /// [`aura_protocol::CapabilityWire`]. `None` for workspace /
    /// integration tools and for the full CEO manifest (where the whole
    /// manifest is emitted unconditionally).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capability_origin: Option<String>,
    /// Whether the server-side dispatcher at
    /// `/api/agent_tools/:name` knows how to execute this tool. Always
    /// `true` for workspace / integration tools (they are executed via
    /// other endpoints).
    pub registered: bool,
}

/// Top-level response shape.
#[derive(Debug, Clone, Serialize)]
pub(crate) struct AgentInstalledToolsDiagnostic {
    pub agent_id: String,
    pub is_ceo_preset: bool,
    pub agent_permissions: AgentPermissionsWire,
    pub tools: Vec<InstalledToolDiagnosticRow>,
    /// Tool names whose endpoint points at `/api/agent_tools/:name` but
    /// which are not present in
    /// [`aura_os_agent_tools::all_dispatchable_tool_names`].
    /// Typically indicates a wiring bug (for example a
    /// `Capability`-gated name that never got a concrete `AgentTool`
    /// implementation registered).
    pub missing_registrations: Vec<String>,
    /// Tool names that collide between `workspace_tools` and
    /// `cross_agent_tools`. Expected to be empty in normal operation —
    /// any name listed here would have 400'd Anthropic with
    /// `tools: Tool names must be unique.` prior to the server-side
    /// dedupe. Kept in the diagnostic so the sidekick can surface
    /// collisions that the harness resolves via first-occurrence
    /// wins.
    pub duplicate_names: Vec<String>,
    /// Exact name list that `chat::build_session_installed_tools`
    /// would ship to the harness for this agent today, after
    /// first-occurrence-wins dedupe. Mirrors the `info!` line emitted
    /// at `SessionInit`; surfacing it here lets the frontend verify
    /// the list against the harness request body without re-running a
    /// chat turn.
    pub final_shipped_names: Vec<String>,
}

/// GET `/api/agents/:agent_id/installed-tools`
///
/// Returns the exact `installed_tools` list [`crate::handlers::agents::chat`]
/// would build for this agent in a fresh session, annotated with dispatch
/// reachability. Read-only, so it's safe to call on every Permissions
/// sidekick render.
pub(crate) async fn get_installed_tools_diagnostic(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<Json<AgentInstalledToolsDiagnostic>> {
    let agent = load_agent(&state, &jwt, &agent_id).await?;

    let workspace_tools = if let Some(org_id) = agent.org_id.as_ref() {
        installed_workspace_app_tools(&state, org_id, &jwt).await
    } else {
        Vec::new()
    };
    let mut cross_agent_tools = build_cross_agent_tools(&agent.permissions);
    // Mirror `build_session_installed_tools`: the live chat path
    // stamps the control-plane base URL onto every cross-agent
    // endpoint before shipping the manifest to the harness. The
    // diagnostic must apply the exact same transform so the sidekick
    // shows the endpoints the harness would actually invoke —
    // including surfacing the same named error when the server would
    // otherwise stamp a loopback URL onto a manifest bound for a
    // remote harness.
    let remote = harness_target_is_remote(&agent.machine_type);
    let base_url = match aura_os_integrations::control_plane_api_base_url_or_error(remote) {
        Ok(url) => url,
        Err(aura_os_integrations::ControlPlaneBaseUrlError::MissingForRemoteHarness {
            fallback_url,
        }) => {
            tracing::error!(
                agent_id = %agent_id,
                fallback_url = %fallback_url,
                "refusing to ship loopback control-plane URL to remote harness; \
                 set AURA_SERVER_BASE_URL to the server's public URL"
            );
            return Err(ApiError::internal(format!(
                "AURA_SERVER_BASE_URL must be set when the harness runs off-box; \
                 refusing to ship `{fallback_url}` to the harness"
            )));
        }
    };
    absolutize_agent_tool_endpoints(&mut cross_agent_tools, &base_url);
    let integration_tools = if let Some(org_id) = agent.org_id.as_ref() {
        installed_workspace_integrations_for_org_with_token(&state, org_id, &jwt).await
    } else {
        Vec::new()
    };

    let dispatchable: HashSet<String> = all_dispatchable_tool_names();

    let mut rows: Vec<InstalledToolDiagnosticRow> = Vec::new();
    for tool in &workspace_tools {
        rows.push(diagnostic_row(
            &tool.name,
            &tool.endpoint,
            "workspace",
            None,
            &dispatchable,
        ));
    }
    let is_ceo_preset = agent.permissions.is_ceo_preset();
    for tool in &cross_agent_tools {
        let origin = if is_ceo_preset {
            None
        } else {
            capability_origin_for_cross_agent_tool(&tool.name, &agent.permissions)
        };
        rows.push(diagnostic_row(
            &tool.name,
            &tool.endpoint,
            "cross_agent",
            origin,
            &dispatchable,
        ));
    }
    // Integrations aren't tools per se, but the harness exposes their
    // provider tools through `installed_integrations` alongside the tool
    // list. Surface them here so the sidekick can show the full picture.
    for integration in &integration_tools {
        rows.push(InstalledToolDiagnosticRow {
            name: integration.name.clone(),
            endpoint: integration.provider.clone(),
            source: "integration",
            capability_origin: None,
            registered: true,
        });
    }

    let missing_registrations: Vec<String> = rows
        .iter()
        .filter(|row| row.source == "cross_agent" && !row.registered)
        .map(|row| row.name.clone())
        .collect();

    // Mirror what `build_session_installed_tools` does at chat open
    // time: concatenate workspace + cross-agent tools and run the
    // shared dedupe. Integrations are not part of `tools[]` shipped to
    // the LLM so they're excluded from this preview.
    let mut shipped: Vec<InstalledTool> = workspace_tools.clone();
    shipped.extend(cross_agent_tools.iter().cloned());
    let duplicate_names = dedupe_installed_tools_by_name(&mut shipped);
    let final_shipped_names: Vec<String> =
        shipped.iter().map(|tool| tool.name.clone()).collect();

    Ok(Json(AgentInstalledToolsDiagnostic {
        agent_id: agent_id.to_string(),
        is_ceo_preset,
        agent_permissions: (&agent.permissions).into(),
        tools: rows,
        missing_registrations,
        duplicate_names,
        final_shipped_names,
    }))
}

fn diagnostic_row(
    name: &str,
    endpoint: &str,
    source: &'static str,
    capability_origin: Option<String>,
    dispatchable: &HashSet<String>,
) -> InstalledToolDiagnosticRow {
    let registered = if endpoint.contains(AGENT_TOOL_PATH_PREFIX) {
        dispatchable.contains(name)
    } else {
        true
    };
    InstalledToolDiagnosticRow {
        name: name.to_string(),
        endpoint: endpoint.to_string(),
        source,
        capability_origin,
        registered,
    }
}

/// Map a cross-agent tool name back to the [`Capability`] variant that
/// caused [`build_cross_agent_tools`] to emit it (non-CEO branch only).
/// Kept in lockstep with [`build_cross_agent_tools`]; if that function
/// gains a new branch, add the mapping here too.
fn capability_origin_for_cross_agent_tool(
    name: &str,
    permissions: &AgentPermissions,
) -> Option<String> {
    let caps = &permissions.capabilities;
    let matches_capability = |want: &Capability| caps.contains(want);
    let origin = match name {
        "spawn_agent" if matches_capability(&Capability::SpawnAgent) => Capability::SpawnAgent,
        "send_to_agent" | "remote_agent_action"
            if matches_capability(&Capability::ControlAgent) =>
        {
            Capability::ControlAgent
        }
        "get_agent" | "list_agents" | "get_remote_agent_state"
            if matches_capability(&Capability::ReadAgent) =>
        {
            Capability::ReadAgent
        }
        _ => {
            // Aura-native project tools are emitted by
            // `build_cross_agent_tools` whenever the agent has *any*
            // `ReadProject` / `WriteProject` grant. The diagnostic
            // doesn't need to know which specific project id the
            // capability targets — the sidekick groups tools by
            // capability *kind*, so we fall through to the canonical
            // origin from the runtime helper and verify the agent
            // actually has a matching grant before labelling the row.
            let origin = aura_native_project_tool_origin(name)?;
            match &origin {
                Capability::ReadProject { .. }
                    if caps.iter().any(|c| {
                        matches!(
                            c,
                            Capability::ReadProject { .. } | Capability::WriteProject { .. }
                        )
                    }) => {}
                Capability::WriteProject { .. }
                    if caps
                        .iter()
                        .any(|c| matches!(c, Capability::WriteProject { .. })) => {}
                _ => return None,
            }
            origin
        }
    };
    Some(capability_wire_tag(&origin).to_string())
}

fn capability_wire_tag(cap: &Capability) -> &'static str {
    match cap {
        Capability::SpawnAgent => "spawnAgent",
        Capability::ControlAgent => "controlAgent",
        Capability::ReadAgent => "readAgent",
        Capability::ManageOrgMembers => "manageOrgMembers",
        Capability::ManageBilling => "manageBilling",
        Capability::InvokeProcess => "invokeProcess",
        Capability::PostToFeed => "postToFeed",
        Capability::GenerateMedia => "generateMedia",
        Capability::ReadProject { .. } => "readProject",
        Capability::WriteProject { .. } => "writeProject",
    }
}

async fn load_agent(state: &AppState, jwt: &str, agent_id: &AgentId) -> ApiResult<Agent> {
    if let Some(ref client) = state.network_client {
        let net_agent = client
            .get_agent(&agent_id.to_string(), jwt)
            .await
            .map_err(map_network_error)?;
        let mut agent = agent_from_network(&net_agent);
        let _ = state.agent_service.apply_runtime_config(&mut agent);
        return Ok(agent);
    }
    state
        .agent_service
        .get_agent_local(agent_id)
        .map_err(|e| match e {
            aura_os_agents::AgentError::NotFound => ApiError::not_found("agent not found"),
            _ => ApiError::internal(format!("fetching agent: {e}")),
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_os_core::{AgentPermissions, AgentScope, Capability};

    #[test]
    fn diagnostic_row_flags_unregistered_cross_agent_tool() {
        let mut dispatchable: HashSet<String> = HashSet::new();
        dispatchable.insert("create_agent".to_string());

        let row = diagnostic_row(
            "spawn_agent",
            "/api/agent_tools/spawn_agent",
            "cross_agent",
            Some("spawnAgent".to_string()),
            &dispatchable,
        );
        assert_eq!(row.name, "spawn_agent");
        assert_eq!(row.source, "cross_agent");
        assert_eq!(row.capability_origin.as_deref(), Some("spawnAgent"));
        assert!(!row.registered);
    }

    #[test]
    fn diagnostic_row_marks_workspace_tools_registered() {
        let dispatchable: HashSet<String> = HashSet::new();
        let row = diagnostic_row(
            "search_docs",
            "https://example.com/tools/search_docs",
            "workspace",
            None,
            &dispatchable,
        );
        assert!(row.registered);
        assert_eq!(row.source, "workspace");
    }

    #[test]
    fn cross_agent_origin_maps_for_non_ceo_permissions() {
        let perms = AgentPermissions {
            scope: AgentScope::default(),
            capabilities: vec![
                Capability::SpawnAgent,
                Capability::ControlAgent,
                Capability::ReadAgent,
            ],
        };
        assert_eq!(
            capability_origin_for_cross_agent_tool("spawn_agent", &perms).as_deref(),
            Some("spawnAgent")
        );
        assert_eq!(
            capability_origin_for_cross_agent_tool("send_to_agent", &perms).as_deref(),
            Some("controlAgent")
        );
        assert_eq!(
            capability_origin_for_cross_agent_tool("list_agents", &perms).as_deref(),
            Some("readAgent")
        );
        assert_eq!(
            capability_origin_for_cross_agent_tool("not_a_real_tool", &perms),
            None
        );
    }

    #[test]
    fn ceo_preset_manifest_is_fully_dispatchable() {
        let perms = AgentPermissions::ceo_preset();
        assert!(perms.is_ceo_preset());
        let tools = build_cross_agent_tools(&perms);
        assert!(!tools.is_empty());
        let dispatchable = all_dispatchable_tool_names();
        let missing: Vec<String> = tools
            .iter()
            .filter(|t| t.endpoint.contains(AGENT_TOOL_PATH_PREFIX))
            .filter(|t| !dispatchable.contains(&t.name))
            .map(|t| t.name.clone())
            .collect();
        assert!(
            missing.is_empty(),
            "CEO manifest references tools that aren't in the dispatcher: {missing:?}"
        );
    }

    #[test]
    fn project_capabilities_map_aura_native_tools_to_origin() {
        // `ReadProject` grant: read-only project tools should come back
        // with "readProject" origin. Write-only names must return None
        // because the helper insists on a real matching grant, not just
        // a name match, to prevent mis-labelling.
        let read_only = AgentPermissions {
            scope: AgentScope::default(),
            capabilities: vec![Capability::ReadProject {
                id: "proj-1".to_string(),
            }],
        };
        assert_eq!(
            capability_origin_for_cross_agent_tool("list_specs", &read_only).as_deref(),
            Some("readProject")
        );
        assert_eq!(
            capability_origin_for_cross_agent_tool("get_project", &read_only).as_deref(),
            Some("readProject")
        );
        assert_eq!(
            capability_origin_for_cross_agent_tool("run_task", &read_only),
            None,
            "run_task must not be labelled as readProject without a write grant"
        );

        // `WriteProject` grant: both halves of the manifest should pick
        // up origins, with writes labelled as "writeProject" and reads
        // as "readProject" (write implies read).
        let writable = AgentPermissions {
            scope: AgentScope::default(),
            capabilities: vec![Capability::WriteProject {
                id: "proj-2".to_string(),
            }],
        };
        assert_eq!(
            capability_origin_for_cross_agent_tool("list_specs", &writable).as_deref(),
            Some("readProject")
        );
        assert_eq!(
            capability_origin_for_cross_agent_tool("run_task", &writable).as_deref(),
            Some("writeProject")
        );
        assert_eq!(
            capability_origin_for_cross_agent_tool("create_spec", &writable).as_deref(),
            Some("writeProject")
        );

        // No project grants at all: even if a cross-agent name happens
        // to appear in the aura-native list, the helper must return
        // None so the diagnostic doesn't claim an origin the agent
        // doesn't actually hold.
        let no_project = AgentPermissions {
            scope: AgentScope::default(),
            capabilities: vec![Capability::SpawnAgent],
        };
        assert_eq!(
            capability_origin_for_cross_agent_tool("list_specs", &no_project),
            None
        );
    }

    #[test]
    fn non_ceo_spawn_agent_capability_exposes_missing_registration() {
        let perms = AgentPermissions {
            scope: AgentScope::default(),
            capabilities: vec![Capability::SpawnAgent],
        };
        let tools = build_cross_agent_tools(&perms);
        let dispatchable = all_dispatchable_tool_names();
        let names: Vec<&str> = tools.iter().map(|t| t.name.as_str()).collect();
        assert!(
            names.contains(&"spawn_agent"),
            "SpawnAgent capability should produce a spawn_agent tool row"
        );
        assert!(
            !dispatchable.contains("spawn_agent"),
            "spawn_agent should NOT be registered in the dispatcher — the registered \
             name is create_agent. This test documents the wiring bug so the \
             installed-tools diagnostic keeps surfacing it until the rename/alias lands."
        );
    }
}
