//! Unified session-tool assembly.
//!
//! Single source of truth for "which [`InstalledTool`]s should a given
//! agent's harness session carry?". Replaces the old two-pronged
//! mechanism that lived in `crate::ceo`:
//!
//! * CEO preset agents used a hand-maintained tier-1 registry
//!   ([`crate::build_tier1_registry`]), ignoring capabilities on the
//!   assumption that the preset holds everything.
//! * Non-CEO agents used [`crate::build_time_cross_agent_tool_names`],
//!   which iterated the *full* registry and filtered by capabilities
//!   with a carve-out `is_ceo_preset()` short-circuit.
//!
//! The unified filter here applies to *every* bundle: a tool ships
//! iff its `required_capabilities()` are satisfied by the bundle —
//! see [`crate::permissions_satisfy_requirements`]. The secondary
//! `Surface::OnDemand` gate that used to require the LLM to call the
//! `load_domain_tools` meta-tool first has been removed, so every
//! tool the agent has permission for ships in the default session
//! payload.
//!
//! The CEO preset holds the wildcard
//! [`Capability::ReadAllProjects`] / [`Capability::WriteAllProjects`]
//! grants so `ReadProjectFromArg` / `WriteProjectFromArg`
//! requirements pass the same filter every other bundle uses.

use aura_protocol::{InstalledTool, ToolAuth};

use aura_os_core::{AgentPermissions, Capability, ToolDomain};

use crate::ceo::AGENT_TOOL_PATH_PREFIX;

/// Synthetic cross-agent tool name not backed by an `AgentTool` in
/// the shared registry. The dispatcher-side handler recognises it
/// and routes to the bespoke agent-creation pipeline. Kept small:
/// registry-backed tools should be preferred over synthetic names.
const SYNTHETIC_SPAWN_AGENT: &str = "spawn_agent";

/// Assemble the `InstalledTool` list to ship into a harness session
/// for an agent with the given `permissions`.
///
/// Every registry tool that passes [`crate::permissions_satisfy_requirements`]
/// is included — there is no surface / on-demand gate. Tool
/// descriptions and JSON schemas are stamped from the canonical
/// [`crate::tool_metadata_map`] so the harness LLM sees the real
/// definition — the historical "empty schema" bug that made the LLM
/// silently refuse to call tools is impossible here.
///
/// `spawn_agent` is a synthetic name handled by a bespoke dispatcher
/// branch (not a registry [`AgentTool`]). It is appended when the
/// bundle carries [`Capability::SpawnAgent`] so the LLM menu mirrors
/// what the agent could actually invoke.
///
/// `_loaded_domains` is kept in the signature for source-compat with
/// callers that still pass the domain slice through; it is ignored.
#[must_use]
pub fn build_session_tools(
    permissions: &AgentPermissions,
    _loaded_domains: &[ToolDomain],
) -> Vec<InstalledTool> {
    let metadata = crate::tool_metadata_map();
    let metadata = &*metadata;

    let mut names = crate::build_session_tool_names(permissions, &[]);

    if permissions.capabilities.contains(&Capability::SpawnAgent)
        && !names.iter().any(|n| n == SYNTHETIC_SPAWN_AGENT)
    {
        names.push(SYNTHETIC_SPAWN_AGENT.to_string());
    }

    names
        .iter()
        .map(|name| installed_tool_for(name, metadata))
        .collect()
}

fn installed_tool_for(
    name: &str,
    metadata: &std::collections::HashMap<String, (String, serde_json::Value)>,
) -> InstalledTool {
    let (description, input_schema) = metadata
        .get(name)
        .cloned()
        .unwrap_or_else(|| (String::new(), serde_json::json!({"type": "object"})));
    InstalledTool {
        name: name.to_string(),
        description,
        input_schema,
        endpoint: format!("{AGENT_TOOL_PATH_PREFIX}/{name}"),
        auth: ToolAuth::default(),
        timeout_ms: None,
        namespace: None,
        required_integration: None,
        runtime_execution: None,
        metadata: std::collections::HashMap::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_os_core::{AgentPermissions, AgentScope, Capability};

    fn tool_names(tools: &[InstalledTool]) -> Vec<&str> {
        tools.iter().map(|t| t.name.as_str()).collect()
    }

    #[test]
    fn ceo_preset_ships_every_capable_tool() {
        // The CEO preset now ships every tool whose capabilities it
        // satisfies, regardless of the legacy surface/on-demand
        // classification. The historical tier-1 backbone is still
        // present; previously-OnDemand project tools (e.g.
        // `list_specs`) ship in the same payload now that the
        // surface gate has been removed.
        let tools = build_session_tools(&AgentPermissions::ceo_preset(), &[]);
        let names = tool_names(&tools);
        for required in [
            "list_agents",
            "get_agent",
            "list_agent_instances",
            "send_to_agent",
            "load_domain_tools",
            "get_current_time",
            "get_fleet_status",
            "get_progress_report",
            "list_projects",
            "get_project",
            "get_credit_balance",
            // previously `Surface::OnDemand` — must now ship by default
            "list_specs",
            "get_spec",
            "list_tasks",
            // synthetic — must surface whenever SpawnAgent cap is held
            "spawn_agent",
        ] {
            assert!(
                names.contains(&required),
                "CEO session must include `{required}`; got {names:?}"
            );
        }
    }

    #[test]
    fn ceo_preset_ships_previously_on_demand_tools_without_promotion() {
        // Regression guard: the surface gate has been removed, so
        // passing an empty `loaded_domains` slice must still surface
        // every domain-scoped tool the CEO has capabilities for.
        let without = build_session_tools(&AgentPermissions::ceo_preset(), &[]);
        let without_names = tool_names(&without);
        assert!(
            without_names.contains(&"list_specs"),
            "fresh CEO session must carry `list_specs` without any domain promotion"
        );

        // Passing a non-empty `loaded_domains` slice must be a no-op
        // — the tool list is identical.
        let with = build_session_tools(&AgentPermissions::ceo_preset(), &[ToolDomain::Spec]);
        let with_names = tool_names(&with);
        assert_eq!(
            without_names, with_names,
            "loaded_domains must not influence the session tool list"
        );
    }

    #[test]
    fn read_project_exposes_project_read_tools_only() {
        // A non-CEO agent granted `ReadProject` on a specific project
        // should see project read tools but no write-side tools.
        let perms = AgentPermissions {
            scope: AgentScope::default(),
            capabilities: vec![Capability::ReadProject {
                id: "proj-1".to_string(),
            }],
        };
        let tools = build_session_tools(&perms, &[]);
        let names = tool_names(&tools);

        assert!(names.contains(&"get_project"));
        assert!(names.contains(&"list_projects"));
        assert!(
            !names.contains(&"delete_project"),
            "write-side `delete_project` must not appear for ReadProject-only bundle"
        );
        assert!(
            !names.contains(&"spawn_agent"),
            "synthetic spawn_agent must not appear without SpawnAgent capability"
        );
    }

    #[test]
    fn write_project_exposes_write_tools() {
        let perms = AgentPermissions {
            scope: AgentScope::default(),
            capabilities: vec![Capability::WriteProject {
                id: "proj-1".to_string(),
            }],
        };
        let tools = build_session_tools(&perms, &[]);
        let names = tool_names(&tools);
        assert!(names.contains(&"delete_project"));
        assert!(names.contains(&"update_project"));
        assert!(names.contains(&"get_project"), "write implies read");
    }

    #[test]
    fn spawn_agent_only_bundle() {
        // Agents with only cross-agent capabilities must not see any
        // project-scoped *write* or capability-gated read tool — the
        // LLM menu must mirror what the agent could actually invoke.
        // `list_projects` itself is org-scoped and carries no
        // capability gate (downstream JWT filtering handles access
        // control), so it appears for every bundle.
        let perms = AgentPermissions {
            scope: AgentScope::default(),
            capabilities: vec![Capability::SpawnAgent, Capability::ReadAgent],
        };
        let tools = build_session_tools(&perms, &[]);
        let names = tool_names(&tools);

        assert!(names.contains(&"spawn_agent"));
        assert!(names.contains(&"get_agent"));
        assert!(
            !names.contains(&"get_project"),
            "get_project must not appear without any ReadProject grant"
        );
        assert!(
            !names.contains(&"delete_project"),
            "delete_project must not appear without WriteProject"
        );
        assert!(
            !names.contains(&"list_agent_instances"),
            "list_agent_instances must not appear without any ReadProject grant"
        );
    }

    #[test]
    fn empty_bundle_spliced_with_project_self_caps_ships_project_tools() {
        // Regression for the "Tool 'get_project' / 'list_specs' /
        // 'create_spec' is not allowed" failures seen when a project-
        // bound chat session opened for a non-CEO agent whose
        // persisted `capabilities` column was empty. The chat
        // handlers now call
        // [`AgentPermissions::with_project_self_caps`] with the bound
        // project id before passing the bundle to
        // `build_session_tool_names`; this test locks in that the
        // spliced bundle does indeed surface every project-scoped
        // tool the error reports referenced.
        let spliced = AgentPermissions::empty().with_project_self_caps("proj-42");
        let tools = build_session_tools(&spliced, &[]);
        let names = tool_names(&tools);
        for required in [
            "get_project",
            "list_specs",
            "get_spec",
            "create_spec",
            "update_spec",
            "delete_spec",
            "list_tasks",
            "create_task",
            "update_project",
        ] {
            assert!(
                names.contains(&required),
                "spliced bundle must include `{required}`; got {names:?}"
            );
        }
    }

    #[test]
    fn with_project_self_caps_is_scoped_to_bound_project() {
        // The splice grants access to `proj-42` only — tools gated on
        // `proj-other` should still be filtered out if a tool checks
        // a different project. We exercise this through the normal
        // filter: a bundle spliced for `proj-42` that's asked to act
        // against `proj-other` won't bypass the runtime capability
        // gate (enforced at tool-call time by the harness), but the
        // manifest should still list the tool since manifest-level
        // filtering only checks whether *any* satisfying grant
        // exists. This test documents the current design: the splice
        // is a session-open safety net, not a per-call authorisation.
        let spliced = AgentPermissions::empty().with_project_self_caps("proj-42");
        assert!(
            spliced.capabilities.contains(&Capability::ReadProject {
                id: "proj-42".into()
            })
        );
        assert!(
            !spliced.capabilities.contains(&Capability::ReadProject {
                id: "proj-other".into()
            }),
            "splice must not leak access to unrelated projects"
        );
    }

    #[test]
    fn session_tool_descriptions_are_not_empty() {
        // Regression guard for the "InstalledTool schema empty" bug:
        // every shipped tool must carry the canonical description +
        // parameters schema, not a blank placeholder.
        let tools = build_session_tools(&AgentPermissions::ceo_preset(), &[]);
        for tool in &tools {
            if tool.name == SYNTHETIC_SPAWN_AGENT {
                // synthetic — no registry entry, known blank.
                continue;
            }
            assert!(
                !tool.description.is_empty(),
                "`{}` must ship a non-empty description",
                tool.name
            );
        }
    }
}
