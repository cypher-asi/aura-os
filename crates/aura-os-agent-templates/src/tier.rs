//! Tier-1 / tier-2 intent classifier for CEO-preset agents.
//!
//! A CEO-preset agent exposes a large tool surface to the LLM; to keep
//! each turn tractable the runtime only serializes a subset of tools
//! based on the user's intent. [`classify_intent`] returns the set of
//! [`ToolDomain`]s that should be visible for a given message. Tier-1
//! domains are always included; tier-2 domains are added when keywords
//! in the message suggest them.
//!
//! This module is deliberately pure — no I/O, no async, no dependencies
//! on service types — so the same rules can run in-process inside
//! `aura-os-server` and as a harness `TurnObserver` in a different
//! binary.

use aura_os_core::ToolDomain;
use serde::{Deserialize, Serialize};

/// Tier-1 domains that are always exposed, regardless of intent.
pub const TIER1_DOMAINS: &[ToolDomain] = &[
    ToolDomain::Project,
    ToolDomain::Agent,
    ToolDomain::Execution,
    ToolDomain::Monitoring,
];

/// Domains that users can explicitly request via the `load_domain_tools`
/// meta-tool. Matches the enum in the agent-runtime's tool schema.
pub const LOADABLE_DOMAINS: &[&str] = &[
    "spec",
    "task",
    "org",
    "billing",
    "social",
    "system",
    "generation",
    "process",
];

/// Tool names whose JSON arguments should stream eagerly to the client
/// (`input_json_delta`). Must stay in sync with `is_streaming_tool_name`
/// in `aura-os-agent-runtime::tools`.
pub const STREAMING_TOOL_NAMES: &[&str] =
    &["create_spec", "update_spec", "write_file", "edit_file"];

/// A keyword → [`ToolDomain`] mapping.
///
/// `classify_intent` walks the default rule table to decide which tier-2
/// domains to expose; consumers can reuse [`default_classifier_rules`]
/// or build their own.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassifierRule {
    pub domain: ToolDomain,
    pub keywords: Vec<String>,
}

/// The canonical keyword-to-domain rules used by
/// [`classify_intent_with`]. Order matters only for readability;
/// duplicates are deduped by the classifier.
pub fn default_classifier_rules() -> Vec<ClassifierRule> {
    vec![
        ClassifierRule {
            domain: ToolDomain::Org,
            keywords: strs(&["org", "organization", "team", "member", "invite"]),
        },
        ClassifierRule {
            domain: ToolDomain::Billing,
            keywords: strs(&[
                "bill", "credit", "balance", "cost", "pay", "checkout", "purchase",
            ]),
        },
        ClassifierRule {
            domain: ToolDomain::Social,
            keywords: strs(&["feed", "post", "comment", "follow", "social"]),
        },
        ClassifierRule {
            domain: ToolDomain::Task,
            keywords: strs(&["task", "extract", "transition", "retry", "run task"]),
        },
        ClassifierRule {
            domain: ToolDomain::Spec,
            keywords: strs(&["spec", "specification", "requirements", "generate spec"]),
        },
        ClassifierRule {
            domain: ToolDomain::System,
            keywords: strs(&[
                "file",
                "browse",
                "directory",
                "system info",
                "environment",
                "remote",
                "vm",
            ]),
        },
        ClassifierRule {
            domain: ToolDomain::Generation,
            keywords: strs(&["image", "generate image", "3d", "model", "render", "logo"]),
        },
        ClassifierRule {
            domain: ToolDomain::Process,
            keywords: strs(&[
                "process",
                "workflow",
                "node",
                "ignition",
                "pipeline",
                "automate",
                "trigger",
                "cron",
                "schedule",
                "scheduled",
                "recurring",
                "every day",
                "every hour",
                "every morning",
                "daily",
                "weekly",
                "periodic",
            ]),
        },
    ]
}

fn strs(s: &[&str]) -> Vec<String> {
    s.iter().map(|v| (*v).to_string()).collect()
}

/// Classify the user's message into the set of [`ToolDomain`]s that
/// should be exposed this turn, using the canonical rule set.
///
/// Same ordering, same deduplication, same case-insensitive matching as
/// the legacy in-process classifier.
pub fn classify_intent(message: &str) -> Vec<ToolDomain> {
    classify_intent_with(message, &default_classifier_rules())
}

/// Classify the user's message using a caller-supplied rule set. Useful
/// for testing and for harness-hosted agents that want to extend or
/// override the CEO defaults without forking.
pub fn classify_intent_with(message: &str, rules: &[ClassifierRule]) -> Vec<ToolDomain> {
    let mut domains: Vec<ToolDomain> = TIER1_DOMAINS.to_vec();
    let lower = message.to_lowercase();

    for rule in rules {
        if rule.keywords.iter().any(|kw| lower.contains(kw)) {
            domains.push(rule.domain);
        }
    }

    domains.dedup();
    domains
}

/// `true` iff the domain is always visible (tier-1).
pub fn is_tier1(domain: &ToolDomain) -> bool {
    TIER1_DOMAINS.contains(domain)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tier1_always_included_for_empty_message() {
        let domains = classify_intent("");
        for t1 in TIER1_DOMAINS {
            assert!(domains.contains(t1), "missing tier-1 domain {t1:?}");
        }
    }

    #[test]
    fn schedule_language_loads_process_domain() {
        let domains = classify_intent("Create a recurring daily process schedule");
        assert!(domains.contains(&ToolDomain::Process));
    }

    #[test]
    fn org_keywords_add_org_domain() {
        assert!(classify_intent("invite a team member").contains(&ToolDomain::Org));
        assert!(classify_intent("update organization name").contains(&ToolDomain::Org));
    }

    #[test]
    fn billing_keywords_add_billing_domain() {
        assert!(classify_intent("check my credit balance").contains(&ToolDomain::Billing));
        assert!(classify_intent("purchase more credits").contains(&ToolDomain::Billing));
    }

    #[test]
    fn case_insensitive_matching() {
        let domains = classify_intent("INVITE A MEMBER");
        assert!(domains.contains(&ToolDomain::Org));
    }

    #[test]
    fn no_duplicates_when_multiple_keywords_hit() {
        let domains = classify_intent("post a comment to the feed");
        let social_count = domains.iter().filter(|d| **d == ToolDomain::Social).count();
        assert_eq!(social_count, 1);
    }

    #[test]
    fn is_tier1_identifies_core_domains() {
        assert!(is_tier1(&ToolDomain::Project));
        assert!(is_tier1(&ToolDomain::Agent));
        assert!(!is_tier1(&ToolDomain::Billing));
        assert!(!is_tier1(&ToolDomain::Generation));
    }

    #[test]
    fn loadable_domains_excludes_legacy_cron() {
        assert!(LOADABLE_DOMAINS.contains(&"process"));
        assert!(!LOADABLE_DOMAINS.contains(&"cron"));
    }

    #[test]
    fn default_rules_cover_every_non_tier1_domain() {
        let rules = default_classifier_rules();
        for domain in [
            ToolDomain::Org,
            ToolDomain::Billing,
            ToolDomain::Social,
            ToolDomain::Task,
            ToolDomain::Spec,
            ToolDomain::System,
            ToolDomain::Generation,
            ToolDomain::Process,
        ] {
            assert!(
                rules.iter().any(|r| r.domain == domain),
                "missing rule for {domain:?}"
            );
        }
    }
}
