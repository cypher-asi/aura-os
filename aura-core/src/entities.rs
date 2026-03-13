use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::enums::{AgentStatus, ChatRole, ProjectStatus, SessionStatus, TaskStatus};
use crate::ids::{AgentId, ChatMessageId, ChatSessionId, ProjectId, SessionId, SpecId, TaskId};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Project {
    pub project_id: ProjectId,
    pub name: String,
    pub description: String,
    pub linked_folder_path: String,
    pub requirements_doc_path: String,
    pub current_status: ProjectStatus,
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
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
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
    pub execution_notes: String,
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
    pub context_usage_estimate: f64,
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
