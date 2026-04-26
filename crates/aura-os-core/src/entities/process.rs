use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::enums::{
    ArtifactType, ProcessEventStatus, ProcessNodeType, ProcessRunStatus, ProcessRunTrigger,
};
use crate::ids::{
    AgentId, OrgId, ProcessArtifactId, ProcessEventId, ProcessFolderId, ProcessId,
    ProcessNodeConnectionId, ProcessNodeId, ProcessRunId, ProjectId,
};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProcessFolder {
    pub folder_id: ProcessFolderId,
    pub org_id: OrgId,
    pub user_id: String,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Process {
    pub process_id: ProcessId,
    pub org_id: OrgId,
    pub user_id: String,
    #[serde(default)]
    pub project_id: Option<ProjectId>,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub enabled: bool,
    #[serde(default)]
    pub folder_id: Option<ProcessFolderId>,
    /// Optional schedule expression for scheduled triggering (cron syntax).
    #[serde(default)]
    pub schedule: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub last_run_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub next_run_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProcessNode {
    pub node_id: ProcessNodeId,
    pub process_id: ProcessId,
    pub node_type: ProcessNodeType,
    pub label: String,
    #[serde(default)]
    pub agent_id: Option<AgentId>,
    #[serde(default)]
    pub prompt: String,
    /// Type-specific configuration (condition expression, artifact settings, delay, etc.)
    #[serde(default)]
    pub config: serde_json::Value,
    #[serde(default)]
    pub position_x: f64,
    #[serde(default)]
    pub position_y: f64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProcessNodeConnection {
    pub connection_id: ProcessNodeConnectionId,
    pub process_id: ProcessId,
    pub source_node_id: ProcessNodeId,
    #[serde(default)]
    pub source_handle: Option<String>,
    pub target_node_id: ProcessNodeId,
    #[serde(default)]
    pub target_handle: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProcessRun {
    pub run_id: ProcessRunId,
    pub process_id: ProcessId,
    pub status: ProcessRunStatus,
    pub trigger: ProcessRunTrigger,
    #[serde(default)]
    pub error: Option<String>,
    pub started_at: DateTime<Utc>,
    #[serde(default)]
    pub completed_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub total_input_tokens: Option<u64>,
    #[serde(default)]
    pub total_output_tokens: Option<u64>,
    #[serde(default)]
    pub cost_usd: Option<f64>,
    /// Canonical output of the run: the downstream_output of the terminal
    /// (leaf) node(s). Present only after a successful completion.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_run_id: Option<ProcessRunId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_override: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProcessEvent {
    pub event_id: ProcessEventId,
    pub run_id: ProcessRunId,
    pub node_id: ProcessNodeId,
    pub process_id: ProcessId,
    pub status: ProcessEventStatus,
    #[serde(default)]
    pub input_snapshot: String,
    #[serde(default)]
    pub output: String,
    pub started_at: DateTime<Utc>,
    #[serde(default)]
    pub completed_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub input_tokens: Option<u64>,
    #[serde(default)]
    pub output_tokens: Option<u64>,
    #[serde(default)]
    pub model: Option<String>,
    /// Structured content blocks from the harness conversation (text, tool_use,
    /// tool_result, thinking).  Present for action/condition/artifact nodes that
    /// invoke the LLM; `None` for ignition/delay/merge.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_blocks: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProcessArtifact {
    pub artifact_id: ProcessArtifactId,
    pub process_id: ProcessId,
    pub run_id: ProcessRunId,
    pub node_id: ProcessNodeId,
    pub artifact_type: ArtifactType,
    pub name: String,
    /// Relative path under data_dir
    pub file_path: String,
    pub size_bytes: u64,
    #[serde(default)]
    pub metadata: serde_json::Value,
    pub created_at: DateTime<Utc>,
}
