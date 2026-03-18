use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::enums::{AgentStatus, ChatRole, ProjectStatus, SessionStatus, TaskStatus};
use crate::ids::{
    AgentId, AgentInstanceId, GitHubIntegrationId, MessageId, OrgId, ProfileId, ProjectId,
    SessionId, SpecId, SprintId, TaskId, UserId,
};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Project {
    pub project_id: ProjectId,
    pub org_id: OrgId,
    pub name: String,
    pub description: String,
    pub linked_folder_path: String,
    #[serde(default)]
    pub requirements_doc_path: Option<String>,
    pub current_status: ProjectStatus,
    #[serde(default)]
    pub github_integration_id: Option<GitHubIntegrationId>,
    #[serde(default)]
    pub github_repo_full_name: Option<String>,
    #[serde(default)]
    pub build_command: Option<String>,
    #[serde(default)]
    pub test_command: Option<String>,
    #[serde(default)]
    pub specs_summary: Option<String>,
    #[serde(default)]
    pub specs_title: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Sprint {
    pub sprint_id: SprintId,
    pub project_id: ProjectId,
    pub title: String,
    pub prompt: String,
    pub order_index: u32,
    #[serde(default)]
    pub generated_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Spec {
    pub spec_id: SpecId,
    pub project_id: ProjectId,
    pub title: String,
    pub order_index: u32,
    pub markdown_contents: String,
    #[serde(default)]
    pub sprint_id: Option<SprintId>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FileChangeSummary {
    pub op: String,
    pub path: String,
    #[serde(default)]
    pub lines_added: u32,
    #[serde(default)]
    pub lines_removed: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BuildStepRecord {
    pub kind: String,
    pub command: Option<String>,
    pub stderr: Option<String>,
    pub stdout: Option<String>,
    pub attempt: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IndividualTestResult {
    pub name: String,
    pub status: String,
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TestStepRecord {
    pub kind: String,
    pub command: Option<String>,
    pub stderr: Option<String>,
    pub stdout: Option<String>,
    pub attempt: Option<u32>,
    #[serde(default)]
    pub tests: Vec<IndividualTestResult>,
    #[serde(default)]
    pub summary: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Task {
    pub task_id: TaskId,
    pub project_id: ProjectId,
    pub spec_id: SpecId,
    pub title: String,
    pub description: String,
    pub status: TaskStatus,
    pub order_index: u32,
    pub dependency_ids: Vec<TaskId>,
    #[serde(default)]
    pub parent_task_id: Option<TaskId>,
    pub assigned_agent_instance_id: Option<AgentInstanceId>,
    #[serde(default)]
    pub completed_by_agent_instance_id: Option<AgentInstanceId>,
    #[serde(default)]
    pub session_id: Option<SessionId>,
    pub execution_notes: String,
    #[serde(default)]
    pub files_changed: Vec<FileChangeSummary>,
    #[serde(default)]
    pub live_output: String,
    #[serde(default)]
    pub build_steps: Vec<BuildStepRecord>,
    #[serde(default)]
    pub test_steps: Vec<TestStepRecord>,
    #[serde(default)]
    pub user_id: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub total_input_tokens: u64,
    #[serde(default)]
    pub total_output_tokens: u64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Agent {
    pub agent_id: AgentId,
    pub user_id: String,
    pub name: String,
    pub role: String,
    pub personality: String,
    pub system_prompt: String,
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub network_agent_id: Option<String>,
    #[serde(default)]
    pub profile_id: Option<ProfileId>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentInstance {
    pub agent_instance_id: AgentInstanceId,
    pub project_id: ProjectId,
    pub agent_id: AgentId,
    pub name: String,
    pub role: String,
    pub personality: String,
    pub system_prompt: String,
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default)]
    pub icon: Option<String>,
    pub status: AgentStatus,
    pub current_task_id: Option<TaskId>,
    pub current_session_id: Option<SessionId>,
    #[serde(default)]
    pub total_input_tokens: u64,
    #[serde(default)]
    pub total_output_tokens: u64,
    #[serde(default)]
    pub model: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Session {
    pub session_id: SessionId,
    pub agent_instance_id: AgentInstanceId,
    pub project_id: ProjectId,
    pub active_task_id: Option<TaskId>,
    #[serde(default)]
    pub tasks_worked: Vec<TaskId>,
    pub context_usage_estimate: f64,
    #[serde(default)]
    pub total_input_tokens: u64,
    #[serde(default)]
    pub total_output_tokens: u64,
    pub summary_of_previous_context: String,
    pub status: SessionStatus,
    #[serde(default)]
    pub user_id: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Message {
    pub message_id: MessageId,
    pub agent_instance_id: AgentInstanceId,
    pub project_id: ProjectId,
    pub role: ChatRole,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_blocks: Option<Vec<ChatContentBlock>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking_duration_ms: Option<u64>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChatContentBlock {
    Text {
        text: String,
    },
    Image {
        media_type: String,
        data: String,
    },
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    ToolResult {
        tool_use_id: String,
        content: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        is_error: Option<bool>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Org {
    pub org_id: OrgId,
    pub name: String,
    pub owner_user_id: String,
    pub billing: Option<OrgBilling>,
    pub github: Option<OrgGithub>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OrgBilling {
    pub billing_email: Option<String>,
    pub plan: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OrgGithub {
    pub github_org: String,
    pub connected_by: String,
    pub connected_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GitHubIntegration {
    pub integration_id: GitHubIntegrationId,
    pub org_id: OrgId,
    pub installation_id: i64,
    pub github_account_login: String,
    pub github_account_type: String,
    pub connected_by: String,
    pub connected_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GitHubRepo {
    pub github_repo_id: i64,
    pub integration_id: GitHubIntegrationId,
    pub full_name: String,
    pub name: String,
    pub private: bool,
    pub default_branch: String,
    pub html_url: String,
    pub updated_at: DateTime<Utc>,
}

/// A single row in the fee schedule: per-model token pricing effective from a given date.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FeeScheduleEntry {
    pub model: String,
    pub input_cost_per_million: f64,
    pub output_cost_per_million: f64,
    /// ISO 8601 date (e.g. "2026-02-01"). The rate applies from this date onward
    /// until superseded by a later entry for the same model.
    pub effective_date: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreditTier {
    pub id: String,
    pub credits: u64,
    pub price_usd_cents: u64,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreditPurchase {
    pub id: String,
    pub tier_id: Option<String>,
    pub credits: u64,
    pub amount_cents: u64,
    pub status: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreditBalance {
    pub total_credits: u64,
    pub purchases: Vec<CreditPurchase>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CheckoutSessionResponse {
    pub checkout_url: String,
    pub session_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DebitResponse {
    pub success: bool,
    pub balance: u64,
    pub transaction_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Follow {
    pub id: String,
    pub follower_profile_id: ProfileId,
    pub target_profile_id: ProfileId,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ZeroAuthSession {
    pub user_id: String,
    #[serde(default)]
    pub network_user_id: Option<UserId>,
    #[serde(default)]
    pub profile_id: Option<ProfileId>,
    pub display_name: String,
    pub profile_image: String,
    pub primary_zid: String,
    pub zero_wallet: String,
    pub wallets: Vec<String>,
    pub access_token: String,
    pub created_at: DateTime<Utc>,
    pub validated_at: DateTime<Utc>,
}
