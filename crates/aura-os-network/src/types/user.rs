use aura_os_core::{ProfileId, UserId};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkUser {
    pub id: String,
    #[serde(default, alias = "zos_user_id", alias = "zeroUserId")]
    pub zos_user_id: Option<String>,
    #[serde(alias = "display_name", alias = "name")]
    pub display_name: Option<String>,
    #[serde(
        default,
        rename = "profileImage",
        alias = "avatar_url",
        alias = "avatarUrl"
    )]
    pub avatar_url: Option<String>,
    pub bio: Option<String>,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub website: Option<String>,
    #[serde(alias = "profile_id")]
    pub profile_id: Option<String>,
    #[serde(default)]
    pub is_access_granted: bool,
    #[serde(default, alias = "created_at")]
    pub created_at: Option<String>,
    #[serde(default, alias = "updated_at")]
    pub updated_at: Option<String>,
}

impl NetworkUser {
    pub fn user_id_typed(&self) -> Option<UserId> {
        self.id.parse().ok().map(UserId::from_uuid)
    }
    pub fn profile_id_typed(&self) -> Option<ProfileId> {
        self.profile_id
            .as_ref()?
            .parse()
            .ok()
            .map(ProfileId::from_uuid)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateUserRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "profileImage")]
    pub avatar_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bio: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub website: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn network_user_accepts_snake_case_aliases() {
        let user: NetworkUser = serde_json::from_value(serde_json::json!({
            "id": "00000000-0000-0000-0000-000000000001",
            "zos_user_id": "zero-user",
            "display_name": "Ada",
            "avatar_url": "https://example.test/avatar.png"
        }))
        .expect("network user should deserialize alias payload");

        assert_eq!(user.zos_user_id.as_deref(), Some("zero-user"));
        assert_eq!(user.display_name.as_deref(), Some("Ada"));
        assert_eq!(
            user.avatar_url.as_deref(),
            Some("https://example.test/avatar.png")
        );
        assert!(user.user_id_typed().is_some());
    }
}
