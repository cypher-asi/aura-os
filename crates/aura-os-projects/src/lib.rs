mod error;
pub use error::ProjectError;

use std::sync::Arc;

use chrono::{DateTime, Utc};
use tracing::debug;

use aura_os_core::*;
use aura_os_network::NetworkClient;
use aura_os_store::RocksStore;

fn parse_rfc3339_or_now(raw: Option<&str>) -> DateTime<Utc> {
    raw.and_then(|v| DateTime::parse_from_rfc3339(v).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(Utc::now)
}

fn net_or_local<T: Clone>(
    net_val: &Option<T>,
    local: Option<&Project>,
    field: fn(&Project) -> &Option<T>,
) -> Option<T> {
    net_val
        .clone()
        .or_else(|| local.and_then(|p| field(p).clone()))
}

fn network_project_to_core(
    net: &aura_os_network::NetworkProject,
    local: Option<&Project>,
) -> Project {
    let project_id = net
        .id
        .parse::<ProjectId>()
        .unwrap_or_else(|_| ProjectId::new());
    let org_id = net.org_id.parse::<OrgId>().unwrap_or_else(|_| OrgId::new());

    debug!(
        project_id = %net.id, name = %net.name,
        network_folder = ?net.folder,
        "network_project_to_core"
    );

    Project {
        project_id,
        org_id,
        name: net.name.clone(),
        description: net
            .description
            .clone()
            .or_else(|| local.map(|p| p.description.clone()))
            .unwrap_or_default(),
        requirements_doc_path: local.and_then(|p| p.requirements_doc_path.clone()),
        current_status: local
            .map(|p| p.current_status)
            .unwrap_or(ProjectStatus::Active),
        build_command: local.and_then(|p| p.build_command.clone()),
        test_command: local.and_then(|p| p.test_command.clone()),
        specs_summary: local.and_then(|p| p.specs_summary.clone()),
        specs_title: local.and_then(|p| p.specs_title.clone()),
        created_at: parse_rfc3339_or_now(net.created_at.as_deref()),
        updated_at: parse_rfc3339_or_now(net.updated_at.as_deref()),
        git_repo_url: net_or_local(&net.git_repo_url, local, |p| &p.git_repo_url),
        git_branch: net_or_local(&net.git_branch, local, |p| &p.git_branch),
        orbit_base_url: net_or_local(&net.orbit_base_url, local, |p| &p.orbit_base_url),
        orbit_owner: net_or_local(&net.orbit_owner, local, |p| &p.orbit_owner),
        orbit_repo: net_or_local(&net.orbit_repo, local, |p| &p.orbit_repo),
    }
}

const TRAILING_PHRASES: &[&str] = &[
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

const NON_COMMAND_VERBS: &[&str] = &[
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

fn strip_trailing_phrase(cmd: &str, lower: &str) -> Option<String> {
    for phrase in TRAILING_PHRASES {
        if let Some(idx) = lower.find(phrase) {
            return Some(cmd[..idx].trim_end().to_string());
        }
    }
    None
}

fn strip_trailing_to_verb(cmd: &str, lower: &str) -> Option<String> {
    if let Some(idx) = lower.rfind(" to ") {
        let first_word = lower[idx + 4..].split_whitespace().next().unwrap_or("");
        if NON_COMMAND_VERBS.contains(&first_word) {
            return Some(cmd[..idx].trim_end().to_string());
        }
    }
    None
}

fn sanitize_shell_command(cmd: &str) -> String {
    let trimmed = cmd.trim();
    if trimmed.is_empty() {
        return trimmed.to_string();
    }
    let lower = trimmed.to_lowercase();
    strip_trailing_phrase(trimmed, &lower)
        .or_else(|| strip_trailing_to_verb(trimmed, &lower))
        .unwrap_or_else(|| trimmed.to_string())
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
    pub build_command: Option<String>,
    pub test_command: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct UpdateProjectInput {
    pub name: Option<String>,
    pub description: Option<String>,
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
                aura_os_store::StoreError::NotFound(_) => ProjectError::NotFound(*project_id),
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
            if let Ok(project) = serde_json::from_slice::<Project>(&value) {
                projects.push(project)
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

    pub fn new_with_network(
        network_client: Option<Arc<NetworkClient>>,
        store: Arc<RocksStore>,
    ) -> Self {
        Self {
            network_client,
            store,
        }
    }

    pub fn create_project(&self, input: CreateProjectInput) -> Result<Project, ProjectError> {
        if input.name.trim().is_empty() {
            return Err(ProjectError::InvalidInput(
                "project name must not be empty".into(),
            ));
        }

        let now = Utc::now();
        let project = Project {
            project_id: ProjectId::new(),
            org_id: input.org_id,
            name: input.name,
            description: input.description,
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
            .filter(|project| {
                project.org_id == *org_id && project.current_status != ProjectStatus::Archived
            })
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
                    let _ = self
                        .store
                        .delete_setting(&Self::project_key(&project.project_id));
                }
            }
        }
    }

    pub fn find_project_by_orbit_repo(
        &self,
        orbit_owner: &str,
        orbit_repo: &str,
    ) -> Result<Option<Project>, ProjectError> {
        let all = self.list_local_projects()?;
        Ok(all.into_iter().find(|p| {
            p.orbit_owner.as_deref() == Some(orbit_owner)
                && p.orbit_repo.as_deref() == Some(orbit_repo)
                && p.current_status != ProjectStatus::Archived
        }))
    }

    pub fn archive_project(&self, id: &ProjectId) -> Result<Project, ProjectError> {
        let mut project = self.get_project(id)?;
        project.current_status = ProjectStatus::Archived;
        project.updated_at = Utc::now();
        self.save_project_shadow(&project)?;
        Ok(project)
    }

    fn get_jwt(&self) -> Result<String, ProjectError> {
        self.store.get_jwt().ok_or(ProjectError::NoSession)
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
                aura_os_network::NetworkError::Server { status: 404, .. } => {
                    ProjectError::NotFound(*id)
                }
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
        let net_req = aura_os_network::UpdateProjectRequest {
            name: input.name.clone(),
            description: input.description.clone(),
            folder: None,
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
