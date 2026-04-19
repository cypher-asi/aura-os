//! Shared deduplication + diagnostic logging for harness
//! `installed_tools` lists.
//!
//! Every code path that constructs `Vec<InstalledTool>` and ships it to
//! the harness as part of `SessionInit` must funnel through
//! [`dedupe_and_log_installed_tools`] so the contract "no two tools in
//! the list share a `name`" is enforced in one place.
//!
//! The Anthropic Messages API rejects a whole request with
//! `400 Bad Request { "tools: Tool names must be unique." }` the moment
//! the same tool name appears twice. The harness forwards our
//! `installed_tools` into that `tools[]` array, so any duplicate that
//! slips through here lights up as an `invalid_request_error` on every
//! turn of the session. The `info!` emitted here gives us the full list
//! the server actually shipped, so when a 400 does occur we can tell
//! from logs alone whether the duplicate originated here or was added
//! by something downstream of us (e.g. a harness-native tool clashing
//! with one we installed).

use aura_os_link::InstalledTool;
use tracing::{info, warn};

/// Drop later entries with a tool `name` that was already seen earlier
/// in `tools`. Returns the list of dropped names (in drop order) so the
/// caller can log / alert.
///
/// Pure and deterministic so it's easy to unit-test and cheap to reason
/// about from the callers.
pub(crate) fn dedupe_installed_tools_by_name(tools: &mut Vec<InstalledTool>) -> Vec<String> {
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut duplicates: Vec<String> = Vec::new();
    tools.retain(|tool| {
        if seen.insert(tool.name.clone()) {
            true
        } else {
            duplicates.push(tool.name.clone());
            false
        }
    });
    duplicates
}

/// Dedupe `tools` in place and emit a ground-truth log line with the
/// final list of names that will ship to the harness.
///
/// `context` is a short label ("agent_chat", "instance_chat",
/// "project_tool_session", "dev_loop_start", ...) so a multi-path repro
/// is easy to attribute to one specific entry point. `agent_id` may be
/// empty for entry points that don't address a single agent (e.g. the
/// dev loop runs keyed on project+task).
pub(crate) fn dedupe_and_log_installed_tools(
    context: &'static str,
    agent_id: &str,
    tools: &mut Vec<InstalledTool>,
) {
    let duplicates = dedupe_installed_tools_by_name(tools);
    if !duplicates.is_empty() {
        warn!(
            context,
            agent_id = %agent_id,
            duplicate_tool_names = ?duplicates,
            "dropped duplicate tool names from harness installed_tools",
        );
    }

    // Always print the final shipped list. When the harness later 400s
    // with Anthropic's "tools: Tool names must be unique." we can diff
    // this against the harness request body to localize whether the
    // collision was introduced here (and somehow survived dedupe) or
    // downstream of us (the harness merging a native tool with the same
    // name).
    let names: Vec<&str> = tools.iter().map(|t| t.name.as_str()).collect();
    info!(
        context,
        agent_id = %agent_id,
        tool_count = names.len(),
        tool_names = ?names,
        "harness installed_tools dedupe complete",
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tool_named(name: &str) -> InstalledTool {
        InstalledTool {
            name: name.to_string(),
            description: String::new(),
            input_schema: serde_json::json!({"type": "object"}),
            endpoint: String::new(),
            auth: aura_os_link::ToolAuth::default(),
            timeout_ms: None,
            namespace: None,
            required_integration: None,
            runtime_execution: None,
            metadata: std::collections::HashMap::new(),
        }
    }

    #[test]
    fn dedupe_is_a_noop_when_all_names_are_unique() {
        let mut tools = vec![
            tool_named("list_agents"),
            tool_named("send_to_agent"),
            tool_named("create_spec"),
        ];

        let dropped = dedupe_installed_tools_by_name(&mut tools);

        assert!(
            dropped.is_empty(),
            "unique-name list must not drop anything, got: {dropped:?}"
        );
        let names: Vec<&str> = tools.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, vec!["list_agents", "send_to_agent", "create_spec"]);
    }

    #[test]
    fn dedupe_keeps_first_occurrence_and_drops_later_duplicates() {
        // Scenario: a workspace manifest exposes `list_agents` with an
        // org-scoped endpoint, and the CEO preset's cross-agent tool
        // manifest also emits `list_agents`. Without dedup the harness
        // ships both to the LLM API and the request 400s with
        // `"tools: Tool names must be unique."`.
        let mut workspace_list_agents = tool_named("list_agents");
        workspace_list_agents.endpoint = "workspace-endpoint".to_string();
        let mut cross_agent_list_agents = tool_named("list_agents");
        cross_agent_list_agents.endpoint = "cross-agent-endpoint".to_string();

        let mut tools = vec![
            workspace_list_agents,
            tool_named("send_to_agent"),
            cross_agent_list_agents,
            tool_named("send_to_agent"),
        ];

        let dropped = dedupe_installed_tools_by_name(&mut tools);

        assert_eq!(
            dropped,
            vec!["list_agents".to_string(), "send_to_agent".to_string()],
            "second occurrences must be the ones dropped"
        );
        let names: Vec<&str> = tools.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, vec!["list_agents", "send_to_agent"]);
        assert_eq!(
            tools[0].endpoint, "workspace-endpoint",
            "first-occurrence wins so the workspace (org-scoped) endpoint is preserved over the cross-agent copy"
        );
    }
}
