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

use crate::prompt::super_agent_system_prompt;
use aura_os_super_agent_profile::{
    classify_intent_with, default_classifier_rules, SuperAgentProfile,
};

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
/// rendered using [`super_agent_system_prompt`] so it stays bit-compatible
/// with previous builds.
pub fn ceo_agent_template(org_name: &str, org_id: &str) -> CeoAgentTemplate {
    CeoAgentTemplate {
        name: "CEO".to_string(),
        role: "CEO".to_string(),
        personality:
            "Strategic, efficient, and proactive. I orchestrate your entire development operation."
                .to_string(),
        system_prompt: super_agent_system_prompt(org_name, org_id),
        permissions: AgentPermissions::ceo_preset(),
        intent_classifier: Some(ceo_intent_classifier_spec()),
    }
}

/// The per-turn intent classifier spec used by the CEO preset. Mirrors
/// the tier-1/tier-2 keyword rules the in-process super-agent used to
/// apply, so harness-hosted CEOs narrow tool surface the same way.
pub fn ceo_intent_classifier_spec() -> IntentClassifierSpec {
    let profile = SuperAgentProfile::ceo_default();
    let tier1_domains = profile.tier1_domains_snake_case();
    let classifier_rules = profile
        .classifier_rules_snake_case()
        .into_iter()
        .map(|(domain, keywords)| IntentClassifierRule { domain, keywords })
        .collect();
    let tool_domains = profile.tool_domains_snake_case();
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
        return SuperAgentProfile::ceo_default()
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
    tools
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
}
