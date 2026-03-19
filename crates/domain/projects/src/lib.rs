mod error;
pub use error::ProjectError;

use std::sync::Arc;

use chrono::{DateTime, Utc};

use aura_core::*;
use aura_network::NetworkClient;
use aura_store::RocksStore;

/// Convert NetworkProject to core Project (no local shadow).
fn network_project_to_core(net: &aura_network::NetworkProject) -> Project {
    let project_id = net
        .id
        .parse::<ProjectId>()
        .unwrap_or_else(|_| ProjectId::new());
    let org_id = net
        .org_id
        .parse::<OrgId>()
        .unwrap_or_else(|_| OrgId::new());
    let created_at = net
        .created_at
        .as_deref()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(Utc::now);
    let updated_at = net
        .updated_at
        .as_deref()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(Utc::now);

    Project {
        project_id,
        org_id,
        name: net.name.clone(),
        description: net.description.clone().unwrap_or_default(),
        linked_folder_path: net.folder.clone().unwrap_or_default(),
        requirements_doc_path: None,
        current_status: ProjectStatus::Active,
        build_command: None,
        test_command: None,
        specs_summary: None,
        specs_title: None,
        created_at,
        updated_at,
        git_repo_url: net.git_repo_url.clone(),
        git_branch: net.git_branch.clone(),
        orbit_base_url: net.orbit_base_url.clone(),
        orbit_owner: net.orbit_owner.clone(),
        orbit_repo: net.orbit_repo.clone(),
    }
}

#[derive(Debug, Clone)]
pub struct CreateProjectInput {
    pub org_id: OrgId,
    pub name: String,
    pub description: String,
    pub linked_folder_path: String,
    pub build_command: Option<String>,
    pub test_command: Option<String>,
    pub git_repo_url: Option<String>,
    pub git_branch: Option<String>,
    pub orbit_base_url: Option<String>,
    pub orbit_owner: Option<String>,
    pub orbit_repo: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct UpdateProjectInput {
    pub name: Option<String>,
    pub description: Option<String>,
    pub linked_folder_path: Option<String>,
    pub build_command: Option<String>,
    pub test_command: Option<String>,
    pub git_repo_url: Option<String>,
    pub git_branch: Option<String>,
    pub orbit_base_url: Option<String>,
    pub orbit_owner: Option<String>,
    pub orbit_repo: Option<String>,
}

pub struct ProjectService {
    network_client: Option<Arc<NetworkClient>>,
    store: Arc<RocksStore>,
}

impl ProjectService {
    pub fn new(network_client: Option<Arc<NetworkClient>>, store: Arc<RocksStore>) -> Self {
        Self {
            network_client,
            store,
        }
    }

    fn get_jwt(&self) -> Result<String, ProjectError> {
        let bytes = self
            .store
            .get_setting("zero_auth_session")
            .map_err(|_| ProjectError::NoSession)?;
        let session: ZeroAuthSession =
            serde_json::from_slice(&bytes).map_err(|_| ProjectError::NoSession)?;
        Ok(session.access_token)
    }

    /// Get project from aura-network only. Returns error if network is not configured or project not found.
    pub async fn get_project_async(&self, id: &ProjectId) -> Result<Project, ProjectError> {
        let client = self
            .network_client
            .as_ref()
            .ok_or(ProjectError::NetworkNotConfigured)?;
        let jwt = self.get_jwt()?;
        let net = client
            .get_project(&id.to_string(), &jwt)
            .await
            .map_err(|e| match &e {
                aura_network::NetworkError::Server { status: 404, .. } => ProjectError::NotFound(*id),
                _ => ProjectError::Network(e),
            })?;
        Ok(network_project_to_core(&net))
    }

    /// Update project on aura-network only.
    pub async fn update_project_async(
        &self,
        id: &ProjectId,
        input: UpdateProjectInput,
    ) -> Result<Project, ProjectError> {
        let client = self
            .network_client
            .as_ref()
            .ok_or(ProjectError::NetworkNotConfigured)?;
        let jwt = self.get_jwt()?;

        if let Some(ref name) = input.name {
            if name.trim().is_empty() {
                return Err(ProjectError::InvalidInput(
                    "project name must not be empty".into(),
                ));
            }
        }

        let folder = input
            .linked_folder_path
            .clone()
            .filter(|p| !p.is_empty());

        let net_req = aura_network::UpdateProjectRequest {
            name: input.name,
            description: input.description,
            folder,
            git_repo_url: input.git_repo_url,
            git_branch: input.git_branch,
            orbit_base_url: input.orbit_base_url,
            orbit_owner: input.orbit_owner,
            orbit_repo: input.orbit_repo,
        };

        let net = client
            .update_project(&id.to_string(), &jwt, &net_req)
            .await
            .map_err(ProjectError::Network)?;
        Ok(network_project_to_core(&net))
    }
}
