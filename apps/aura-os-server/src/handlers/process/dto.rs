use serde::{Deserialize, Serialize};

use aura_os_core::ProcessNodeType;

#[derive(Deserialize)]
pub(crate) struct CreateProcessRequest {
    pub name: String,
    pub description: Option<String>,
    pub project_id: String,
    pub folder_id: Option<String>,
    pub schedule: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Deserialize)]
pub(crate) struct UpdateProcessRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub project_id: Option<Option<String>>,
    pub folder_id: Option<Option<String>>,
    pub schedule: Option<String>,
    pub tags: Option<Vec<String>>,
    pub enabled: Option<bool>,
}

#[derive(Deserialize)]
pub(crate) struct CreateFolderRequest {
    pub name: String,
    pub org_id: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct UpdateFolderRequest {
    pub name: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct CreateNodeRequest {
    pub node_type: ProcessNodeType,
    pub label: String,
    pub agent_id: Option<String>,
    #[serde(default)]
    pub prompt: String,
    #[serde(default)]
    pub config: serde_json::Value,
    #[serde(default)]
    pub position_x: f64,
    #[serde(default)]
    pub position_y: f64,
}

#[derive(Deserialize)]
pub(crate) struct UpdateNodeRequest {
    pub label: Option<String>,
    pub agent_id: Option<String>,
    pub prompt: Option<String>,
    pub config: Option<serde_json::Value>,
    pub position_x: Option<f64>,
    pub position_y: Option<f64>,
}

#[derive(Deserialize)]
pub(crate) struct CreateConnectionRequest {
    pub source_node_id: String,
    pub source_handle: Option<String>,
    pub target_node_id: String,
    pub target_handle: Option<String>,
}

#[derive(Serialize)]
pub(crate) struct DeleteResponse {
    pub deleted: bool,
}
