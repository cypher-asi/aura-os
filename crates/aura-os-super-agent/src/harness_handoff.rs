//! Render a [`SuperAgentProfile`] into the wire payload a harness session
//! needs to behave like an in-process super-agent.
//!
//! Phase 3 of the super-agent / harness unification plan: instead of
//! running `SuperAgentStream` in `aura-os-server`, we hand a preloaded
//! harness session the portable profile so the harness can:
//!
//! 1. render the system prompt (`SuperAgentProfile::render_system_prompt`),
//! 2. install every tool as an [`aura_protocol::InstalledTool`] pointing
//!    at the super-agent dispatcher endpoint in `aura-os-server`, and
//! 3. narrow the per-turn tool surface via
//!    [`aura_protocol::IntentClassifierSpec`] using the same tier/keyword
//!    rules as the legacy `classify_intent`.
//!
//! Everything here is pure (no async, no I/O) so it can be unit-tested
//! exhaustively and reused by the forthcoming `HarnessSuperAgentDriver`.

use std::collections::HashMap;

use aura_os_super_agent_profile::{SuperAgentProfile, ToolManifestEntry};
use aura_protocol::{
    IntentClassifierRule, IntentClassifierSpec, InstalledTool, SessionInit, ToolAuth,
};

/// URL path prefix every super-agent tool is proxied through.
///
/// `{name}` is replaced by the tool's wire name when assembling the
/// [`InstalledTool::endpoint`] for each manifest entry.
pub const SUPER_AGENT_TOOL_DISPATCH_PATH: &str = "/api/super_agent/tools/";

/// Default per-tool HTTP timeout for harness-hosted super-agent tools.
///
/// 60 s is conservative but matches today's in-process behaviour, where
/// `reqwest::Client::new()` itself has no explicit timeout and slow
/// upstreams (e.g. generation) routinely exceed 30 s. The harness will
/// abort the request if the dispatcher takes longer.
pub const DEFAULT_TOOL_TIMEOUT_MS: u64 = 60_000;

/// Build one [`InstalledTool`] per manifest entry, pointing at the
/// dispatcher endpoint in `aura-os-server`.
///
/// `server_base_url` is the `aura-os-server` root (no trailing slash),
/// e.g. `"http://localhost:4001"`. Each tool's endpoint becomes
/// `"{server_base_url}/api/super_agent/tools/{name}"`, which the harness
/// POSTs with the tool's JSON arguments as the request body. `jwt` is
/// attached as a [`ToolAuth::Bearer`] token so the dispatcher can
/// authenticate the caller using the same bearer flow as direct aura-os
/// HTTP clients.
///
/// The returned vector preserves manifest order for deterministic
/// inspection in tests.
#[must_use]
pub fn profile_to_installed_tools(
    profile: &SuperAgentProfile,
    server_base_url: &str,
    jwt: &str,
) -> Vec<InstalledTool> {
    let base = server_base_url.trim_end_matches('/');
    profile
        .tool_manifest
        .iter()
        .map(|entry| manifest_entry_to_installed_tool(entry, profile, base, jwt))
        .collect()
}

fn manifest_entry_to_installed_tool(
    entry: &ToolManifestEntry,
    profile: &SuperAgentProfile,
    base: &str,
    jwt: &str,
) -> InstalledTool {
    let endpoint = format!("{base}{SUPER_AGENT_TOOL_DISPATCH_PATH}{}", entry.name);
    let auth = if jwt.is_empty() {
        ToolAuth::None
    } else {
        ToolAuth::Bearer {
            token: jwt.to_string(),
        }
    };

    // Metadata lets the dispatcher / observability layers trace back to
    // the profile without re-deriving the domain from the tool name.
    // Also flags streaming tools so the harness protocol layer can wire
    // them to `eager_input_streaming` if we extend `InstalledTool` with
    // that bit later; today it is informational.
    let mut metadata: HashMap<String, serde_json::Value> = HashMap::new();
    metadata.insert(
        "super_agent_preset".into(),
        serde_json::Value::String(profile.preset.clone()),
    );
    metadata.insert(
        "domain".into(),
        serde_json::to_value(entry.domain).unwrap_or(serde_json::Value::Null),
    );
    if profile.streaming_tool_names.iter().any(|n| n == &entry.name) {
        metadata.insert(
            "eager_input_streaming".into(),
            serde_json::Value::Bool(true),
        );
    }

    InstalledTool {
        name: entry.name.clone(),
        description: format!("{} (super-agent `{}` preset)", entry.name, profile.preset),
        // The harness currently treats `input_schema` as opaque model
        // context; use a permissive object schema rather than shipping
        // per-tool JSON schemas cross-process. The dispatcher performs
        // the real validation using the super-agent's native
        // `parameters_schema`.
        input_schema: serde_json::json!({ "type": "object", "additionalProperties": true }),
        endpoint,
        auth,
        timeout_ms: Some(DEFAULT_TOOL_TIMEOUT_MS),
        namespace: Some(format!("super_agent.{}", profile.preset)),
        required_integration: None,
        runtime_execution: None,
        metadata,
    }
}

/// Render the classifier subset of `profile` into the wire spec the
/// harness consumes via [`aura_protocol::SessionInit::intent_classifier`].
///
/// The resulting value is equivalent to (and produced from) the same
/// fields `aura-tools::IntentClassifier::from_profile_json` deserializes
/// on the harness side, plus a `tool_domains` map so the harness can
/// narrow `tool_definitions` without a copy of the manifest in its
/// binary.
#[must_use]
pub fn profile_to_intent_classifier_spec(profile: &SuperAgentProfile) -> IntentClassifierSpec {
    IntentClassifierSpec {
        tier1_domains: profile.tier1_domains_snake_case(),
        classifier_rules: profile
            .classifier_rules_snake_case()
            .into_iter()
            .map(|(domain, keywords)| IntentClassifierRule { domain, keywords })
            .collect(),
        tool_domains: profile.tool_domains_snake_case(),
    }
}

/// Build a complete [`SessionInit`] payload that turns a blank harness
/// session into a super-agent.
///
/// - `profile` — portable super-agent configuration.
/// - `org_name` / `org_id` — rendered into the system prompt.
/// - `server_base_url` — `aura-os-server` root used for tool dispatch.
/// - `jwt` — bearer token attached to every tool call.
/// - `model` — optional model override; defaults to the harness default
///   when `None`.
///
/// Everything else is left at protocol defaults. Callers are free to
/// mutate fields afterwards (e.g. to attach a `project_path`).
#[must_use]
pub fn build_super_agent_session_init(
    profile: &SuperAgentProfile,
    org_name: &str,
    org_id: &str,
    server_base_url: &str,
    jwt: &str,
    model: Option<String>,
) -> SessionInit {
    SessionInit {
        system_prompt: Some(profile.render_system_prompt(org_name, org_id)),
        model,
        max_tokens: None,
        temperature: None,
        max_turns: None,
        installed_tools: Some(profile_to_installed_tools(profile, server_base_url, jwt)),
        installed_integrations: None,
        workspace: None,
        project_path: None,
        token: Some(jwt.to_string()),
        project_id: None,
        conversation_messages: None,
        aura_agent_id: None,
        aura_session_id: None,
        aura_org_id: Some(org_id.to_string()),
        agent_id: None,
        provider_config: None,
        intent_classifier: Some(profile_to_intent_classifier_spec(profile)),
        agent_permissions: None,
        preset: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_os_super_agent_profile::SuperAgentProfile;

    fn ceo() -> SuperAgentProfile {
        SuperAgentProfile::ceo_default()
    }

    #[test]
    fn installed_tools_cover_every_manifest_entry() {
        let profile = ceo();
        let tools = profile_to_installed_tools(&profile, "http://localhost:4001", "jwt-xyz");
        assert_eq!(tools.len(), profile.tool_manifest.len());
        for (installed, entry) in tools.iter().zip(profile.tool_manifest.iter()) {
            assert_eq!(installed.name, entry.name);
            assert!(installed
                .endpoint
                .ends_with(&format!("/api/super_agent/tools/{}", entry.name)));
        }
    }

    #[test]
    fn installed_tools_strip_trailing_slash_from_base() {
        let profile = ceo();
        let tools = profile_to_installed_tools(&profile, "http://localhost:4001/", "jwt");
        assert!(tools[0].endpoint.starts_with("http://localhost:4001/api/"));
        assert!(!tools[0].endpoint.contains("localhost:4001//"));
    }

    #[test]
    fn installed_tool_bearer_auth_uses_jwt() {
        let tools = profile_to_installed_tools(&ceo(), "http://host", "my-jwt");
        match &tools[0].auth {
            ToolAuth::Bearer { token } => assert_eq!(token, "my-jwt"),
            other => panic!("expected Bearer auth, got {other:?}"),
        }
    }

    #[test]
    fn installed_tool_auth_is_none_when_jwt_empty() {
        let tools = profile_to_installed_tools(&ceo(), "http://host", "");
        assert!(matches!(tools[0].auth, ToolAuth::None));
    }

    #[test]
    fn streaming_tools_are_tagged_in_metadata() {
        let profile = ceo();
        let tools = profile_to_installed_tools(&profile, "http://host", "jwt");
        let streaming: Vec<_> = tools
            .iter()
            .filter(|t| {
                t.metadata
                    .get("eager_input_streaming")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
            })
            .map(|t| t.name.as_str())
            .collect();
        for expected in &profile.streaming_tool_names {
            // Streaming names may not all appear in the manifest (e.g.
            // `write_file` / `edit_file` are harness tools, not
            // super-agent ones). The ones that do must be tagged.
            if profile.tool_manifest.iter().any(|e| &e.name == expected) {
                assert!(
                    streaming.contains(&expected.as_str()),
                    "{expected} should be tagged eager_input_streaming"
                );
            }
        }
    }

    #[test]
    fn intent_classifier_spec_matches_profile() {
        let profile = ceo();
        let spec = profile_to_intent_classifier_spec(&profile);
        assert_eq!(spec.tier1_domains, profile.tier1_domains_snake_case());
        assert_eq!(spec.classifier_rules.len(), profile.classifier_rules.len());
        for (rule, (expected_dom, expected_kws)) in spec
            .classifier_rules
            .iter()
            .zip(profile.classifier_rules_snake_case())
        {
            assert_eq!(rule.domain, expected_dom);
            assert_eq!(rule.keywords, expected_kws);
        }
        assert_eq!(spec.tool_domains.len(), profile.tool_manifest.len());
    }

    #[test]
    fn session_init_carries_prompt_tools_and_classifier() {
        let profile = ceo();
        let init = build_super_agent_session_init(
            &profile,
            "Acme",
            "org-42",
            "http://localhost:4001",
            "jwt-xyz",
            Some("claude-opus-4-6".into()),
        );
        let prompt = init.system_prompt.as_deref().unwrap();
        assert!(prompt.contains("Acme"), "prompt must mention org name");
        assert!(prompt.contains("org-42"), "prompt must mention org id");
        assert_eq!(init.model.as_deref(), Some("claude-opus-4-6"));
        assert_eq!(init.token.as_deref(), Some("jwt-xyz"));
        assert_eq!(init.aura_org_id.as_deref(), Some("org-42"));
        let tools = init.installed_tools.as_ref().unwrap();
        assert_eq!(tools.len(), profile.tool_manifest.len());
        assert!(init.intent_classifier.is_some());
    }

    #[test]
    fn session_init_is_deterministic_for_same_inputs() {
        let a = build_super_agent_session_init(
            &ceo(),
            "Acme",
            "org-42",
            "http://localhost:4001",
            "jwt",
            None,
        );
        let b = build_super_agent_session_init(
            &ceo(),
            "Acme",
            "org-42",
            "http://localhost:4001",
            "jwt",
            None,
        );
        // Serialize through JSON to avoid requiring PartialEq on SessionInit.
        assert_eq!(
            serde_json::to_value(&a).unwrap(),
            serde_json::to_value(&b).unwrap()
        );
    }
}
