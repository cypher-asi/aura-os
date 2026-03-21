use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;

use aura_core::{Project, ProjectId};
use aura_projects::UpdateProjectInput;

use crate::dto::{
    CreateImportedProjectRequest, CreateProjectRequest, UpdateProjectRequest,
};
use crate::error::{map_network_error, ApiError, ApiResult};
use crate::state::AppState;

use super::projects_helpers::{
    ListProjectsQuery,
    project_from_network, ensure_local_shadow, folder_name_from_path,
    to_project_input, write_imported_files,
    build_local_shadow, resolve_orbit_repo,
};

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
            let project = project_from_network(net, local.as_ref())?;
            ensure_local_shadow(state, &project);
            projects.push(project);
        }
    }
    Ok(projects)
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

        let project_id = net_project.id.parse::<ProjectId>().map_err(|e| {
            ApiError::internal(format!("unparseable network project id '{}': {e}", net_project.id))
        })?;
        let local_shadow = build_local_shadow(project_id, req, orbit);
        let project = project_from_network(&net_project, Some(&local_shadow))?;
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

            let projects: Vec<Project> = net_projects
                .iter()
                .map(|net| {
                    let local = net
                        .id
                        .parse::<ProjectId>()
                        .ok()
                        .and_then(|project_id| state.project_service.get_project(&project_id).ok());
                    let project = project_from_network(net, local.as_ref())?;
                    ensure_local_shadow(&state, &project);
                    Ok(project)
                })
                .collect::<ApiResult<_>>()?;
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
        let project = project_from_network(&net_project, local.as_ref())?;
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
        let merged = project_from_network(&net_project, Some(&project))?;
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
