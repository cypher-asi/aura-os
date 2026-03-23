use axum::extract::{Path, Query, State};
use serde::Deserialize;

use aura_os_core::ProjectId;

use crate::error::{map_network_error, ApiError, ApiResult};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct ListOrbitReposQuery {
    pub q: Option<String>,
}

/// GET /api/orbit/repos?q=...
/// Returns repos the current user can use (JWT auth). Requires ORBIT_BASE_URL to be set.
/// Each repo includes a resolved clone_url for Git operations.
pub async fn list_orbit_repos(
    State(state): State<AppState>,
    Query(query): Query<ListOrbitReposQuery>,
) -> ApiResult<axum::Json<Vec<aura_os_orbit::OrbitRepo>>> {
    let base_url = state
        .orbit_base_url
        .as_deref()
        .ok_or_else(|| ApiError::service_unavailable("Orbit is not configured (ORBIT_BASE_URL)"))?;
    let jwt = state.get_jwt()?;

    let repos = state
        .orbit_client
        .list_repos(base_url, &jwt, query.q.as_deref())
        .await
        .map_err(|e| ApiError::internal(format!("listing orbit repos: {e}")))?;

    let repos_with_url: Vec<aura_os_orbit::OrbitRepo> = repos
        .into_iter()
        .map(|r| {
            let clone_url = Some(r.clone_url_or(base_url));
            aura_os_orbit::OrbitRepo {
                id: r.id,
                name: r.name,
                owner: r.owner,
                full_name: r.full_name,
                clone_url,
                git_url: r.git_url,
            }
        })
        .collect();

    Ok(axum::Json(repos_with_url))
}

/// GET /api/projects/:project_id/orbit-collaborators
/// Returns Orbit repo collaborators for a project with an Orbit link. Uses current user's JWT.
/// "Can add people" = repo owner + users with owner role.
pub async fn get_project_orbit_collaborators(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<axum::Json<Vec<aura_os_orbit::OrbitCollaborator>>> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;
    let net_project = client
        .get_project(&project_id.to_string(), &jwt)
        .await
        .map_err(map_network_error)?;

    let base_url = net_project
        .orbit_base_url
        .as_deref()
        .or(state.orbit_base_url.as_deref())
        .ok_or_else(|| ApiError::bad_request("project has no Orbit link"))?;
    let owner = net_project
        .orbit_owner
        .as_deref()
        .ok_or_else(|| ApiError::bad_request("project has no Orbit link"))?;
    let repo = net_project
        .orbit_repo
        .as_deref()
        .ok_or_else(|| ApiError::bad_request("project has no Orbit link"))?;

    let collaborators = state
        .orbit_client
        .list_collaborators(base_url, owner, repo, &jwt)
        .await
        .map_err(|e| ApiError::internal(format!("listing orbit collaborators: {e}")))?;

    Ok(axum::Json(collaborators))
}
