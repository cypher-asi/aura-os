use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageSkill {
    pub id: String,
    #[serde(default)]
    pub org_id: Option<String>,
    pub created_by: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub allowed_tools: Vec<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub context: Option<String>,
    #[serde(default = "default_true")]
    pub user_invocable: bool,
    #[serde(default)]
    pub model_invocable: bool,
    #[serde(default)]
    pub agent_target: Option<serde_json::Value>,
    pub revision: i64,
    pub content_hash: String,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub deleted_at: Option<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateStorageSkillRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub org_id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub allowed_tools: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
    pub user_invocable: bool,
    pub model_invocable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_target: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStorageSkillRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allowed_tools: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_invocable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_invocable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_target: Option<Option<serde_json::Value>>,
    pub expected_revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageAgentSkillAssignment {
    pub id: String,
    pub skill_id: String,
    pub agent_id: String,
    #[serde(default)]
    pub org_id: Option<String>,
    pub created_by: String,
    #[serde(default)]
    pub created_at: Option<String>,
}
