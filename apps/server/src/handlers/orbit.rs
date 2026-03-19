use axum::extract::{Query, State};
use serde::Deserialize;

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct ListOrbitReposQuery {
    pub q: Option<String>,
}

/// GET /api/orbit/repos?q=...
/// Returns repos the current user can use (JWT auth). Requires ORBIT_BASE_URL to be set.
pub async fn list_orbit_repos(
    State(state): State<AppState>,
    Query(query): Query<ListOrbitReposQuery>,
) -> ApiResult<axum::Json<Vec<aura_orbit::OrbitRepo>>> {
    let base_url = state
        .orbit_base_url
        .as_deref()
        .ok_or_else(|| ApiError::service_unavailable("Orbit is not configured (ORBIT_BASE_URL)"))?;
    let jwt = state.get_jwt()?;

    let repos = state
        .orbit_client
        .list_repos(base_url, &jwt, query.q.as_deref())
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;

    Ok(axum::Json(repos))
}
