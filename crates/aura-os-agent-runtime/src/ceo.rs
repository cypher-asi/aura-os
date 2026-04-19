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
use aura_os_agent_templates::{classify_intent_with, default_classifier_rules, AgentTemplate};

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

/// Static tool allowlist for [`AgentPermissions::ceo_preset`] agents.
///
/// Mirrors the tier-1 slice of
/// [`aura_os_agent_templates::ceo_tool_manifest`] plus the
/// `load_domain_tools` meta-tool, which lets the CEO fetch additional
/// domains on demand without the harness having to run an intent
/// classifier. Pulling the tier-1 slice directly (rather than letting a
/// per-turn classifier rebuild it) matches how non-CEO agents construct
/// their cross-agent tool list — see the capability-gated branch below —
/// and is what keeps a trivial "who are my agents" turn from shipping
/// ~30 tool definitions to the LLM.
const CEO_CORE_TOOLS: &[&str] = &[
    // Project (tier 1)
    "create_project",
    "import_project",
    "list_projects",
    "get_project",
    "update_project",
    "delete_project",
    "archive_project",
    "get_project_stats",
    // Agent (tier 1)
    "list_agents",
    "get_agent",
    "assign_agent_to_project",
    // Execution (tier 1)
    "start_dev_loop",
    "pause_dev_loop",
    "stop_dev_loop",
    "get_loop_status",
    "send_to_agent",
    // Monitoring (tier 1)
    "get_fleet_status",
    "get_progress_report",
    "get_project_cost",
    // Billing (tier 1 head)
    "get_credit_balance",
    // System (tier 1) — stable, cross-platform current time. Without
    // this, the CEO falls back to `run_command date`, which on Windows
    // hits cmd.exe's interactive `date` built-in (no `/t`) and exits
    // with code 1 plus garbage output.
    "get_current_time",
    // Meta-tool (always on; lets the LLM ask for additional domains)
    "load_domain_tools",
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
        // CEO agents run with a static tool allowlist (see CEO_CORE_TOOLS);
        // shipping an IntentClassifierSpec causes the harness to re-filter
        // the list per turn and has silently dropped tier-1 tools like
        // `send_to_agent` in practice.
        intent_classifier: None,
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
/// static [`CEO_CORE_TOOLS`] allowlist (~21 tier-1 names plus the
/// `load_domain_tools` meta-tool). For agents carrying only a subset of
/// the cross-agent capabilities we emit a narrower list gated by
/// [`Capability`].
///
/// Every returned entry points at [`AGENT_TOOL_PATH_PREFIX`]`/:name` on
/// the local server; the harness forwards the caller's JWT so the
/// dispatcher can authorize against the real user.
#[must_use]
pub fn build_cross_agent_tools(permissions: &AgentPermissions) -> Vec<InstalledTool> {
    build_cross_agent_tools_for_message(permissions, None)
}

/// Chat-path entry point kept for signature compatibility.
///
/// Historically this was a message-aware variant of
/// [`build_cross_agent_tools`] that ran an intent classifier over the
/// user's message and narrowed a ~55-tool CEO manifest down to tier-1
/// plus any tier-2 domains the classifier matched. That per-turn
/// narrowing has been removed in favour of a static
/// [`CEO_CORE_TOOLS`] allowlist — the classifier was silently dropping
/// tier-1 tools like `send_to_agent` in practice, and a static list
/// matches how non-CEO agents already construct their cross-agent tool
/// list (see the capability-gated branch below). The `message`
/// parameter is retained so the chat path can keep calling through
/// this entry point without a signature change; it is currently
/// ignored.
#[must_use]
pub fn build_cross_agent_tools_for_message(
    permissions: &AgentPermissions,
    _message: Option<&str>,
) -> Vec<InstalledTool> {
    // Build the name -> (description, schema) map *once* so each
    // InstalledTool gets the real metadata the LLM needs to call the
    // tool. Shipping `""` / `{}` here (the old behaviour) left the
    // model unable to decide when to invoke `send_to_agent` etc.
    let metadata = crate::tools::tool_metadata_map();
    let metadata = &*metadata;

    // CEO preset: static tier-1 allowlist, no classifier. See
    // `CEO_CORE_TOOLS` for the rationale. The harness receives this
    // list verbatim and does not re-filter it, which prevents the
    // "classifier silently strips send_to_agent" failure mode the
    // previous per-turn narrowing caused.
    if permissions.is_ceo_preset() {
        return CEO_CORE_TOOLS
            .iter()
            .map(|name| installed_tool_for(name, metadata))
            .collect();
    }

    // Non-CEO agents: narrowly gated cross-agent tools only.
    let mut tools: Vec<InstalledTool> = Vec::new();
    let caps = &permissions.capabilities;
    if caps.contains(&Capability::SpawnAgent) {
        tools.push(installed_tool_for("spawn_agent", metadata));
    }
    if caps.contains(&Capability::ControlAgent) {
        tools.push(installed_tool_for("send_to_agent", metadata));
        tools.push(installed_tool_for("remote_agent_action", metadata));
    }
    if caps.contains(&Capability::ReadAgent) {
        tools.push(installed_tool_for("get_agent", metadata));
        tools.push(installed_tool_for("list_agents", metadata));
        tools.push(installed_tool_for("get_remote_agent_state", metadata));
    }
    // Aura-native project control plane — gated so the menu the LLM
    // sees mirrors what the agent could actually invoke. `WriteProject`
    // is treated as a strict superset of `ReadProject` because every
    // spec/task/project write flow reads the same record first.
    let has_read = has_any_read_project(caps);
    let has_write = has_any_write_project(caps);
    if has_read || has_write {
        for name in AURA_NATIVE_PROJECT_READ_TOOLS {
            tools.push(installed_tool_for(name, metadata));
        }
    }
    if has_write {
        for name in AURA_NATIVE_PROJECT_WRITE_TOOLS {
            tools.push(installed_tool_for(name, metadata));
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

/// Stamp the cross-agent dispatcher call-back credentials onto every
/// cross-agent entry in `tools`.
///
/// The dispatcher at `POST /api/agent_tools/:name` extracts the user
/// JWT via the standard `AuthJwt` extractor (`Authorization: Bearer
/// <jwt>`) and reads an optional `X-Aura-Org-Id` header to pin the
/// execution context to the caller's org without re-resolving it on
/// every tool call. [`build_cross_agent_tools`] emits each entry with
/// `ToolAuth::None` because construction has no access to the live
/// session JWT — without stamping, the harness's
/// [`ToolAuth::None`] branch ships the POST with no auth header and
/// the dispatcher 401s with `missing authorization`, which is how this
/// bug first surfaced for `get_fleet_status` and every other CEO tool.
/// This is the single choke point for attaching session credentials,
/// designed to be called on the combined manifest right after
/// [`build_cross_agent_tools`] and before [`absolutize_agent_tool_endpoints`]
/// so the relative path check stays simple.
///
/// Entries whose endpoint is not under [`AGENT_TOOL_PATH_PREFIX`] are
/// left untouched: workspace / MCP integration tools carry their own
/// bearer tokens stamped by dedicated builders (see
/// `aura_os_integrations::installed_workspace_app_tools`) and those
/// tokens must survive the combined-list pass through this helper.
///
/// If `jwt` is empty the helper is a no-op, matching the behaviour of
/// [`absolutize_agent_tool_endpoints`] for misconfigured environments
/// so the failure mode stays the same observable 401 rather than a
/// harder-to-debug malformed `Authorization: Bearer` header.
pub fn stamp_agent_tool_auth(
    tools: &mut [InstalledTool],
    jwt: &str,
    org_id: Option<&str>,
) {
    if jwt.is_empty() {
        return;
    }
    for tool in tools.iter_mut() {
        // Only stamp entries that target the server-side cross-agent
        // dispatcher. Expected call order is `build_cross_agent_tools`
        // → `stamp_agent_tool_auth` → `absolutize_agent_tool_endpoints`,
        // so the endpoint should still be relative here — but accept
        // an already-absolute form as well so the helper stays robust
        // if the call order ever gets reshuffled.
        let endpoint = &tool.endpoint;
        let is_cross_agent = endpoint.starts_with(AGENT_TOOL_PATH_PREFIX)
            || endpoint.contains("/api/agent_tools/");
        if !is_cross_agent {
            continue;
        }
        let mut headers = std::collections::HashMap::new();
        headers.insert("Authorization".to_string(), format!("Bearer {jwt}"));
        if let Some(org) = org_id {
            let trimmed = org.trim();
            if !trimmed.is_empty() {
                // HeaderName is case-insensitive on the wire and the
                // dispatcher reads `"x-aura-org-id"` via `HeaderMap`,
                // which normalises lookups. Either case works; keep the
                // canonical lowercase form used by reqwest so the
                // outbound header matches the dispatcher's constant.
                headers.insert("x-aura-org-id".to_string(), trimmed.to_string());
            }
        }
        tool.auth = ToolAuth::Headers { headers };
    }
}

/// Rewrite relative `/api/agent_tools/:name` endpoints in `tools` to
/// absolute URLs rooted at `base_url`.
///
/// `build_cross_agent_tools` emits every cross-agent tool with the
/// canonical [`AGENT_TOOL_PATH_PREFIX`]`/:name` path so the manifest
/// stays base-agnostic at construction time (it has no access to
/// runtime config). The harness, however, executes an `InstalledTool`
/// by issuing a raw `reqwest::Client::post(&tool.endpoint)` in a
/// separate process — often on a separate host — so a bare path fails
/// immediately with `builder error: relative URL without a base`
/// before the request even leaves the harness. This is the single
/// choke point where the control-plane base URL gets stamped on, so
/// anything shipped to the harness (live session `installed_tools`
/// list, installed-tools diagnostic, etc.) must funnel through it.
///
/// Endpoints that are already absolute (contain `://`) or that don't
/// start with [`AGENT_TOOL_PATH_PREFIX`] are left untouched so callers
/// can freely mix cross-agent entries with workspace / integration
/// tools (which already carry absolute URLs stamped by their own
/// builders) without risking a double prefix.
pub fn absolutize_agent_tool_endpoints(tools: &mut [InstalledTool], base_url: &str) {
    let base = base_url.trim_end_matches('/');
    if base.is_empty() {
        return;
    }
    for tool in tools.iter_mut() {
        if tool.endpoint.contains("://") {
            continue;
        }
        if tool.endpoint.starts_with(AGENT_TOOL_PATH_PREFIX) {
            tool.endpoint = format!("{base}{}", tool.endpoint);
        }
    }
}

fn installed_tool_for(
    name: &str,
    metadata: &std::collections::HashMap<String, (String, serde_json::Value)>,
) -> InstalledTool {
    // Pull the real description + parameters schema from the canonical
    // `ToolRegistry` (via `tool_metadata_map`). The fallback — empty
    // description, generic object schema — only kicks in for names the
    // registry doesn't know about, which would indicate a wiring bug
    // surfaced by the installed-tools diagnostic's `missing_registrations`.
    let (description, input_schema) = metadata.get(name).cloned().unwrap_or_else(|| {
        (String::new(), serde_json::json!({"type": "object"}))
    });
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
    use aura_os_core::AgentScope;

    #[test]
    fn ceo_template_is_ceo_preset() {
        let t = ceo_agent_template("Acme", "org-123");
        assert!(t.permissions.is_ceo_preset());
        assert_eq!(t.role, "CEO");
        assert!(t.system_prompt.contains("Acme"));
        assert!(t.system_prompt.contains("org-123"));
        assert!(
            t.intent_classifier.is_none(),
            "CEO template must not ship an IntentClassifierSpec — see CEO_CORE_TOOLS"
        );
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
    fn ceo_preset_ships_static_core_allowlist() {
        // Guardrail: the CEO fast-path must emit exactly the
        // `CEO_CORE_TOOLS` set, regardless of the user message. This
        // replaces the old "ships full manifest" guarantee — the full
        // manifest was the source of the 100% context utilisation bug.
        let tools = build_cross_agent_tools(&AgentPermissions::ceo_preset());
        let names: Vec<&str> = tools.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(
            names.len(),
            CEO_CORE_TOOLS.len(),
            "CEO manifest should be exactly CEO_CORE_TOOLS; got {names:?}"
        );
        for expected in CEO_CORE_TOOLS {
            assert!(
                names.contains(expected),
                "CEO_CORE_TOOLS entry `{expected}` missing from emitted manifest; got {names:?}"
            );
        }
    }

    #[test]
    fn ceo_preset_ignores_message_parameter() {
        // The message-aware variant must return the same allowlist whether
        // or not a message is supplied — the static allowlist deliberately
        // side-steps per-turn classification, which is what caused the
        // classifier to silently drop `send_to_agent` on simple prompts.
        let perms = AgentPermissions::ceo_preset();
        let without = build_cross_agent_tools_for_message(&perms, None);
        let with = build_cross_agent_tools_for_message(
            &perms,
            Some("hi, what's the weather"),
        );
        let names_without: Vec<&str> = without.iter().map(|t| t.name.as_str()).collect();
        let names_with: Vec<&str> = with.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names_without, names_with);
    }

    #[test]
    fn ceo_allowlist_includes_send_to_agent_and_meta_tool() {
        // Explicit regression guard for the two tools that were reported
        // missing from CEO turns: `send_to_agent` (the inter-agent chat
        // capability) and `load_domain_tools` (the meta-tool that lets
        // the LLM expand its own tool surface on demand).
        let tools = build_cross_agent_tools(&AgentPermissions::ceo_preset());
        let names: Vec<&str> = tools.iter().map(|t| t.name.as_str()).collect();
        assert!(names.contains(&"send_to_agent"),
            "CEO manifest must always expose send_to_agent; got {names:?}");
        assert!(names.contains(&"load_domain_tools"),
            "CEO manifest must always expose load_domain_tools; got {names:?}");
    }

    #[test]
    fn installed_tools_carry_real_descriptions_and_schemas() {
        // Regression guard for the `InstalledTool` description/schema
        // bug: the harness LLM was seeing tool names with blank
        // descriptions and `{"type":"object"}` schemas, so it
        // couldn't tell when/how to invoke `send_to_agent`,
        // `list_agents`, etc. Every tool we emit must now carry the
        // canonical description + parameters schema from `ToolRegistry`.
        let tools = build_cross_agent_tools(&AgentPermissions::ceo_preset());
        let find = |name: &str| -> &InstalledTool {
            tools
                .iter()
                .find(|t| t.name == name)
                .unwrap_or_else(|| panic!("`{name}` missing from CEO manifest"))
        };

        // Every tool must ship a non-empty description; the empty
        // string was the pre-fix behaviour that made the LLM believe
        // the tools didn't exist. Only names that are part of
        // `CEO_CORE_TOOLS` can be asserted here — tier-2/process tools
        // are no longer shipped up-front on the CEO path.
        for name in [
            "send_to_agent",
            "list_agents",
            "get_agent",
        ] {
            assert!(
                !find(name).description.is_empty(),
                "`{name}` must ship a non-empty description to the harness"
            );
        }

        // Tools that take arguments must now ship the real required
        // list — this is what lets the LLM pick the right call shape.
        let check_required = |name: &str, required_arg: &str| {
            let schema = &find(name).input_schema;
            let required = schema
                .get("required")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            assert!(
                required.iter().any(|r| r == required_arg),
                "`{name}` schema must require `{required_arg}`; got required = {required:?}"
            );
        };
        check_required("send_to_agent", "agent_id");
        check_required("send_to_agent", "content");
        check_required("get_project", "project_id");
    }

    #[test]
    fn installed_tools_for_readproject_carry_schemas() {
        // The new capability-gated aura-native branch must also get
        // real schemas, otherwise project-scoped agents would hit the
        // same "LLM can't call this" problem as the CEO did.
        let perms = AgentPermissions {
            scope: AgentScope::default(),
            capabilities: vec![Capability::ReadProject {
                id: "proj-1".to_string(),
            }],
        };
        let tools = build_cross_agent_tools(&perms);
        let list_specs = tools
            .iter()
            .find(|t| t.name == "list_specs")
            .expect("ReadProject should emit list_specs");
        assert!(!list_specs.description.is_empty());
        assert!(list_specs
            .input_schema
            .get("properties")
            .and_then(|v| v.as_object())
            .is_some_and(|p| !p.is_empty()));
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

    #[test]
    fn absolutize_rewrites_relative_cross_agent_endpoints() {
        // Every CEO tool leaves `build_cross_agent_tools` with a bare
        // `/api/agent_tools/:name` path. The harness POSTs to that
        // path directly, which fails with `builder error: relative
        // URL without a base` unless we stamp the control-plane base
        // URL on first. Pin that behaviour so a regression in the
        // session-assembly path can't silently reintroduce the
        // original `get_fleet_status` failure.
        let mut tools = build_cross_agent_tools(&AgentPermissions::ceo_preset());
        assert!(tools
            .iter()
            .all(|t| t.endpoint.starts_with(AGENT_TOOL_PATH_PREFIX)));

        absolutize_agent_tool_endpoints(&mut tools, "http://127.0.0.1:3100");

        for tool in &tools {
            assert!(
                tool.endpoint.starts_with("http://127.0.0.1:3100/api/agent_tools/"),
                "cross-agent endpoint should be absolute after rewrite; got {}",
                tool.endpoint
            );
            assert!(
                tool.endpoint.ends_with(&format!("/{}", tool.name)),
                "rewritten endpoint should still end with `/{name}`; got {endpoint}",
                name = tool.name,
                endpoint = tool.endpoint
            );
        }
    }

    #[test]
    fn absolutize_trims_trailing_slash_from_base_url() {
        // `control_plane_api_base_url()` trims trailing slashes, but
        // be defensive: callers occasionally pass values straight from
        // configuration or environment variables where a trailing `/`
        // is common. Joining naively would produce
        // `http://host//api/agent_tools/:name`, which some routers
        // 404. Verify the helper normalises the base.
        let mut tools = vec![InstalledTool {
            name: "send_to_agent".to_string(),
            description: String::new(),
            input_schema: serde_json::json!({}),
            endpoint: format!("{AGENT_TOOL_PATH_PREFIX}/send_to_agent"),
            auth: ToolAuth::default(),
            timeout_ms: None,
            namespace: None,
            required_integration: None,
            runtime_execution: None,
            metadata: std::collections::HashMap::new(),
        }];
        absolutize_agent_tool_endpoints(&mut tools, "http://example.com/");
        assert_eq!(
            tools[0].endpoint,
            "http://example.com/api/agent_tools/send_to_agent"
        );
    }

    #[test]
    fn absolutize_leaves_absolute_and_non_matching_endpoints_alone() {
        // The session assembly path concatenates workspace /
        // integration tools (already absolute, e.g.
        // `https://host/api/orgs/.../tool-actions/...`) with the
        // cross-agent manifest and then calls this helper once over
        // the combined slice. It must be a no-op for entries that
        // either (a) already carry a scheme or (b) don't live under
        // the cross-agent dispatcher path, otherwise double-prefixing
        // would break every workspace tool call.
        let mut tools = vec![
            InstalledTool {
                name: "workspace_tool".to_string(),
                description: String::new(),
                input_schema: serde_json::json!({}),
                endpoint: "https://example.com/api/orgs/acme/tool-actions/workspace_tool"
                    .to_string(),
                auth: ToolAuth::default(),
                timeout_ms: None,
                namespace: None,
                required_integration: None,
                runtime_execution: None,
                metadata: std::collections::HashMap::new(),
            },
            InstalledTool {
                name: "other_relative".to_string(),
                description: String::new(),
                input_schema: serde_json::json!({}),
                endpoint: "/unrelated/path".to_string(),
                auth: ToolAuth::default(),
                timeout_ms: None,
                namespace: None,
                required_integration: None,
                runtime_execution: None,
                metadata: std::collections::HashMap::new(),
            },
            InstalledTool {
                name: "send_to_agent".to_string(),
                description: String::new(),
                input_schema: serde_json::json!({}),
                endpoint: format!("{AGENT_TOOL_PATH_PREFIX}/send_to_agent"),
                auth: ToolAuth::default(),
                timeout_ms: None,
                namespace: None,
                required_integration: None,
                runtime_execution: None,
                metadata: std::collections::HashMap::new(),
            },
        ];
        absolutize_agent_tool_endpoints(&mut tools, "http://127.0.0.1:3100");

        assert_eq!(
            tools[0].endpoint,
            "https://example.com/api/orgs/acme/tool-actions/workspace_tool",
            "absolute workspace endpoints must not be rewritten"
        );
        assert_eq!(
            tools[1].endpoint, "/unrelated/path",
            "relative paths outside the cross-agent dispatcher prefix must not be rewritten"
        );
        assert_eq!(
            tools[2].endpoint, "http://127.0.0.1:3100/api/agent_tools/send_to_agent",
            "cross-agent endpoints must be absolutised"
        );
    }

    #[test]
    fn stamp_attaches_bearer_and_org_headers_to_cross_agent_tools() {
        // Pin the shape of the auth payload the harness will forward
        // to `/api/agent_tools/:name`: both `Authorization: Bearer
        // <jwt>` (required — without it the dispatcher's `AuthJwt`
        // extractor returns 401 `missing authorization`) and
        // `x-aura-org-id: <org>` (optional — the dispatcher falls
        // back to `"default"` if absent, which silently scopes tool
        // execution to the wrong org).
        let mut tools = build_cross_agent_tools(&AgentPermissions::ceo_preset());
        assert!(tools
            .iter()
            .all(|t| matches!(t.auth, ToolAuth::None)));

        stamp_agent_tool_auth(&mut tools, "jwt-abc", Some("org-42"));

        for tool in &tools {
            match &tool.auth {
                ToolAuth::Headers { headers } => {
                    assert_eq!(
                        headers.get("Authorization").map(String::as_str),
                        Some("Bearer jwt-abc"),
                        "`{}` must carry the session bearer token",
                        tool.name
                    );
                    assert_eq!(
                        headers.get("x-aura-org-id").map(String::as_str),
                        Some("org-42"),
                        "`{}` must carry the session org id",
                        tool.name
                    );
                }
                other => panic!(
                    "`{}` should carry ToolAuth::Headers after stamping; got {:?}",
                    tool.name, other
                ),
            }
        }
    }

    #[test]
    fn stamp_omits_org_header_when_missing() {
        // Personal-account sessions (no org) must still send the
        // bearer token — the dispatcher's 401 path only checks for
        // the Authorization header, so skipping the org id keeps the
        // tool callable and defers to the handler's "default" org
        // fallback.
        let mut tools = build_cross_agent_tools(&AgentPermissions::ceo_preset());
        stamp_agent_tool_auth(&mut tools, "jwt-abc", None);

        let send_to_agent = tools
            .iter()
            .find(|t| t.name == "send_to_agent")
            .expect("CEO manifest should contain send_to_agent");
        match &send_to_agent.auth {
            ToolAuth::Headers { headers } => {
                assert!(headers.contains_key("Authorization"));
                assert!(!headers.contains_key("x-aura-org-id"));
                assert!(!headers.contains_key("X-Aura-Org-Id"));
            }
            other => panic!("expected Headers auth, got {other:?}"),
        }
    }

    #[test]
    fn stamp_ignores_whitespace_org_id() {
        // Treat `Some("")` / `Some("   ")` the same as `None`. Env-
        // plumbed values occasionally come back as whitespace when a
        // session hasn't resolved an org yet; shipping
        // `x-aura-org-id: ` with an empty value would cause the
        // dispatcher to see a present-but-blank header and is strictly
        // worse than the `None` fallback to `"default"`.
        let mut tools = build_cross_agent_tools(&AgentPermissions::ceo_preset());
        stamp_agent_tool_auth(&mut tools, "jwt-abc", Some("   "));
        let any = tools.first().expect("manifest must be non-empty");
        match &any.auth {
            ToolAuth::Headers { headers } => {
                assert!(!headers.contains_key("x-aura-org-id"));
            }
            other => panic!("expected Headers auth, got {other:?}"),
        }
    }

    #[test]
    fn stamp_leaves_non_cross_agent_tool_auth_untouched() {
        // Workspace / MCP integration tools already carry their own
        // bearer tokens from dedicated builders. The combined
        // `installed_tools` slice in `build_session_installed_tools`
        // is passed through this helper once, so we must not
        // overwrite those — doing so would swap their provider-
        // specific token for the raw control-plane JWT and break
        // every workspace tool call.
        let mut tools = vec![
            InstalledTool {
                name: "workspace_tool".to_string(),
                description: String::new(),
                input_schema: serde_json::json!({}),
                endpoint: "https://example.com/api/orgs/acme/tool-actions/workspace_tool"
                    .to_string(),
                auth: ToolAuth::Bearer {
                    token: "workspace-token".to_string(),
                },
                timeout_ms: None,
                namespace: None,
                required_integration: None,
                runtime_execution: None,
                metadata: std::collections::HashMap::new(),
            },
            InstalledTool {
                name: "send_to_agent".to_string(),
                description: String::new(),
                input_schema: serde_json::json!({}),
                endpoint: format!("{AGENT_TOOL_PATH_PREFIX}/send_to_agent"),
                auth: ToolAuth::None,
                timeout_ms: None,
                namespace: None,
                required_integration: None,
                runtime_execution: None,
                metadata: std::collections::HashMap::new(),
            },
        ];
        stamp_agent_tool_auth(&mut tools, "jwt-abc", Some("org-42"));

        // Workspace tool preserved.
        match &tools[0].auth {
            ToolAuth::Bearer { token } => assert_eq!(token, "workspace-token"),
            other => panic!(
                "workspace bearer must not be rewritten by stamp_agent_tool_auth; got {other:?}"
            ),
        }
        // Cross-agent tool stamped.
        match &tools[1].auth {
            ToolAuth::Headers { headers } => {
                assert_eq!(
                    headers.get("Authorization").map(String::as_str),
                    Some("Bearer jwt-abc")
                );
            }
            other => panic!("cross-agent tool must be stamped; got {other:?}"),
        }
    }

    #[test]
    fn stamp_is_noop_on_empty_jwt() {
        // Guardrail: an empty JWT is almost certainly a bug in the
        // caller, but shipping `Authorization: Bearer ` would still
        // 401 at the dispatcher *and* hide the underlying misconfig
        // behind a generic auth failure. Preserve the original
        // `ToolAuth::None` so the failure mode stays visible.
        let mut tools = build_cross_agent_tools(&AgentPermissions::ceo_preset());
        stamp_agent_tool_auth(&mut tools, "", Some("org-42"));
        assert!(tools.iter().all(|t| matches!(t.auth, ToolAuth::None)));
    }

    #[test]
    fn stamp_matches_after_absolutize() {
        // Defensive: if the call order ever gets reshuffled and
        // `absolutize_agent_tool_endpoints` runs before
        // `stamp_agent_tool_auth`, stamping must still recognise the
        // absolute form of the cross-agent dispatcher URL.
        let mut tools = build_cross_agent_tools(&AgentPermissions::ceo_preset());
        absolutize_agent_tool_endpoints(&mut tools, "http://127.0.0.1:3100");
        stamp_agent_tool_auth(&mut tools, "jwt-abc", Some("org-42"));
        assert!(tools.iter().all(|t| matches!(t.auth, ToolAuth::Headers { .. })));
    }

    #[test]
    fn absolutize_is_noop_on_empty_base_url() {
        // Be forgiving when the base URL is missing / misconfigured:
        // shipping a relative path to the harness still errors, but
        // clobbering the list with `/api/agent_tools/...` prefixed by
        // an empty string would turn the manifest into `//api/...`
        // which is strictly worse. Preserve the original endpoints so
        // the failure mode stays the same observable "relative URL
        // without a base" rather than a harder-to-debug malformed URL.
        let mut tools = build_cross_agent_tools(&AgentPermissions::ceo_preset());
        let before: Vec<String> = tools.iter().map(|t| t.endpoint.clone()).collect();
        absolutize_agent_tool_endpoints(&mut tools, "");
        let after: Vec<String> = tools.iter().map(|t| t.endpoint.clone()).collect();
        assert_eq!(before, after);
    }
}
