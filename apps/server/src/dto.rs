use aura_core::*;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct SetSettingRequest {
    pub value: String,
}

#[derive(Debug, Serialize)]
pub struct GetSettingResponse {
    pub key: String,
    pub value: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateProjectRequest {
    pub org_id: OrgId,
    pub name: String,
    pub description: String,
    pub linked_folder_path: String,
    pub workspace_source: Option<String>,
    pub workspace_display_path: Option<String>,
    pub github_integration_id: Option<GitHubIntegrationId>,
    pub github_repo_full_name: Option<String>,
    pub build_command: Option<String>,
    pub test_command: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProjectRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub linked_folder_path: Option<String>,
    pub workspace_source: Option<String>,
    pub workspace_display_path: Option<String>,
    pub github_integration_id: Option<GitHubIntegrationId>,
    pub github_repo_full_name: Option<String>,
    pub build_command: Option<String>,
    pub test_command: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ImportedProjectFile {
    pub relative_path: String,
    pub contents_base64: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateImportedProjectRequest {
    pub org_id: OrgId,
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub files: Vec<ImportedProjectFile>,
    pub build_command: Option<String>,
    pub test_command: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TransitionTaskRequest {
    pub new_status: TaskStatus,
}

#[derive(Debug, Serialize)]
pub struct LoopStatusResponse {
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
pub struct CreateAgentRequest {
    pub name: String,
    pub role: String,
    pub personality: String,
    pub system_prompt: String,
    #[serde(default)]
    pub skills: Vec<String>,
    pub icon: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateAgentRequest {
    pub name: Option<String>,
    pub role: Option<String>,
    pub personality: Option<String>,
    pub system_prompt: Option<String>,
    pub skills: Option<Vec<String>>,
    pub icon: Option<Option<String>>,
}

// -- AgentInstance DTOs (project-level) --

#[derive(Debug, Deserialize)]
pub struct CreateAgentInstanceRequest {
    pub agent_id: AgentId,
}

#[derive(Debug, Deserialize)]
pub struct UpdateAgentInstanceRequest {
    pub name: Option<String>,
    pub role: Option<String>,
    pub personality: Option<String>,
    pub system_prompt: Option<String>,
}

// -- Message DTOs --

#[derive(Debug, Deserialize)]
pub struct SendMessageRequest {
    pub content: String,
    pub action: Option<String>,
    #[serde(default)]
    pub attachments: Option<Vec<aura_chat::ChatAttachment>>,
}

#[derive(Debug, Deserialize)]
pub struct AuthLoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct AuthRegisterRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct AuthSessionResponse {
    pub user_id: String,
    pub display_name: String,
    pub profile_image: String,
    pub primary_zid: String,
    pub zero_wallet: String,
    pub wallets: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub validated_at: DateTime<Utc>,
}

// -- Org DTOs --

#[derive(Debug, Deserialize)]
pub struct CreateOrgRequest {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateOrgRequest {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateMemberRoleRequest {
    pub role: aura_core::OrgRole,
}

#[derive(Debug, Deserialize)]
pub struct SetBillingRequest {
    pub billing_email: Option<String>,
    pub plan: String,
}

#[derive(Debug, Deserialize)]
pub struct SetGithubRequest {
    pub github_org: String,
}

#[derive(Debug, Serialize)]
pub struct GitHubInstallResponse {
    pub install_url: String,
}

#[derive(Debug, Serialize)]
pub struct GitHubIntegrationResponse {
    pub integration_id: String,
    pub org_id: String,
    pub installation_id: i64,
    pub github_account_login: String,
    pub github_account_type: String,
    pub connected_by: String,
    pub connected_at: DateTime<Utc>,
    pub repo_count: usize,
}

#[derive(Debug, Serialize)]
pub struct GitHubRepoResponse {
    pub github_repo_id: i64,
    pub integration_id: String,
    pub full_name: String,
    pub name: String,
    pub private: bool,
    pub default_branch: String,
    pub html_url: String,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct GitHubCallbackQuery {
    pub installation_id: i64,
    pub setup_action: Option<String>,
    pub state: Option<String>,
}

impl GitHubIntegrationResponse {
    pub fn from_integration(int: GitHubIntegration, repo_count: usize) -> Self {
        Self {
            integration_id: int.integration_id.to_string(),
            org_id: int.org_id.to_string(),
            installation_id: int.installation_id,
            github_account_login: int.github_account_login,
            github_account_type: int.github_account_type,
            connected_by: int.connected_by,
            connected_at: int.connected_at,
            repo_count,
        }
    }
}

impl From<GitHubRepo> for GitHubRepoResponse {
    fn from(repo: GitHubRepo) -> Self {
        Self {
            github_repo_id: repo.github_repo_id,
            integration_id: repo.integration_id.to_string(),
            full_name: repo.full_name,
            name: repo.name,
            private: repo.private,
            default_branch: repo.default_branch,
            html_url: repo.html_url,
            updated_at: repo.updated_at,
        }
    }
}

// -- Follow DTOs --

#[derive(Debug, Deserialize)]
pub struct FollowRequest {
    pub target_type: FollowTargetType,
    pub target_id: String,
}

#[derive(Debug, Serialize)]
pub struct FollowCheckResponse {
    pub following: bool,
}

// -- Billing/Credits DTOs --

#[derive(Debug, Deserialize)]
pub struct CreateCreditCheckoutRequest {
    pub tier_id: Option<String>,
    pub credits: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct FulfillmentWebhookRequest {
    #[serde(alias = "entityId")]
    pub entity_id: String,
    pub credits: u64,
    #[serde(alias = "purchaseId")]
    pub purchase_id: String,
}

#[derive(Debug, Serialize)]
pub struct FulfillmentWebhookResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl From<ZeroAuthSession> for AuthSessionResponse {
    fn from(s: ZeroAuthSession) -> Self {
        Self {
            user_id: s.user_id,
            display_name: s.display_name,
            profile_image: s.profile_image,
            primary_zid: s.primary_zid,
            zero_wallet: s.zero_wallet,
            wallets: s.wallets,
            created_at: s.created_at,
            validated_at: s.validated_at,
        }
    }
}
