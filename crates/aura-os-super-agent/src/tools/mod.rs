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
use std::sync::Arc;

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
use aura_os_store::RocksStore;
use aura_os_tasks::TaskService;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    pub content: serde_json::Value,
    #[serde(default)]
    pub is_error: bool,
}

#[async_trait]
pub trait SuperAgentTool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn domain(&self) -> ToolDomain;
    fn parameters_schema(&self) -> serde_json::Value;
    async fn execute(
        &self,
        input: serde_json::Value,
        ctx: &SuperAgentContext,
    ) -> Result<ToolResult, crate::SuperAgentError>;
}

pub struct SuperAgentContext {
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
    pub store: Arc<RocksStore>,
    pub event_broadcast: broadcast::Sender<serde_json::Value>,
    /// Base URL (no trailing slash) of the aura-os-server instance running in
    /// this process. When set, tools that need server-side side-effects
    /// (e.g. spec disk mirrors) should POST/PUT/DELETE here instead of going
    /// directly to the remote router via `network_client`.
    pub local_server_base_url: Option<String>,
    /// HTTP client reused for local-server calls. Shared with `SuperAgentService`.
    pub local_http_client: reqwest::Client,
}

pub struct ToolRegistry {
    tools: HashMap<String, Arc<dyn SuperAgentTool>>,
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

    pub fn register(&mut self, tool: Arc<dyn SuperAgentTool>) {
        self.tools.insert(tool.name().to_string(), tool);
    }

    pub fn get(&self, name: &str) -> Option<&Arc<dyn SuperAgentTool>> {
        self.tools.get(name)
    }

    pub fn list_tools(&self) -> Vec<&Arc<dyn SuperAgentTool>> {
        self.tools.values().collect()
    }

    pub fn tools_for_domains(&self, domains: &[ToolDomain]) -> Vec<&Arc<dyn SuperAgentTool>> {
        self.tools
            .values()
            .filter(|t| domains.contains(&t.domain()))
            .collect()
    }

    pub fn tool_definitions(&self, tools: &[&Arc<dyn SuperAgentTool>]) -> Vec<serde_json::Value> {
        tools
            .iter()
            .map(|t| {
                serde_json::json!({
                    "name": t.name(),
                    "description": t.description(),
                    "input_schema": t.parameters_schema(),
                })
            })
            .collect()
    }
}
