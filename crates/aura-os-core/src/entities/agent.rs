use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

use crate::enums::{AgentInstanceRole, AgentStatus, HarnessMode};
use crate::ids::{AgentId, AgentInstanceId, OrgId, ProfileId, ProjectId, SessionId, TaskId};
use crate::listing_status::AgentListingStatus;
use crate::permissions::AgentPermissions;
use aura_protocol::IntentClassifierSpec;

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
    _adapter_type: &str,
    auth_source: Option<&str>,
    _integration_id: Option<&str>,
) -> String {
    match auth_source.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => value.to_string(),
        None => "aura_managed".to_string(),
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
    /// fallback. Ordinary agents may carry [`AgentPermissions::full_access`];
    /// the CEO bootstrap identity is tracked separately by name/role and the
    /// persisted bootstrap agent id.
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
    /// Functional role this instance plays in the project (chat target,
    /// automation loop target, or an ephemeral per-task executor).
    /// Defaults to [`AgentInstanceRole::Chat`] so legacy rows without
    /// the field stay on the chat surface — see the enum docs for the
    /// full multi-instance rationale.
    #[serde(default)]
    pub instance_role: AgentInstanceRole,
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
