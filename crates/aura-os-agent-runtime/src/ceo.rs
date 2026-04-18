//! CEO agent template — the seed values the server writes into a fresh
//! agent record when a user first calls the bootstrap endpoint.
//!
//! In the clean-slate Agent model there is only one `Agent` type; what
//! makes it a "CEO" is the [`AgentPermissions::ceo_preset`] bundle plus
//! the matching system prompt / intent classifier. This module centralises
//! those seed values so the bootstrap handler and any future provisioning
//! flows agree byte-for-byte.

use aura_os_core::{AgentPermissions, Capability};
use aura_protocol::{
    InstalledTool, IntentClassifierRule, IntentClassifierSpec, ToolAuth,
};

use crate::prompt::ceo_system_prompt;
use aura_os_agent_templates::{
    classify_intent_with, default_classifier_rules, AgentTemplate,
};

/// URL path prefix every cross-agent tool is proxied through.
///
/// The unified `/api/agent_tools/:name` dispatcher executes the tool in-
/// process on behalf of a harness-hosted agent session.
pub const AGENT_TOOL_PATH_PREFIX: &str = "/api/agent_tools";

/// Aura-native project control-plane tools that are safe to expose the
/// moment an agent holds *any* [`Capability::ReadProject`] grant.
///
/// These all take a `project_id` argument and are enforced at dispatch
/// time by the underlying service clients against the caller's JWT, so
/// shipping them in the harness's tool menu cannot escalate access
/// beyond what the agent could already do via direct REST calls — it
/// just lets the LLM discover and invoke them from a chat session.
const AURA_NATIVE_PROJECT_READ_TOOLS: &[&str] = &[
    "list_specs",
    "get_spec",
    "list_tasks",
    "list_tasks_by_spec",
    "get_task",
    "get_task_output",
    "get_loop_status",
    "get_project",
    "get_project_stats",
];

/// Aura-native project control-plane tools that mutate project state.
/// Exposed only when the agent holds any [`Capability::WriteProject`]
/// grant. Universe scope is represented by [`AgentPermissions::ceo_preset`]
/// (which skips this path entirely) and per-project `WriteProject`
/// grants, so a non-CEO agent with only `ReadProject` capabilities will
/// never see these names.
const AURA_NATIVE_PROJECT_WRITE_TOOLS: &[&str] = &[
    "create_spec",
    "update_spec",
    "delete_spec",
    "generate_specs",
    "generate_specs_summary",
    "create_task",
    "update_task",
    "delete_task",
    "extract_tasks",
    "transition_task",
    "retry_task",
    "run_task",
    "update_project",
    "start_dev_loop",
    "pause_dev_loop",
    "stop_dev_loop",
];

/// Returns true if any capability in `caps` is a [`Capability::ReadProject`]
/// grant (regardless of target project id).
fn has_any_read_project(caps: &[Capability]) -> bool {
    caps.iter()
        .any(|c| matches!(c, Capability::ReadProject { .. }))
}

/// Returns true if any capability in `caps` is a [`Capability::WriteProject`]
/// grant (regardless of target project id).
fn has_any_write_project(caps: &[Capability]) -> bool {
    caps.iter()
        .any(|c| matches!(c, Capability::WriteProject { .. }))
}

/// Portable seed values used to build a `CreateAgentRequest` for the CEO
/// bootstrap.
pub struct CeoAgentTemplate {
    pub name: String,
    pub role: String,
    pub personality: String,
    pub system_prompt: String,
    pub permissions: AgentPermissions,
    pub intent_classifier: Option<IntentClassifierSpec>,
}

/// Build the CEO template for the given org. The system prompt is
/// rendered using [`ceo_system_prompt`] so it stays bit-compatible with
/// previous builds.
pub fn ceo_agent_template(org_name: &str, org_id: &str) -> CeoAgentTemplate {
    CeoAgentTemplate {
        name: "CEO".to_string(),
        role: "CEO".to_string(),
        personality:
            "Strategic, efficient, and proactive. I orchestrate your entire development operation."
                .to_string(),
        system_prompt: ceo_system_prompt(org_name, org_id),
        permissions: AgentPermissions::ceo_preset(),
        intent_classifier: Some(ceo_intent_classifier_spec()),
    }
}

/// The per-turn intent classifier spec used by the CEO preset. Mirrors
/// the tier-1/tier-2 keyword rules the in-process path used to apply,
/// so harness-hosted CEOs narrow their tool surface the same way.
pub fn ceo_intent_classifier_spec() -> IntentClassifierSpec {
    let template = AgentTemplate::ceo_default();
    let tier1_domains = template.tier1_domains_snake_case();
    let classifier_rules = template
        .classifier_rules_snake_case()
        .into_iter()
        .map(|(domain, keywords)| IntentClassifierRule { domain, keywords })
        .collect();
    let tool_domains = template.tool_domains_snake_case();
    IntentClassifierSpec {
        tier1_domains,
        classifier_rules,
        tool_domains,
    }
}

/// Convenience used by tests / future callers: classify a user message
/// into the set of tier-2 domains it should expose.
pub fn ceo_classify_intent(message: &str) -> Vec<aura_os_core::ToolDomain> {
    classify_intent_with(message, &default_classifier_rules())
}

/// Build the list of cross-agent tools a harness session should install
/// for an agent with the given permissions.
///
/// The unified chat path installs these alongside workspace + integration
/// tools when opening a harness session. For the CEO preset we emit the
/// full `ceo_tool_manifest` so the bootstrap agent keeps parity with the
/// legacy in-process super-agent. For agents carrying only a subset of
/// the cross-agent capabilities we emit a narrower list gated by
/// [`Capability`].
///
/// Every returned entry points at [`AGENT_TOOL_PATH_PREFIX`]`/:name` on
/// the local server; the harness forwards the caller's JWT so the
/// dispatcher can authorize against the real user.
#[must_use]
pub fn build_cross_agent_tools(permissions: &AgentPermissions) -> Vec<InstalledTool> {
    // CEO preset: full manifest, one InstalledTool per registered tool.
    if permissions.is_ceo_preset() {
        return AgentTemplate::ceo_default()
            .tool_manifest
            .into_iter()
            .map(|entry| installed_tool_for(&entry.name))
            .collect();
    }

    // Non-CEO agents: narrowly gated cross-agent tools only.
    let mut tools: Vec<InstalledTool> = Vec::new();
    let caps = &permissions.capabilities;
    if caps.contains(&Capability::SpawnAgent) {
        tools.push(installed_tool_for("spawn_agent"));
    }
    if caps.contains(&Capability::ControlAgent) {
        tools.push(installed_tool_for("send_to_agent"));
        tools.push(installed_tool_for("remote_agent_action"));
    }
    if caps.contains(&Capability::ReadAgent) {
        tools.push(installed_tool_for("get_agent"));
        tools.push(installed_tool_for("list_agents"));
        tools.push(installed_tool_for("get_remote_agent_state"));
    }
    // Aura-native project control plane — gated so the menu the LLM
    // sees mirrors what the agent could actually invoke. `WriteProject`
    // is treated as a strict superset of `ReadProject` because every
    // spec/task/project write flow reads the same record first.
    let has_read = has_any_read_project(caps);
    let has_write = has_any_write_project(caps);
    if has_read || has_write {
        for name in AURA_NATIVE_PROJECT_READ_TOOLS {
            tools.push(installed_tool_for(name));
        }
    }
    if has_write {
        for name in AURA_NATIVE_PROJECT_WRITE_TOOLS {
            tools.push(installed_tool_for(name));
        }
    }
    tools
}

/// Returns true if `name` is one of the aura-native project tools
/// emitted by [`build_cross_agent_tools`] when `ReadProject` /
/// `WriteProject` capabilities are present. Used by the installed-tools
/// diagnostic to label the origin capability in the sidekick.
#[must_use]
pub fn aura_native_project_tool_origin(name: &str) -> Option<Capability> {
    if AURA_NATIVE_PROJECT_WRITE_TOOLS.iter().any(|t| *t == name) {
        return Some(Capability::WriteProject {
            id: String::new(),
        });
    }
    if AURA_NATIVE_PROJECT_READ_TOOLS.iter().any(|t| *t == name) {
        return Some(Capability::ReadProject {
            id: String::new(),
        });
    }
    None
}

fn installed_tool_for(name: &str) -> InstalledTool {
    InstalledTool {
        name: name.to_string(),
        description: String::new(),
        input_schema: serde_json::json!({"type": "object"}),
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
    use aura_os_core::AgentScope;

    #[test]
    fn ceo_template_is_ceo_preset() {
        let t = ceo_agent_template("Acme", "org-123");
        assert!(t.permissions.is_ceo_preset());
        assert_eq!(t.role, "CEO");
        assert!(t.system_prompt.contains("Acme"));
        assert!(t.system_prompt.contains("org-123"));
        assert!(t.intent_classifier.is_some());
    }

    #[test]
    fn intent_spec_has_tier1_domains() {
        let spec = ceo_intent_classifier_spec();
        assert!(spec.tier1_domains.contains(&"project".to_string()));
        assert!(spec.tier1_domains.contains(&"agent".to_string()));
        assert!(!spec.classifier_rules.is_empty());
        assert!(!spec.tool_domains.is_empty());
    }

    fn tool_names(tools: &[InstalledTool]) -> Vec<&str> {
        tools.iter().map(|t| t.name.as_str()).collect()
    }

    #[test]
    fn read_project_exposes_read_tools_only() {
        // A non-CEO agent granted `ReadProject` on a specific project
        // should see the read half of the aura-native manifest and
        // nothing from the write half (the LLM menu must mirror what
        // the agent could actually invoke).
        let perms = AgentPermissions {
            scope: AgentScope::default(),
            capabilities: vec![Capability::ReadProject {
                id: "proj-1".to_string(),
            }],
        };
        let tools = build_cross_agent_tools(&perms);
        let names = tool_names(&tools);
        for name in AURA_NATIVE_PROJECT_READ_TOOLS {
            assert!(
                names.contains(name),
                "expected read tool `{name}` for ReadProject grant; got {names:?}"
            );
        }
        for name in AURA_NATIVE_PROJECT_WRITE_TOOLS {
            assert!(
                !names.contains(name),
                "write tool `{name}` must not appear without WriteProject"
            );
        }
    }

    #[test]
    fn write_project_exposes_read_and_write_tools() {
        // `WriteProject` implies `ReadProject` because every write path
        // reads the record first — shipping read-only tools alongside
        // saves the LLM a round-trip through the router.
        let perms = AgentPermissions {
            scope: AgentScope::default(),
            capabilities: vec![Capability::WriteProject {
                id: "proj-1".to_string(),
            }],
        };
        let tools = build_cross_agent_tools(&perms);
        let names = tool_names(&tools);
        for name in AURA_NATIVE_PROJECT_READ_TOOLS
            .iter()
            .chain(AURA_NATIVE_PROJECT_WRITE_TOOLS.iter())
        {
            assert!(
                names.contains(name),
                "expected project tool `{name}` for WriteProject grant; got {names:?}"
            );
        }
    }

    #[test]
    fn no_project_capabilities_means_no_project_tools() {
        // Agents with only cross-agent capabilities (the original
        // gating) keep the original behaviour — no stray aura-native
        // project tools leak in.
        let perms = AgentPermissions {
            scope: AgentScope::default(),
            capabilities: vec![Capability::SpawnAgent, Capability::ReadAgent],
        };
        let tools = build_cross_agent_tools(&perms);
        let names = tool_names(&tools);
        for name in AURA_NATIVE_PROJECT_READ_TOOLS
            .iter()
            .chain(AURA_NATIVE_PROJECT_WRITE_TOOLS.iter())
        {
            assert!(
                !names.contains(name),
                "unexpected project tool `{name}` emitted without project capability"
            );
        }
        assert!(names.contains(&"spawn_agent"));
        assert!(names.contains(&"get_agent"));
    }

    #[test]
    fn ceo_preset_still_ships_full_manifest() {
        // Guardrail: the CEO fast-path must not regress just because
        // the non-CEO branch learned about project tools.
        let tools = build_cross_agent_tools(&AgentPermissions::ceo_preset());
        let names = tool_names(&tools);
        // A representative sampling from the full manifest: one cross-
        // agent name, one aura-native read name, and one aura-native
        // write name so a regression on either branch would trip.
        for expected in &[
            "create_agent",
            "list_agents",
            "send_to_agent",
            "list_specs",
            "create_spec",
            "list_tasks",
            "run_task",
        ] {
            assert!(
                names.contains(expected),
                "CEO manifest missing `{expected}`; got {names:?}"
            );
        }
    }

    #[test]
    fn aura_native_tool_origin_classifies_known_names() {
        // The diagnostic uses this helper to label rows in the sidekick.
        let read = aura_native_project_tool_origin("list_specs");
        assert!(matches!(read, Some(Capability::ReadProject { .. })));
        let write = aura_native_project_tool_origin("run_task");
        assert!(matches!(write, Some(Capability::WriteProject { .. })));
        assert!(aura_native_project_tool_origin("spawn_agent").is_none());
        assert!(aura_native_project_tool_origin("nonexistent").is_none());
    }
}
