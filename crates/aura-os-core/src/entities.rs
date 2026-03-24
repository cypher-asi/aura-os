use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::enums::{AgentStatus, ChatRole, HarnessMode, ProjectStatus, SessionStatus, TaskStatus};
use crate::ids::{
    AgentId, AgentInstanceId, OrgId, ProfileId, ProjectId, SessionEventId, SessionId, SpecId,
    TaskId, UserId,
};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Project {
    pub project_id: ProjectId,
    pub org_id: OrgId,
    pub name: String,
    pub description: String,
    pub linked_folder_path: String,
    #[serde(default)]
    pub workspace_source: Option<String>,
    #[serde(default)]
    pub workspace_display_path: Option<String>,
    #[serde(default)]
    pub requirements_doc_path: Option<String>,
    pub current_status: ProjectStatus,
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
    // Git / Orbit link (owner is org_id or user_id from aura-storage)
    #[serde(default)]
    pub git_repo_url: Option<String>,
    #[serde(default)]
    pub git_branch: Option<String>,
    #[serde(default)]
    pub orbit_base_url: Option<String>,
    #[serde(default)]
    pub orbit_owner: Option<String>,
    #[serde(default)]
    pub orbit_repo: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Spec {
    pub spec_id: SpecId,
    pub project_id: ProjectId,
    pub title: String,
    pub order_index: u32,
    pub markdown_contents: String,
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
    /// Ephemeral: not persisted in aura-storage.
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
    /// Ephemeral: populated only during engine execution; not persisted.
    #[serde(default)]
    pub live_output: String,
    /// Ephemeral: populated only during engine execution; not persisted.
    #[serde(default)]
    pub build_steps: Vec<BuildStepRecord>,
    /// Ephemeral: populated only during engine execution; not persisted.
    #[serde(default)]
    pub test_steps: Vec<TestStepRecord>,
    /// Ephemeral: not persisted in aura-storage.
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

fn default_machine_type() -> String {
    "local".to_string()
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
    #[serde(default = "default_machine_type")]
    pub machine_type: String,
    #[serde(default)]
    pub network_agent_id: Option<AgentId>,
    #[serde(default)]
    pub profile_id: Option<ProfileId>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Agent {
    pub fn harness_mode(&self) -> HarnessMode {
        HarnessMode::from_machine_type(&self.machine_type)
    }
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
    #[serde(default = "default_machine_type")]
    pub machine_type: String,
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

impl AgentInstance {
    pub fn harness_mode(&self) -> HarnessMode {
        HarnessMode::from_machine_type(&self.machine_type)
    }
}

/// Volatile per-agent-instance state that lives only in memory (lost on restart).
/// `close_stale_sessions` cleans up on the next startup.
#[derive(Debug, Clone, Default)]
pub struct RuntimeAgentState {
    pub current_task_id: Option<TaskId>,
    pub current_session_id: Option<SessionId>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Session {
    pub session_id: SessionId,
    pub agent_instance_id: AgentInstanceId,
    pub project_id: ProjectId,
    /// Ephemeral: set by caller from in-memory engine state; not persisted.
    pub active_task_id: Option<TaskId>,
    /// Persisted as `tasks_worked_count` (length only); individual IDs are
    /// ephemeral. Used for the 8-task session rollover limit.
    #[serde(default)]
    pub tasks_worked: Vec<TaskId>,
    pub context_usage_estimate: f64,
    /// Ephemeral: accumulates per engine run; resets on reload from storage.
    #[serde(default)]
    pub total_input_tokens: u64,
    /// Ephemeral: accumulates per engine run; resets on reload from storage.
    #[serde(default)]
    pub total_output_tokens: u64,
    pub summary_of_previous_context: String,
    pub status: SessionStatus,
    /// Ephemeral: populated from auth context by the caller; not persisted.
    #[serde(default)]
    pub user_id: Option<String>,
    /// Ephemeral: populated from auth context by the caller; not persisted.
    #[serde(default)]
    pub model: Option<String>,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
}

impl Session {
    pub fn dummy(project_id: ProjectId) -> Self {
        Self {
            session_id: SessionId::new(),
            agent_instance_id: AgentInstanceId::new(),
            project_id,
            active_task_id: None,
            tasks_worked: vec![],
            context_usage_estimate: 0.0,
            total_input_tokens: 0,
            total_output_tokens: 0,
            summary_of_previous_context: String::new(),
            status: SessionStatus::Active,
            user_id: None,
            model: None,
            started_at: chrono::Utc::now(),
            ended_at: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SessionEvent {
    pub event_id: SessionEventId,
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
    TaskRef {
        task_id: String,
        title: String,
    },
    SpecRef {
        spec_id: String,
        title: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Org {
    pub org_id: OrgId,
    pub name: String,
    pub owner_user_id: UserId,
    pub billing: Option<OrgBilling>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OrgBilling {
    pub billing_email: Option<String>,
    pub plan: String,
}


#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreditBalance {
    pub balance_cents: i64,
    pub plan: String,
    pub balance_formatted: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreditTransaction {
    pub id: String,
    pub amount_cents: i64,
    pub transaction_type: String,
    pub balance_after_cents: i64,
    pub description: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TransactionsResponse {
    pub transactions: Vec<CreditTransaction>,
    pub has_more: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BillingAccount {
    pub user_id: String,
    pub balance_cents: i64,
    pub balance_formatted: String,
    pub lifetime_purchased_cents: i64,
    pub lifetime_granted_cents: i64,
    pub lifetime_used_cents: i64,
    pub plan: String,
    pub auto_refill_enabled: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CheckoutSessionResponse {
    pub checkout_url: String,
    pub session_id: String,
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
    #[serde(default)]
    pub is_zero_pro: bool,
    pub created_at: DateTime<Utc>,
    pub validated_at: DateTime<Utc>,
}
