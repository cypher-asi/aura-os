use aura_os_core::*;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

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
}

#[derive(Debug, Deserialize)]
pub(crate) struct TransitionTaskRequest {
    pub new_status: TaskStatus,
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
}

// -- AgentInstance DTOs (project-level) --

#[derive(Debug, Deserialize)]
pub(crate) struct CreateAgentInstanceRequest {
    pub agent_id: AgentId,
}

#[derive(Debug, Deserialize)]
pub(crate) struct UpdateAgentInstanceRequest {
    pub status: Option<String>,
}

// -- Chat DTOs --

#[derive(Debug, Deserialize)]
pub(crate) struct SendChatRequest {
    pub content: String,
    pub action: Option<String>,
    pub model: Option<String>,
    pub commands: Option<Vec<String>>,
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

#[derive(Debug, Deserialize)]
pub(crate) struct CreateOrgIntegrationRequest {
    pub name: String,
    pub provider: String,
    #[serde(default)]
    pub default_model: Option<String>,
    #[serde(default)]
    pub api_key: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct UpdateOrgIntegrationRequest {
    pub name: Option<String>,
    pub provider: Option<String>,
    #[serde(default)]
    pub default_model: Option<Option<String>>,
    #[serde(default)]
    pub api_key: Option<Option<String>>,
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
