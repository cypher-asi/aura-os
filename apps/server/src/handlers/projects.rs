use std::path::{Component, Path as FsPath, PathBuf};

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use base64::Engine;
use serde::Deserialize;

use aura_core::{OrgId, Project, ProjectId};
use aura_projects::{CreateProjectInput, UpdateProjectInput};

#[derive(Debug, Deserialize)]
pub struct ListProjectsQuery {
    pub org_id: Option<OrgId>,
}

use crate::dto::{CreateImportedProjectRequest, CreateProjectRequest, ImportedProjectFile, UpdateProjectRequest};
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

fn to_project_input(req: CreateProjectRequest) -> CreateProjectInput {
    CreateProjectInput {
        org_id: req.org_id,
        name: req.name,
        description: req.description,
        linked_folder_path: req.linked_folder_path,
        workspace_source: req.workspace_source,
        workspace_display_path: req.workspace_display_path,
        github_integration_id: req.github_integration_id,
        github_repo_full_name: req.github_repo_full_name,
        build_command: req.build_command,
        test_command: req.test_command,
    }
}

fn sanitize_import_path(relative_path: &str) -> ApiResult<PathBuf> {
    let candidate = FsPath::new(relative_path);
    let mut sanitized = PathBuf::new();

    for component in candidate.components() {
      match component {
          Component::Normal(part) => sanitized.push(part),
          Component::CurDir => {}
          Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
              return Err(ApiError::bad_request(format!(
                  "invalid imported file path: {relative_path}",
              )));
          }
      }
    }

    if sanitized.as_os_str().is_empty() {
        return Err(ApiError::bad_request("imported files must include a relative path".to_string()));
    }

    Ok(sanitized)
}

async fn write_imported_files(
    workspace_root: &FsPath,
    files: Vec<ImportedProjectFile>,
) -> ApiResult<()> {
    if files.is_empty() {
        return Err(ApiError::bad_request("select at least one file to import".to_string()));
    }

    for file in files {
        let relative_path = sanitize_import_path(&file.relative_path)?;
        let destination = workspace_root.join(relative_path);
        if let Some(parent) = destination.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| ApiError::internal(format!("failed to create imported workspace directories: {e}")))?;
        }

        let contents = base64::engine::general_purpose::STANDARD
            .decode(file.contents_base64)
            .map_err(|e| ApiError::bad_request(format!("invalid imported file contents: {e}")))?;

        tokio::fs::write(&destination, contents)
            .await
            .map_err(|e| ApiError::internal(format!("failed to write imported file {}: {e}", destination.display())))?;
    }

    Ok(())
}

pub async fn create_project(
    State(state): State<AppState>,
    Json(req): Json<CreateProjectRequest>,
) -> ApiResult<(StatusCode, Json<Project>)> {
    let input = to_project_input(req);
    let project = state
        .project_service
        .create_project(input)
        .map_err(|e| match &e {
            aura_projects::ProjectError::InvalidInput(msg) => ApiError::bad_request(msg.clone()),
            _ => ApiError::internal(e.to_string()),
        })?;
    Ok((StatusCode::CREATED, Json(project)))
}

pub async fn create_imported_project(
    State(state): State<AppState>,
    Json(req): Json<CreateImportedProjectRequest>,
) -> ApiResult<(StatusCode, Json<Project>)> {
    let CreateImportedProjectRequest {
        org_id,
        name,
        description,
        files,
        build_command,
        test_command,
    } = req;

    let workspace_id = ProjectId::new().to_string();
    let workspace_root = state
        .data_dir
        .join("imported-workspaces")
        .join(workspace_id)
        .join("workspace");

    tokio::fs::create_dir_all(&workspace_root)
        .await
        .map_err(|e| ApiError::internal(format!("failed to create imported workspace directory: {e}")))?;

    write_imported_files(&workspace_root, files).await?;

    let input = CreateProjectInput {
        org_id,
        name,
        description,
        linked_folder_path: workspace_root.to_string_lossy().to_string(),
        workspace_source: Some("imported".to_string()),
        workspace_display_path: Some("Imported workspace snapshot".to_string()),
        github_integration_id: None,
        github_repo_full_name: None,
        build_command,
        test_command,
    };

    let project = state
        .project_service
        .create_project(input)
        .map_err(|e| match &e {
            aura_projects::ProjectError::InvalidInput(msg) => ApiError::bad_request(msg.clone()),
            _ => ApiError::internal(e.to_string()),
        })?;

    Ok((StatusCode::CREATED, Json(project)))
}

pub async fn list_projects(
    State(state): State<AppState>,
    Query(query): Query<ListProjectsQuery>,
) -> ApiResult<Json<Vec<Project>>> {
    let projects = match query.org_id {
        Some(org_id) => state
            .project_service
            .list_projects_by_org(&org_id)
            .map_err(|e| ApiError::internal(e.to_string()))?,
        None => state
            .project_service
            .list_projects()
            .map_err(|e| ApiError::internal(e.to_string()))?,
    };
    Ok(Json(projects))
}

pub async fn get_project(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<Project>> {
    let project = state
        .project_service
        .get_project(&project_id)
        .map_err(|e| match &e {
            aura_projects::ProjectError::NotFound(_) => ApiError::not_found("project not found"),
            _ => ApiError::internal(e.to_string()),
        })?;
    Ok(Json(project))
}

pub async fn update_project(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
    Json(req): Json<UpdateProjectRequest>,
) -> ApiResult<Json<Project>> {
    let input = UpdateProjectInput {
        name: req.name,
        description: req.description,
        linked_folder_path: req.linked_folder_path,
        workspace_source: req.workspace_source,
        workspace_display_path: req.workspace_display_path,
        github_integration_id: req.github_integration_id,
        github_repo_full_name: req.github_repo_full_name,
        build_command: req.build_command,
        test_command: req.test_command,
    };
    let project = state
        .project_service
        .update_project(&project_id, input)
        .map_err(|e| match &e {
            aura_projects::ProjectError::NotFound(_) => ApiError::not_found("project not found"),
            aura_projects::ProjectError::InvalidInput(msg) => ApiError::bad_request(msg.clone()),
            _ => ApiError::internal(e.to_string()),
        })?;
    Ok(Json(project))
}

pub async fn delete_project(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<StatusCode> {
    state
        .project_service
        .delete_project(&project_id)
        .map_err(|e| match &e {
            aura_projects::ProjectError::NotFound(_) => ApiError::not_found("project not found"),
            _ => ApiError::internal(e.to_string()),
        })?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn archive_project(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<Project>> {
    let project = state
        .project_service
        .archive_project(&project_id)
        .map_err(|e| match &e {
            aura_projects::ProjectError::NotFound(_) => ApiError::not_found("project not found"),
            _ => ApiError::internal(e.to_string()),
        })?;
    Ok(Json(project))
}
