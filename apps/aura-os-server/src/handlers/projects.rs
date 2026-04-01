use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;

use aura_os_core::{Project, ProjectId};
use aura_os_projects::UpdateProjectInput;

use crate::dto::{CreateImportedProjectRequest, CreateProjectRequest, UpdateProjectRequest};
use crate::error::{map_network_error, ApiError, ApiResult};
use crate::state::{AppState, AuthJwt};

use super::projects_helpers::{
    build_local_shadow, canonical_workspace_path, ensure_local_shadow, normalize_project_workspace,
    project_from_network, to_project_input, write_imported_files, ListProjectsQuery,
    slugify,
};

pub(crate) async fn list_all_projects_from_network(state: &AppState, jwt: &str) -> ApiResult<Vec<Project>> {
    let client = state.require_network_client()?;
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
            let project =
                normalize_project_workspace(state, &project_from_network(net, local.as_ref())?);
            ensure_local_shadow(state, &project);
            projects.push(project);
        }
    }
    Ok(projects)
}

/// Shared implementation for both `create_project` and `create_imported_project`.
///
/// Handles the network -> local-shadow flow that both endpoints share.
/// `network_folder` controls what goes into the network request's `folder` field
/// (directory basename for regular projects, `None` for imported).
async fn create_project_impl(
    state: &AppState,
    req: &CreateProjectRequest,
    network_folder: Option<String>,
    jwt: &str,
) -> ApiResult<(StatusCode, Json<Project>)> {
    if let (Some(owner), Some(repo)) = (&req.orbit_owner, &req.orbit_repo) {
        if !owner.is_empty() && !repo.is_empty() {
            if let Ok(Some(existing)) = state
                .project_service
                .find_project_by_orbit_repo(owner, repo)
            {
                return Err(ApiError::conflict(format!(
                    "Orbit repo '{owner}/{repo}' is already used by project '{}'",
                    existing.name
                )));
            }
        }
    }

    let project = if let Some(client) = &state.network_client {
        let net_req = aura_os_network::CreateProjectRequest {
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

        let project_id = net_project.id.parse::<ProjectId>().map_err(|e| {
            ApiError::internal(format!(
                "unparseable network project id '{}': {e}",
                net_project.id
            ))
        })?;
        let local_shadow = build_local_shadow(project_id, &req);
        let project = normalize_project_workspace(
            state,
            &project_from_network(&net_project, Some(&local_shadow))?,
        );
        ensure_local_shadow(state, &project);
        project
    } else {
        let input = to_project_input(&req);
        let project = state
            .project_service
            .create_project(input)
            .map_err(|e| match &e {
                aura_os_projects::ProjectError::InvalidInput(msg) => {
                    ApiError::bad_request(msg.clone())
                }
                _ => ApiError::internal(format!("creating project: {e}")),
            })?;
        let project = normalize_project_workspace(state, &project);
        ensure_local_shadow(state, &project);
        project
    };

    if let (Some(owner), Some(repo)) = (&project.orbit_owner, &project.orbit_repo) {
        if !owner.is_empty() && !repo.is_empty() && project.git_repo_url.is_none() {
            if let Some(orbit) = &state.orbit_client {
                if let Err(e) = orbit
                    .ensure_repo(repo, owner, &project.project_id.to_string(), &jwt)
                    .await
                {
                    tracing::warn!(
                        %owner, %repo,
                        error = %e,
                        "Orbit repo creation failed (project was created, repo may need manual setup)"
                    );
                }
            }
        }
    }

    Ok((StatusCode::CREATED, Json(project)))
}

pub(crate) async fn create_project(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Json(req): Json<CreateProjectRequest>,
) -> ApiResult<(StatusCode, Json<Project>)> {
    if req.name.trim().is_empty() {
        return Err(ApiError::bad_request("name must not be empty"));
    }
    let folder = Some(slugify(&req.name));
    create_project_impl(&state, &req, folder, &jwt).await
}

pub(crate) async fn create_imported_project(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
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

    let local_req = CreateProjectRequest {
        org_id,
        name,
        description,
        build_command,
        test_command,
        git_repo_url,
        git_branch,
        orbit_base_url,
        orbit_owner,
        orbit_repo,
    };

    let (status, Json(project)) = create_project_impl(&state, &local_req, None, &jwt).await?;
    let workspace_root = canonical_workspace_path(&state.data_dir, &project.project_id);

    tokio::fs::create_dir_all(&workspace_root)
        .await
        .map_err(|e| ApiError::internal(format!("failed to create imported workspace directory: {e}")))?;
    write_imported_files(&workspace_root, files).await?;

    Ok((status, Json(project)))
}

pub(crate) async fn list_projects(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Query(query): Query<ListProjectsQuery>,
) -> ApiResult<Json<Vec<Project>>> {
    if let Some(ref org_id) = query.org_id {
        if let Some(client) = &state.network_client {
            let net_projects = client
                .list_projects_by_org(&org_id.to_string(), &jwt)
                .await
                .map_err(map_network_error)?;

            let projects: Vec<Project> = net_projects
                .iter()
                .map(|net| {
                    let local =
                        net.id.parse::<ProjectId>().ok().and_then(|project_id| {
                            state.project_service.get_project(&project_id).ok()
                        });
                    let project = normalize_project_workspace(
                        &state,
                        &project_from_network(net, local.as_ref())?,
                    );
                    ensure_local_shadow(&state, &project);
                    Ok(project)
                })
                .collect::<ApiResult<_>>()?;
            return Ok(Json(projects));
        }

        let projects = state
            .project_service
            .list_projects_by_org(org_id)
            .map_err(|e| ApiError::internal(format!("listing projects by org: {e}")))?;
        let projects = projects
            .iter()
            .map(|project| {
                let normalized = normalize_project_workspace(&state, project);
                ensure_local_shadow(&state, &normalized);
                normalized
            })
            .collect();
        return Ok(Json(projects));
    }

    let projects = state
        .project_service
        .list_projects()
        .map_err(|e| ApiError::internal(format!("listing projects: {e}")))?;
    let projects = projects
        .iter()
        .map(|project| {
            let normalized = normalize_project_workspace(&state, project);
            ensure_local_shadow(&state, &normalized);
            normalized
        })
        .collect();
    Ok(Json(projects))
}

pub(crate) async fn get_project(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<Project>> {
    if let Some(client) = &state.network_client {
        let net_project = client
            .get_project(&project_id.to_string(), &jwt)
            .await
            .map_err(map_network_error)?;
        let local = state.project_service.get_project(&project_id).ok();
        let project = normalize_project_workspace(
            &state,
            &project_from_network(&net_project, local.as_ref())?,
        );
        ensure_local_shadow(&state, &project);
        return Ok(Json(project));
    }

    let project = state
        .project_service
        .get_project(&project_id)
        .map_err(|e| match &e {
            aura_os_projects::ProjectError::NotFound(_) => ApiError::not_found("project not found"),
            _ => ApiError::internal(format!("fetching project: {e}")),
        })?;
    let project = normalize_project_workspace(&state, &project);
    ensure_local_shadow(&state, &project);
    Ok(Json(project))
}

pub(crate) async fn update_project(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<ProjectId>,
    Json(req): Json<UpdateProjectRequest>,
) -> ApiResult<Json<Project>> {
    let input = UpdateProjectInput {
        name: req.name.clone(),
        description: req.description.clone(),
        build_command: req.build_command.clone(),
        test_command: req.test_command.clone(),
    };
    let project = state
        .project_service
        .update_project(&project_id, input)
        .map_err(|e| match &e {
            aura_os_projects::ProjectError::NotFound(_) => ApiError::not_found("project not found"),
            aura_os_projects::ProjectError::InvalidInput(msg) => ApiError::bad_request(msg.clone()),
            _ => ApiError::internal(format!("updating project: {e}")),
        })?;

    if let Some(client) = &state.network_client {
        let net_req = aura_os_network::UpdateProjectRequest {
            name: req.name.clone(),
            description: req.description.clone(),
            folder: None,
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
        let merged = normalize_project_workspace(
            &state,
            &project_from_network(&net_project, Some(&project))?,
        );
        ensure_local_shadow(&state, &merged);
        return Ok(Json(merged));
    }

    let project = normalize_project_workspace(&state, &project);
    ensure_local_shadow(&state, &project);
    Ok(Json(project))
}

pub(crate) async fn delete_project(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<StatusCode> {
    // Verify the project exists locally before attempting remote deletion.
    state
        .project_service
        .get_project(&project_id)
        .map_err(|e| match &e {
            aura_os_projects::ProjectError::NotFound(_) => ApiError::not_found("project not found"),
            _ => ApiError::internal(format!("verifying project exists: {e}")),
        })?;

    // Delete remotely first so that a rejection (e.g. project has agent
    // children) prevents us from removing the local copy.
    if let Some(client) = &state.network_client {
        client
            .delete_project(&project_id.to_string(), &jwt)
            .await
            .map_err(map_network_error)?;
    }

    state
        .project_service
        .delete_project(&project_id)
        .map_err(|e| ApiError::internal(format!("deleting project: {e}")))?;

    Ok(StatusCode::NO_CONTENT)
}

pub(crate) async fn archive_project(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<Project>> {
    let project = state
        .project_service
        .archive_project(&project_id)
        .map_err(|e| match &e {
            aura_os_projects::ProjectError::NotFound(_) => ApiError::not_found("project not found"),
            _ => ApiError::internal(format!("archiving project: {e}")),
        })?;
    Ok(Json(project))
}
