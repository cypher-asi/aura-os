//! Tool implementations and the shared registry/CEO-template helpers.
//!
//! Split out of `aura-os-agent-runtime` in Tier D of the architectural
//! review (Decoupling). The runtime crate keeps the `AgentTool` trait,
//! `CapabilityRequirement`, `ToolRegistry`, `AgentToolContext`,
//! `AgentRuntimeService`, `policy`, `audit`, `events`, and `state`.
//! Every concrete `impl AgentTool for X` — and the CEO-template wiring
//! that needs those impls — lives here so the runtime crate no longer
//! has to pull in the full domain dependency graph (projects, tasks,
//! sessions, orgs, etc.) that the tools themselves require.
//!
//! Callers that previously wrote
//! `aura_os_agent_runtime::tools::shared_all_tools_registry()` should
//! switch to `aura_os_agent_tools::shared_all_tools_registry()`; the
//! two crates are peers and do not re-export each other's surface.

pub mod ceo;
pub mod tier;
pub mod tools;

use std::collections::HashMap;
use std::sync::{Arc, LazyLock};

use aura_os_agent_runtime::tools::{
    AgentTool, CapabilityRequirement, ToolRegistry,
};
use aura_os_core::Capability;

/// Build a tool registry containing the tier-1 tool slice — the
/// narrow allowlist the CEO preset ships and the canonical source for
/// the "always on" tools.
#[must_use]
pub fn build_tier1_registry() -> ToolRegistry {
    let mut registry = ToolRegistry::new();

    registry.register(Arc::new(tools::project_tools::CreateProjectTool));
    registry.register(Arc::new(tools::project_tools::ImportProjectTool));
    registry.register(Arc::new(tools::project_tools::ListProjectsTool));
    registry.register(Arc::new(tools::project_tools::GetProjectTool));
    registry.register(Arc::new(tools::project_tools::UpdateProjectTool));
    registry.register(Arc::new(tools::project_tools::DeleteProjectTool));
    registry.register(Arc::new(tools::project_tools::ArchiveProjectTool));
    registry.register(Arc::new(tools::project_tools::GetProjectStatsTool));

    registry.register(Arc::new(tools::agent_tools::ListAgentsTool));
    registry.register(Arc::new(tools::agent_tools::GetAgentTool));
    registry.register(Arc::new(tools::agent_tools::AssignAgentToProjectTool));

    registry.register(Arc::new(tools::exec_tools::StartDevLoopTool));
    registry.register(Arc::new(tools::exec_tools::PauseDevLoopTool));
    registry.register(Arc::new(tools::exec_tools::StopDevLoopTool));
    registry.register(Arc::new(tools::exec_tools::GetLoopStatusTool));
    registry.register(Arc::new(tools::exec_tools::SendToAgentTool));

    registry.register(Arc::new(tools::monitor_tools::GetFleetStatusTool));
    registry.register(Arc::new(tools::monitor_tools::GetProgressReportTool));
    registry.register(Arc::new(tools::monitor_tools::GetProjectCostTool));

    registry.register(Arc::new(tools::billing_tools::GetCreditBalanceTool));

    // System tools (Tier 1): `get_current_time` is a basic question
    // the CEO needs to answer without loading a domain. Also the
    // stable replacement for the harness's `run_command date` flow,
    // which is broken on Windows (cmd's built-in `date` is
    // interactive and exits 1).
    registry.register(Arc::new(tools::system_tools::GetCurrentTimeTool));

    registry.register(Arc::new(tier::LoadDomainToolsTool));

    registry
}

/// Build a tool registry containing every tier-1 + tier-2 tool. Does
/// not include the dynamically-registered process tools (which need
/// a live `ProcessExecutor`); use [`register_process_tools`] on a
/// mutable registry to add those.
#[must_use]
pub fn build_all_tools_registry() -> ToolRegistry {
    let mut registry = build_tier1_registry();

    registry.register(Arc::new(tools::spec_tools::ListSpecsTool));
    registry.register(Arc::new(tools::spec_tools::GetSpecTool));
    registry.register(Arc::new(tools::spec_tools::CreateSpecTool));
    registry.register(Arc::new(tools::spec_tools::UpdateSpecTool));
    registry.register(Arc::new(tools::spec_tools::DeleteSpecTool));
    registry.register(Arc::new(tools::spec_tools::GenerateSpecsTool));
    registry.register(Arc::new(tools::spec_tools::GenerateSpecsSummaryTool));

    registry.register(Arc::new(tools::task_tools::ListTasksTool));
    registry.register(Arc::new(tools::task_tools::ListTasksBySpecTool));
    registry.register(Arc::new(tools::task_tools::GetTaskTool));
    registry.register(Arc::new(tools::task_tools::CreateTaskTool));
    registry.register(Arc::new(tools::task_tools::UpdateTaskTool));
    registry.register(Arc::new(tools::task_tools::DeleteTaskTool));
    registry.register(Arc::new(tools::task_tools::ExtractTasksTool));
    registry.register(Arc::new(tools::task_tools::TransitionTaskTool));
    registry.register(Arc::new(tools::task_tools::RetryTaskTool));
    registry.register(Arc::new(tools::task_tools::RunTaskTool));
    registry.register(Arc::new(tools::task_tools::GetTaskOutputTool));

    registry.register(Arc::new(tools::agent_tools::CreateAgentTool));
    registry.register(Arc::new(tools::agent_tools::UpdateAgentTool));
    registry.register(Arc::new(tools::agent_tools::DeleteAgentTool));
    registry.register(Arc::new(tools::agent_tools::ListAgentInstancesTool));
    registry.register(Arc::new(tools::agent_tools::UpdateAgentInstanceTool));
    registry.register(Arc::new(tools::agent_tools::DeleteAgentInstanceTool));
    registry.register(Arc::new(tools::agent_tools::RemoteAgentActionTool));

    registry.register(Arc::new(tools::org_tools::ListOrgsTool));
    registry.register(Arc::new(tools::org_tools::CreateOrgTool));
    registry.register(Arc::new(tools::org_tools::GetOrgTool));
    registry.register(Arc::new(tools::org_tools::UpdateOrgTool));
    registry.register(Arc::new(tools::org_tools::ListMembersTool));
    registry.register(Arc::new(tools::org_tools::UpdateMemberRoleTool));
    registry.register(Arc::new(tools::org_tools::RemoveMemberTool));
    registry.register(Arc::new(tools::org_tools::ManageInvitesTool));

    registry.register(Arc::new(tools::billing_tools::GetTransactionsTool));
    registry.register(Arc::new(tools::billing_tools::GetBillingAccountTool));
    registry.register(Arc::new(tools::billing_tools::PurchaseCreditsTool));

    registry.register(Arc::new(tools::social_tools::ListFeedTool));
    registry.register(Arc::new(tools::social_tools::CreatePostTool));
    registry.register(Arc::new(tools::social_tools::GetPostTool));
    registry.register(Arc::new(tools::social_tools::AddCommentTool));
    registry.register(Arc::new(tools::social_tools::DeleteCommentTool));
    registry.register(Arc::new(tools::social_tools::FollowProfileTool));
    registry.register(Arc::new(tools::social_tools::UnfollowProfileTool));
    registry.register(Arc::new(tools::social_tools::ListFollowsTool));

    registry.register(Arc::new(tools::monitor_tools::GetLeaderboardTool));
    registry.register(Arc::new(tools::monitor_tools::GetUsageStatsTool));
    registry.register(Arc::new(tools::monitor_tools::ListSessionsTool));
    registry.register(Arc::new(tools::monitor_tools::ListLogEntriesTool));

    registry.register(Arc::new(tools::system_tools::BrowseFilesTool));
    registry.register(Arc::new(tools::system_tools::ReadFileTool));
    registry.register(Arc::new(tools::system_tools::GetEnvironmentInfoTool));
    registry.register(Arc::new(tools::system_tools::GetRemoteAgentStateTool));

    registry.register(Arc::new(tools::generation_tools::GenerateImageTool));
    registry.register(Arc::new(tools::generation_tools::Generate3dModelTool));
    registry.register(Arc::new(tools::generation_tools::Get3dStatusTool));

    registry
}

/// Register the five process workflow tools against an existing
/// registry. Kept separate from [`build_all_tools_registry`] because
/// `TriggerProcessTool` holds an `Arc<ProcessExecutor>` that only
/// exists at runtime (after the server constructs one from the data
/// directory + storage client).
pub fn register_process_tools(
    registry: &mut ToolRegistry,
    executor: Arc<aura_os_process::ProcessExecutor>,
) {
    registry.register(Arc::new(tools::process_tools::CreateProcessTool));
    registry.register(Arc::new(tools::process_tools::ListProcessesTool));
    registry.register(Arc::new(tools::process_tools::DeleteProcessTool));
    registry.register(Arc::new(tools::process_tools::TriggerProcessTool { executor }));
    registry.register(Arc::new(tools::process_tools::ListProcessRunsTool));
}

/// Process-wide cached set of tier-1 tool names — the registry view
/// used as the CEO preset's static allowlist. Built from
/// [`build_tier1_registry`] and sorted so the harness sees a
/// deterministic order regardless of the underlying HashMap iteration.
static SHARED_TIER1_TOOL_NAMES: LazyLock<Vec<String>> = LazyLock::new(|| {
    let registry = build_tier1_registry();
    let mut names = registry.tool_names();
    names.sort();
    names
});

/// Names of every tool registered in [`build_tier1_registry`].
///
/// This is the canonical source for the CEO preset's always-on tool
/// allowlist. Callers must not cache the returned `Vec` — the
/// underlying [`LazyLock`] already shares one heap allocation across
/// the process and clones are cheap.
#[must_use]
pub fn ceo_tier1_tool_names() -> Vec<String> {
    SHARED_TIER1_TOOL_NAMES.clone()
}

/// Process-wide cached `build_all_tools_registry()`.
///
/// Every tool in the registry is stateless (no captured
/// `ProcessExecutor` — see [`register_process_tools`] for that branch),
/// so the built registry is safe to share across all requests.
static SHARED_ALL_TOOLS: LazyLock<Arc<ToolRegistry>> =
    LazyLock::new(|| Arc::new(build_all_tools_registry()));

/// Return the process-wide cached [`build_all_tools_registry`]
/// instance. Callers that previously wrote
/// `ToolRegistry::with_all_tools()` on every request should use this
/// instead to avoid rebuilding the full tool table.
#[must_use]
pub fn shared_all_tools_registry() -> Arc<ToolRegistry> {
    SHARED_ALL_TOOLS.clone()
}

/// Names of every tool that the in-process `/api/agent_tools/:name`
/// dispatcher knows how to execute. Built from [`SHARED_ALL_TOOLS`]
/// plus the five dynamically-registered process tool names, so
/// diagnostic surfaces can reason about tools without needing a
/// `ProcessExecutor` to hand to [`register_process_tools`].
#[must_use]
pub fn all_dispatchable_tool_names() -> std::collections::HashSet<String> {
    let mut names: std::collections::HashSet<String> =
        SHARED_ALL_TOOLS.tool_names().into_iter().collect();
    for name in [
        "create_process",
        "list_processes",
        "trigger_process",
        "delete_process",
        "list_process_runs",
    ] {
        names.insert(name.to_string());
    }
    names
}

/// Map of `tool_name -> (description, input_schema)` for every tool the
/// `/api/agent_tools/:name` dispatcher can execute.
///
/// [`crate::ceo::build_cross_agent_tools`] uses this to stamp the real
/// description + parameters_schema onto each `InstalledTool` it ships
/// to the harness; without it the LLM sees just a tool name with an
/// empty `{}` schema and defensively refuses to call the tool.
#[must_use]
pub fn tool_metadata_map() -> Arc<HashMap<String, (String, serde_json::Value)>> {
    SHARED_TOOL_METADATA_MAP.clone()
}

static SHARED_TOOL_METADATA_MAP: LazyLock<Arc<HashMap<String, (String, serde_json::Value)>>> =
    LazyLock::new(|| Arc::new(build_tool_metadata_map()));

fn build_tool_metadata_map() -> HashMap<String, (String, serde_json::Value)> {
    let mut map: HashMap<String, (String, serde_json::Value)> = HashMap::new();
    let registry = &*SHARED_ALL_TOOLS;
    for name in registry.tool_names() {
        if let Some(tool) = registry.get(&name) {
            map.insert(
                name,
                (tool.description().to_string(), tool.parameters_schema()),
            );
        }
    }
    // Process tools: registered dynamically at boot via
    // `register_process_tools`, but their metadata is static so we can
    // inline it here. Four are ZSTs we can construct for free;
    // `trigger_process` hand-codes the same description + schema the
    // `AgentTool` impl returns (kept in sync by a round-trip test in
    // `process_tools` tests below).
    map.insert(
        "create_process".to_string(),
        (
            tools::process_tools::CreateProcessTool.description().to_string(),
            tools::process_tools::CreateProcessTool.parameters_schema(),
        ),
    );
    map.insert(
        "list_processes".to_string(),
        (
            tools::process_tools::ListProcessesTool.description().to_string(),
            tools::process_tools::ListProcessesTool.parameters_schema(),
        ),
    );
    map.insert(
        "delete_process".to_string(),
        (
            tools::process_tools::DeleteProcessTool.description().to_string(),
            tools::process_tools::DeleteProcessTool.parameters_schema(),
        ),
    );
    map.insert(
        "list_process_runs".to_string(),
        (
            tools::process_tools::ListProcessRunsTool.description().to_string(),
            tools::process_tools::ListProcessRunsTool.parameters_schema(),
        ),
    );
    let (trigger_desc, trigger_schema) = tools::process_tools::trigger_process_metadata();
    map.insert(
        "trigger_process".to_string(),
        (trigger_desc.to_string(), trigger_schema),
    );
    map
}

/// Tool names that should stream their JSON arguments to the client via
/// `input_json_delta` / `tool_call_snapshot`.
///
/// Composed of two disjoint sources:
///
/// 1. Registry-backed tools that opt in via [`AgentTool::is_streaming`]
///    (e.g. `create_spec`, `update_spec`).
/// 2. Harness-side file tools listed in
///    [`aura_os_agent_templates::HARNESS_SIDE_STREAMING_TOOL_NAMES`]
///    (`write_file`, `edit_file`). These live in the harness process,
///    not the registry, so they must be listed explicitly.
#[must_use]
pub fn streaming_tool_names() -> Vec<String> {
    let mut names: Vec<String> = SHARED_ALL_TOOLS
        .list_tools()
        .into_iter()
        .filter(|t| t.is_streaming())
        .map(|t| t.name().to_string())
        .collect();
    for harness in aura_os_agent_templates::HARNESS_SIDE_STREAMING_TOOL_NAMES {
        let h = (*harness).to_string();
        if !names.iter().any(|n| n == &h) {
            names.push(h);
        }
    }
    names
}

/// Cached union list of streaming tool names, built lazily on first
/// access from [`streaming_tool_names`].
static SHARED_STREAMING_TOOL_NAMES: LazyLock<Vec<String>> = LazyLock::new(streaming_tool_names);

/// Cached snapshot of [`streaming_tool_names`] suitable for shipping
/// unchanged in `AgentTemplate::streaming_tool_names`.
#[must_use]
pub fn shared_streaming_tool_names() -> Vec<String> {
    SHARED_STREAMING_TOOL_NAMES.clone()
}

/// `true` iff a tool with the given name should stream its JSON
/// arguments eagerly.
pub fn is_streaming_tool_name(name: &str) -> bool {
    SHARED_STREAMING_TOOL_NAMES.iter().any(|n| n == name)
}

/// Canonical ordered tool manifest used by the CEO preset template.
///
/// Derived from [`build_all_tools_registry`] so the manifest cannot
/// drift from the set of tools that are actually registered +
/// dispatchable. Sorted by tool name so cross-process JSON
/// serialization is stable even though [`ToolRegistry`] is backed by
/// a `HashMap`.
#[must_use]
pub fn ceo_tool_manifest() -> Vec<aura_os_agent_templates::ToolManifestEntry> {
    let mut entries: Vec<aura_os_agent_templates::ToolManifestEntry> = SHARED_ALL_TOOLS
        .list_tools()
        .into_iter()
        .map(|t| aura_os_agent_templates::ToolManifestEntry {
            name: t.name().to_string(),
            domain: t.domain(),
        })
        .collect();
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    entries
}

/// Build the fully-fledged [`AgentTemplate`](aura_os_agent_templates::AgentTemplate)
/// for the CEO preset, with `tool_manifest` and `streaming_tool_names`
/// derived from the runtime's canonical registry.
#[must_use]
pub fn ceo_agent_template() -> aura_os_agent_templates::AgentTemplate {
    aura_os_agent_templates::AgentTemplate::ceo(ceo_tool_manifest(), shared_streaming_tool_names())
}

/// Names of tools that an agent with the given `permissions` would be
/// able to invoke *if* they were shipped in the harness session's
/// `installed_tools` list.
///
/// Build-time approximation of
/// [`aura_os_agent_runtime::policy::check_capabilities`] used by
/// [`crate::ceo::build_cross_agent_tools`] to decide which tool names
/// to expose to the LLM. Because the agent has not yet produced any
/// call arguments, `*FromArg` requirements are treated conservatively
/// as "agent holds any `ReadProject` / `WriteProject` grant", and
/// `AnyOf` as "agent holds at least one member". Per-call dispatch
/// still re-checks via the policy module, so this layer can err on
/// the side of showing slightly more tools without risking escalation.
#[must_use]
pub fn build_time_cross_agent_tool_names(
    permissions: &aura_os_core::AgentPermissions,
) -> Vec<String> {
    let has_any_read_project = permissions
        .capabilities
        .iter()
        .any(|c| matches!(c, Capability::ReadProject { .. } | Capability::WriteProject { .. }));
    let has_any_write_project = permissions
        .capabilities
        .iter()
        .any(|c| matches!(c, Capability::WriteProject { .. }));

    let mut names: Vec<String> = SHARED_ALL_TOOLS
        .list_tools()
        .into_iter()
        .filter(|tool| {
            let reqs = tool.required_capabilities();
            if reqs.is_empty() {
                return true;
            }
            reqs.iter().all(|req| match req {
                CapabilityRequirement::Exact(cap) => {
                    permissions.is_ceo_preset() || permissions.capabilities.contains(cap)
                }
                CapabilityRequirement::ReadProjectFromArg(_) => {
                    permissions.is_ceo_preset() || has_any_read_project
                }
                CapabilityRequirement::WriteProjectFromArg(_) => {
                    permissions.is_ceo_preset() || has_any_write_project
                }
                CapabilityRequirement::AnyOf(caps) => {
                    permissions.is_ceo_preset()
                        || caps.iter().any(|c| permissions.capabilities.contains(c))
                }
            })
        })
        .map(|t| t.name().to_string())
        .collect();
    names.sort();
    names
}
