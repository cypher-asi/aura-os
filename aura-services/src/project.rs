use std::path::Path;
use std::sync::Arc;

use chrono::Utc;

use aura_core::*;
use aura_store::RocksStore;

use crate::error::ProjectError;

#[derive(Debug, Clone)]
pub struct CreateProjectInput {
    pub org_id: OrgId,
    pub name: String,
    pub description: String,
    pub linked_folder_path: String,
    pub requirements_doc_path: String,
}

#[derive(Debug, Clone, Default)]
pub struct UpdateProjectInput {
    pub name: Option<String>,
    pub description: Option<String>,
    pub linked_folder_path: Option<String>,
    pub requirements_doc_path: Option<String>,
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

        let req_path = Path::new(&input.requirements_doc_path);
        if !req_path.is_file() {
            return Err(ProjectError::InvalidInput(format!(
                "requirements doc path does not exist or is not a file: {}",
                input.requirements_doc_path
            )));
        }

        let now = Utc::now();
        let project = Project {
            project_id: ProjectId::new(),
            org_id: input.org_id,
            name: input.name,
            description: input.description,
            linked_folder_path: input.linked_folder_path,
            requirements_doc_path: input.requirements_doc_path,
            current_status: ProjectStatus::Planning,
            github_integration_id: None,
            github_repo_full_name: None,
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
        Ok(self.store.list_projects()?)
    }

    pub fn list_projects_by_org(&self, org_id: &OrgId) -> Result<Vec<Project>, ProjectError> {
        let all = self.store.list_projects()?;
        Ok(all.into_iter().filter(|p| p.org_id == *org_id).collect())
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
        if let Some(path) = input.requirements_doc_path {
            project.requirements_doc_path = path;
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
