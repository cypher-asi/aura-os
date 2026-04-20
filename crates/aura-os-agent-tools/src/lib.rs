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
pub mod session;
pub mod tier;
pub mod tools;

use std::collections::HashMap;
use std::sync::{Arc, LazyLock};

use aura_os_agent_runtime::tools::{
    AgentTool, CapabilityRequirement, Surface, ToolRegistry,
};
use aura_os_core::{AgentPermissions, Capability, ToolDomain};

/// Build the canonical [`ToolRegistry`] containing every
/// stateless tool. Does not include the process workflow tools
/// (`create_process`, `trigger_process`, etc.) because
/// [`tools::process_tools::TriggerProcessTool`] holds an
/// `Arc<ProcessExecutor>` that only exists after the server's
/// `app_builder` has constructed one from its data directory. Use
/// [`register_process_tools`] on a mutable registry to add those at
/// boot.
///
/// There used to be two entry points here — `build_tier1_registry`
/// and `build_all_tools_registry` — with the tier-1 slice serving as
/// the CEO preset's narrow allowlist. The surface-vs-OnDemand split
/// is now declared per-tool via [`AgentTool::surface`], so a single
/// registry + a capability/surface filter ([`session::build_session_tool_names`])
/// replaces the two-builder pattern.
#[must_use]
pub fn build_registry() -> ToolRegistry {
    let mut registry = ToolRegistry::new();

    // Always-surface project / agent / exec / monitoring / billing
    // tools — the ones the CEO preset used to load via
    // `build_tier1_registry`. They keep the default
    // `Surface::Always` from `AgentTool`.
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

    registry.register(Arc::new(tools::system_tools::GetCurrentTimeTool));

    // Meta-tool: promotes `Surface::OnDemand` domains into the live
    // session's tool surface.
    registry.register(Arc::new(tier::LoadDomainToolsTool));

    // `list_agent_instances` was previously tier-2 (hidden from the
    // CEO until `load_domain_tools` was called), which produced the
    // reported bug where the CEO could not see its own project
    // agents. It's `Surface::Always` now so it ships on every turn
    // for any bundle that satisfies its `ReadProjectFromArg`
    // requirement (including the CEO preset via
    // `Capability::ReadAllProjects`).
    registry.register(Arc::new(tools::agent_tools::ListAgentInstancesTool));

    // --- Surface::OnDemand tools below: shipped only when the LLM
    // promotes their `ToolDomain` via `load_domain_tools`. ---

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

/// Backwards-compatible alias for [`build_registry`]. The unified
/// registry no longer splits on tier — every tool is registered once
/// and filtered at session-open time via [`AgentTool::surface`].
#[deprecated(
    note = "Use `build_registry()`; the tier-1 / tier-2 split has been \
            replaced by the declarative `AgentTool::surface` method."
)]
#[must_use]
pub fn build_all_tools_registry() -> ToolRegistry {
    build_registry()
}

/// Register the five process workflow tools against an existing
/// registry. Kept separate from [`build_registry`] because
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

/// Process-wide cached [`build_registry`] output.
///
/// Every tool in the registry is stateless (no captured
/// `ProcessExecutor` — see [`register_process_tools`] for that branch),
/// so the built registry is safe to share across all requests.
static SHARED_ALL_TOOLS: LazyLock<Arc<ToolRegistry>> =
    LazyLock::new(|| Arc::new(build_registry()));

/// Return the process-wide cached [`build_registry`] instance.
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
        // Synthetic agent-spawn name — not backed by an `AgentTool`
        // impl but dispatched by a bespoke handler branch in the
        // server's `/api/agent_tools/:name` route. Included here so the
        // "fully dispatchable" diagnostic recognises it.
        "spawn_agent",
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

/// Does `permissions` satisfy the build-time approximation of
/// `tool.required_capabilities()`?
///
/// Per-call dispatch still re-checks with the full policy module on
/// resolved arguments, so this layer can err on the side of "show"
/// without risking privilege escalation.
///
/// * `Exact(cap)` — bundle must contain `cap` (e.g. `SpawnAgent`).
/// * `ReadProjectFromArg(_)` — bundle must hold some `ReadProject`,
///   `WriteProject`, `ReadAllProjects`, or `WriteAllProjects`.
/// * `WriteProjectFromArg(_)` — bundle must hold some `WriteProject`
///   or `WriteAllProjects`.
/// * `AnyOf(caps)` — bundle must contain at least one member (with
///   the same wildcard lifting for the `ReadProject` / `WriteProject`
///   slots).
///
/// With the new [`Capability::ReadAllProjects`] / [`Capability::WriteAllProjects`]
/// wildcards in [`AgentPermissions::ceo_preset`], the CEO no longer
/// needs a separate `is_ceo_preset()` short-circuit — it satisfies
/// every requirement through the normal path like any other bundle
/// that happens to carry a wildcard.
#[must_use]
pub fn permissions_satisfy_requirements(
    permissions: &AgentPermissions,
    requirements: &[CapabilityRequirement],
) -> bool {
    if requirements.is_empty() {
        return true;
    }
    let caps = &permissions.capabilities;
    let has_any_read_project = caps.iter().any(|c| {
        matches!(
            c,
            Capability::ReadProject { .. }
                | Capability::WriteProject { .. }
                | Capability::ReadAllProjects
                | Capability::WriteAllProjects
        )
    });
    let has_any_write_project = caps.iter().any(|c| {
        matches!(
            c,
            Capability::WriteProject { .. } | Capability::WriteAllProjects
        )
    });
    requirements.iter().all(|req| match req {
        CapabilityRequirement::Exact(cap) => holds(caps, cap, has_any_read_project, has_any_write_project),
        CapabilityRequirement::ReadProjectFromArg(_) => has_any_read_project,
        CapabilityRequirement::WriteProjectFromArg(_) => has_any_write_project,
        CapabilityRequirement::AnyOf(options) => options
            .iter()
            .any(|c| holds(caps, c, has_any_read_project, has_any_write_project)),
    })
}

fn holds(
    held: &[Capability],
    needed: &Capability,
    has_any_read_project: bool,
    has_any_write_project: bool,
) -> bool {
    match needed {
        Capability::ReadProject { id } => held.iter().any(|h| match h {
            Capability::ReadProject { id: hid } | Capability::WriteProject { id: hid } => hid == id,
            Capability::ReadAllProjects | Capability::WriteAllProjects => true,
            _ => false,
        }) || has_any_read_project && id.is_empty(),
        Capability::WriteProject { id } => held.iter().any(|h| match h {
            Capability::WriteProject { id: hid } => hid == id,
            Capability::WriteAllProjects => true,
            _ => false,
        }) || has_any_write_project && id.is_empty(),
        other => held.contains(other),
    }
}

/// Names of tools a session should ship for an agent with the given
/// `permissions` and the given set of currently-loaded on-demand
/// `loaded_domains`.
///
/// A tool is included iff:
/// 1. its `required_capabilities()` are satisfied by `permissions`
///    ([`permissions_satisfy_requirements`]), *and*
/// 2. its `surface()` is [`Surface::Always`] OR its `domain()` is in
///    `loaded_domains` (the LLM has promoted that domain this session
///    via `load_domain_tools`).
///
/// This is the unified replacement for the old pair
/// `build_time_cross_agent_tool_names` (non-CEO branch) +
/// `ceo_tier1_tool_names` (CEO branch). Both preset and non-preset
/// bundles now follow exactly the same code path — what differs is
/// the capabilities they carry.
#[must_use]
pub fn build_session_tool_names(
    permissions: &AgentPermissions,
    loaded_domains: &[ToolDomain],
) -> Vec<String> {
    let mut names: Vec<String> = SHARED_ALL_TOOLS
        .list_tools()
        .into_iter()
        .filter(|tool| permissions_satisfy_requirements(permissions, tool.required_capabilities()))
        .filter(|tool| {
            tool.surface() == Surface::Always || loaded_domains.contains(&tool.domain())
        })
        .map(|t| t.name().to_string())
        .collect();
    names.sort();
    names
}

/// Build-time approximation kept for source-compat with existing
/// callers (e.g. the installed-tools diagnostic). Equivalent to
/// [`build_session_tool_names`] called with an empty
/// `loaded_domains` — the set of tools a fresh session would ship
/// before the LLM promoted any domain.
#[must_use]
pub fn build_time_cross_agent_tool_names(permissions: &AgentPermissions) -> Vec<String> {
    build_session_tool_names(permissions, &[])
}
