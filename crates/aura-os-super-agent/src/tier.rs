use async_trait::async_trait;
use serde_json::json;

use aura_os_core::ToolDomain;

use crate::tools::{SuperAgentContext, SuperAgentTool, ToolResult};
use crate::SuperAgentError;

const TIER1_DOMAINS: &[ToolDomain] = &[
    ToolDomain::Project,
    ToolDomain::Agent,
    ToolDomain::Execution,
    ToolDomain::Monitoring,
];

pub fn classify_intent(message: &str) -> Vec<ToolDomain> {
    let mut domains: Vec<ToolDomain> = TIER1_DOMAINS.to_vec();
    let lower = message.to_lowercase();

    if contains_any(&lower, &["org", "organization", "team", "member", "invite"]) {
        domains.push(ToolDomain::Org);
    }
    if contains_any(
        &lower,
        &[
            "bill", "credit", "balance", "cost", "pay", "checkout", "purchase",
        ],
    ) {
        domains.push(ToolDomain::Billing);
    }
    if contains_any(&lower, &["feed", "post", "comment", "follow", "social"]) {
        domains.push(ToolDomain::Social);
    }
    if contains_any(
        &lower,
        &["task", "extract", "transition", "retry", "run task"],
    ) {
        domains.push(ToolDomain::Task);
    }
    if contains_any(
        &lower,
        &["spec", "specification", "requirements", "generate spec"],
    ) {
        domains.push(ToolDomain::Spec);
    }
    if contains_any(
        &lower,
        &[
            "file",
            "browse",
            "directory",
            "system info",
            "environment",
            "remote",
            "vm",
        ],
    ) {
        domains.push(ToolDomain::System);
    }
    if contains_any(
        &lower,
        &["image", "generate image", "3d", "model", "render", "logo"],
    ) {
        domains.push(ToolDomain::Generation);
    }
    if contains_any(
        &lower,
        &[
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
        ],
    ) {
        domains.push(ToolDomain::Cron);
    }

    domains.dedup();
    domains
}

fn contains_any(text: &str, keywords: &[&str]) -> bool {
    keywords.iter().any(|kw| text.contains(kw))
}

pub fn is_tier1(domain: &ToolDomain) -> bool {
    TIER1_DOMAINS.contains(domain)
}

// ---------------------------------------------------------------------------
// LoadDomainToolsTool – meta-tool that signals the orchestration loop to
// expose additional tool domains on the next turn.
// ---------------------------------------------------------------------------

pub struct LoadDomainToolsTool;

const LOADABLE_DOMAINS: &[&str] = &[
    "spec",
    "task",
    "org",
    "billing",
    "social",
    "system",
    "generation",
    "cron",
];

#[async_trait]
impl SuperAgentTool for LoadDomainToolsTool {
    fn name(&self) -> &str {
        "load_domain_tools"
    }

    fn description(&self) -> &str {
        "Load additional tool domains into the current conversation. Use when you need tools from domains not currently available."
    }

    fn domain(&self) -> ToolDomain {
        ToolDomain::System
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "domains": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "enum": LOADABLE_DOMAINS
                    },
                    "description": "Tool domains to load"
                }
            },
            "required": ["domains"]
        })
    }

    async fn execute(
        &self,
        input: serde_json::Value,
        _ctx: &SuperAgentContext,
    ) -> Result<ToolResult, SuperAgentError> {
        let domains: Vec<String> = input
            .get("domains")
            .and_then(|d| d.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .filter(|s| LOADABLE_DOMAINS.contains(&s.as_str()))
                    .collect()
            })
            .unwrap_or_default();

        if domains.is_empty() {
            return Ok(ToolResult {
                content: json!({
                    "error": "No valid domains specified. Available: spec, task, org, billing, social, system, generation"
                }),
                is_error: true,
            });
        }

        Ok(ToolResult {
            content: json!({
                "loaded_domains": domains,
                "status": "Tools will be available on the next turn"
            }),
            is_error: false,
        })
    }
}
