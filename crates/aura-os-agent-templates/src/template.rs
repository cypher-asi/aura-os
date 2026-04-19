//! Portable, JSON-serializable template that configures a generic harness
//! agent to behave like today's CEO-preset agent.
//!
//! The template captures everything the harness needs at startup to know
//! (a) what system prompt to render, (b) which tool names belong to
//! which [`ToolDomain`], (c) which domains are always-on vs load-on-
//! demand, (d) which keywords promote which domains, and (e) which
//! tools should opt in to eager input streaming.
//!
//! It deliberately contains no code — only data — so it can be:
//!
//! - serialized to JSON and POSTed to a remote harness,
//! - stored next to the agent record,
//! - or assembled in-process by `aura-os-agent-runtime` via
//!   `tools::ceo_agent_template()`, which derives the tool manifest +
//!   streaming list from the live [`crate`]-agnostic `ToolRegistry`.
//!
//! # Crate dependency envelope
//!
//! This crate intentionally depends only on `aura-os-core` + `serde`.
//! The tool manifest used to live here as a hand-written static list,
//! which drifted from the runtime's `ToolRegistry` every time a tool
//! was added; the canonical list now lives in `aura-os-agent-runtime`
//! and is injected into [`AgentTemplate::ceo`] at construction time.

use aura_os_core::ToolDomain;
use serde::{Deserialize, Serialize};

use crate::tier::{default_classifier_rules, ClassifierRule, LOADABLE_DOMAINS, TIER1_DOMAINS};

/// Name under which the CEO preset is referenced by the interface and
/// the harness. Kept in a single place so phase 6's "create agent + pick
/// preset" flow can reference the exact same identifier.
pub const CEO_PRESET_NAME: &str = "ceo";

/// Ordered tool → domain assignment used by the agent-runtime to filter
/// the exposed tool list each turn. The fixed ordering mirrors the
/// `ToolRegistry::with_all_tools` wiring and guarantees deterministic
/// JSON round-trips.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ToolManifestEntry {
    pub name: String,
    pub domain: ToolDomain,
}

/// A portable agent template. Everything the harness needs to know to
/// behave like a given preset, shippable as one JSON blob.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTemplate {
    /// Human-readable preset name (e.g. `"ceo"`).
    pub preset: String,
    /// System prompt template. `{org_name}` and `{org_id}` placeholders
    /// are replaced by [`AgentTemplate::render_system_prompt`].
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

impl AgentTemplate {
    /// Build the CEO preset from caller-supplied `tool_manifest` and
    /// `streaming_tool_names` lists.
    ///
    /// `aura-os-agent-templates` no longer ships a hand-written tool
    /// manifest — the canonical list lives in
    /// `aura-os-agent-runtime::tools::ceo_tool_manifest()` and is
    /// derived from the live `ToolRegistry`. Callers in the runtime
    /// crate use `ceo_agent_template()` (which fills both lists in)
    /// rather than calling this constructor directly.
    pub fn ceo(
        tool_manifest: Vec<ToolManifestEntry>,
        streaming_tool_names: Vec<String>,
    ) -> Self {
        Self {
            preset: CEO_PRESET_NAME.to_string(),
            system_prompt_template: ceo_system_prompt_template(),
            tier1_domains: TIER1_DOMAINS.to_vec(),
            loadable_domains: LOADABLE_DOMAINS.iter().map(|s| (*s).to_string()).collect(),
            classifier_rules: default_classifier_rules(),
            tool_manifest,
            streaming_tool_names,
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

    /// Snake-case tier-1 domain names for the wire intent-classifier spec.
    ///
    /// Matches what `aura-tools::IntentClassifier::from_profile_json`
    /// deserializes from `tier1_domains: [String]` on the harness side.
    pub fn tier1_domains_snake_case(&self) -> Vec<String> {
        self.tier1_domains
            .iter()
            .map(domain_to_snake_case)
            .collect()
    }

    /// Classifier rules in `[{domain: String, keywords: [String]}]` form —
    /// the exact JSON shape the harness classifier deserializes.
    ///
    /// The `domain` field is rendered in snake_case so the harness never
    /// needs a copy of the `ToolDomain` enum.
    pub fn classifier_rules_snake_case(&self) -> Vec<(String, Vec<String>)> {
        self.classifier_rules
            .iter()
            .map(|r| (domain_to_snake_case(&r.domain), r.keywords.clone()))
            .collect()
    }

    /// Map of `tool_name -> snake_case domain` for every tool in the
    /// manifest, suitable for `IntentClassifierSpec::tool_domains`.
    ///
    /// The harness uses this mapping to decide which concrete
    /// [`ToolDefinition`](aura_os_core::ToolDefinition) entries to keep
    /// each turn once the classifier has chosen the visible domain set.
    /// Without this map the harness would have to duplicate the manifest
    /// in its own binary.
    pub fn tool_domains_snake_case(
        &self,
    ) -> std::collections::HashMap<String, String> {
        self.tool_manifest
            .iter()
            .map(|e| (e.name.clone(), domain_to_snake_case(&e.domain)))
            .collect()
    }
}

/// Small helper so every cross-process serialization site agrees on
/// the snake_case rendering of [`ToolDomain`] (which is already the
/// `#[serde(rename_all = "snake_case")]` representation — we just want
/// the string without going through `serde_json::to_value`).
fn domain_to_snake_case(domain: &ToolDomain) -> String {
    serde_json::to_value(domain)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default()
}

/// Raw template string used by [`AgentTemplate::ceo`].
///
/// Kept identical (modulo the `{org_*}` placeholders) to the body of
/// [`crate::prompt::ceo_system_prompt`] so that in-process and
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

    fn sample_manifest() -> Vec<ToolManifestEntry> {
        vec![
            ToolManifestEntry {
                name: "create_spec".to_string(),
                domain: ToolDomain::Spec,
            },
            ToolManifestEntry {
                name: "list_projects".to_string(),
                domain: ToolDomain::Project,
            },
        ]
    }

    #[test]
    fn ceo_renders_bit_compatible_prompt() {
        let rendered = AgentTemplate::ceo(sample_manifest(), vec![])
            .render_system_prompt("Acme", "org-123");
        let expected = crate::prompt::ceo_system_prompt("Acme", "org-123");
        assert_eq!(
            rendered, expected,
            "template-based prompt must match the legacy helper byte-for-byte"
        );
    }

    #[test]
    fn json_roundtrip_preserves_every_field() {
        let profile = AgentTemplate::ceo(
            sample_manifest(),
            vec!["create_spec".to_string()],
        );
        let json = serde_json::to_string(&profile).unwrap();
        let back: AgentTemplate = serde_json::from_str(&json).unwrap();
        assert_eq!(back.preset, profile.preset);
        assert_eq!(back.tier1_domains, profile.tier1_domains);
        assert_eq!(back.loadable_domains, profile.loadable_domains);
        assert_eq!(back.streaming_tool_names, profile.streaming_tool_names);
        assert_eq!(back.tool_manifest, profile.tool_manifest);
        assert_eq!(back.system_prompt_template, profile.system_prompt_template);
    }

    #[test]
    fn tools_for_domains_filters_manifest() {
        let profile = AgentTemplate::ceo(sample_manifest(), vec![]);
        let spec_tools = profile.tools_for_domains(&[ToolDomain::Spec]);
        assert!(!spec_tools.is_empty());
        for t in &spec_tools {
            assert_eq!(t.domain, ToolDomain::Spec);
        }
        assert!(spec_tools.iter().any(|t| t.name == "create_spec"));
    }

    #[test]
    fn tier1_domains_match_tier_module_constant() {
        let profile = AgentTemplate::ceo(vec![], vec![]);
        assert_eq!(profile.tier1_domains, TIER1_DOMAINS);
    }

    #[test]
    fn tier1_domains_snake_case_matches_wire_strings() {
        let profile = AgentTemplate::ceo(vec![], vec![]);
        let strs = profile.tier1_domains_snake_case();
        assert!(strs.contains(&"project".to_string()));
        assert!(strs.contains(&"agent".to_string()));
        assert!(strs.contains(&"execution".to_string()));
        assert!(strs.contains(&"monitoring".to_string()));
        for s in &strs {
            assert!(s.chars().all(|c| c.is_lowercase() || c == '_'));
        }
    }

    #[test]
    fn classifier_rules_snake_case_preserves_keywords() {
        let profile = AgentTemplate::ceo(vec![], vec![]);
        let rules = profile.classifier_rules_snake_case();
        assert_eq!(rules.len(), profile.classifier_rules.len());
        for (i, (dom, kws)) in rules.iter().enumerate() {
            let expected_dom =
                serde_json::to_value(profile.classifier_rules[i].domain).unwrap();
            assert_eq!(dom, expected_dom.as_str().unwrap());
            assert_eq!(*kws, profile.classifier_rules[i].keywords);
        }
    }

    #[test]
    fn tool_domains_snake_case_covers_every_manifest_entry() {
        let profile = AgentTemplate::ceo(sample_manifest(), vec![]);
        let map = profile.tool_domains_snake_case();
        assert_eq!(map.len(), profile.tool_manifest.len());
        for entry in &profile.tool_manifest {
            let expected = serde_json::to_value(entry.domain)
                .unwrap()
                .as_str()
                .unwrap()
                .to_string();
            assert_eq!(map.get(&entry.name), Some(&expected));
        }
    }

    /// Contract test: the JSON wire shape must match what
    /// `aura-tools::IntentClassifier::from_profile_json` expects.
    #[test]
    fn wire_shape_matches_harness_intent_classifier_contract() {
        let profile = AgentTemplate::ceo(sample_manifest(), vec![]);
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
            assert!(
                r.get("domain").and_then(|d| d.as_str()).is_some(),
                "each rule must expose `domain: string`, got {rule:?}"
            );
            let kws = r
                .get("keywords")
                .and_then(|k| k.as_array())
                .expect("each rule must expose `keywords: [string]`");
            for k in kws {
                assert!(k.is_string(), "keyword must be string, got {k:?}");
            }
        }

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
