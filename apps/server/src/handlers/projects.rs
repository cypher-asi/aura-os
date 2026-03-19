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

use crate::dto::{
    CreateImportedProjectRequest, CreateProjectRequest, ImportedProjectFile, UpdateProjectRequest,
};
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

fn ensure_local_shadow(state: &AppState, project: &Project) {
    if let Err(err) = state.project_service.save_project_shadow(project) {
        warn!(project_id = %project.project_id, error = %err, "Failed to save local project shadow");
    }
}

fn folder_name_from_path(path: &str) -> Option<String> {
    std::path::Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_string())
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

fn to_project_input(req: &CreateProjectRequest) -> CreateProjectInput {
    CreateProjectInput {
        org_id: req.org_id,
        name: req.name.clone(),
        description: req.description.clone(),
        linked_folder_path: req.linked_folder_path.clone(),
        workspace_source: req.workspace_source.clone(),
        workspace_display_path: req.workspace_display_path.clone(),
        build_command: req.build_command.clone(),
        test_command: req.test_command.clone(),
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
        return Err(ApiError::bad_request(
            "imported files must include a relative path".to_string(),
        ));
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
                .map_err(|e| ApiError::internal(format!(
                    "failed to create imported workspace directories: {e}",
                )))?;
        }

        let contents = base64::engine::general_purpose::STANDARD
            .decode(file.contents_base64)
            .map_err(|e| ApiError::bad_request(format!(
                "invalid imported file contents: {e}",
            )))?;

        tokio::fs::write(&destination, contents)
            .await
            .map_err(|e| ApiError::internal(format!(
                "failed to write imported file {}: {e}",
                destination.display(),
            )))?;
    }

    Ok(())
}

fn build_local_shadow(
    project_id: ProjectId,
    req: &CreateProjectRequest,
    git_repo_url: Option<String>,
    git_branch: Option<String>,
    orbit_base_url: Option<String>,
    orbit_owner: Option<String>,
    orbit_repo: Option<String>,
) -> Project {
    Project {
        project_id,
        org_id: req.org_id,
        name: req.name.clone(),
        description: req.description.clone(),
        linked_folder_path: req.linked_folder_path.clone(),
        workspace_source: req.workspace_source.clone(),
        workspace_display_path: req.workspace_display_path.clone(),
        requirements_doc_path: None,
        current_status: ProjectStatus::Planning,
        build_command: req.build_command.clone(),
        test_command: req.test_command.clone(),
        specs_summary: None,
        specs_title: None,
        created_at: Utc::now(),
        updated_at: Utc::now(),
        git_repo_url,
        git_branch,
        orbit_base_url,
        orbit_owner,
        orbit_repo,
    }
}

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
            let local = net
                .id
                .parse::<ProjectId>()
                .ok()
                .and_then(|project_id| state.project_service.get_project(&project_id).ok());
            let project = project_from_network(net, local.as_ref());
            ensure_local_shadow(state, &project);
            projects.push(project);
        }
    }
    Ok(projects)
}

pub async fn create_project(
    State(state): State<AppState>,
    Json(req): Json<CreateProjectRequest>,
) -> ApiResult<(StatusCode, Json<Project>)> {
    if req.name.trim().is_empty() {
        return Err(ApiError::bad_request("name must not be empty"));
    }

    if let Some(client) = &state.network_client {
        let jwt = state.get_jwt()?;
        let (git_repo_url, git_branch, orbit_base_url, orbit_owner, orbit_repo) = {
            if let (Some(owner), Some(repo)) = (&req.orbit_owner, &req.orbit_repo) {
                if let Some(base_url) = &state.orbit_base_url {
                    match state.orbit_client.create_repo(base_url, owner, repo, &jwt).await {
                        Ok(created) => (
                            Some(orbit_create_repo_url(base_url, owner, repo, &created)),
                            req.git_branch.clone().or_else(|| Some("main".into())),
                            req.orbit_base_url.clone().or_else(|| Some(base_url.clone())),
                            req.orbit_owner.clone(),
                            req.orbit_repo.clone(),
                        ),
                        Err(err) => return Err(ApiError::internal(err.message_for_api())),
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
            }
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

        let local_shadow = build_local_shadow(
            net_project
                .id
                .parse::<ProjectId>()
                .unwrap_or_else(|_| ProjectId::new()),
            &req,
            git_repo_url,
            git_branch,
            orbit_base_url,
            orbit_owner,
            orbit_repo,
        );
        let project = project_from_network(&net_project, Some(&local_shadow));
        ensure_local_shadow(&state, &project);
        return Ok((StatusCode::CREATED, Json(project)));
    }

    let input = to_project_input(&req);
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
        git_repo_url,
        git_branch,
        orbit_base_url,
        orbit_owner,
        orbit_repo,
    } = req;

    let workspace_id = ProjectId::new().to_string();
    let workspace_root = state
        .data_dir
        .join("imported-workspaces")
        .join(workspace_id)
        .join("workspace");

    tokio::fs::create_dir_all(&workspace_root)
        .await
        .map_err(|e| ApiError::internal(format!(
            "failed to create imported workspace directory: {e}",
        )))?;

    write_imported_files(&workspace_root, files).await?;

    let local_req = CreateProjectRequest {
        org_id,
        name: name.clone(),
        description: description.clone(),
        linked_folder_path: workspace_root.to_string_lossy().to_string(),
        workspace_source: Some("imported".to_string()),
        workspace_display_path: Some("Imported workspace snapshot".to_string()),
        build_command: build_command.clone(),
        test_command: test_command.clone(),
        git_repo_url: git_repo_url.clone(),
        git_branch: git_branch.clone(),
        orbit_base_url: orbit_base_url.clone(),
        orbit_owner: orbit_owner.clone(),
        orbit_repo: orbit_repo.clone(),
    };

    if let Some(client) = &state.network_client {
        let jwt = state.get_jwt()?;
        let (git_repo_url, git_branch, orbit_base_url, orbit_owner, orbit_repo) = {
            if let (Some(owner), Some(repo)) = (&orbit_owner, &orbit_repo) {
                if let Some(base_url) = &state.orbit_base_url {
                    match state.orbit_client.create_repo(base_url, owner, repo, &jwt).await {
                        Ok(created) => (
                            Some(orbit_create_repo_url(base_url, owner, repo, &created)),
                            git_branch.clone().or_else(|| Some("main".into())),
                            orbit_base_url.clone().or_else(|| Some(base_url.clone())),
                            orbit_owner.clone(),
                            orbit_repo.clone(),
                        ),
                        Err(err) => return Err(ApiError::internal(err.message_for_api())),
                    }
                } else {
                    (
                        git_repo_url.clone(),
                        git_branch.clone(),
                        orbit_base_url.clone(),
                        orbit_owner.clone(),
                        orbit_repo.clone(),
                    )
                }
            } else {
                (
                    git_repo_url.clone(),
                    git_branch.clone(),
                    orbit_base_url.clone(),
                    orbit_owner.clone(),
                    orbit_repo.clone(),
                )
            }
        };

        let net_req = aura_network::CreateProjectRequest {
            name: name.clone(),
            org_id: org_id.to_string(),
            description: Some(description.clone()),
            folder: None,
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

        let local_shadow = build_local_shadow(
            net_project
                .id
                .parse::<ProjectId>()
                .unwrap_or_else(|_| ProjectId::new()),
            &local_req,
            git_repo_url,
            git_branch,
            orbit_base_url,
            orbit_owner,
            orbit_repo,
        );
        let project = project_from_network(&net_project, Some(&local_shadow));
        ensure_local_shadow(&state, &project);
        return Ok((StatusCode::CREATED, Json(project)));
    }

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
    if let Some(ref org_id) = query.org_id {
        if let Some(client) = &state.network_client {
            let jwt = state.get_jwt()?;
            let net_projects = client
                .list_projects_by_org(&org_id.to_string(), &jwt)
                .await
                .map_err(map_network_error)?;

            let projects = net_projects
                .iter()
                .map(|net| {
                    let local = net
                        .id
                        .parse::<ProjectId>()
                        .ok()
                        .and_then(|project_id| state.project_service.get_project(&project_id).ok());
                    let project = project_from_network(net, local.as_ref());
                    ensure_local_shadow(&state, &project);
                    project
                })
                .collect();
            return Ok(Json(projects));
        }

        let projects = state
            .project_service
            .list_projects_by_org(org_id)
            .map_err(|e| ApiError::internal(e.to_string()))?;
        return Ok(Json(projects));
    }

    let projects = state
        .project_service
        .list_projects()
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(projects))
}

pub async fn get_project(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<Project>> {
    if let Some(client) = &state.network_client {
        let jwt = state.get_jwt()?;
        let net_project = client
            .get_project(&project_id.to_string(), &jwt)
            .await
            .map_err(map_network_error)?;
        let local = state.project_service.get_project(&project_id).ok();
        let project = project_from_network(&net_project, local.as_ref());
        ensure_local_shadow(&state, &project);
        return Ok(Json(project));
    }

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
        name: req.name.clone(),
        description: req.description.clone(),
        linked_folder_path: req.linked_folder_path.clone(),
        workspace_source: req.workspace_source.clone(),
        workspace_display_path: req.workspace_display_path.clone(),
        build_command: req.build_command.clone(),
        test_command: req.test_command.clone(),
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
        let merged = project_from_network(&net_project, Some(&project));
        ensure_local_shadow(&state, &merged);
        return Ok(Json(merged));
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
