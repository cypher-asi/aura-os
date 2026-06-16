use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;

use aura_os_core::{Project, ProjectId};
use aura_os_projects::UpdateProjectInput;

use crate::capture_auth::{demo_org_id, demo_project, demo_project_id, is_capture_access_token};
use crate::dto::{CreateImportedProjectRequest, CreateProjectRequest, UpdateProjectRequest};
use crate::error::{map_network_error, ApiError, ApiResult, UpstreamErrorContext};
use crate::state::{AppState, AuthJwt};

use super::projects_helpers::{
    build_local_shadow, canonical_workspace_path, ensure_canonical_workspace_dir,
    ensure_local_shadow, normalize_project_workspace, project_from_network, slugify,
    to_project_input, write_imported_files, ListProjectsQuery,
};

pub(crate) async fn list_all_projects_from_network(
    state: &AppState,
    jwt: &str,
) -> ApiResult<Vec<Project>> {
    let client = state.require_network_client()?;
    let orgs = client.list_orgs(jwt).await.map_err(map_network_error)?;

    // Fan out one `list_projects_by_org` call per org in parallel.
    // The sequential version used to dominate chat setup latency for
    // users with more than a couple of orgs; every chat turn walks
    // through `find_matching_project_agents` which depends on this
    // enumeration finishing before the LLM can see the user message.
    let futs = orgs
        .iter()
        .map(|org| client.list_projects_by_org(&org.id, jwt));
    let results = futures_util::future::join_all(futs).await;

    let mut projects = Vec::new();
    for result in results {
        let net_projects = result.map_err(map_network_error)?;
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
            .create_project(jwt, &net_req)
            .await
            .map_err(map_network_error)?;

        let project_id = net_project.id.parse::<ProjectId>().map_err(|e| {
            ApiError::internal(format!(
                "unparseable network project id '{}': {e}",
                net_project.id
            ))
        })?;
        let local_shadow = build_local_shadow(project_id, req);
        let project = normalize_project_workspace(
            state,
            &project_from_network(&net_project, Some(&local_shadow))?,
        );
        ensure_local_shadow(state, &project);
        project
    } else {
        let input = to_project_input(req);
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
            try_ensure_orbit_repo(state, owner, repo, &project.project_id.to_string(), jwt).await;
        }
    }

    ensure_canonical_workspace_dir(&state.data_dir, &project.project_id)?;

    Ok((StatusCode::CREATED, Json(project)))
}

/// Best-effort Orbit `ensure_repo` for a freshly created or freshly
/// attached project.
///
/// Failures are intentionally **non-fatal**: when Orbit is unreachable,
/// misconfigured, or returns a 5xx (e.g. `failed to initialize
/// repository storage` from an exhausted-rootfs deploy), the project
/// stays created with its `orbit_owner` / `orbit_repo` metadata intact.
/// Rationale:
///   - Project creation should not be coupled to a third-party service's
///     transient availability. Rolling back the project for an
///     Orbit-only failure leaves the user with nothing usable and no
///     obvious recovery path.
///   - `OrbitClient::ensure_repo` already treats `409 Conflict` as
///     success, so the *next* code path that needs the Orbit repo (push
///     from the dev loop, manual re-attach via `update_project`, etc.)
///     can safely re-invoke it and will succeed once Orbit recovers.
///   - The push path classifies the downstream failure mode as
///     `remote_storage_exhausted` / `push_deferred` and surfaces it
///     through the Orbit status indicator and project banner (see
///     `docs/render-deployment.md` "Orbit ENOSPC runbook"), so the user
///     still gets a clear "Orbit is unhealthy" signal — just at push
///     time rather than at create time.
async fn try_ensure_orbit_repo(
    state: &AppState,
    owner: &str,
    repo: &str,
    project_id: &str,
    jwt: &str,
) {
    let Some(orbit) = state.orbit_client.as_deref() else {
        tracing::warn!(
            %owner, %repo, %project_id,
            "Orbit client not configured (ORBIT_BASE_URL not set); \
             skipping Orbit repo creation — project will work without Orbit \
             until ORBIT_BASE_URL is set and the repo is created."
        );
        return;
    };

    if let Err(e) = orbit.ensure_repo(repo, owner, project_id, jwt).await {
        tracing::warn!(
            %owner, %repo, %project_id,
            error = %e,
            "Orbit repo creation failed; project kept anyway. \
             Pushes to this Orbit repo will fail until Orbit recovers \
             and the repo is created (idempotent retry)."
        );
    }
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
        local_workspace_path,
    } = req;

    let import_by_reference = files.is_empty()
        && local_workspace_path
            .as_deref()
            .map(str::trim)
            .is_some_and(|path| !path.is_empty());

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
        local_workspace_path,
    };

    let (status, Json(project)) = create_project_impl(&state, &local_req, None, &jwt).await?;
    if !import_by_reference {
        let workspace_root = ensure_canonical_workspace_dir(&state.data_dir, &project.project_id)?;
        write_imported_files(&workspace_root, files).await?;
    }

    Ok((status, Json(project)))
}

pub(crate) async fn list_projects(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Query(query): Query<ListProjectsQuery>,
) -> ApiResult<Json<Vec<Project>>> {
    if is_capture_access_token(&jwt) {
        if query
            .org_id
            .as_ref()
            .map_or(true, |org_id| org_id == &demo_org_id())
        {
            return Ok(Json(vec![demo_project()]));
        }
        return Ok(Json(Vec::new()));
    }

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

    if state.network_client.is_some() {
        return Ok(Json(list_all_projects_from_network(&state, &jwt).await?));
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
    if is_capture_access_token(&jwt) && project_id == demo_project_id() {
        return Ok(Json(demo_project()));
    }

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
        local_workspace_path: req.local_workspace_path.clone().map(|inner| {
            inner.and_then(|value| {
                let trimmed = value.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                }
            })
        }),
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
        // Detect a "first-time Orbit attach" before we mutate the project so
        // we know whether to create the Orbit repo after the network update.
        // Only attach when the project did not already have one (avoids
        // re-creating a repo that already exists for this project) and the
        // caller did not bring their own `git_repo_url` (which signals a
        // link-to-existing flow rather than a create-new flow).
        let attaching_new_orbit_repo = matches!(
            (&req.orbit_owner, &req.orbit_repo),
            (Some(o), Some(r)) if !o.is_empty() && !r.is_empty()
        ) && project.orbit_owner.as_deref().unwrap_or("").is_empty()
            && project.orbit_repo.as_deref().unwrap_or("").is_empty()
            && req
                .git_repo_url
                .as_deref()
                .map(str::trim)
                .unwrap_or("")
                .is_empty();

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

        if attaching_new_orbit_repo {
            if let (Some(owner), Some(repo)) = (&merged.orbit_owner, &merged.orbit_repo) {
                if !owner.is_empty() && !repo.is_empty() {
                    try_ensure_orbit_repo(
                        &state,
                        owner,
                        repo,
                        &merged.project_id.to_string(),
                        &jwt,
                    )
                    .await;
                }
            }
        }

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
            .map_err(|e| map_project_delete_error(&project_id, e))?;
    }

    state
        .project_service
        .delete_project(&project_id)
        .map_err(|e| ApiError::internal(format!("deleting project: {e}")))?;

    // Clean up local workspace directory (best-effort)
    let workspace = canonical_workspace_path(&state.data_dir, &project_id);
    if workspace.exists() {
        if let Err(e) = tokio::fs::remove_dir_all(&workspace).await {
            tracing::warn!(
                project_id = %project_id,
                path = %workspace.display(),
                error = %e,
                "failed to remove workspace directory"
            );
        }
    }

    Ok(StatusCode::NO_CONTENT)
}

/// Translate upstream delete-project errors into user-actionable responses.
///
/// The aura-network backend tends to return a generic
/// `500 {"error":{"code":"DATABASE","message":"An internal error occurred"}}`
/// when a project can't be deleted because rows in a sibling table still
/// reference it (agents, sessions, feed entries, etc.). That bubbles up to
/// the UI as the unhelpful "An internal error occurred". Rewrite the common
/// cases to a `409 Conflict` with an actionable message, while preserving
/// the upstream context in `details` for diagnostics.
fn map_project_delete_error(
    project_id: &ProjectId,
    e: aura_os_network::NetworkError,
) -> (StatusCode, Json<ApiError>) {
    if let aura_os_network::NetworkError::Server { status, body } = &e {
        if *status == 500 {
            let ctx = UpstreamErrorContext::parse(body);
            if ctx.upstream_code.as_deref() == Some("DATABASE") {
                tracing::warn!(
                    %project_id,
                    upstream_message = ?ctx.upstream_message,
                    body_preview = %body.chars().take(200).collect::<String>(),
                    "opaque DATABASE error from aura-network on project delete; \
                     likely a residual FK (feed, session, swarm, orbit metadata, etc.)",
                );
                let detail_msg = ctx
                    .upstream_message
                    .as_deref()
                    .unwrap_or("An internal error occurred");
                return ApiError::conflict_with_details(
                    "Project can't be deleted because it still has linked resources \
                     (e.g. sessions, feed entries, or orbit metadata). Remove or \
                     archive those first, or archive the project instead.",
                    format!("upstream: DATABASE - {detail_msg}"),
                );
            }
        }
    }
    map_network_error(e)
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
