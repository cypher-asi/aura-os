use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Redirect;
use axum::Json;

use aura_core::*;

use crate::dto::{
    GitHubCallbackQuery, GitHubInstallResponse, GitHubIntegrationResponse, GitHubRepoResponse,
};
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

fn map_gh_err(e: aura_github::GitHubError) -> (StatusCode, Json<ApiError>) {
    match &e {
        aura_github::GitHubError::NotConfigured(msg) => ApiError::bad_request(msg.clone()),
        aura_github::GitHubError::IntegrationNotFound => {
            ApiError::not_found("integration not found")
        }
        _ => ApiError::internal(e.to_string()),
    }
}

fn get_user_id(state: &AppState) -> Result<(String, String), (StatusCode, Json<ApiError>)> {
    let session_bytes = state
        .store
        .get_setting("zero_auth_session")
        .map_err(|_| ApiError::unauthorized("not authenticated"))?;
    let session: ZeroAuthSession =
        serde_json::from_slice(&session_bytes).map_err(|e| ApiError::internal(e.to_string()))?;
    Ok((session.user_id, session.display_name))
}

pub async fn list_integrations(
    State(state): State<AppState>,
    Path(org_id): Path<OrgId>,
) -> ApiResult<Json<Vec<GitHubIntegrationResponse>>> {
    let integrations = state
        .github_service
        .list_integrations(&org_id)
        .map_err(map_gh_err)?;

    let mut responses = Vec::with_capacity(integrations.len());
    for int in integrations {
        let repo_count = state
            .github_service
            .list_repos_for_integration(&int.integration_id)
            .map(|r| r.len())
            .unwrap_or(0);
        responses.push(GitHubIntegrationResponse::from_integration(int, repo_count));
    }

    Ok(Json(responses))
}

pub async fn start_install(
    State(state): State<AppState>,
    Path(org_id): Path<OrgId>,
) -> ApiResult<Json<GitHubInstallResponse>> {
    let install_url = state
        .github_service
        .generate_install_url(&org_id)
        .map_err(map_gh_err)?;

    Ok(Json(GitHubInstallResponse { install_url }))
}

pub async fn github_callback(
    State(state): State<AppState>,
    Query(query): Query<GitHubCallbackQuery>,
) -> Result<Redirect, (StatusCode, Json<ApiError>)> {
    let installation_id = query.installation_id;

    let org_id_str = query
        .state
        .ok_or_else(|| ApiError::bad_request("missing state (org_id)"))?;

    let org_id: OrgId = org_id_str
        .parse()
        .map_err(|_| ApiError::bad_request("invalid org_id in state"))?;

    let (user_id, _) = get_user_id(&state)?;

    state
        .github_service
        .handle_installation_callback(installation_id, &org_id, &user_id)
        .await
        .map_err(map_gh_err)?;

    Ok(Redirect::to("/?github_installed=true"))
}

pub async fn remove_integration(
    State(state): State<AppState>,
    Path((org_id, integration_id)): Path<(OrgId, GitHubIntegrationId)>,
) -> ApiResult<StatusCode> {
    state
        .github_service
        .disconnect_integration(&org_id, &integration_id)
        .map_err(map_gh_err)?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn list_repos(
    State(state): State<AppState>,
    Path(org_id): Path<OrgId>,
) -> ApiResult<Json<Vec<GitHubRepoResponse>>> {
    let repos = state
        .github_service
        .list_repos_for_org(&org_id)
        .map_err(map_gh_err)?;

    let responses: Vec<GitHubRepoResponse> = repos.into_iter().map(GitHubRepoResponse::from).collect();
    Ok(Json(responses))
}

pub async fn refresh_integration(
    State(state): State<AppState>,
    Path((org_id, integration_id)): Path<(OrgId, GitHubIntegrationId)>,
) -> ApiResult<Json<Vec<GitHubRepoResponse>>> {
    let repos = state
        .github_service
        .refresh_integration(&org_id, &integration_id)
        .await
        .map_err(map_gh_err)?;

    let responses: Vec<GitHubRepoResponse> = repos.into_iter().map(GitHubRepoResponse::from).collect();
    Ok(Json(responses))
}
