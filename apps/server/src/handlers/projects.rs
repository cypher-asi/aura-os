use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::{DateTime, Utc};
use serde::Deserialize;

use aura_core::{OrgId, Project, ProjectId, ProjectStatus};
use aura_network::NetworkProject;

use crate::dto::{CreateProjectRequest, UpdateProjectRequest};
use crate::error::{map_network_error, ApiError, ApiResult};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct ListProjectsQuery {
    pub org_id: Option<OrgId>,
}

/// Build a core Project from aura-network response only (no local merge).
fn project_from_network(net: &NetworkProject) -> Project {
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

fn folder_name_from_path(path: &str) -> Option<String> {
    std::path::Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
}

/// List all projects for the current user from the network (all orgs). Used by agents/log when no org scope.
pub(crate) async fn list_all_projects_from_network(state: &AppState) -> ApiResult<Vec<Project>> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;
    let orgs = client.list_orgs(&jwt).await.map_err(map_network_error)?;
    let mut projects = Vec::new();
    for org in &orgs {
        let net_projects = client
            .list_projects_by_org(&org.id, &jwt)
            .await
            .map_err(map_network_error)?;
        for net in &net_projects {
            projects.push(project_from_network(net));
        }
    }
    Ok(projects)
}

fn orbit_create_repo_url(
    base_url: &str,
    owner: &str,
    repo: &str,
    resp: &aura_orbit::CreateRepoResponse,
) -> String {
    resp.clone_url
        .clone()
        .or_else(|| resp.git_url.clone())
        .unwrap_or_else(|| {
            let base = base_url.trim_end_matches('/');
            format!("{}/{}/{}", base, owner, repo)
        })
}

pub async fn create_project(
    State(state): State<AppState>,
    Json(req): Json<CreateProjectRequest>,
) -> ApiResult<(StatusCode, Json<Project>)> {
    if req.name.trim().is_empty() {
        return Err(ApiError::bad_request("name must not be empty"));
    }
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;

    let (git_repo_url, git_branch, orbit_base_url, orbit_owner, orbit_repo) =
        if let (Some(ref owner), Some(ref repo)) = (&req.orbit_owner, &req.orbit_repo) {
            if let Some(ref base_url) = state.orbit_base_url {
                match state
                    .orbit_client
                    .create_repo(base_url, owner, repo, &jwt)
                    .await
                {
                    Ok(created) => {
                        let url = orbit_create_repo_url(base_url, owner, repo, &created);
                        (
                            Some(url),
                            req.git_branch.clone().or_else(|| Some("main".into())),
                            req.orbit_base_url.clone().or_else(|| Some(base_url.clone())),
                            req.orbit_owner.clone(),
                            req.orbit_repo.clone(),
                        )
                    }
                    Err(e) => {
                        return Err(ApiError::internal(format!(
                            "Failed to create Orbit repo: {}",
                            e
                        )));
                    }
                }
            } else {
                (
                    req.git_repo_url.clone(),
                    req.git_branch.clone(),
                    req.orbit_base_url.clone(),
                    req.orbit_owner.clone(),
                    req.orbit_repo.clone(),
                )
            }
        } else {
            (
                req.git_repo_url.clone(),
                req.git_branch.clone(),
                req.orbit_base_url.clone(),
                req.orbit_owner.clone(),
                req.orbit_repo.clone(),
            )
        };

    let net_req = aura_network::CreateProjectRequest {
        name: req.name.clone(),
        org_id: req.org_id.to_string(),
        description: Some(req.description.clone()),
        folder: folder_name_from_path(&req.linked_folder_path),
        git_repo_url: git_repo_url.clone(),
        git_branch: git_branch.clone(),
        orbit_base_url: orbit_base_url.clone(),
        orbit_owner: orbit_owner.clone(),
        orbit_repo: orbit_repo.clone(),
    };
    let net_project = client
        .create_project(&jwt, &net_req)
        .await
        .map_err(map_network_error)?;

    let project_id = net_project
        .id
        .parse::<ProjectId>()
        .unwrap_or_else(|_| ProjectId::new());
    let now = Utc::now();
    let project = Project {
        project_id,
        org_id: req.org_id,
        name: req.name,
        description: req.description,
        linked_folder_path: req.linked_folder_path,
        requirements_doc_path: None,
        current_status: ProjectStatus::Active,
        build_command: req.build_command,
        test_command: req.test_command,
        specs_summary: None,
        specs_title: None,
        created_at: now,
        updated_at: now,
        git_repo_url,
        git_branch,
        orbit_base_url,
        orbit_owner,
        orbit_repo,
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
            .map(project_from_network)
            .collect();

        Ok(Json(projects))
    } else {
        // No org_id — listing is org-scoped only; return empty (web-only, no local fallback).
        Ok(Json(Vec::new()))
    }
}

pub async fn get_project(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<Project>> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;
    let net_project = client
        .get_project(&project_id.to_string(), &jwt)
        .await
        .map_err(map_network_error)?;
    let project = project_from_network(&net_project);
    Ok(Json(project))
}

pub async fn update_project(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
    Json(req): Json<UpdateProjectRequest>,
) -> ApiResult<Json<Project>> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;
    let folder = req
        .linked_folder_path
        .as_deref()
        .and_then(folder_name_from_path);
    let net_req = aura_network::UpdateProjectRequest {
        name: req.name.clone(),
        description: req.description.clone(),
        folder,
        git_repo_url: req.git_repo_url.clone(),
        git_branch: req.git_branch.clone(),
        orbit_base_url: req.orbit_base_url.clone(),
        orbit_owner: req.orbit_owner.clone(),
        orbit_repo: req.orbit_repo.clone(),
    };
    let net_project = client
        .update_project(&project_id.to_string(), &jwt, &net_req)
        .await
        .map_err(map_network_error)?;
    let project = project_from_network(&net_project);
    Ok(Json(project))
}

pub async fn delete_project(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<StatusCode> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;
    client
        .delete_project(&project_id.to_string(), &jwt)
        .await
        .map_err(map_network_error)?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn archive_project(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<Project>> {
    let project = state
        .project_service
        .get_project_async(&project_id)
        .await
        .map_err(|e| match &e {
            aura_projects::ProjectError::NotFound(_) => ApiError::not_found("project not found"),
            _ => ApiError::internal(e.to_string()),
        })?;
    Ok(Json(project))
}
