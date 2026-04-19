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
//! turn of the session.
//!
//! There are two independent sources of duplicates we defend against:
//!
//! 1. Server-side name collisions between workspace tools and
//!    cross-agent tools (both manifests happen to emit a name like
//!    `list_specs`). Handled by [`dedupe_installed_tools_by_name`].
//!
//! 2. Collisions between a tool the server ships in `installed_tools`
//!    and a native tool the external harness sidecar (`aura_node`)
//!    registers itself before forwarding to Anthropic. This repo
//!    doesn't host the sidecar, but the desktop launcher always spawns
//!    it with `ENABLE_FS_TOOLS=true` / `ENABLE_CMD_TOOLS=true`, which
//!    registers filesystem/env tools under the exact names
//!    (`read_file`, `browse_files`, `get_environment_info`) that
//!    `ceo_tool_manifest` also emits. Handled by
//!    [`strip_harness_native_tool_names`].
//!
//! The `info!` emitted here gives us the full list the server actually
//! shipped, so when a 400 does occur we can tell from logs alone
//! whether the duplicate originated here or was added by something
//! downstream of us.

use aura_os_link::InstalledTool;
use tracing::{info, warn};

/// Tool names the external harness sidecar (`aura_node`) registers
/// natively whenever it's launched with the default env flags the
/// desktop launcher sets (`ENABLE_FS_TOOLS=true`). If we also ship
/// an `InstalledTool` with any of these names in `installed_tools`,
/// the sidecar merges both into the Anthropic `tools[]` payload,
/// Anthropic sees a name appearing twice, and the whole request 400s
/// with `"tools: Tool names must be unique."`.
///
/// Keep this list aligned with the server-side implementations in
/// `crates/aura-os-agent-runtime/src/tools/system_tools.rs` — every
/// entry here has a working server-side dispatcher fallback for
/// contexts where the sidecar is NOT present (for example pure
/// `SwarmHarness` mode), so dropping the installed tool only costs
/// Anthropic's tool-schema advertising, not capability.
const HARNESS_NATIVE_TOOL_NAMES: &[&str] = &[
    "read_file",
    "browse_files",
    "get_environment_info",
];

/// Drop any `InstalledTool` whose name is claimed natively by the
/// harness sidecar. Returns the dropped names (in drop order) so the
/// caller can log. Called *before* [`dedupe_installed_tools_by_name`]
/// so the dedupe log reflects what actually gets shipped.
pub(crate) fn strip_harness_native_tool_names(tools: &mut Vec<InstalledTool>) -> Vec<String> {
    let native: std::collections::HashSet<&str> =
        HARNESS_NATIVE_TOOL_NAMES.iter().copied().collect();
    let mut dropped: Vec<String> = Vec::new();
    tools.retain(|tool| {
        if native.contains(tool.name.as_str()) {
            dropped.push(tool.name.clone());
            false
        } else {
            true
        }
    });
    dropped
}

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
    // Step 1: drop names the sidecar claims natively. These will ALWAYS
    // collide when forwarded to Anthropic alongside our installed copy,
    // so we surrender the name in the advertised tool schema and let
    // the sidecar's native implementation handle it. The server-side
    // `AgentTool` remains available as a fallback for non-sidecar
    // harness modes.
    let native = strip_harness_native_tool_names(tools);
    if !native.is_empty() {
        warn!(
            context,
            agent_id = %agent_id,
            harness_native_tool_names = ?native,
            "dropped harness-native tool names from installed_tools to avoid Anthropic \"tools: Tool names must be unique.\" 400",
        );
    }

    // Step 2: dedupe by name (first occurrence wins) so workspace
    // tools win over any identically-named cross-agent tool.
    let duplicates = dedupe_installed_tools_by_name(tools);
    if !duplicates.is_empty() {
        warn!(
            context,
            agent_id = %agent_id,
            duplicate_tool_names = ?duplicates,
            "dropped duplicate tool names from harness installed_tools",
        );
    }

    // Step 3: print the final shipped list. When the harness later
    // 400s with Anthropic's "tools: Tool names must be unique." we
    // can diff this against the harness request body to localize
    // whether the collision was introduced here (and somehow survived
    // strip + dedupe) or downstream of us (the harness merging a
    // native tool with the same name we didn't know about).
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
    fn strip_harness_native_drops_fs_tool_names_the_sidecar_registers_itself() {
        // Regression: the desktop sidecar launcher starts `aura_node`
        // with `ENABLE_FS_TOOLS=true`, which registers `read_file`,
        // `browse_files`, and `get_environment_info` natively. The
        // ceo_tool_manifest also emits these names, so without this
        // strip the sidecar forwards BOTH copies to Anthropic and the
        // whole request 400s with `tools: Tool names must be unique.`.
        let mut tools = vec![
            tool_named("list_specs"),
            tool_named("read_file"),
            tool_named("browse_files"),
            tool_named("send_to_agent"),
            tool_named("get_environment_info"),
        ];

        let dropped = strip_harness_native_tool_names(&mut tools);

        assert_eq!(
            dropped,
            vec![
                "read_file".to_string(),
                "browse_files".to_string(),
                "get_environment_info".to_string(),
            ],
            "all three harness-native names must be dropped in input order"
        );
        let names: Vec<&str> = tools.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(
            names,
            vec!["list_specs", "send_to_agent"],
            "only non-native tools should survive"
        );
    }

    #[test]
    fn strip_harness_native_is_a_noop_when_no_native_names_present() {
        let mut tools = vec![
            tool_named("list_specs"),
            tool_named("send_to_agent"),
            tool_named("create_spec"),
        ];

        let dropped = strip_harness_native_tool_names(&mut tools);

        assert!(
            dropped.is_empty(),
            "strip must not touch anything when no harness-native names are present, dropped={dropped:?}"
        );
        let names: Vec<&str> = tools.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, vec!["list_specs", "send_to_agent", "create_spec"]);
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
