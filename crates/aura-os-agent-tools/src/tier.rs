//! Intent-tier classifier and the `load_domain_tools` meta-tool.
//!
//! The pure classifier (keyword → [`ToolDomain`] rules) lives in
//! `aura-os-agent-templates` so it can run in both the in-process
//! agent-runtime path and a harness-hosted `TurnObserver`. This module
//! re-exports the portable helpers and keeps [`LoadDomainToolsTool`],
//! which depends on the in-process [`AgentTool`] trait.
//!
//! `LoadDomainToolsTool` used to gate domain-scoped tools behind an
//! explicit promotion step. That surface gate has been removed — every
//! tool the agent has capabilities for now ships in the default
//! session payload — so the tool is retained only so older system
//! prompts that still mention it do not cause the LLM to reject the
//! tool list. Its `execute` returns a no-op status message confirming
//! that all capable tools are already available.

use async_trait::async_trait;
use serde_json::json;

use aura_os_core::ToolDomain;

pub use aura_os_agent_templates::{classify_intent, is_tier1, LOADABLE_DOMAINS};

use aura_os_agent_runtime::tools::{
    AgentTool, AgentToolContext, CapabilityRequirement, ToolResult,
};
use aura_os_agent_runtime::AgentRuntimeError;

// ---------------------------------------------------------------------------
// LoadDomainToolsTool – meta-tool that signals the orchestration loop to
// expose additional tool domains on the next turn.
// ---------------------------------------------------------------------------

pub struct LoadDomainToolsTool;

#[async_trait]
impl AgentTool for LoadDomainToolsTool {
    fn name(&self) -> &str {
        "load_domain_tools"
    }

    fn description(&self) -> &str {
        "No-op retained for backwards compatibility. Every tool the agent has capabilities for already ships in the session payload, so this tool no longer needs to be called; invoking it returns a status message and does not change the tool list."
    }

    fn domain(&self) -> ToolDomain {
        ToolDomain::System
    }

    fn required_capabilities(&self) -> &'static [CapabilityRequirement] {
        // `load_domain_tools` is a meta-tool; it only signals the
        // orchestration loop and never reaches the dispatcher.
        &[]
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
        _ctx: &AgentToolContext,
    ) -> Result<ToolResult, AgentRuntimeError> {
        // Accept the `domains` argument for schema-compat with older
        // prompts but ignore its value: every tool the agent has
        // capabilities for already ships in the session payload, so
        // there is nothing to promote.
        let echoed: Vec<String> = input
            .get("domains")
            .and_then(|d| d.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        Ok(ToolResult {
            content: json!({
                "loaded_domains": echoed,
                "status": "All tools the agent has capabilities for are already available; no promotion required."
            }),
            is_error: false,
        })
    }
}

#[cfg(test)]
mod tests {
    use aura_os_core::ToolDomain;

    use super::{classify_intent, LoadDomainToolsTool};
    use aura_os_agent_runtime::tools::AgentTool;

    #[test]
    fn schedule_language_loads_process_domain() {
        let domains = classify_intent("Create a recurring daily process schedule");
        assert!(domains.contains(&ToolDomain::Process));
    }

    #[test]
    fn load_domain_tools_schema_excludes_legacy_cron_domain() {
        let tool = LoadDomainToolsTool;
        let schema = tool.parameters_schema();
        let domains = schema["properties"]["domains"]["items"]["enum"]
            .as_array()
            .expect("domain enum should exist");

        assert!(domains
            .iter()
            .any(|value| value.as_str() == Some("process")));
        assert!(!domains.iter().any(|value| value.as_str() == Some("cron")));
    }
}
