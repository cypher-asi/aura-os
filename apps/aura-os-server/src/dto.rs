use aura_os_core::*;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Deserializer, Serialize};

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct CreateProjectRequest {
    pub org_id: OrgId,
    pub name: String,
    pub description: String,
    pub build_command: Option<String>,
    pub test_command: Option<String>,
    pub git_repo_url: Option<String>,
    pub git_branch: Option<String>,
    pub orbit_base_url: Option<String>,
    pub orbit_owner: Option<String>,
    pub orbit_repo: Option<String>,
    /// Local-only, per-machine project working directory. Absolute OS path.
    #[serde(default)]
    pub local_workspace_path: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct UpdateProjectRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub build_command: Option<String>,
    pub test_command: Option<String>,
    pub git_repo_url: Option<String>,
    pub git_branch: Option<String>,
    pub orbit_base_url: Option<String>,
    pub orbit_owner: Option<String>,
    pub orbit_repo: Option<String>,
    /// Patch for the local workspace folder.
    /// - Absent: leaves the stored value unchanged.
    /// - `Some("")` or `Some(null)` (via `Some(None)`): clears the override.
    /// - `Some(Some("..."))`: sets a new path.
    #[serde(default, deserialize_with = "deserialize_patch_option")]
    pub local_workspace_path: Option<Option<String>>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ImportedProjectFile {
    pub relative_path: String,
    pub contents_base64: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CreateImportedProjectRequest {
    pub org_id: OrgId,
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub files: Vec<ImportedProjectFile>,
    pub build_command: Option<String>,
    pub test_command: Option<String>,
    pub git_repo_url: Option<String>,
    pub git_branch: Option<String>,
    pub orbit_base_url: Option<String>,
    pub orbit_owner: Option<String>,
    pub orbit_repo: Option<String>,
    #[serde(default)]
    pub local_workspace_path: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct TransitionTaskRequest {
    pub new_status: TaskStatus,
}

#[derive(Debug, Serialize)]
pub(crate) struct ActiveLoopTask {
    pub task_id: String,
    pub agent_instance_id: AgentInstanceId,
}

#[derive(Debug, Serialize)]
pub(crate) struct LoopStatusResponse {
    pub running: bool,
    pub paused: bool,
    pub project_id: Option<ProjectId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_instance_id: Option<AgentInstanceId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_agent_instances: Option<Vec<AgentInstanceId>>,
    /// Per-agent tasks currently streaming output. Set from the
    /// automaton registry's `current_task_id` so clients can rehydrate
    /// the Run panel and per-task "live" indicators after a page
    /// refresh (WS `task_started` events are not replayed, so this is
    /// the only HTTP path that exposes "what task is running right
    /// now"). Empty / absent when no automatons are working a task.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_tasks: Option<Vec<ActiveLoopTask>>,
}

// -- Agent DTOs (user-level) --

#[derive(Debug, Deserialize)]
pub(crate) struct CreateAgentRequest {
    #[serde(default)]
    pub org_id: Option<OrgId>,
    pub name: String,
    pub role: String,
    pub personality: String,
    pub system_prompt: String,
    #[serde(default)]
    pub skills: Vec<String>,
    pub icon: Option<String>,
    #[serde(default)]
    pub machine_type: Option<String>,
    #[serde(default)]
    pub adapter_type: Option<String>,
    #[serde(default)]
    pub environment: Option<String>,
    #[serde(default)]
    pub auth_source: Option<String>,
    #[serde(default)]
    pub integration_id: Option<String>,
    #[serde(default)]
    pub default_model: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    /// Marketplace discoverability: `closed` (default) or `hireable`. Encoded
    /// as a `listing_status:<value>` tag on the stored agent until Phase 3
    /// promotes it to a dedicated column on the network agent record.
    #[serde(default)]
    pub listing_status: Option<String>,
    /// Marketplace expertise slugs. Validated against
    /// [`aura_os_core::expertise::ALLOWED_SLUGS`] and persisted as
    /// `expertise:<slug>` tags. Dedupe is applied server-side.
    #[serde(default)]
    pub expertise: Option<Vec<String>>,
    /// Per-agent local working directory override (absolute path). Applied only
    /// for local machines; takes precedence over the project's folder.
    #[serde(default)]
    pub local_workspace_path: Option<String>,
    /// Required capability + scope bundle for the new agent. Regular
    /// agents pass [`aura_os_core::AgentPermissions::empty`]; the CEO
    /// bootstrap passes [`aura_os_core::AgentPermissions::ceo_preset`].
    pub permissions: aura_os_core::AgentPermissions,
    /// Optional intent classifier spec (CEO-style agents only).
    #[serde(default)]
    pub intent_classifier: Option<aura_os_core::IntentClassifierSpec>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct UpdateAgentRequest {
    pub name: Option<String>,
    pub role: Option<String>,
    pub personality: Option<String>,
    pub system_prompt: Option<String>,
    pub skills: Option<Vec<String>>,
    pub icon: Option<Option<String>>,
    pub machine_type: Option<String>,
    #[serde(default)]
    pub adapter_type: Option<String>,
    #[serde(default)]
    pub environment: Option<String>,
    #[serde(default)]
    pub auth_source: Option<String>,
    #[serde(default)]
    pub integration_id: Option<Option<String>>,
    #[serde(default)]
    pub default_model: Option<Option<String>>,
    /// Replacement tag set. `None` leaves existing tags untouched; `Some` overwrites.
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    /// Marketplace discoverability override. `None` leaves the existing
    /// `listing_status:*` tag untouched; `Some(value)` replaces it.
    #[serde(default)]
    pub listing_status: Option<String>,
    /// Replacement expertise set. `None` leaves existing `expertise:*` tags
    /// untouched; `Some` replaces all of them.
    #[serde(default)]
    pub expertise: Option<Vec<String>>,
    /// `None` leaves the value unchanged. `Some(None)` clears the override.
    /// `Some(Some("..."))` sets a new path.
    #[serde(default, deserialize_with = "deserialize_patch_option")]
    pub local_workspace_path: Option<Option<String>>,
    /// Optional replacement for the agent's capability bundle. `None`
    /// leaves the existing permissions untouched.
    #[serde(default)]
    pub permissions: Option<aura_os_core::AgentPermissions>,
    /// Optional replacement for the intent classifier spec. `None` leaves
    /// the existing value untouched.
    #[serde(default)]
    pub intent_classifier: Option<aura_os_core::IntentClassifierSpec>,
}

// -- Marketplace DTOs --

#[derive(Debug, Clone, Serialize)]
pub(crate) struct MarketplaceAgent {
    pub agent: Agent,
    pub description: String,
    pub jobs: u64,
    pub revenue_usd: f64,
    pub reputation: f32,
    pub creator_display_name: String,
    pub creator_user_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_image_url: Option<String>,
    pub listed_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct ListMarketplaceAgentsQuery {
    #[serde(default)]
    pub sort: Option<String>,
    #[serde(default)]
    pub expertise: Option<String>,
    #[serde(default)]
    pub limit: Option<u32>,
    #[serde(default)]
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct ListMarketplaceAgentsResponse {
    pub agents: Vec<MarketplaceAgent>,
    pub total: u64,
}

// -- AgentInstance DTOs (project-level) --

#[derive(Debug, Deserialize)]
pub(crate) struct CreateAgentInstanceRequest {
    #[serde(default)]
    pub agent_id: Option<AgentId>,
    #[serde(default)]
    pub kind: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct UpdateAgentInstanceRequest {
    pub name: Option<String>,
    pub status: Option<String>,
}

// -- Chat DTOs --

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct ChatAttachmentDto {
    #[serde(rename = "type")]
    pub type_: String,
    pub media_type: String,
    pub data: String,
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SendChatRequest {
    pub content: String,
    pub action: Option<String>,
    pub model: Option<String>,
    pub commands: Option<Vec<String>>,
    pub project_id: Option<String>,
    #[serde(default)]
    pub attachments: Option<Vec<ChatAttachmentDto>>,
    #[serde(default)]
    pub new_session: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct GenerateImageRequest {
    pub prompt: String,
    pub model: Option<String>,
    pub size: Option<String>,
    #[serde(default)]
    pub images: Option<Vec<String>>,
    #[serde(rename = "projectId")]
    pub project_id: Option<String>,
    #[serde(rename = "isIteration")]
    pub is_iteration: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct Generate3dRequest {
    pub image_url: String,
    pub prompt: Option<String>,
    #[serde(rename = "projectId")]
    pub project_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct AgentRuntimeTestResponse {
    pub ok: bool,
    pub adapter_type: String,
    pub environment: String,
    pub auth_source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub integration_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub integration_name: Option<String>,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct AuthLoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct AuthRegisterRequest {
    pub email: String,
    pub password: String,
    pub name: String,
    pub invite_code: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct PasswordResetRequest {
    pub email: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ImportAccessTokenRequest {
    pub access_token: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct AuthSessionResponse {
    pub user_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub network_user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<String>,
    pub display_name: String,
    pub profile_image: String,
    pub primary_zid: String,
    pub zero_wallet: String,
    pub wallets: Vec<String>,
    pub is_zero_pro: bool,
    pub is_access_granted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zero_pro_refresh_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub access_token: Option<String>,
    pub created_at: DateTime<Utc>,
    pub validated_at: DateTime<Utc>,
}

// -- Org DTOs --

#[derive(Debug, Deserialize)]
pub(crate) struct CreateOrgRequest {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct UpdateOrgRequest {
    pub name: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub(crate) struct CreateOrgIntegrationRequest {
    pub name: String,
    pub provider: String,
    #[serde(default = "default_org_integration_kind")]
    pub kind: aura_os_core::OrgIntegrationKind,
    #[serde(default)]
    pub default_model: Option<String>,
    #[serde(default)]
    pub provider_config: Option<serde_json::Value>,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub enabled: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize)]
pub(crate) struct UpdateOrgIntegrationRequest {
    pub name: Option<String>,
    pub provider: Option<String>,
    #[serde(default)]
    pub kind: Option<aura_os_core::OrgIntegrationKind>,
    #[serde(default, deserialize_with = "deserialize_patch_option")]
    pub default_model: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_patch_option")]
    pub provider_config: Option<Option<serde_json::Value>>,
    #[serde(default, deserialize_with = "deserialize_patch_option")]
    pub api_key: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_patch_option")]
    pub enabled: Option<Option<bool>>,
}

fn default_org_integration_kind() -> aura_os_core::OrgIntegrationKind {
    aura_os_core::OrgIntegrationKind::WorkspaceConnection
}

fn deserialize_patch_option<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(Some(Option::<T>::deserialize(deserializer)?))
}

#[derive(Debug, Deserialize)]
pub(crate) struct UpdateMemberRoleRequest {
    pub role: aura_os_core::OrgRole,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SetBillingRequest {
    pub billing_email: Option<String>,
    pub plan: String,
}

// -- Follow DTOs --

#[derive(Debug, Deserialize)]
pub(crate) struct FollowRequest {
    pub target_profile_id: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct FollowCheckResponse {
    pub following: bool,
}

// -- Billing/Credits DTOs --

#[derive(Debug, Deserialize)]
pub(crate) struct CreateCreditCheckoutRequest {
    pub amount_usd: f64,
}

impl From<ZeroAuthSession> for AuthSessionResponse {
    fn from(s: ZeroAuthSession) -> Self {
        let token = s.access_token.clone();
        Self {
            user_id: s.user_id,
            network_user_id: s.network_user_id.map(|id| id.to_string()),
            profile_id: s.profile_id.map(|id| id.to_string()),
            display_name: s.display_name,
            profile_image: s.profile_image,
            primary_zid: s.primary_zid,
            zero_wallet: s.zero_wallet,
            wallets: s.wallets,
            is_zero_pro: s.is_zero_pro,
            is_access_granted: s.is_access_granted,
            zero_pro_refresh_error: None,
            access_token: Some(token),
            created_at: s.created_at,
            validated_at: s.validated_at,
        }
    }
}

impl AuthSessionResponse {
    pub(crate) fn from_auth_result(result: aura_os_auth::AuthSessionResult) -> Self {
        let mut response = Self::from(result.session);
        response.zero_pro_refresh_error = result.zero_pro_refresh_error;
        response
    }
}
