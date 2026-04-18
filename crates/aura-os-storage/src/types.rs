use serde::{Deserialize, Serialize};
use serde_json::Value;

// ---------------------------------------------------------------------------
// Process types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageProcess {
    pub id: String,
    #[serde(default)]
    pub org_id: Option<String>,
    #[serde(default)]
    pub created_by: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub folder_id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub schedule: Option<String>,
    #[serde(default)]
    pub tags: Option<Value>,
    #[serde(default)]
    pub last_run_at: Option<String>,
    #[serde(default)]
    pub next_run_at: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageProcessNode {
    pub id: String,
    #[serde(default)]
    pub process_id: Option<String>,
    #[serde(default)]
    pub node_type: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub agent_id: Option<String>,
    #[serde(default)]
    pub prompt: Option<String>,
    #[serde(default)]
    pub config: Option<Value>,
    #[serde(default)]
    pub position_x: Option<f64>,
    #[serde(default)]
    pub position_y: Option<f64>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageProcessNodeConnection {
    pub id: String,
    #[serde(default)]
    pub process_id: Option<String>,
    #[serde(default)]
    pub source_node_id: Option<String>,
    #[serde(default)]
    pub source_handle: Option<String>,
    #[serde(default)]
    pub target_node_id: Option<String>,
    #[serde(default)]
    pub target_handle: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageProcessRun {
    pub id: String,
    #[serde(default)]
    pub process_id: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub trigger: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default)]
    pub completed_at: Option<String>,
    #[serde(default)]
    pub total_input_tokens: Option<i64>,
    #[serde(default)]
    pub total_output_tokens: Option<i64>,
    #[serde(default)]
    pub cost_usd: Option<f64>,
    #[serde(default)]
    pub output: Option<String>,
    #[serde(default)]
    pub parent_run_id: Option<String>,
    #[serde(default)]
    pub input_override: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageProcessEvent {
    pub id: String,
    #[serde(default)]
    pub run_id: Option<String>,
    #[serde(default)]
    pub node_id: Option<String>,
    #[serde(default)]
    pub process_id: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub input_snapshot: Option<String>,
    #[serde(default)]
    pub output: Option<String>,
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default)]
    pub completed_at: Option<String>,
    #[serde(default)]
    pub input_tokens: Option<i64>,
    #[serde(default)]
    pub output_tokens: Option<i64>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub content_blocks: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageProcessArtifact {
    pub id: String,
    #[serde(default)]
    pub process_id: Option<String>,
    #[serde(default)]
    pub run_id: Option<String>,
    #[serde(default)]
    pub node_id: Option<String>,
    #[serde(default)]
    pub artifact_type: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub file_path: Option<String>,
    #[serde(default)]
    pub size_bytes: Option<i64>,
    #[serde(default)]
    pub metadata: Option<Value>,
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageProcessFolder {
    pub id: String,
    #[serde(default)]
    pub org_id: Option<String>,
    #[serde(default)]
    pub created_by: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

// Process request types

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProcessRequest {
    pub org_id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schedule: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProcessRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schedule: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_run_at: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_run_at: Option<Option<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProcessNodeRequest {
    pub node_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position_x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position_y: Option<f64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProcessNodeRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position_x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position_y: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProcessConnectionRequest {
    pub source_node_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_handle: Option<String>,
    pub target_node_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_handle: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProcessRunRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub process_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trigger: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_run_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_override: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProcessRunRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_input_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_output_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost_usd: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<Option<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProcessEventRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub run_id: String,
    pub node_id: String,
    pub process_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_snapshot: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProcessEventRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_blocks: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProcessArtifactRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub process_id: String,
    pub run_id: String,
    pub node_id: String,
    pub artifact_type: String,
    pub name: String,
    pub file_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProcessFolderRequest {
    pub org_id: String,
    pub name: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProcessFolderRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

// ---------------------------------------------------------------------------
// Project Stats
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStats {
    #[serde(default)]
    pub total_tasks: u64,
    #[serde(default)]
    pub pending_tasks: u64,
    #[serde(default)]
    pub ready_tasks: u64,
    #[serde(default)]
    pub in_progress_tasks: u64,
    #[serde(default)]
    pub blocked_tasks: u64,
    #[serde(default)]
    pub done_tasks: u64,
    #[serde(default)]
    pub failed_tasks: u64,
    #[serde(default)]
    pub completion_percentage: f64,
    #[serde(default)]
    pub total_tokens: u64,
    /// Sum of input tokens across all sessions. Some aura-storage deployments
    /// populate this (and `total_output_tokens`) alongside a zero or stale
    /// `total_tokens`; read them too so callers can fall back when needed.
    #[serde(default)]
    pub total_input_tokens: Option<u64>,
    #[serde(default)]
    pub total_output_tokens: Option<u64>,
    #[serde(default)]
    pub total_events: u64,
    #[serde(default)]
    pub total_agents: u64,
    #[serde(default)]
    pub total_sessions: u64,
    #[serde(default)]
    pub total_time_seconds: f64,
    #[serde(default)]
    pub lines_changed: u64,
    #[serde(default)]
    pub total_specs: u64,
    #[serde(default)]
    pub contributors: u64,
    #[serde(default)]
    pub estimated_cost_usd: f64,
}

// ---------------------------------------------------------------------------
// Project Agent types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageProjectAgent {
    pub id: String,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub org_id: Option<String>,
    #[serde(default)]
    pub agent_id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub personality: Option<String>,
    #[serde(default)]
    pub system_prompt: Option<String>,
    #[serde(default)]
    pub skills: Option<Vec<String>>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub harness: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub total_input_tokens: Option<u64>,
    #[serde(default)]
    pub total_output_tokens: Option<u64>,
    /// Snapshot of the parent Agent's permissions at instance-creation
    /// time. Persisted so a cold reload doesn't silently fall back to
    /// an empty bundle when the parent Agent lookup fails.
    #[serde(default)]
    pub permissions: Option<aura_os_core::AgentPermissions>,
    /// Snapshot of the parent Agent's intent classifier.
    #[serde(default)]
    pub intent_classifier: Option<aura_protocol::IntentClassifierSpec>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectAgentRequest {
    pub agent_id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub org_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub personality: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skills: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub harness: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permissions: Option<aura_os_core::AgentPermissions>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub intent_classifier: Option<aura_protocol::IntentClassifierSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectAgentRequest {
    pub status: String,
}

// ---------------------------------------------------------------------------
// Spec types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageSpec {
    pub id: String,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub org_id: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub order_index: Option<i32>,
    #[serde(default)]
    pub markdown_contents: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSpecRequest {
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub org_id: Option<String>,
    #[serde(default)]
    pub order_index: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub markdown_contents: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSpecRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order_index: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub markdown_contents: Option<String>,
}

// ---------------------------------------------------------------------------
// Task types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageTaskFileChangeSummary {
    pub op: String,
    pub path: String,
    #[serde(default)]
    pub lines_added: u32,
    #[serde(default)]
    pub lines_removed: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageTask {
    pub id: String,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub org_id: Option<String>,
    #[serde(default)]
    pub spec_id: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub order_index: Option<i32>,
    #[serde(default)]
    pub dependency_ids: Option<Vec<String>>,
    #[serde(default)]
    pub execution_notes: Option<String>,
    #[serde(default)]
    pub files_changed: Option<Vec<StorageTaskFileChangeSummary>>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub total_input_tokens: Option<u64>,
    #[serde(default)]
    pub total_output_tokens: Option<u64>,
    #[serde(default)]
    pub assigned_project_agent_id: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskRequest {
    pub spec_id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub org_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order_index: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dependency_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assigned_project_agent_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order_index: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dependency_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files_changed: Option<Vec<StorageTaskFileChangeSummary>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_input_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_output_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assigned_project_agent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransitionTaskRequest {
    pub status: String,
}

// ---------------------------------------------------------------------------
// Session types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageSession {
    pub id: String,
    #[serde(default)]
    pub project_agent_id: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub org_id: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default, alias = "contextUsage")]
    pub context_usage_estimate: Option<f64>,
    #[serde(default)]
    pub total_input_tokens: Option<u64>,
    #[serde(default)]
    pub total_output_tokens: Option<u64>,
    #[serde(default, alias = "summary")]
    pub summary_of_previous_context: Option<String>,
    #[serde(default)]
    pub tasks_worked_count: Option<u32>,
    #[serde(default)]
    pub ended_at: Option<String>,
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionRequest {
    pub project_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub org_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_usage_estimate: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary_of_previous_context: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSessionRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_input_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_output_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "contextUsage")]
    pub context_usage_estimate: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "summary")]
    pub summary_of_previous_context: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tasks_worked_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,
}

// ---------------------------------------------------------------------------
// Log Entry types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageLogEntry {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub org_id: Option<String>,
    #[serde(default)]
    pub level: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLogEntryRequest {
    pub level: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub org_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

// ---------------------------------------------------------------------------
// Session Event types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageSessionEvent {
    #[serde(alias = "eventId")]
    pub id: String,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub user_id: Option<String>,
    #[serde(default)]
    pub agent_id: Option<String>,
    #[serde(default)]
    pub sender: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub org_id: Option<String>,
    #[serde(default, rename = "type", alias = "eventType")]
    pub event_type: Option<String>,
    #[serde(default)]
    pub content: Option<serde_json::Value>,
    #[serde(default, alias = "timestamp")]
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionEventRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sender: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub org_id: Option<String>,
    #[serde(rename = "type")]
    pub event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<serde_json::Value>,
}
