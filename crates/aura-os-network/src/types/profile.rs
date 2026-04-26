use aura_os_core::ProfileId;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkProfile {
    pub id: String,
    #[serde(alias = "display_name", alias = "name")]
    pub display_name: Option<String>,
    #[serde(alias = "avatar_url", alias = "avatarUrl", alias = "avatar")]
    pub avatar_url: Option<String>,
    pub bio: Option<String>,
    #[serde(rename = "type", alias = "profile_type", alias = "profileType")]
    pub profile_type: Option<String>,
    #[serde(default, alias = "entity_id", alias = "entityId")]
    pub entity_id: Option<String>,
    #[serde(default, alias = "user_id")]
    pub user_id: Option<String>,
    #[serde(default, alias = "agent_id")]
    pub agent_id: Option<String>,
}

impl NetworkProfile {
    pub fn profile_id_typed(&self) -> Option<ProfileId> {
        self.id.parse().ok().map(ProfileId::from_uuid)
    }
}
