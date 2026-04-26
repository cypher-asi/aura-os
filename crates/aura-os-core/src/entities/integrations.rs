use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::ids::OrgId;

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
