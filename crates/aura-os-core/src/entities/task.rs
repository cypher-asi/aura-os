use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::enums::TaskStatus;
use crate::ids::{AgentInstanceId, ProjectId, SessionId, SpecId, TaskId};

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
    /// Per-task opt-out for the Phase 5 preflight decomposition path.
    ///
    /// Ephemeral: carried through `create_task` so callers (e.g. task
    /// extractors that already emit well-sized specs) can disable the
    /// auto-split without touching the global `AURA_AUTO_DECOMPOSE_DISABLED`
    /// flag. Not persisted in aura-storage — a task reloaded after a
    /// restart always defaults to `false`, which is intentional because
    /// the preflight path only runs at creation time anyway.
    #[serde(default)]
    pub skip_auto_decompose: bool,
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
