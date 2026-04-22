use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

use crate::enums::{
    AgentStatus, ArtifactType, ChatRole, HarnessMode, ProcessEventStatus, ProcessNodeType,
    ProcessRunStatus, ProcessRunTrigger, ProjectStatus, SessionStatus, TaskStatus,
};
use crate::ids::{
    AgentId, AgentInstanceId, OrgId, ProcessArtifactId, ProcessEventId, ProcessFolderId, ProcessId,
    ProcessNodeConnectionId, ProcessNodeId, ProcessRunId, ProfileId, ProjectId, SessionEventId,
    SessionId, SpecId, TaskId, UserId,
};
use crate::listing_status::AgentListingStatus;
use crate::permissions::AgentPermissions;
use aura_protocol::IntentClassifierSpec;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Project {
    pub project_id: ProjectId,
    pub org_id: OrgId,
    pub name: String,
    pub description: String,
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
    /// Local-only, per-machine override for the project's working directory.
    /// Not synced to aura-network. When set, local agents run in this folder
    /// and the project terminal auto-loads here. Absolute OS path.
    #[serde(default)]
    pub local_workspace_path: Option<String>,
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

fn default_machine_type() -> String {
    "local".to_string()
}

fn default_adapter_type() -> String {
    "aura_harness".to_string()
}

fn default_environment() -> String {
    "local_host".to_string()
}

fn default_auth_source() -> String {
    "aura_managed".to_string()
}

fn default_org_integration_kind() -> OrgIntegrationKind {
    OrgIntegrationKind::WorkspaceConnection
}

fn default_org_integration_enabled() -> bool {
    true
}

pub fn effective_auth_source(
    adapter_type: &str,
    auth_source: Option<&str>,
    integration_id: Option<&str>,
) -> String {
    match auth_source.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => value.to_string(),
        None if adapter_type == "aura_harness" => "aura_managed".to_string(),
        None if integration_id.is_some() => "org_integration".to_string(),
        None => "local_cli_auth".to_string(),
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OrgIntegrationKind {
    WorkspaceConnection,
    WorkspaceIntegration,
    McpServer,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OrgIntegration {
    pub integration_id: String,
    pub org_id: OrgId,
    pub name: String,
    pub provider: String,
    #[serde(default = "default_org_integration_kind")]
    pub kind: OrgIntegrationKind,
    #[serde(default)]
    pub default_model: Option<String>,
    #[serde(default)]
    pub provider_config: Option<JsonValue>,
    #[serde(default)]
    pub has_secret: bool,
    #[serde(default = "default_org_integration_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub secret_last4: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentRuntimeConfig {
    #[serde(default = "default_adapter_type")]
    pub adapter_type: String,
    #[serde(default = "default_environment")]
    pub environment: String,
    #[serde(default = "default_auth_source")]
    pub auth_source: String,
    #[serde(default)]
    pub integration_id: Option<String>,
    #[serde(default)]
    pub default_model: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Agent {
    pub agent_id: AgentId,
    pub user_id: String,
    #[serde(default)]
    pub org_id: Option<OrgId>,
    #[serde(default)]
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
    #[serde(default = "default_adapter_type")]
    pub adapter_type: String,
    #[serde(default = "default_environment")]
    pub environment: String,
    #[serde(default = "default_auth_source")]
    pub auth_source: String,
    #[serde(default)]
    pub integration_id: Option<String>,
    #[serde(default)]
    pub default_model: Option<String>,
    #[serde(default)]
    pub vm_id: Option<String>,
    #[serde(default)]
    pub network_agent_id: Option<AgentId>,
    #[serde(default)]
    pub profile_id: Option<ProfileId>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub is_pinned: bool,
    /// Marketplace listing status. Defaults to [`AgentListingStatus::Closed`]
    /// so agents stay unlisted until their owner opts in.
    #[serde(default)]
    pub listing_status: AgentListingStatus,
    /// Marketplace expertise slugs (see [`crate::expertise::ALLOWED_SLUGS`]).
    /// Unknown slugs are filtered out by the server on ingest.
    #[serde(default)]
    pub expertise: Vec<String>,
    /// Aggregated marketplace stats. Computed server-side and surfaced in
    /// API responses; clients should not write these directly.
    #[serde(default)]
    pub jobs: u64,
    #[serde(default)]
    pub revenue_usd: f64,
    #[serde(default)]
    pub reputation: f32,
    /// Local-only override for the agent's working directory, applied only when
    /// running on a local machine. Takes precedence over the project's
    /// `local_workspace_path`. Not synced to aura-network.
    #[serde(default)]
    pub local_workspace_path: Option<String>,
    /// Required capability + scope bundle. The harness enforces these
    /// unconditionally on every session — there is no role-based
    /// fallback. Regular agents carry [`AgentPermissions::empty`]; CEO
    /// bootstraps carry [`AgentPermissions::ceo_preset`].
    pub permissions: AgentPermissions,
    /// Optional per-turn intent classifier. When present the harness
    /// narrows the per-turn tool surface based on each user message.
    /// Populated for CEO-style agents; `None` for regular agents.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub intent_classifier: Option<IntentClassifierSpec>,
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
    #[serde(default)]
    pub org_id: Option<OrgId>,
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
    #[serde(default = "default_adapter_type")]
    pub adapter_type: String,
    #[serde(default = "default_environment")]
    pub environment: String,
    #[serde(default = "default_auth_source")]
    pub auth_source: String,
    #[serde(default)]
    pub integration_id: Option<String>,
    #[serde(default)]
    pub default_model: Option<String>,
    #[serde(default)]
    pub workspace_path: Option<String>,
    pub status: AgentStatus,
    pub current_task_id: Option<TaskId>,
    pub current_session_id: Option<SessionId>,
    #[serde(default)]
    pub total_input_tokens: u64,
    #[serde(default)]
    pub total_output_tokens: u64,
    #[serde(default)]
    pub model: Option<String>,
    /// Snapshot of the parent Agent's permissions at instance-creation
    /// time. The harness enforces these unconditionally for any session
    /// opened against this instance. Persisted via the storage DTO so a
    /// cold reload doesn't silently fall back to an empty bundle when
    /// the parent Agent lookup fails (e.g. offline / network error).
    #[serde(default)]
    pub permissions: AgentPermissions,
    /// Snapshot of the parent Agent's intent classifier, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub intent_classifier: Option<IntentClassifierSpec>,
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
    #[serde(default)]
    pub is_access_granted: bool,
    pub created_at: DateTime<Utc>,
    pub validated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentOrchestration {
    pub orchestration_id: uuid::Uuid,
    pub agent_id: AgentId,
    pub org_id: OrgId,
    pub intent: String,
    pub plan: Vec<AgentOrchestrationStep>,
    pub status: crate::enums::OrchestrationStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentOrchestrationStep {
    pub step_index: u32,
    pub tool_name: String,
    pub tool_input: serde_json::Value,
    pub status: crate::enums::StepStatus,
    pub result: Option<serde_json::Value>,
}

// ---------------------------------------------------------------------------
// Process workflow entities
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Integration config (per-org)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct ObsidianConfig {
    #[serde(default)]
    pub vault_path: Option<String>,
    #[serde(default)]
    pub default_output_folder: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct WebSearchConfig {
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub api_key_set: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IntegrationConfig {
    pub org_id: OrgId,
    #[serde(default)]
    pub obsidian: Option<ObsidianConfig>,
    #[serde(default)]
    pub web_search: Option<WebSearchConfig>,
    pub updated_at: DateTime<Utc>,
}
