mod error;
pub use error::ProjectError;

use std::path::Path;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use tracing::debug;

use aura_core::*;
use aura_network::NetworkClient;
use aura_store::RocksStore;

fn network_project_to_core(
    net: &aura_network::NetworkProject,
    local: Option<&Project>,
) -> Project {
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

    let folder = net.folder.clone().unwrap_or_default();
    debug!(
        project_id = %net.id,
        name = %net.name,
        network_folder = ?net.folder,
        resolved_folder = %folder,
        "network_project_to_core"
    );

    Project {
        project_id,
        org_id,
        name: net.name.clone(),
        description: net
            .description
            .clone()
            .or_else(|| local.map(|project| project.description.clone()))
            .unwrap_or_default(),
        linked_folder_path: local
            .map(|project| project.linked_folder_path.clone())
            .unwrap_or_else(|| net.folder.clone().unwrap_or_default()),
        workspace_source: local.and_then(|project| project.workspace_source.clone()),
        workspace_display_path: local.and_then(|project| project.workspace_display_path.clone()),
        requirements_doc_path: local.and_then(|project| project.requirements_doc_path.clone()),
        current_status: local
            .map(|project| project.current_status)
            .unwrap_or(ProjectStatus::Active),
        build_command: local.and_then(|project| project.build_command.clone()),
        test_command: local.and_then(|project| project.test_command.clone()),
        specs_summary: local.and_then(|project| project.specs_summary.clone()),
        specs_title: local.and_then(|project| project.specs_title.clone()),
        created_at,
        updated_at,
        git_repo_url: net
            .git_repo_url
            .clone()
            .or_else(|| local.and_then(|project| project.git_repo_url.clone())),
        git_branch: net
            .git_branch
            .clone()
            .or_else(|| local.and_then(|project| project.git_branch.clone())),
        orbit_base_url: net
            .orbit_base_url
            .clone()
            .or_else(|| local.and_then(|project| project.orbit_base_url.clone())),
        orbit_owner: net
            .orbit_owner
            .clone()
            .or_else(|| local.and_then(|project| project.orbit_owner.clone())),
        orbit_repo: net
            .orbit_repo
            .clone()
            .or_else(|| local.and_then(|project| project.orbit_repo.clone())),
    }
}

fn sanitize_shell_command(cmd: &str) -> String {
    let trimmed = cmd.trim();
    if trimmed.is_empty() {
        return trimmed.to_string();
    }

    let trailing_phrases: &[&str] = &[
        " in order to ",
        " so that ",
        " which will ",
        " that will ",
        " to confirm ",
        " to verify ",
        " to check ",
        " to ensure ",
        " to validate ",
        " to test ",
        " to see ",
        " to make sure ",
        " to run ",
        " to build ",
        " to compile ",
        " for confirming ",
        " for verifying ",
        " for checking ",
    ];

    let lower = trimmed.to_lowercase();
    for phrase in trailing_phrases {
        if let Some(idx) = lower.find(phrase) {
            return trimmed[..idx].trim_end().to_string();
        }
    }

    if let Some(idx) = lower.rfind(" to ") {
        let after = &lower[idx + 4..];
        let first_word = after.split_whitespace().next().unwrap_or("");
        let non_command_verbs = [
            "confirm",
            "verify",
            "check",
            "ensure",
            "validate",
            "test",
            "see",
            "make",
            "run",
            "build",
            "compile",
            "show",
            "prove",
            "demonstrate",
            "try",
            "attempt",
        ];
        if non_command_verbs.contains(&first_word) {
            return trimmed[..idx].trim_end().to_string();
        }
    }

    trimmed.to_string()
}

fn rewrite_server_commands(cmd: &str) -> String {
    let trimmed = cmd.trim();
    if trimmed == "cargo run" || trimmed.starts_with("cargo run ") {
        return trimmed.replacen("cargo run", "cargo build", 1);
    }
    if trimmed == "npm start" {
        return "npm run build".to_string();
    }
    trimmed.to_string()
}

fn sanitize_command_option(cmd: Option<String>) -> Option<String> {
    cmd.map(|c| {
        let sanitized = sanitize_shell_command(&c);
        let sanitized = if sanitized.is_empty() { c } else { sanitized };
        rewrite_server_commands(&sanitized)
    })
}

#[derive(Debug, Clone)]
pub struct CreateProjectInput {
    pub org_id: OrgId,
    pub name: String,
    pub description: String,
    pub linked_folder_path: String,
    pub workspace_source: Option<String>,
    pub workspace_display_path: Option<String>,
    pub build_command: Option<String>,
    pub test_command: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct UpdateProjectInput {
    pub name: Option<String>,
    pub description: Option<String>,
    pub linked_folder_path: Option<String>,
    pub workspace_source: Option<String>,
    pub workspace_display_path: Option<String>,
    pub build_command: Option<String>,
    pub test_command: Option<String>,
}

pub struct ProjectService {
    network_client: Option<Arc<NetworkClient>>,
    store: Arc<RocksStore>,
}

impl ProjectService {
    fn project_key(project_id: &ProjectId) -> String {
        format!("project:{project_id}")
    }

    pub fn save_project_shadow(&self, project: &Project) -> Result<(), ProjectError> {
        let payload = serde_json::to_vec(project)
            .map_err(|err| ProjectError::InvalidInput(err.to_string()))?;
        self.store
            .put_setting(&Self::project_key(&project.project_id), &payload)
            .map_err(ProjectError::Store)
    }

    fn load_local_project(&self, project_id: &ProjectId) -> Result<Project, ProjectError> {
        let bytes = self
            .store
            .get_setting(&Self::project_key(project_id))
            .map_err(|err| match err {
                aura_store::StoreError::NotFound(_) => ProjectError::NotFound(*project_id),
                other => ProjectError::Store(other),
            })?;
        serde_json::from_slice(&bytes).map_err(|err| ProjectError::InvalidInput(err.to_string()))
    }

    fn list_local_projects(&self) -> Result<Vec<Project>, ProjectError> {
        let entries = self
            .store
            .list_settings_with_prefix("project:")
            .map_err(ProjectError::Store)?;
        let mut projects = Vec::new();
        for (_key, value) in entries {
            match serde_json::from_slice::<Project>(&value) {
                Ok(project) => projects.push(project),
                Err(_) => {}
            }
        }
        Ok(projects)
    }

    pub fn new(store: Arc<RocksStore>) -> Self {
        Self {
            network_client: None,
            store,
        }
    }

    pub fn new_with_network(network_client: Option<Arc<NetworkClient>>, store: Arc<RocksStore>) -> Self {
        Self { network_client, store }
    }

    pub fn create_project(&self, input: CreateProjectInput) -> Result<Project, ProjectError> {
        if input.name.trim().is_empty() {
            return Err(ProjectError::InvalidInput(
                "project name must not be empty".into(),
            ));
        }

        let folder = Path::new(&input.linked_folder_path);
        if !folder.is_dir() {
            return Err(ProjectError::InvalidInput(format!(
                "linked folder path does not exist or is not a directory: {}",
                input.linked_folder_path
            )));
        }

        let now = Utc::now();
        let project = Project {
            project_id: ProjectId::new(),
            org_id: input.org_id,
            name: input.name,
            description: input.description,
            linked_folder_path: input.linked_folder_path,
            workspace_source: input.workspace_source,
            workspace_display_path: input.workspace_display_path,
            requirements_doc_path: None,
            current_status: ProjectStatus::Planning,
            build_command: sanitize_command_option(input.build_command),
            test_command: sanitize_command_option(input.test_command),
            specs_summary: None,
            specs_title: None,
            created_at: now,
            updated_at: now,
            git_repo_url: None,
            git_branch: None,
            orbit_base_url: None,
            orbit_owner: None,
            orbit_repo: None,
        };

        self.save_project_shadow(&project)?;
        Ok(project)
    }

    pub fn get_project(&self, id: &ProjectId) -> Result<Project, ProjectError> {
        self.load_local_project(id)
    }

    pub fn list_projects(&self) -> Result<Vec<Project>, ProjectError> {
        let all = self.list_local_projects()?;
        Ok(all
            .into_iter()
            .filter(|project| project.current_status != ProjectStatus::Archived)
            .collect())
    }

    pub fn list_projects_by_org(&self, org_id: &OrgId) -> Result<Vec<Project>, ProjectError> {
        let all = self.list_local_projects()?;
        Ok(all
            .into_iter()
            .filter(|project| project.org_id == *org_id && project.current_status != ProjectStatus::Archived)
            .collect())
    }

    pub fn update_project(
        &self,
        id: &ProjectId,
        input: UpdateProjectInput,
    ) -> Result<Project, ProjectError> {
        let mut project = self.get_project(id)?;

        if let Some(name) = input.name {
            if name.trim().is_empty() {
                return Err(ProjectError::InvalidInput(
                    "project name must not be empty".into(),
                ));
            }
            project.name = name;
        }
        if let Some(desc) = input.description {
            project.description = desc;
        }
        if let Some(path) = input.linked_folder_path {
            project.linked_folder_path = path;
        }
        if let Some(source) = input.workspace_source {
            project.workspace_source = Some(source);
        }
        if let Some(display_path) = input.workspace_display_path {
            project.workspace_display_path = Some(display_path);
        }
        if input.build_command.is_some() {
            project.build_command = sanitize_command_option(input.build_command);
        }
        if input.test_command.is_some() {
            project.test_command = sanitize_command_option(input.test_command);
        }

        project.updated_at = Utc::now();
        self.save_project_shadow(&project)?;
        Ok(project)
    }

    pub fn delete_project(&self, id: &ProjectId) -> Result<(), ProjectError> {
        self.get_project(id)?;
        self.store
            .delete_setting(&Self::project_key(id))
            .map_err(ProjectError::Store)?;
        Ok(())
    }

    pub fn cleanup_empty_projects(&self) {
        if let Ok(all) = self.list_local_projects() {
            for project in all {
                if project.name.trim().is_empty() {
                    let _ = self.store.delete_setting(&Self::project_key(&project.project_id));
                }
            }
        }
    }

    pub fn archive_project(&self, id: &ProjectId) -> Result<Project, ProjectError> {
        let mut project = self.get_project(id)?;
        project.current_status = ProjectStatus::Archived;
        project.updated_at = Utc::now();
        self.save_project_shadow(&project)?;
        Ok(project)
    }

    fn get_jwt(&self) -> Result<String, ProjectError> {
        self.store
            .get_jwt()
            .ok_or(ProjectError::NoSession)
    }

    pub async fn get_project_async(&self, id: &ProjectId) -> Result<Project, ProjectError> {
        let Some(client) = self.network_client.as_ref() else {
            return self.get_project(id);
        };

        let jwt = self.get_jwt()?;
        let net = client
            .get_project(&id.to_string(), &jwt)
            .await
            .map_err(|e| match &e {
                aura_network::NetworkError::Server { status: 404, .. } => ProjectError::NotFound(*id),
                _ => ProjectError::Network(e),
            })?;
        let local = self.load_local_project(id).ok();
        Ok(network_project_to_core(&net, local.as_ref()))
    }

    pub async fn update_project_async(
        &self,
        id: &ProjectId,
        input: UpdateProjectInput,
    ) -> Result<Project, ProjectError> {
        let Some(client) = self.network_client.as_ref() else {
            return self.update_project(id, input);
        };

        if let Some(ref name) = input.name {
            if name.trim().is_empty() {
                return Err(ProjectError::InvalidInput(
                    "project name must not be empty".into(),
                ));
            }
        }

        let jwt = self.get_jwt()?;
        let folder = input
            .linked_folder_path
            .clone()
            .filter(|path| !path.is_empty());

        let net_req = aura_network::UpdateProjectRequest {
            name: input.name.clone(),
            description: input.description.clone(),
            folder,
            git_repo_url: None,
            git_branch: None,
            orbit_base_url: None,
            orbit_owner: None,
            orbit_repo: None,
        };

        let net = client
            .update_project(&id.to_string(), &jwt, &net_req)
            .await
            .map_err(ProjectError::Network)?;

        let local = self.update_project(id, input).ok();
        Ok(network_project_to_core(&net, local.as_ref()))
    }
}
