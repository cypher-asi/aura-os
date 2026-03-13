use aura_core::*;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct SetApiKeyRequest {
    pub api_key: String,
}

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
    pub name: String,
    pub description: String,
    pub linked_folder_path: String,
    pub requirements_doc_path: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProjectRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub linked_folder_path: Option<String>,
    pub requirements_doc_path: Option<String>,
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
    pub created_at: String,
    pub validated_at: String,
}

impl From<aura_core::ZeroAuthSession> for AuthSessionResponse {
    fn from(s: aura_core::ZeroAuthSession) -> Self {
        Self {
            user_id: s.user_id,
            display_name: s.display_name,
            profile_image: s.profile_image,
            primary_zid: s.primary_zid,
            zero_wallet: s.zero_wallet,
            wallets: s.wallets,
            created_at: s.created_at.to_rfc3339(),
            validated_at: s.validated_at.to_rfc3339(),
        }
    }
}
