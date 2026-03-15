mod error;
pub use error::ProjectError;

use std::path::Path;
use std::sync::Arc;

use chrono::Utc;

use aura_core::*;
use aura_store::RocksStore;

/// Strip trailing natural language that LLMs sometimes append to shell commands.
/// e.g. "cargo build --workspace to confirm compilation" → "cargo build --workspace"
fn sanitize_shell_command(cmd: &str) -> String {
    let trimmed = cmd.trim();
    if trimmed.is_empty() {
        return trimmed.to_string();
    }

    let trailing_phrases: &[&str] = &[
        " in order to ", " so that ", " which will ", " that will ",
        " to confirm ", " to verify ", " to check ", " to ensure ",
        " to validate ", " to test ", " to see ", " to make sure ",
        " to run ", " to build ", " to compile ",
        " for confirming ", " for verifying ", " for checking ",
    ];

    let lower = trimmed.to_lowercase();
    for phrase in trailing_phrases {
        if let Some(idx) = lower.find(phrase) {
            return trimmed[..idx].trim_end().to_string();
        }
    }

    // Catch generic " to <verb>" at end: "cargo build --workspace to confirm compilation"
    if let Some(idx) = lower.rfind(" to ") {
        let after = &lower[idx + 4..];
        let first_word = after.split_whitespace().next().unwrap_or("");
        let non_command_verbs = [
            "confirm", "verify", "check", "ensure", "validate", "test",
            "see", "make", "run", "build", "compile", "show", "prove",
            "demonstrate", "try", "attempt",
        ];
        if non_command_verbs.contains(&first_word) {
            return trimmed[..idx].trim_end().to_string();
        }
    }

    trimmed.to_string()
}

fn sanitize_command_option(cmd: Option<String>) -> Option<String> {
    cmd.map(|c| {
        let sanitized = sanitize_shell_command(&c);
        if sanitized.is_empty() { c } else { sanitized }
    })
}

#[derive(Debug, Clone)]
pub struct CreateProjectInput {
    pub org_id: OrgId,
    pub name: String,
    pub description: String,
    pub linked_folder_path: String,
    pub github_integration_id: Option<GitHubIntegrationId>,
    pub github_repo_full_name: Option<String>,
    pub build_command: Option<String>,
    pub test_command: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct UpdateProjectInput {
    pub name: Option<String>,
    pub description: Option<String>,
    pub linked_folder_path: Option<String>,
    pub github_integration_id: Option<GitHubIntegrationId>,
    pub github_repo_full_name: Option<String>,
    pub build_command: Option<String>,
    pub test_command: Option<String>,
}

pub struct ProjectService {
    store: Arc<RocksStore>,
}

impl ProjectService {
    pub fn new(store: Arc<RocksStore>) -> Self {
        Self { store }
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
            requirements_doc_path: None,
            current_status: ProjectStatus::Planning,
            github_integration_id: input.github_integration_id,
            github_repo_full_name: input.github_repo_full_name,
            build_command: sanitize_command_option(input.build_command),
            test_command: sanitize_command_option(input.test_command),
            specs_summary: None,
            specs_title: None,
            created_at: now,
            updated_at: now,
        };

        self.store.put_project(&project)?;
        Ok(project)
    }

    pub fn get_project(&self, id: &ProjectId) -> Result<Project, ProjectError> {
        self.store.get_project(id).map_err(|e| match e {
            aura_store::StoreError::NotFound(_) => ProjectError::NotFound(*id),
            other => ProjectError::Store(other),
        })
    }

    pub fn list_projects(&self) -> Result<Vec<Project>, ProjectError> {
        let all = self.store.list_projects()?;
        Ok(all
            .into_iter()
            .filter(|p| p.current_status != ProjectStatus::Archived)
            .collect())
    }

    pub fn list_projects_by_org(&self, org_id: &OrgId) -> Result<Vec<Project>, ProjectError> {
        let all = self.store.list_projects()?;
        Ok(all
            .into_iter()
            .filter(|p| p.org_id == *org_id && p.current_status != ProjectStatus::Archived)
            .collect())
    }

    pub fn verify_org_access(
        &self,
        project: &Project,
        user_id: &str,
        store: &RocksStore,
    ) -> Result<(), ProjectError> {
        store
            .get_org_member(&project.org_id, user_id)
            .map_err(|_| {
                ProjectError::InvalidInput("user is not a member of the project's org".into())
            })?;
        Ok(())
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
        if input.github_integration_id.is_some() || input.github_repo_full_name.is_some() {
            project.github_integration_id = input.github_integration_id;
            project.github_repo_full_name = input.github_repo_full_name;
        }
        if input.build_command.is_some() {
            project.build_command = sanitize_command_option(input.build_command);
        }
        if input.test_command.is_some() {
            project.test_command = sanitize_command_option(input.test_command);
        }

        project.updated_at = Utc::now();
        self.store.put_project(&project)?;
        Ok(project)
    }

    pub fn delete_project(&self, id: &ProjectId) -> Result<(), ProjectError> {
        self.get_project(id)?;
        self.store.delete_project(id)?;
        Ok(())
    }

    pub fn archive_project(&self, id: &ProjectId) -> Result<Project, ProjectError> {
        let mut project = self.get_project(id)?;
        project.current_status = ProjectStatus::Archived;
        project.updated_at = Utc::now();
        self.store.put_project(&project)?;
        Ok(project)
    }
}
