pub mod agent_tools;
pub mod billing_tools;
pub mod exec_tools;
pub mod generation_tools;
pub mod helpers;
pub mod monitor_tools;
pub mod org_tools;
pub mod process_tools;
pub mod project_tools;
pub mod social_tools;
pub mod spec_tools;
pub mod system_tools;
pub mod task_tools;
#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::sync::{Arc, LazyLock};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

use aura_os_agents::{AgentInstanceService, AgentService};
use aura_os_billing::BillingClient;
use aura_os_core::ToolDomain;
use aura_os_link::AutomatonClient;
use aura_os_network::{NetworkClient, OrbitClient};
use aura_os_orgs::OrgService;
use aura_os_projects::ProjectService;
use aura_os_sessions::SessionService;
use aura_os_storage::StorageClient;
use aura_os_store::SettingsStore;
use aura_os_tasks::TaskService;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    pub content: serde_json::Value,
    #[serde(default)]
    pub is_error: bool,
}

#[async_trait]
pub trait AgentTool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn domain(&self) -> ToolDomain;
    fn parameters_schema(&self) -> serde_json::Value;
    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &AgentToolContext,
    ) -> Result<ToolResult, crate::AgentRuntimeError>;
}

pub struct AgentToolContext {
    pub user_id: String,
    pub org_id: String,
    pub jwt: String,
    pub project_service: Arc<ProjectService>,
    pub agent_service: Arc<AgentService>,
    pub agent_instance_service: Arc<AgentInstanceService>,
    pub task_service: Arc<TaskService>,
    pub session_service: Arc<SessionService>,
    pub org_service: Arc<OrgService>,
    pub billing_client: Arc<BillingClient>,
    pub automaton_client: Arc<AutomatonClient>,
    pub network_client: Option<Arc<NetworkClient>>,
    pub storage_client: Option<Arc<StorageClient>>,
    pub orbit_client: Option<Arc<OrbitClient>>,
    pub store: Arc<SettingsStore>,
    pub event_broadcast: broadcast::Sender<serde_json::Value>,
    /// Base URL (no trailing slash) of the aura-os-server instance running in
    /// this process. When set, tools that need server-side side-effects
    /// (e.g. spec disk mirrors) should POST/PUT/DELETE here instead of going
    /// directly to the remote router via `network_client`.
    pub local_server_base_url: Option<String>,
    /// HTTP client reused for local-server calls. Shared with `AgentRuntimeService`.
    pub local_http_client: reqwest::Client,
}

pub struct ToolRegistry {
    tools: HashMap<String, Arc<dyn AgentTool>>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self {
            tools: HashMap::new(),
        }
    }

    pub fn with_tier1_tools() -> Self {
        let mut registry = Self::new();

        // Project tools
        registry.register(Arc::new(project_tools::CreateProjectTool));
        registry.register(Arc::new(project_tools::ImportProjectTool));
        registry.register(Arc::new(project_tools::ListProjectsTool));
        registry.register(Arc::new(project_tools::GetProjectTool));
        registry.register(Arc::new(project_tools::UpdateProjectTool));
        registry.register(Arc::new(project_tools::DeleteProjectTool));
        registry.register(Arc::new(project_tools::ArchiveProjectTool));
        registry.register(Arc::new(project_tools::GetProjectStatsTool));

        // Agent tools
        registry.register(Arc::new(agent_tools::ListAgentsTool));
        registry.register(Arc::new(agent_tools::GetAgentTool));
        registry.register(Arc::new(agent_tools::AssignAgentToProjectTool));

        // Execution tools
        registry.register(Arc::new(exec_tools::StartDevLoopTool));
        registry.register(Arc::new(exec_tools::PauseDevLoopTool));
        registry.register(Arc::new(exec_tools::StopDevLoopTool));
        registry.register(Arc::new(exec_tools::GetLoopStatusTool));
        registry.register(Arc::new(exec_tools::SendToAgentTool));

        // Monitoring tools
        registry.register(Arc::new(monitor_tools::GetFleetStatusTool));
        registry.register(Arc::new(monitor_tools::GetProgressReportTool));
        registry.register(Arc::new(monitor_tools::GetProjectCostTool));

        // Billing tools
        registry.register(Arc::new(billing_tools::GetCreditBalanceTool));

        // Meta-tool: load_domain_tools (always available)
        registry.register(Arc::new(crate::tier::LoadDomainToolsTool));

        registry
    }

    pub fn with_all_tools() -> Self {
        let mut registry = Self::with_tier1_tools();

        // Spec tools (Tier 2)
        registry.register(Arc::new(spec_tools::ListSpecsTool));
        registry.register(Arc::new(spec_tools::GetSpecTool));
        registry.register(Arc::new(spec_tools::CreateSpecTool));
        registry.register(Arc::new(spec_tools::UpdateSpecTool));
        registry.register(Arc::new(spec_tools::DeleteSpecTool));
        registry.register(Arc::new(spec_tools::GenerateSpecsTool));
        registry.register(Arc::new(spec_tools::GenerateSpecsSummaryTool));

        // Task tools (Tier 2)
        registry.register(Arc::new(task_tools::ListTasksTool));
        registry.register(Arc::new(task_tools::ListTasksBySpecTool));
        registry.register(Arc::new(task_tools::GetTaskTool));
        registry.register(Arc::new(task_tools::CreateTaskTool));
        registry.register(Arc::new(task_tools::UpdateTaskTool));
        registry.register(Arc::new(task_tools::DeleteTaskTool));
        registry.register(Arc::new(task_tools::ExtractTasksTool));
        registry.register(Arc::new(task_tools::TransitionTaskTool));
        registry.register(Arc::new(task_tools::RetryTaskTool));
        registry.register(Arc::new(task_tools::RunTaskTool));
        registry.register(Arc::new(task_tools::GetTaskOutputTool));

        // Additional agent tools (Tier 2)
        registry.register(Arc::new(agent_tools::CreateAgentTool));
        registry.register(Arc::new(agent_tools::UpdateAgentTool));
        registry.register(Arc::new(agent_tools::DeleteAgentTool));
        registry.register(Arc::new(agent_tools::ListAgentInstancesTool));
        registry.register(Arc::new(agent_tools::UpdateAgentInstanceTool));
        registry.register(Arc::new(agent_tools::DeleteAgentInstanceTool));
        registry.register(Arc::new(agent_tools::RemoteAgentActionTool));

        // Org tools (Tier 2)
        registry.register(Arc::new(org_tools::ListOrgsTool));
        registry.register(Arc::new(org_tools::CreateOrgTool));
        registry.register(Arc::new(org_tools::GetOrgTool));
        registry.register(Arc::new(org_tools::UpdateOrgTool));
        registry.register(Arc::new(org_tools::ListMembersTool));
        registry.register(Arc::new(org_tools::UpdateMemberRoleTool));
        registry.register(Arc::new(org_tools::RemoveMemberTool));
        registry.register(Arc::new(org_tools::ManageInvitesTool));

        // Additional billing tools (Tier 2)
        registry.register(Arc::new(billing_tools::GetTransactionsTool));
        registry.register(Arc::new(billing_tools::GetBillingAccountTool));
        registry.register(Arc::new(billing_tools::PurchaseCreditsTool));

        // Social tools (Tier 2)
        registry.register(Arc::new(social_tools::ListFeedTool));
        registry.register(Arc::new(social_tools::CreatePostTool));
        registry.register(Arc::new(social_tools::GetPostTool));
        registry.register(Arc::new(social_tools::AddCommentTool));
        registry.register(Arc::new(social_tools::DeleteCommentTool));
        registry.register(Arc::new(social_tools::FollowProfileTool));
        registry.register(Arc::new(social_tools::UnfollowProfileTool));
        registry.register(Arc::new(social_tools::ListFollowsTool));

        // Additional monitoring tools (Tier 2)
        registry.register(Arc::new(monitor_tools::GetLeaderboardTool));
        registry.register(Arc::new(monitor_tools::GetUsageStatsTool));
        registry.register(Arc::new(monitor_tools::ListSessionsTool));
        registry.register(Arc::new(monitor_tools::ListLogEntriesTool));

        // System tools (Tier 2)
        registry.register(Arc::new(system_tools::BrowseFilesTool));
        registry.register(Arc::new(system_tools::ReadFileTool));
        registry.register(Arc::new(system_tools::GetEnvironmentInfoTool));
        registry.register(Arc::new(system_tools::GetRemoteAgentStateTool));

        // Generation tools (Tier 2)
        registry.register(Arc::new(generation_tools::GenerateImageTool));
        registry.register(Arc::new(generation_tools::Generate3dModelTool));
        registry.register(Arc::new(generation_tools::Get3dStatusTool));

        registry
    }

    pub fn register_process_tools(&mut self, executor: Arc<aura_os_process::ProcessExecutor>) {
        self.register(Arc::new(process_tools::CreateProcessTool));
        self.register(Arc::new(process_tools::ListProcessesTool));
        self.register(Arc::new(process_tools::DeleteProcessTool));
        self.register(Arc::new(process_tools::TriggerProcessTool { executor }));
        self.register(Arc::new(process_tools::ListProcessRunsTool));
    }

    pub fn register(&mut self, tool: Arc<dyn AgentTool>) {
        self.tools.insert(tool.name().to_string(), tool);
    }

    pub fn get(&self, name: &str) -> Option<&Arc<dyn AgentTool>> {
        self.tools.get(name)
    }

    pub fn list_tools(&self) -> Vec<&Arc<dyn AgentTool>> {
        self.tools.values().collect()
    }

    /// Names of every tool currently in this registry, including those
    /// registered via [`register_process_tools`].
    pub fn tool_names(&self) -> Vec<String> {
        self.tools.keys().cloned().collect()
    }

    pub fn tools_for_domains(&self, domains: &[ToolDomain]) -> Vec<&Arc<dyn AgentTool>> {
        self.tools
            .values()
            .filter(|t| domains.contains(&t.domain()))
            .collect()
    }

    pub fn tool_definitions(&self, tools: &[&Arc<dyn AgentTool>]) -> Vec<serde_json::Value> {
        tools
            .iter()
            .map(|t| {
                let mut def = serde_json::json!({
                    "name": t.name(),
                    "description": t.description(),
                    "input_schema": t.parameters_schema(),
                });
                // Opt the tool into Anthropic's fine-grained tool streaming
                // (`input_json_delta`) so the UI can render `markdown_contents`
                // / file `content` character-by-character in the preview card
                // rather than in one batch at the end of the turn.
                if is_streaming_tool_name(t.name()) {
                    def["eager_input_streaming"] = serde_json::Value::Bool(true);
                }
                def
            })
            .collect()
    }
}

/// Process-wide cached `ToolRegistry::with_all_tools()`.
///
/// `with_all_tools` allocates ~55 `Arc<dyn AgentTool>` entries plus a
/// `HashMap` every call; it was being built once per chat session open
/// ([`crate::ceo::build_cross_agent_tools`]) *and* once per tool
/// invocation ([`dispatch_agent_tool`]). Since every tool in the
/// registry is stateless (no captured `ProcessExecutor` — see
/// [`ToolRegistry::register_process_tools`] for that branch), the
/// built registry is safe to share across all requests.
static SHARED_ALL_TOOLS: LazyLock<Arc<ToolRegistry>> =
    LazyLock::new(|| Arc::new(ToolRegistry::with_all_tools()));

/// Return the process-wide cached [`ToolRegistry::with_all_tools`]
/// instance. Callers that previously wrote
/// `ToolRegistry::with_all_tools()` on every request should use this
/// instead to avoid rebuilding the full tool table.
#[must_use]
pub fn shared_all_tools_registry() -> Arc<ToolRegistry> {
    SHARED_ALL_TOOLS.clone()
}

/// Names of every tool that the in-process `/api/agent_tools/:name`
/// dispatcher knows how to execute. Built from
/// [`ToolRegistry::with_all_tools`] plus the dynamically-registered
/// process tool names, so diagnostic surfaces can reason about tools
/// without needing a `ProcessExecutor` to hand to `register_process_tools`.
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
/// Built once per caller by walking [`ToolRegistry::with_all_tools`] and
/// then topping up with the five process tools (which aren't in the
/// default registry because `TriggerProcessTool` needs a
/// `ProcessExecutor` at runtime, but all five carry fully-static
/// metadata).
///
/// [`crate::ceo::build_cross_agent_tools`] uses this to stamp the real
/// description + parameters_schema onto each `InstalledTool` it ships
/// to the harness; without it the LLM sees just a tool name with an
/// empty `{}` schema and defensively refuses to call the tool.
#[must_use]
pub fn tool_metadata_map() -> Arc<HashMap<String, (String, serde_json::Value)>> {
    SHARED_TOOL_METADATA_MAP.clone()
}

/// Process-wide cached metadata map. Built lazily on first access
/// from the shared registry above so the full construction cost is
/// paid exactly once per process.
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
            process_tools::CreateProcessTool.description().to_string(),
            process_tools::CreateProcessTool.parameters_schema(),
        ),
    );
    map.insert(
        "list_processes".to_string(),
        (
            process_tools::ListProcessesTool.description().to_string(),
            process_tools::ListProcessesTool.parameters_schema(),
        ),
    );
    map.insert(
        "delete_process".to_string(),
        (
            process_tools::DeleteProcessTool.description().to_string(),
            process_tools::DeleteProcessTool.parameters_schema(),
        ),
    );
    map.insert(
        "list_process_runs".to_string(),
        (
            process_tools::ListProcessRunsTool.description().to_string(),
            process_tools::ListProcessRunsTool.parameters_schema(),
        ),
    );
    // `TriggerProcessTool` needs a `ProcessExecutor` to construct, so
    // we can't just call `.description()` / `.parameters_schema()` on
    // an instance like the four ZST tools above. Pull the same static
    // values the trait impl uses so the two paths can't drift apart.
    let (trigger_desc, trigger_schema) = process_tools::trigger_process_metadata();
    map.insert(
        "trigger_process".to_string(),
        (trigger_desc.to_string(), trigger_schema),
    );
    map
}

/// Tool names that should stream their JSON arguments to the client via
/// `input_json_delta` / `tool_call_snapshot`. Must stay in sync with the
/// list in `crate::stream` (the stream module uses the same names to
/// decide whether to emit snapshots).
///
/// The canonical list now lives in
/// [`aura_os_agent_templates::STREAMING_TOOL_NAMES`] so it can be
/// shipped to a harness-hosted agent in the agent template; this
/// wrapper keeps the existing in-process API stable.
pub(crate) fn is_streaming_tool_name(name: &str) -> bool {
    aura_os_agent_templates::STREAMING_TOOL_NAMES.contains(&name)
}
