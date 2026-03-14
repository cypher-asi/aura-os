use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

use aura_core::{OrgId, Project, ProjectId};
use aura_projects::{CreateProjectInput, UpdateProjectInput};

#[derive(Debug, Deserialize)]
pub struct ListProjectsQuery {
    pub org_id: Option<OrgId>,
}

use crate::dto::{CreateProjectRequest, UpdateProjectRequest};
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

pub async fn create_project(
    State(state): State<AppState>,
    Json(req): Json<CreateProjectRequest>,
) -> ApiResult<(StatusCode, Json<Project>)> {
    let input = CreateProjectInput {
        org_id: req.org_id,
        name: req.name,
        description: req.description,
        linked_folder_path: req.linked_folder_path,
        github_integration_id: req.github_integration_id,
        github_repo_full_name: req.github_repo_full_name,
        build_command: req.build_command,
        test_command: req.test_command,
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
