//! Portable, JSON-serializable profile that configures a generic harness
//! agent to behave like today's CEO super-agent.
//!
//! The profile captures everything the harness needs at startup to know
//! (a) what system prompt to render, (b) which tool names belong to
//! which [`ToolDomain`], (c) which domains are always-on vs load-on-
//! demand, (d) which keywords promote which domains, and (e) which
//! tools should opt in to eager input streaming.
//!
//! It deliberately contains no code — only data — so it can be:
//!
//! - serialized to JSON and POSTed to a remote harness,
//! - stored next to the agent record,
//! - or inlined as a Rust constant via
//!   [`SuperAgentProfile::ceo_default`].
//!
//! Phase 2 uses this crate from the existing in-process super-agent
//! path (bit-compatible with today's hard-coded values). Phase 3 will
//! ship the same profile to a harness-hosted agent through the
//! `HarnessClient` added in phase 1.

use aura_os_core::ToolDomain;
use serde::{Deserialize, Serialize};

use crate::tier::{default_classifier_rules, ClassifierRule, LOADABLE_DOMAINS, TIER1_DOMAINS};

/// Name under which the CEO preset is referenced by the interface and
/// the harness. Kept in a single place so phase 6's "create agent + pick
/// preset" flow can reference the exact same identifier.
pub const CEO_PRESET_NAME: &str = "ceo";

/// Ordered tool → domain assignment used by the super-agent to filter
/// the exposed tool list each turn. The fixed ordering mirrors the
/// `ToolRegistry::with_all_tools` wiring and guarantees deterministic
/// JSON round-trips.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ToolManifestEntry {
    pub name: String,
    pub domain: ToolDomain,
}

/// Complete tool manifest for the CEO preset, listed in registration
/// order (tier-1 first, then tier-2 by domain). Mirrors
/// `ToolRegistry::with_tier1_tools` + `ToolRegistry::with_all_tools`
/// + `ToolRegistry::register_process_tools` exactly.
pub fn ceo_tool_manifest() -> Vec<ToolManifestEntry> {
    use ToolDomain::*;
    let rows: &[(&str, ToolDomain)] = &[
        // Project tools (tier 1)
        ("create_project", Project),
        ("import_project", Project),
        ("list_projects", Project),
        ("get_project", Project),
        ("update_project", Project),
        ("delete_project", Project),
        ("archive_project", Project),
        ("get_project_stats", Project),
        // Agent tools (tier 1)
        ("list_agents", Agent),
        ("get_agent", Agent),
        ("assign_agent_to_project", Agent),
        // Execution tools (tier 1)
        ("start_dev_loop", Execution),
        ("pause_dev_loop", Execution),
        ("stop_dev_loop", Execution),
        ("get_loop_status", Execution),
        ("send_to_agent", Execution),
        // Monitoring tools (tier 1)
        ("get_fleet_status", Monitoring),
        ("get_progress_report", Monitoring),
        ("get_project_cost", Monitoring),
        // Billing tools (tier 1 head)
        ("get_credit_balance", Billing),
        // Meta-tool (always on)
        ("load_domain_tools", System),
        // Spec tools (tier 2)
        ("list_specs", Spec),
        ("get_spec", Spec),
        ("create_spec", Spec),
        ("update_spec", Spec),
        ("delete_spec", Spec),
        ("generate_specs", Spec),
        ("generate_specs_summary", Spec),
        // Task tools (tier 2)
        ("list_tasks", Task),
        ("list_tasks_by_spec", Task),
        ("get_task", Task),
        ("create_task", Task),
        ("update_task", Task),
        ("delete_task", Task),
        ("extract_tasks", Task),
        ("transition_task", Task),
        ("retry_task", Task),
        ("run_task", Task),
        ("get_task_output", Task),
        // Additional agent tools (tier 2)
        ("create_agent", Agent),
        ("update_agent", Agent),
        ("delete_agent", Agent),
        ("list_agent_instances", Agent),
        ("update_agent_instance", Agent),
        ("delete_agent_instance", Agent),
        ("remote_agent_action", Agent),
        // Org tools (tier 2)
        ("list_orgs", Org),
        ("create_org", Org),
        ("get_org", Org),
        ("update_org", Org),
        ("list_members", Org),
        ("update_member_role", Org),
        ("remove_member", Org),
        ("manage_invites", Org),
        // Additional billing tools (tier 2)
        ("get_transactions", Billing),
        ("get_billing_account", Billing),
        ("purchase_credits", Billing),
        // Social tools (tier 2)
        ("list_feed", Social),
        ("create_post", Social),
        ("get_post", Social),
        ("add_comment", Social),
        ("delete_comment", Social),
        ("follow_profile", Social),
        ("unfollow_profile", Social),
        ("list_follows", Social),
        // Additional monitoring tools (tier 2)
        ("get_leaderboard", Monitoring),
        ("get_usage_stats", Monitoring),
        ("list_sessions", Monitoring),
        ("list_log_entries", Monitoring),
        // System tools (tier 2)
        ("browse_files", System),
        ("read_file", System),
        ("get_environment_info", System),
        ("get_remote_agent_state", System),
        // Generation tools (tier 2)
        ("generate_image", Generation),
        ("generate_3d_model", Generation),
        ("get_3d_status", Generation),
        // Process tools (registered dynamically at boot)
        ("create_process", Process),
        ("list_processes", Process),
        ("delete_process", Process),
        ("trigger_process", Process),
        ("list_process_runs", Process),
    ];
    rows.iter()
        .map(|(name, domain)| ToolManifestEntry {
            name: (*name).to_string(),
            domain: *domain,
        })
        .collect()
}

/// A portable super-agent profile. Everything the harness needs to know
/// to behave like an aura-os super-agent, shippable as one JSON blob.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuperAgentProfile {
    /// Human-readable preset name (e.g. `"ceo"`).
    pub preset: String,
    /// System prompt template. `{org_name}` and `{org_id}` placeholders
    /// are replaced by [`SuperAgentProfile::render_system_prompt`].
    pub system_prompt_template: String,
    /// Domains always exposed to the LLM.
    pub tier1_domains: Vec<ToolDomain>,
    /// Domains the user / classifier can promote on demand.
    pub loadable_domains: Vec<String>,
    /// Keyword classifier rules used to decide which tier-2 domains to
    /// expose each turn.
    pub classifier_rules: Vec<ClassifierRule>,
    /// Complete tool → domain manifest for this preset.
    pub tool_manifest: Vec<ToolManifestEntry>,
    /// Tool names whose JSON args should stream eagerly.
    pub streaming_tool_names: Vec<String>,
}

impl SuperAgentProfile {
    /// The CEO preset — bit-compatible with today's hard-coded
    /// super-agent configuration.
    pub fn ceo_default() -> Self {
        Self {
            preset: CEO_PRESET_NAME.to_string(),
            system_prompt_template: ceo_system_prompt_template(),
            tier1_domains: TIER1_DOMAINS.to_vec(),
            loadable_domains: LOADABLE_DOMAINS.iter().map(|s| (*s).to_string()).collect(),
            classifier_rules: default_classifier_rules(),
            tool_manifest: ceo_tool_manifest(),
            streaming_tool_names: crate::tier::STREAMING_TOOL_NAMES
                .iter()
                .map(|s| (*s).to_string())
                .collect(),
        }
    }

    /// Fill in the `{org_name}` / `{org_id}` placeholders.
    pub fn render_system_prompt(&self, org_name: &str, org_id: &str) -> String {
        self.system_prompt_template
            .replace("{org_name}", org_name)
            .replace("{org_id}", org_id)
    }

    /// Return the subset of the tool manifest whose domain is in `domains`.
    pub fn tools_for_domains(&self, domains: &[ToolDomain]) -> Vec<&ToolManifestEntry> {
        self.tool_manifest
            .iter()
            .filter(|t| domains.contains(&t.domain))
            .collect()
    }
}

/// Raw template string used by [`SuperAgentProfile::ceo_default`].
///
/// Kept identical (modulo the `{org_*}` placeholders) to the body of
/// [`crate::prompt::super_agent_system_prompt`] so that in-process and
/// harness-hosted agents render bit-identical prompts.
fn ceo_system_prompt_template() -> String {
    r#"You are the CEO SuperAgent for the "{org_name}" organization in Aura OS.

You are a high-level orchestrator that manages projects, agents, and all system capabilities through natural language. You decompose user requests into tool calls that execute against the Aura OS platform.

## Your Capabilities
- Create, manage, and monitor projects
- Assign agents to projects and manage the agent fleet
- Start, pause, and stop development loops
- Monitor progress, costs, and fleet status
- Manage organization settings, billing, and members
- Access social features (feed, posts, follows)
- Browse files and system information
- Create and manage process workflows that run automatically on a schedule
- Trigger process runs and inspect process artifacts
- Monitor process execution history and automation state

## Behavioral Guidelines
1. Always confirm destructive actions (delete, stop) before executing
2. When creating a project, offer to also generate specs and assign an agent
3. Prefer showing progress summaries after multi-step operations
4. Be proactive about cost awareness — mention credit usage when relevant
5. Chain related operations efficiently (e.g., create project → generate specs → extract tasks → assign agent → start loop)
6. When drafting long-form specs or other substantial markdown that will be persisted via tools such as `create_spec` or `update_spec`, first stream the actual draft markdown visibly as normal assistant text, then call the tool with that same finalized markdown. Do not stream meta-commentary like "I will create a spec" as the draft. The visible text should be the real spec body the user is meant to read.

## Organization Context
- Organization: {org_name}
- Organization ID: {org_id}
"#
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ceo_default_renders_bit_compatible_prompt() {
        let rendered =
            SuperAgentProfile::ceo_default().render_system_prompt("Acme", "org-123");
        let expected = crate::prompt::super_agent_system_prompt("Acme", "org-123");
        assert_eq!(
            rendered, expected,
            "profile-based prompt must match the legacy helper byte-for-byte"
        );
    }

    #[test]
    fn json_roundtrip_preserves_every_field() {
        let profile = SuperAgentProfile::ceo_default();
        let json = serde_json::to_string(&profile).unwrap();
        let back: SuperAgentProfile = serde_json::from_str(&json).unwrap();
        assert_eq!(back.preset, profile.preset);
        assert_eq!(back.tier1_domains, profile.tier1_domains);
        assert_eq!(back.loadable_domains, profile.loadable_domains);
        assert_eq!(back.streaming_tool_names, profile.streaming_tool_names);
        assert_eq!(back.tool_manifest, profile.tool_manifest);
        assert_eq!(back.system_prompt_template, profile.system_prompt_template);
    }

    #[test]
    fn tool_manifest_has_no_duplicate_names() {
        let mut names: Vec<_> = ceo_tool_manifest()
            .into_iter()
            .map(|e| e.name)
            .collect();
        let before = names.len();
        names.sort();
        names.dedup();
        assert_eq!(
            before,
            names.len(),
            "duplicate tool names in ceo_tool_manifest"
        );
    }

    #[test]
    fn tools_for_domains_filters_manifest() {
        let profile = SuperAgentProfile::ceo_default();
        let spec_tools = profile.tools_for_domains(&[ToolDomain::Spec]);
        assert!(!spec_tools.is_empty());
        for t in &spec_tools {
            assert_eq!(t.domain, ToolDomain::Spec);
        }
        // create_spec must be in the Spec subset.
        assert!(spec_tools.iter().any(|t| t.name == "create_spec"));
    }

    #[test]
    fn streaming_names_match_legacy_static_list() {
        let profile = SuperAgentProfile::ceo_default();
        assert_eq!(
            profile.streaming_tool_names,
            vec![
                "create_spec".to_string(),
                "update_spec".to_string(),
                "write_file".to_string(),
                "edit_file".to_string(),
            ]
        );
    }

    #[test]
    fn tier1_domains_match_tier_module_constant() {
        let profile = SuperAgentProfile::ceo_default();
        assert_eq!(profile.tier1_domains, TIER1_DOMAINS);
    }

    /// Contract test: the JSON wire shape must match what
    /// `aura-tools::IntentClassifier::from_profile_json` expects
    /// (`tier1_domains: [String]` + `classifier_rules: [{domain,
    /// keywords}]`). Phase 3 will ship this exact JSON to a
    /// harness-hosted agent; if this test fails, the harness
    /// classifier will silently fall back to tier-1-only behavior.
    #[test]
    fn wire_shape_matches_harness_intent_classifier_contract() {
        let profile = SuperAgentProfile::ceo_default();
        let v = serde_json::to_value(&profile).unwrap();
        let obj = v.as_object().expect("top-level must be object");

        let tier1 = obj
            .get("tier1_domains")
            .expect("tier1_domains must exist")
            .as_array()
            .expect("tier1_domains must be an array");
        for d in tier1 {
            assert!(
                d.is_string(),
                "tier1_domains entries must be snake_case strings, got {d:?}"
            );
        }

        let rules = obj
            .get("classifier_rules")
            .expect("classifier_rules must exist")
            .as_array()
            .expect("classifier_rules must be an array");
        for rule in rules {
            let r = rule.as_object().expect("rule must be object");
            assert!(r.get("domain").and_then(|d| d.as_str()).is_some(),
                "each rule must expose `domain: string`, got {rule:?}");
            let kws = r
                .get("keywords")
                .and_then(|k| k.as_array())
                .expect("each rule must expose `keywords: [string]`");
            for k in kws {
                assert!(k.is_string(), "keyword must be string, got {k:?}");
            }
        }

        // Sanity: tier1 contents should serialize as the documented
        // snake_case names the harness classifier matches on.
        let tier1_strs: Vec<&str> =
            tier1.iter().filter_map(serde_json::Value::as_str).collect();
        for expected in ["project", "agent", "execution", "monitoring"] {
            assert!(
                tier1_strs.contains(&expected),
                "tier1_domains missing {expected}: {tier1_strs:?}"
            );
        }
    }
}
