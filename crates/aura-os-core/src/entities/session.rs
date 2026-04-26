use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::enums::{ChatRole, SessionStatus};
use crate::ids::{AgentInstanceId, ProjectId, SessionEventId, SessionId, TaskId};

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
    /// `Some(true)` when this row is a synthesized snapshot of an
    /// assistant turn that has been started (we have an
    /// `assistant_message_start` row) but not yet terminated by an
    /// `assistant_message_end`. Used by the UI to keep rendering the
    /// partial response (text + tool cards) and to flip the streaming
    /// state flag back on after a mid-turn page refresh, so chat and
    /// sidekick pending artifacts survive across reloads instead of
    /// disappearing until the turn finally completes.
    ///
    /// `None` (the default) on terminal turns reconstructed from
    /// `assistant_message_end` and on `user_message` / `task_output`
    /// rows so existing wire/storage payloads round-trip unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub in_flight: Option<bool>,
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
