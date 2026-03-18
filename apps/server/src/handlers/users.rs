use axum::extract::{Path, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use tracing::warn;

use aura_network::{NetworkProfile, NetworkUser};

use crate::error::{map_network_error, ApiResult};
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Response types (snake_case for local API)
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct UserResponse {
    pub id: String,
    pub zos_user_id: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub bio: Option<String>,
    pub profile_id: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

impl From<NetworkUser> for UserResponse {
    fn from(u: NetworkUser) -> Self {
        Self {
            id: u.id,
            zos_user_id: u.zos_user_id,
            display_name: u.display_name,
            avatar_url: u.avatar_url,
            bio: u.bio,
            profile_id: u.profile_id,
            created_at: u.created_at,
            updated_at: u.updated_at,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct ProfileResponse {
    pub id: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub bio: Option<String>,
    pub profile_type: Option<String>,
    pub entity_id: Option<String>,
}

impl From<NetworkProfile> for ProfileResponse {
    fn from(p: NetworkProfile) -> Self {
        Self {
            id: p.id,
            display_name: p.display_name,
            avatar_url: p.avatar_url,
            bio: p.bio,
            profile_type: p.profile_type,
            entity_id: p.entity_id,
        }
    }
}

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct UpdateMeRequest {
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub bio: Option<String>,
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /api/users/me — proxy to aura-network, returns the current user.
pub async fn get_me(State(state): State<AppState>) -> ApiResult<Json<UserResponse>> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;

    let user = client
        .get_current_user(&jwt)
        .await
        .map_err(map_network_error)?;

    Ok(Json(UserResponse::from(user)))
}

/// GET /api/users/:id — proxy to aura-network, returns a user by ID.
pub async fn get_user(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> ApiResult<Json<UserResponse>> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;

    let user = client
        .get_user(&user_id, &jwt)
        .await
        .map_err(map_network_error)?;

    Ok(Json(UserResponse::from(user)))
}

/// PUT /api/users/me — proxy to aura-network, updates the current user.
pub async fn update_me(
    State(state): State<AppState>,
    Json(req): Json<UpdateMeRequest>,
) -> ApiResult<Json<UserResponse>> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;

    let network_req = aura_network::UpdateUserRequest {
        display_name: req.display_name,
        avatar_url: req.avatar_url,
        bio: req.bio,
    };

    let user = client
        .update_current_user(&jwt, &network_req)
        .await
        .map_err(map_network_error)?;

    Ok(Json(UserResponse::from(user)))
}

/// GET /api/users/:id/profile — proxy to aura-network, returns a user's profile.
pub async fn get_user_profile(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> ApiResult<Json<ProfileResponse>> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;

    let profile = client
        .get_user_profile(&user_id, &jwt)
        .await
        .map_err(map_network_error)?;

    Ok(Json(ProfileResponse::from(profile)))
}

/// GET /api/profiles/:id — proxy to aura-network, returns a profile by ID.
pub async fn get_profile(
    State(state): State<AppState>,
    Path(profile_id): Path<String>,
) -> ApiResult<Json<ProfileResponse>> {
    let client = state.require_network_client()?;
    let jwt = state.get_jwt()?;

    let profile = client
        .get_profile(&profile_id, &jwt)
        .await
        .map_err(map_network_error)?;

    Ok(Json(ProfileResponse::from(profile)))
}

/// Fire-and-forget user sync: ensures the user exists in aura-network.
/// Logs warnings on failure but never blocks the caller.
pub async fn sync_user_to_network(state: &AppState, access_token: &str) {
    if let Some(client) = &state.network_client {
        match client.get_current_user(access_token).await {
            Ok(user) => {
                tracing::info!(
                    network_user_id = %user.id,
                    display_name = ?user.display_name,
                    "User synced to aura-network"
                );
            }
            Err(e) => {
                warn!(error = %e, "Failed to sync user to aura-network (non-fatal)");
            }
        }
    }
}
