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

use tracing::debug;

use crate::dto::{
    CreateImportedProjectRequest, CreateProjectRequest, ImportedProjectFile, UpdateProjectRequest,
};
use crate::error::{map_network_error, ApiError, ApiResult};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct ListProjectsQuery {
    pub org_id: Option<OrgId>,
}

struct ParsedNetworkMeta {
    project_id: ProjectId,
    org_id: OrgId,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

fn parse_network_ids_and_dates(net: &NetworkProject) -> ParsedNetworkMeta {
    ParsedNetworkMeta {
        project_id: net.id.parse::<ProjectId>().unwrap_or_else(|_| ProjectId::new()),
        org_id: net.org_id.parse::<OrgId>().unwrap_or_else(|_| OrgId::new()),
        created_at: net
            .created_at
            .as_deref()
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(Utc::now),
        updated_at: net
            .updated_at
            .as_deref()
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(Utc::now),
    }
}

fn project_from_network(net: &NetworkProject, local: Option<&Project>) -> Project {
    let meta = parse_network_ids_and_dates(net);
    let folder = net.folder.clone().unwrap_or_default();
    debug!(
        project_id = %net.id,
        name = %net.name,
        network_folder = ?net.folder,
        resolved_folder = %folder,
        "project_from_network"
    );

    Project {
        project_id: meta.project_id,
        org_id: meta.org_id,
        name: net.name.clone(),
        description: net
            .description
            .clone()
            .or_else(|| local.map(|project| project.description.clone()))
            .unwrap_or_default(),
        linked_folder_path: local
            .map(|project| project.linked_folder_path.clone())
            .unwrap_or(folder),
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
        created_at: meta.created_at,
        updated_at: meta.updated_at,
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
            format!("{}/{}/{}.git", base, owner, repo)
        })
}

fn should_create_new_orbit_repo(
    git_repo_url: &Option<String>,
    orbit_owner: &Option<String>,
    orbit_repo: &Option<String>,
) -> bool {
    orbit_owner.is_some()
        && orbit_repo.is_some()
        && git_repo_url
            .as_ref()
            .map(|value| value.trim().is_empty())
            .unwrap_or(true)
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

struct OrbitRepoFields {
    git_repo_url: Option<String>,
    git_branch: Option<String>,
    orbit_base_url: Option<String>,
    orbit_owner: Option<String>,
    orbit_repo: Option<String>,
}

async fn resolve_orbit_repo(
    state: &AppState,
    req: &CreateProjectRequest,
    net_project: &aura_network::NetworkProject,
    jwt: &str,
) -> ApiResult<OrbitRepoFields> {
    if !should_create_new_orbit_repo(&req.git_repo_url, &req.orbit_owner, &req.orbit_repo) {
        return Ok(OrbitRepoFields {
            git_repo_url: req.git_repo_url.clone(),
            git_branch: req.git_branch.clone(),
            orbit_base_url: req.orbit_base_url.clone(),
            orbit_owner: req.orbit_owner.clone(),
            orbit_repo: req.orbit_repo.clone(),
        });
    }
    let base_url = state
        .orbit_base_url
        .as_deref()
        .ok_or_else(|| ApiError::service_unavailable("Orbit repo creation is not configured (ORBIT_BASE_URL)"))?;
    let owner = req.orbit_owner.as_deref().unwrap_or(&net_project.org_id);
    let repo_name = req.orbit_repo.as_deref().unwrap_or(&req.name);
    let created = state
        .orbit_client
        .create_repo(
            base_url,
            &net_project.org_id,
            &net_project.id,
            repo_name,
            (!req.description.trim().is_empty()).then_some(req.description.as_str()),
            jwt,
        )
        .await
        .map_err(|err| ApiError::internal(err.message_for_api()))?;
    Ok(OrbitRepoFields {
        git_repo_url: Some(orbit_create_repo_url(base_url, owner, &created.name, &created)),
        git_branch: req.git_branch.clone().or_else(|| Some("main".into())),
        orbit_base_url: Some(base_url.to_string()),
        orbit_owner: Some(owner.to_string()),
        orbit_repo: Some(created.name),
    })
}

/// Shared implementation for both `create_project` and `create_imported_project`.
///
/// Handles the network -> Orbit -> local-shadow flow that both endpoints share.
/// `network_folder` controls what goes into the network request's `folder` field
/// (directory basename for regular projects, `None` for imported).
async fn create_project_impl(
    state: &AppState,
    req: &CreateProjectRequest,
    network_folder: Option<String>,
) -> ApiResult<(StatusCode, Json<Project>)> {
    if let Some(client) = &state.network_client {
        let has_existing_repo = req
            .git_repo_url
            .as_ref()
            .is_some_and(|u| !u.trim().is_empty());
        let has_new_repo =
            req.orbit_owner.is_some() && req.orbit_repo.is_some();
        if !has_existing_repo && !has_new_repo {
            return Err(ApiError::bad_request(
                "An Orbit repo is required: provide orbit_owner and orbit_repo to create a new repo, or git_repo_url to use an existing one",
            ));
        }

        let jwt = state.get_jwt()?;

        let net_req = aura_network::CreateProjectRequest {
            name: req.name.clone(),
            org_id: req.org_id.to_string(),
            description: Some(req.description.clone()),
            folder: network_folder,
            git_repo_url: req.git_repo_url.clone(),
            git_branch: req.git_branch.clone(),
            orbit_base_url: req.orbit_base_url.clone(),
            orbit_owner: req.orbit_owner.clone(),
            orbit_repo: req.orbit_repo.clone(),
        };
        let net_project = client
            .create_project(&jwt, &net_req)
            .await
            .map_err(map_network_error)?;

        let orbit = resolve_orbit_repo(state, req, &net_project, &jwt).await?;

        let local_shadow = build_local_shadow(
            net_project
                .id
                .parse::<ProjectId>()
                .unwrap_or_else(|_| ProjectId::new()),
            req,
            orbit.git_repo_url,
            orbit.git_branch,
            orbit.orbit_base_url,
            orbit.orbit_owner,
            orbit.orbit_repo,
        );
        let project = project_from_network(&net_project, Some(&local_shadow));
        ensure_local_shadow(state, &project);
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

pub async fn create_project(
    State(state): State<AppState>,
    Json(req): Json<CreateProjectRequest>,
) -> ApiResult<(StatusCode, Json<Project>)> {
    if req.name.trim().is_empty() {
        return Err(ApiError::bad_request("name must not be empty"));
    }
    if req.linked_folder_path.trim().is_empty() {
        return Err(ApiError::bad_request("linked_folder_path must not be empty"));
    }

    let folder = folder_name_from_path(&req.linked_folder_path);
    create_project_impl(&state, &req, folder).await
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
        name,
        description,
        linked_folder_path: workspace_root.to_string_lossy().to_string(),
        workspace_source: Some("imported".to_string()),
        workspace_display_path: Some("Imported workspace snapshot".to_string()),
        build_command,
        test_command,
        git_repo_url,
        git_branch,
        orbit_base_url,
        orbit_owner,
        orbit_repo,
    };

    create_project_impl(&state, &local_req, None).await
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
