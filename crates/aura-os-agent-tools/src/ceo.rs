//! CEO agent template — the seed values the server writes into a fresh
//! agent record when a user first calls the bootstrap endpoint.
//!
//! In the clean-slate Agent model there is only one `Agent` type; what
//! makes it a "CEO" is the [`AgentPermissions::ceo_preset`] bundle plus
//! the matching system prompt / intent classifier. This module centralises
//! those seed values so the bootstrap handler and any future provisioning
//! flows agree byte-for-byte.

use aura_os_core::{AgentPermissions, Capability};
use aura_protocol::{InstalledTool, IntentClassifierRule, IntentClassifierSpec, ToolAuth};

use aura_os_agent_runtime::prompt::ceo_system_prompt;
use aura_os_agent_runtime::tools::CapabilityRequirement;
use aura_os_agent_templates::{classify_intent_with, default_classifier_rules};

/// URL path prefix every cross-agent tool is proxied through.
///
/// The unified `/api/agent_tools/:name` dispatcher executes the tool in-
/// process on behalf of a harness-hosted agent session.
pub const AGENT_TOOL_PATH_PREFIX: &str = "/api/agent_tools";

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
        // CEO agents run with a narrow tier-1 allowlist (see
        // `build_cross_agent_tools` for the rationale); shipping an
        // IntentClassifierSpec would cause the harness to re-filter
        // the list per turn and has silently dropped tier-1 tools
        // like `send_to_agent` in practice.
        intent_classifier: None,
    }
}

/// The per-turn intent classifier spec used by the CEO preset. Mirrors
/// the tier-1/tier-2 keyword rules the in-process path used to apply,
/// so harness-hosted CEOs narrow their tool surface the same way.
///
/// The underlying [`aura_os_agent_templates::AgentTemplate`] is built
/// by [`crate::ceo_agent_template`], which derives its manifest
/// + streaming list from the live registry — eliminating the former
/// three-way sync between `ceo.rs`, `agent-templates`, and the
/// `ToolRegistry` wiring.
pub fn ceo_intent_classifier_spec() -> IntentClassifierSpec {
    let template = crate::ceo_agent_template();
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
/// Thin wrapper around [`crate::session::build_session_tools`] — the
/// single unified entry point for assembling an `InstalledTool` list
/// from a capability bundle. CEO and non-CEO bundles flow through
/// exactly the same filter; what differs is the capabilities they
/// carry (the CEO preset holds the wildcard
/// [`Capability::ReadAllProjects`] / [`Capability::WriteAllProjects`]
/// so project-scoped tools pass the same
/// `permissions_satisfy_requirements` check that applies to any other
/// bundle).
///
/// Every returned entry points at [`AGENT_TOOL_PATH_PREFIX`]`/:name` on
/// the local server; the harness forwards the caller's JWT so the
/// dispatcher can authorize against the real user.
#[must_use]
pub fn build_cross_agent_tools(permissions: &AgentPermissions) -> Vec<InstalledTool> {
    crate::session::build_session_tools(permissions, &[])
}

/// Chat-path entry point kept for signature compatibility.
///
/// Historically this was a message-aware variant of
/// [`build_cross_agent_tools`] that ran an intent classifier over the
/// user's message and narrowed a ~55-tool CEO manifest down to tier-1
/// plus any tier-2 domains the classifier matched. Per-turn narrowing
/// has been removed — every tool whose `required_capabilities()` the
/// agent satisfies ships in the default session payload. The
/// `message` parameter is retained so call sites don't have to churn;
/// it is ignored.
#[must_use]
pub fn build_cross_agent_tools_for_message(
    permissions: &AgentPermissions,
    _message: Option<&str>,
) -> Vec<InstalledTool> {
    crate::session::build_session_tools(permissions, &[])
}

/// Returns true if `name` is one of the aura-native project tools
/// emitted by [`build_cross_agent_tools`] when `ReadProject` /
/// `WriteProject` capabilities are present. Used by the installed-tools
/// diagnostic to label the origin capability in the sidekick.
///
/// Derived from the canonical [`ToolRegistry`](aura_os_agent_runtime::tools::ToolRegistry) by
/// inspecting each tool's [`CapabilityRequirement`] set; tools that
/// declare a `WriteProjectFromArg` requirement are classified as
/// write-project origins (write is a strict superset of read, so we
/// never mis-label a write tool as read), and tools with only
/// `ReadProjectFromArg` are classified as read-project origins.
#[must_use]
pub fn aura_native_project_tool_origin(name: &str) -> Option<Capability> {
    let registry = crate::shared_all_tools_registry();
    let tool = registry.get(name)?;
    let reqs = tool.required_capabilities();
    let has_write = reqs
        .iter()
        .any(|r| matches!(r, CapabilityRequirement::WriteProjectFromArg(_)));
    if has_write {
        return Some(Capability::WriteProject { id: String::new() });
    }
    let has_read = reqs
        .iter()
        .any(|r| matches!(r, CapabilityRequirement::ReadProjectFromArg(_)));
    if has_read {
        return Some(Capability::ReadProject { id: String::new() });
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
    agent_id: Option<&str>,
    project_id: Option<&str>,
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
        let is_cross_agent =
            endpoint.starts_with(AGENT_TOOL_PATH_PREFIX) || endpoint.contains("/api/agent_tools/");
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
        // Stamp the calling agent's id so the dispatcher can resolve
        // the agent's permissions and re-check the policy before
        // executing a cross-agent tool. The harness is expected to
        // pre-filter tools at session init, but a compromised or buggy
        // harness must not be able to escalate beyond the chatting
        // agent's declared capabilities.
        if let Some(aid) = agent_id {
            let trimmed = aid.trim();
            if !trimmed.is_empty() {
                headers.insert("x-aura-agent-id".to_string(), trimmed.to_string());
            }
        }
        // Stamp the session's bound project id so the dispatcher can
        // inject it into tool args when the LLM omits `project_id`.
        // Project-scoped tools (`create_spec`, `create_task`,
        // `list_specs`, …) historically required the LLM to thread
        // `project_id` through every call even though the session
        // has exactly one binding; the header lifts that obligation
        // and lets the dispatcher fall back to the session value.
        if let Some(pid) = project_id {
            let trimmed = pid.trim();
            if !trimmed.is_empty() {
                headers.insert("x-aura-project-id".to_string(), trimmed.to_string());
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

#[cfg(test)]
mod tests {
    use super::*;
    use aura_os_core::AgentScope;

    fn tool_names(tools: &[InstalledTool]) -> Vec<&str> {
        tools.iter().map(|t| t.name.as_str()).collect()
    }

    #[test]
    fn ceo_template_is_ceo_preset() {
        let t = ceo_agent_template("Acme", "org-123");
        assert!(t.permissions.is_ceo_preset());
        assert_eq!(t.role, "CEO");
        assert!(t.system_prompt.contains("Acme"));
        assert!(t.system_prompt.contains("org-123"));
        assert!(
            t.intent_classifier.is_none(),
            "CEO template must not ship an IntentClassifierSpec — the narrow tier-1 \
             allowlist is the guard against classifier-driven tool dropouts"
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

    #[test]
    fn read_project_exposes_every_read_tool_no_write_tools() {
        // A non-CEO agent granted `ReadProject` on a specific project
        // now sees every read tool from the aura-native manifest,
        // regardless of the tool's legacy surface classification.
        // Write-side tools must still be withheld because the bundle
        // does not carry `WriteProject`.
        let perms = AgentPermissions {
            scope: AgentScope::default(),
            capabilities: vec![Capability::ReadProject {
                id: "proj-1".to_string(),
            }],
        };
        let tools = build_cross_agent_tools(&perms);
        let names = tool_names(&tools);

        let registry = crate::shared_all_tools_registry();
        for tool in registry.list_tools() {
            let reqs = tool.required_capabilities();
            let is_read = reqs
                .iter()
                .any(|r| matches!(r, CapabilityRequirement::ReadProjectFromArg(_)));
            let is_write = reqs
                .iter()
                .any(|r| matches!(r, CapabilityRequirement::WriteProjectFromArg(_)));
            if is_read && !is_write {
                assert!(
                    names.contains(&tool.name()),
                    "expected read tool `{}` for ReadProject grant; got {names:?}",
                    tool.name()
                );
            }
            if is_write {
                assert!(
                    !names.contains(&tool.name()),
                    "write tool `{}` must not appear without WriteProject",
                    tool.name()
                );
            }
        }
    }

    #[test]
    fn write_project_exposes_every_project_tool() {
        // `WriteProject` implies `ReadProject`. With the surface gate
        // removed, every project-scoped tool whose capabilities this
        // bundle satisfies must ship in the default session — there
        // is no longer a separate on-demand tier that requires
        // `load_domain_tools` promotion.
        let perms = AgentPermissions {
            scope: AgentScope::default(),
            capabilities: vec![Capability::WriteProject {
                id: "proj-1".to_string(),
            }],
        };
        let tools = build_cross_agent_tools(&perms);
        let names = tool_names(&tools);
        let registry = crate::shared_all_tools_registry();
        for tool in registry.list_tools() {
            let reqs = tool.required_capabilities();
            let is_project_scoped = reqs.iter().any(|r| {
                matches!(
                    r,
                    CapabilityRequirement::ReadProjectFromArg(_)
                        | CapabilityRequirement::WriteProjectFromArg(_)
                )
            });
            if is_project_scoped {
                assert!(
                    names.contains(&tool.name()),
                    "expected project tool `{}` for WriteProject grant; got {names:?}",
                    tool.name()
                );
            }
        }
    }

    #[test]
    fn no_project_capabilities_means_no_project_tools() {
        // Agents with only cross-agent capabilities (SpawnAgent /
        // ReadAgent) must not see any project-scoped tool — the LLM
        // menu must mirror what the agent could actually invoke.
        let perms = AgentPermissions {
            scope: AgentScope::default(),
            capabilities: vec![Capability::SpawnAgent, Capability::ReadAgent],
        };
        let tools = build_cross_agent_tools(&perms);
        let names = tool_names(&tools);
        let registry = crate::shared_all_tools_registry();
        for tool in registry.list_tools() {
            let reqs = tool.required_capabilities();
            let is_project_scoped = reqs.iter().any(|r| {
                matches!(
                    r,
                    CapabilityRequirement::ReadProjectFromArg(_)
                        | CapabilityRequirement::WriteProjectFromArg(_)
                )
            });
            if is_project_scoped {
                assert!(
                    !names.contains(&tool.name()),
                    "unexpected project tool `{}` emitted without project capability",
                    tool.name()
                );
            }
        }
        // Synthetic `spawn_agent` + the registry-backed `get_agent`
        // must still appear for this permission bundle.
        assert!(names.contains(&"spawn_agent"));
        assert!(names.contains(&"get_agent"));
    }

    #[test]
    fn ceo_preset_ignores_message_parameter() {
        // The message-aware variant must return the same allowlist whether
        // or not a message is supplied — the static allowlist deliberately
        // side-steps per-turn classification, which is what caused the
        // classifier to silently drop `send_to_agent` on simple prompts.
        let perms = AgentPermissions::ceo_preset();
        let without = build_cross_agent_tools_for_message(&perms, None);
        let with = build_cross_agent_tools_for_message(&perms, Some("hi, what's the weather"));
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
        assert!(
            names.contains(&"send_to_agent"),
            "CEO manifest must always expose send_to_agent; got {names:?}"
        );
        assert!(
            names.contains(&"load_domain_tools"),
            "CEO manifest must always expose load_domain_tools; got {names:?}"
        );
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

        for name in ["send_to_agent", "list_agents", "get_agent"] {
            assert!(
                !find(name).description.is_empty(),
                "`{name}` must ship a non-empty description to the harness"
            );
        }

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

        // `project_id` is no longer in the `required` array for
        // project-scoped tools (the aura-os-server dispatcher injects
        // it from the `X-Aura-Project-Id` header before the capability
        // check), but it MUST still appear in `properties` so the LLM
        // can pass it explicitly for cross-project CEO calls.
        let get_project_schema = &find("get_project").input_schema;
        let properties = get_project_schema
            .get("properties")
            .and_then(|v| v.as_object())
            .expect("`get_project` schema must carry a properties object");
        assert!(
            properties.contains_key("project_id"),
            "`get_project` schema must still expose `project_id` in properties so CEO-style callers can pass it explicitly; got properties = {:?}",
            properties.keys().collect::<Vec<_>>()
        );
    }

    #[test]
    fn installed_tools_for_readproject_carry_schemas() {
        // The capability-gated aura-native branch must deliver real
        // schemas, otherwise project-scoped agents would hit the same
        // "LLM can't call this" problem as the CEO did. Both
        // `get_project` (previously always-on) and `list_specs`
        // (previously on-demand) now ship in the default session
        // payload, so the assertion runs once against the fresh
        // session for both tools.
        let perms = AgentPermissions {
            scope: AgentScope::default(),
            capabilities: vec![Capability::ReadProject {
                id: "proj-1".to_string(),
            }],
        };
        let tools = build_cross_agent_tools(&perms);
        for name in ["get_project", "list_specs"] {
            let tool = tools
                .iter()
                .find(|t| t.name == name)
                .unwrap_or_else(|| panic!("ReadProject should emit `{name}` on a fresh session"));
            assert!(
                !tool.description.is_empty(),
                "`{name}` must ship a non-empty description"
            );
            assert!(
                tool.input_schema
                    .get("properties")
                    .and_then(|v| v.as_object())
                    .is_some_and(|p| !p.is_empty()),
                "`{name}` must ship a non-empty properties schema"
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
                tool.endpoint
                    .starts_with("http://127.0.0.1:3100/api/agent_tools/"),
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
            tools[0].endpoint, "https://example.com/api/orgs/acme/tool-actions/workspace_tool",
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
        assert!(tools.iter().all(|t| matches!(t.auth, ToolAuth::None)));

        stamp_agent_tool_auth(
            &mut tools,
            "jwt-abc",
            Some("org-42"),
            Some("agent-007"),
            Some("proj-777"),
        );

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
                    assert_eq!(
                        headers.get("x-aura-project-id").map(String::as_str),
                        Some("proj-777"),
                        "`{}` must carry the session project id",
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
        stamp_agent_tool_auth(&mut tools, "jwt-abc", None, None, None);

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
        stamp_agent_tool_auth(&mut tools, "jwt-abc", Some("   "), None, None);
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
        stamp_agent_tool_auth(
            &mut tools,
            "jwt-abc",
            Some("org-42"),
            Some("agent-007"),
            None,
        );

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
        stamp_agent_tool_auth(&mut tools, "", Some("org-42"), None, None);
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
        stamp_agent_tool_auth(
            &mut tools,
            "jwt-abc",
            Some("org-42"),
            Some("agent-007"),
            None,
        );
        assert!(tools
            .iter()
            .all(|t| matches!(t.auth, ToolAuth::Headers { .. })));
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
