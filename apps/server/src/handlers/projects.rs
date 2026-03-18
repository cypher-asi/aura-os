use std::path::{Component, Path as FsPath, PathBuf};

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use base64::Engine;
use chrono::{DateTime, Utc};
use serde::Deserialize;
use tracing::warn;

use aura_core::{OrgId, Project, ProjectId, ProjectStatus};
use aura_network::NetworkProject;
use aura_projects::{CreateProjectInput, UpdateProjectInput};

use crate::dto::{CreateImportedProjectRequest, CreateProjectRequest, ImportedProjectFile, UpdateProjectRequest};
use crate::error::{map_network_error, ApiError, ApiResult};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct ListProjectsQuery {
    pub org_id: Option<OrgId>,
}

fn project_from_network(net: &NetworkProject, local: Option<&Project>) -> Project {
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

    if let Some(local) = local {
        Project {
            project_id,
            org_id,
            name: net.name.clone(),
            description: net
                .description
                .clone()
                .unwrap_or_else(|| local.description.clone()),
            linked_folder_path: local.linked_folder_path.clone(),
            workspace_source: local.workspace_source.clone(),
            workspace_display_path: local.workspace_display_path.clone(),
            requirements_doc_path: local.requirements_doc_path.clone(),
            current_status: local.current_status,
            build_command: local.build_command.clone(),
            test_command: local.test_command.clone(),
            specs_summary: local.specs_summary.clone(),
            specs_title: local.specs_title.clone(),
            created_at,
            updated_at,
        }
    } else {
        Project {
            project_id,
            org_id,
            name: net.name.clone(),
            description: net.description.clone().unwrap_or_default(),
            linked_folder_path: net.folder.clone().unwrap_or_default(),
            workspace_source: None,
            workspace_display_path: None,
            requirements_doc_path: None,
            current_status: ProjectStatus::Active,
            build_command: None,
            test_command: None,
            specs_summary: None,
            specs_title: None,
            created_at,
            updated_at,
        }
    }
}

fn ensure_local_shadow(state: &AppState, project: &Project) {
    if let Err(e) = state.store.put_project(project) {
        warn!(project_id = %project.project_id, error = %e, "Failed to save local project shadow");
    }
}

fn folder_name_from_path(path: &str) -> Option<String> {
    std::path::Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
}

fn to_project_input(req: CreateProjectRequest) -> CreateProjectInput {
    CreateProjectInput {
        org_id: req.org_id,
        name: req.name,
        description: req.description,
        linked_folder_path: req.linked_folder_path,
        workspace_source: req.workspace_source,
        workspace_display_path: req.workspace_display_path,
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
    if let Some(client) = &state.network_client {
        let jwt = state.get_jwt()?;
        let net_req = aura_network::CreateProjectRequest {
            name: req.name.clone(),
            org_id: req.org_id.to_string(),
            description: Some(req.description.clone()),
            folder: folder_name_from_path(&req.linked_folder_path),
        };
        let net_project = client
            .create_project(&jwt, &net_req)
            .await
            .map_err(map_network_error)?;

        let local_shadow = Project {
            project_id: net_project
                .id
                .parse::<ProjectId>()
                .unwrap_or_else(|_| ProjectId::new()),
            org_id: req.org_id,
            name: req.name,
            description: req.description,
            linked_folder_path: req.linked_folder_path,
            workspace_source: req.workspace_source,
            workspace_display_path: req.workspace_display_path,
            requirements_doc_path: None,
            current_status: ProjectStatus::Planning,
            build_command: req.build_command,
            test_command: req.test_command,
            specs_summary: None,
            specs_title: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let project = project_from_network(&net_project, Some(&local_shadow));
        ensure_local_shadow(&state, &project);
        return Ok((StatusCode::CREATED, Json(project)));
    }

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
        build_command,
        test_command,
    };

    let project = if let Some(client) = &state.network_client {
        let jwt = state.get_jwt()?;
        let net_req = aura_network::CreateProjectRequest {
            name: input.name.clone(),
            org_id: input.org_id.to_string(),
            description: Some(input.description.clone()),
            folder: None,
        };
        let net_project = client
            .create_project(&jwt, &net_req)
            .await
            .map_err(map_network_error)?;

        let local_shadow = Project {
            project_id: net_project
                .id
                .parse::<ProjectId>()
                .unwrap_or_else(|_| ProjectId::new()),
            org_id: input.org_id,
            name: input.name,
            description: input.description,
            linked_folder_path: input.linked_folder_path,
            workspace_source: input.workspace_source,
            workspace_display_path: input.workspace_display_path,
            requirements_doc_path: None,
            current_status: ProjectStatus::Planning,
            build_command: input.build_command,
            test_command: input.test_command,
            specs_summary: None,
            specs_title: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let project = project_from_network(&net_project, Some(&local_shadow));
        ensure_local_shadow(&state, &project);
        project
    } else {
        state
            .project_service
            .create_project(input)
            .map_err(|e| match &e {
                aura_projects::ProjectError::InvalidInput(msg) => ApiError::bad_request(msg.clone()),
                _ => ApiError::internal(e.to_string()),
            })?
    };

    Ok((StatusCode::CREATED, Json(project)))
}

pub async fn list_projects(
    State(state): State<AppState>,
    Query(query): Query<ListProjectsQuery>,
) -> ApiResult<Json<Vec<Project>>> {
    if let Some(ref org_id) = query.org_id {
        let client = state.require_network_client()?;
        let jwt = state.get_jwt()?;
        let net_projects = client
            .list_projects_by_org(&org_id.to_string(), &jwt)
            .await
            .map_err(map_network_error)?;

        let projects: Vec<Project> = net_projects
            .iter()
            .map(|net| {
                let local = net
                    .id
                    .parse::<ProjectId>()
                    .ok()
                    .and_then(|pid| state.store.get_project(&pid).ok());
                let project = project_from_network(net, local.as_ref());
                ensure_local_shadow(&state, &project);
                project
            })
            .collect();

        Ok(Json(projects))
    } else {
        // No org_id — network API is org-scoped, so fall back to local list.
        let projects = state
            .project_service
            .list_projects()
            .map_err(|e| ApiError::internal(e.to_string()))?;
        Ok(Json(projects))
    }
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
    let network_name = req.name.clone();
    let network_description = req.description.clone();
    let network_linked_folder_path = req.linked_folder_path.clone();
    let input = UpdateProjectInput {
        name: req.name,
        description: req.description,
        linked_folder_path: req.linked_folder_path,
        workspace_source: req.workspace_source,
        workspace_display_path: req.workspace_display_path,
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

    if let Some(client) = &state.network_client {
        let jwt = state.get_jwt()?;
        let folder = network_linked_folder_path
            .as_deref()
            .and_then(folder_name_from_path);
        let net_req = aura_network::UpdateProjectRequest {
            name: network_name,
            description: network_description,
            folder,
        };
        client
            .update_project(&project_id.to_string(), &jwt, &net_req)
            .await
            .map_err(map_network_error)?;
    }

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

    if let Some(client) = &state.network_client {
        let jwt = state.get_jwt()?;
        client
            .delete_project(&project_id.to_string(), &jwt)
            .await
            .map_err(map_network_error)?;
    }

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
