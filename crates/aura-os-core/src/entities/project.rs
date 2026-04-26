use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::enums::ProjectStatus;
use crate::ids::{OrgId, ProjectId, SpecId};

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
