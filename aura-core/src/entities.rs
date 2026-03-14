use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::enums::{
    AgentStatus, ChatRole, InviteStatus, OrgRole, ProjectStatus, SessionStatus, TaskStatus,
};
use crate::ids::{
    AgentId, ChatMessageId, ChatSessionId, GitHubIntegrationId, InviteId, OrgId, ProjectId,
    SessionId, SpecId, SprintId, TaskId,
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
pub struct Task {
    pub task_id: TaskId,
    pub project_id: ProjectId,
    pub spec_id: SpecId,
    pub title: String,
    pub description: String,
    pub status: TaskStatus,
    pub order_index: u32,
    pub dependency_ids: Vec<TaskId>,
    pub assigned_agent_id: Option<AgentId>,
    #[serde(default)]
    pub session_id: Option<SessionId>,
    pub execution_notes: String,
    #[serde(default)]
    pub files_changed: Vec<FileChangeSummary>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Agent {
    pub agent_id: AgentId,
    pub project_id: ProjectId,
    pub name: String,
    pub status: AgentStatus,
    pub current_task_id: Option<TaskId>,
    pub current_session_id: Option<SessionId>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Session {
    pub session_id: SessionId,
    pub agent_id: AgentId,
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
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChatSession {
    pub chat_session_id: ChatSessionId,
    pub project_id: ProjectId,
    pub title: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChatMessage {
    pub message_id: ChatMessageId,
    pub chat_session_id: ChatSessionId,
    pub project_id: ProjectId,
    pub role: ChatRole,
    pub content: String,
    pub created_at: DateTime<Utc>,
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
pub struct OrgMember {
    pub org_id: OrgId,
    pub user_id: String,
    pub display_name: String,
    pub role: OrgRole,
    pub joined_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OrgInvite {
    pub invite_id: InviteId,
    pub org_id: OrgId,
    pub token: String,
    pub created_by: String,
    pub status: InviteStatus,
    pub accepted_by: Option<String>,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub accepted_at: Option<DateTime<Utc>>,
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ZeroAuthSession {
    pub user_id: String,
    pub display_name: String,
    pub profile_image: String,
    pub primary_zid: String,
    pub zero_wallet: String,
    pub wallets: Vec<String>,
    pub access_token: String,
    pub created_at: DateTime<Utc>,
    pub validated_at: DateTime<Utc>,
}
