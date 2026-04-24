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
//!    doesn't host the sidecar; its source lives at
//!    `C:\code\aura-harness\crates\aura-tools\src\definitions.rs`.
//!    At session init the harness builds `tool_definitions` as
//!    `visible_tools(ToolProfile::Agent) + installed_tools` via a
//!    raw `push` (see `aura-harness/crates/aura-node/src/session/
//!    ws_handler.rs::populate_tool_definitions`) — NO dedupe — so any
//!    name we ship that also appears in the harness `Agent` profile
//!    round-trips to Anthropic twice. Handled by
//!    [`strip_harness_native_tool_names`].
//!
//! The `info!` emitted here gives us the full list the server actually
//! shipped, so when a 400 does occur we can tell from logs alone
//! whether the duplicate originated here or was added by something
//! downstream of us.

use aura_os_harness::InstalledTool;
use tracing::{info, warn};

/// Tool names the external harness sidecar (`aura_node`) registers
/// statically in its [`ToolCatalog`] under
/// `visible_tools(ToolProfile::Agent, _)`. If the server also ships
/// an `InstalledTool` with any of these names, the sidecar's
/// `populate_tool_definitions` pushes both copies into the session
/// `tool_definitions` without deduping, and the Messages API 400s
/// on the very first turn with
/// `"tools: Tool names must be unique."`.
///
/// Source of truth: `C:\code\aura-harness\crates\aura-tools\src\
/// definitions.rs` at the time of this commit. Groups map 1:1 to the
/// free functions in that module so it's easy to keep in sync when a
/// harness release adds or removes a tool.
///
/// NOTE: do NOT add server-only names (for example `browse_files`,
/// `get_environment_info`) to this list. The harness does not
/// register them, so stripping them here would silently remove the
/// tool from the model's schema without a replacement.
const HARNESS_NATIVE_TOOL_NAMES: &[&str] = &[
    // core_tool_definitions + stat_file from builtin_tools
    "read_file",
    "write_file",
    "edit_file",
    "delete_file",
    "list_files",
    "stat_file",
    "run_command",
    "search_code",
    "find_files",
    // chat_management_tools: spec_tool_definitions
    "list_specs",
    "get_spec",
    "create_spec",
    "update_spec",
    "delete_spec",
    // chat_management_tools: task_tool_definitions
    "list_tasks",
    "create_task",
    "update_task",
    "delete_task",
    "transition_task",
    "run_task",
    // chat_management_tools: project_tool_definitions
    "get_project",
    "update_project",
    // chat_management_tools: dev_loop_tool_definitions
    "start_dev_loop",
    "pause_dev_loop",
    "stop_dev_loop",
    // chat_management_tools: orbit_tool_definitions
    "orbit_push",
    "orbit_create_repo",
    "orbit_list_repos",
    "orbit_list_branches",
    "orbit_create_branch",
    "orbit_list_commits",
    "orbit_get_diff",
    "orbit_create_pr",
    "orbit_list_prs",
    "orbit_merge_pr",
    // chat_management_tools: network_tool_definitions
    "post_to_feed",
    "list_projects",
    "check_budget",
    "record_usage",
    // NOTE: cross_agent_catalog_entries (spawn_agent, send_to_agent,
    // agent_lifecycle, get_agent_state, delegate_task) are deliberately
    // NOT listed here. The harness registers them with non-empty
    // `required_capabilities` via `cross_agent_catalog_entries()`
    // (aura-harness/crates/aura-tools/src/catalog.rs:103-114). But its
    // `populate_tool_definitions` (aura-harness/crates/aura-node/src/
    // session/ws_handler.rs:395-398) calls `visible_tools(
    // ToolProfile::Agent, _)`, which forwards `None` for permissions
    // and so filters every capability-gated entry out before it reaches
    // the session's `tool_definitions`. Listing them here would strip
    // the only copy the LLM ever sees — that was the previous bug: the
    // CEO reported "I don't have a messaging tool" even though
    // `build_cross_agent_tools` emits `send_to_agent` for the ceo_preset.
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
            auth: aura_os_harness::ToolAuth::default(),
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
    fn strip_harness_native_drops_unconditionally_visible_names_only() {
        // The strip list covers names the harness advertises through
        // `visible_tools(ToolProfile::Agent, _)` — i.e. entries with
        // empty `required_capabilities`. Cross-agent tools
        // (`send_to_agent`, `spawn_agent`, etc.) are registered with
        // capability gates and `visible_tools` forwards `None` for
        // permissions, so they never reach the harness's session
        // `tool_definitions` and must SURVIVE the strip — otherwise
        // the LLM never sees `send_to_agent` at all and the CEO tells
        // the user it can't message agents.
        let mut tools = vec![
            tool_named("list_org_integrations"), // server-only, keep
            tool_named("read_file"),             // harness core, drop
            tool_named("list_specs"),            // harness chat, drop
            tool_named("get_spec"),              // harness chat, drop
            tool_named("create_spec"),
            tool_named("update_spec"),
            tool_named("delete_spec"),
            tool_named("start_dev_loop"),
            tool_named("pause_dev_loop"),
            tool_named("stop_dev_loop"),
            tool_named("send_to_agent"), // harness cross-agent, KEEP (capability-gated)
            tool_named("spawn_agent"),   // harness cross-agent, KEEP (capability-gated)
            tool_named("list_agents"),   // server-only, keep
            tool_named("create_project"), // server-only, keep
            tool_named("list_projects"), // harness network, drop
        ];

        let dropped = strip_harness_native_tool_names(&mut tools);

        let expected_dropped = vec![
            "read_file".to_string(),
            "list_specs".to_string(),
            "get_spec".to_string(),
            "create_spec".to_string(),
            "update_spec".to_string(),
            "delete_spec".to_string(),
            "start_dev_loop".to_string(),
            "pause_dev_loop".to_string(),
            "stop_dev_loop".to_string(),
            "list_projects".to_string(),
        ];
        assert_eq!(
            dropped, expected_dropped,
            "every name the harness already has in visible_tools(Agent, _) must be dropped in input order"
        );
        let names: Vec<&str> = tools.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(
            names,
            vec![
                "list_org_integrations",
                "send_to_agent",
                "spawn_agent",
                "list_agents",
                "create_project",
            ],
            "server-only + capability-gated cross-agent names must survive the strip"
        );
    }

    #[test]
    fn send_to_agent_survives_strip_for_ceo_preset() {
        // Regression for the Agents-app CEO bug: `build_cross_agent_tools`
        // emits `send_to_agent` for the ceo_preset, and the harness's
        // native copy is hidden from `populate_tool_definitions`
        // (capability gate + `None` permissions), so stripping this
        // name server-side would leave the LLM with no messaging tool.
        let mut tools = vec![
            tool_named("send_to_agent"),
            tool_named("spawn_agent"),
            tool_named("agent_lifecycle"),
            tool_named("get_agent_state"),
            tool_named("delegate_task"),
        ];

        let dropped = strip_harness_native_tool_names(&mut tools);

        assert!(
            dropped.is_empty(),
            "capability-gated cross-agent tools must survive the strip, dropped={dropped:?}"
        );
        let names: Vec<&str> = tools.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(
            names,
            vec![
                "send_to_agent",
                "spawn_agent",
                "agent_lifecycle",
                "get_agent_state",
                "delegate_task",
            ]
        );
    }

    #[test]
    fn strip_harness_native_does_not_drop_server_only_system_tool_names() {
        // Regression: a previous version of this list wrongly included
        // `browse_files` and `get_environment_info`, names that were
        // historically server-only and NOT in the harness catalog.
        // Stripping them silently removed real capability from the
        // model's schema. Keep them off the native list.
        let mut tools = vec![
            tool_named("browse_files"),
            tool_named("get_environment_info"),
            tool_named("generate_image"),
        ];

        let dropped = strip_harness_native_tool_names(&mut tools);

        assert!(
            dropped.is_empty(),
            "server-only names must never be classified as harness-native, dropped={dropped:?}"
        );
        let names: Vec<&str> = tools.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(
            names,
            vec!["browse_files", "get_environment_info", "generate_image"]
        );
    }

    #[test]
    fn strip_harness_native_is_a_noop_when_no_native_names_present() {
        let mut tools = vec![
            tool_named("list_org_integrations"),
            tool_named("generate_image"),
            tool_named("create_process"),
        ];

        let dropped = strip_harness_native_tool_names(&mut tools);

        assert!(
            dropped.is_empty(),
            "strip must not touch anything when no harness-native names are present, dropped={dropped:?}"
        );
        let names: Vec<&str> = tools.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(
            names,
            vec!["list_org_integrations", "generate_image", "create_process"]
        );
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
