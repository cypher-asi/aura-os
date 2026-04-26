use axum::extract::{Path, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use tracing::warn;

use aura_os_core::ZeroAuthSession;
use aura_os_network::{NetworkProfile, NetworkUser};

use crate::capture_auth::is_capture_access_token;
use crate::error::{map_network_error, ApiResult};
use crate::state::{persist_zero_auth_session, AppState, AuthJwt};

// ---------------------------------------------------------------------------
// Response types (snake_case for local API)
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub(crate) struct UserResponse {
    pub id: String,
    pub zos_user_id: Option<String>,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub bio: Option<String>,
    pub location: Option<String>,
    pub website: Option<String>,
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
            location: u.location,
            website: u.website,
            profile_id: u.profile_id,
            created_at: u.created_at,
            updated_at: u.updated_at,
        }
    }
}

#[derive(Debug, Serialize)]
pub(crate) struct ProfileResponse {
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
pub(crate) struct UpdateMeRequest {
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub bio: Option<String>,
    pub location: Option<String>,
    pub website: Option<String>,
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /api/users/me — proxy to aura-network, returns the current user.
pub(crate) async fn get_me(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
) -> ApiResult<Json<UserResponse>> {
    if is_capture_access_token(&jwt) {
        return Ok(Json(UserResponse {
            id: "capture-demo-user".into(),
            zos_user_id: Some("capture-demo-user".into()),
            display_name: Some("Aura Capture".into()),
            avatar_url: None,
            bio: Some("Demo user for Aura changelog media capture.".into()),
            location: None,
            website: None,
            profile_id: None,
            created_at: None,
            updated_at: None,
        }));
    }

    let client = state.require_network_client()?;

    let user = client
        .get_current_user(&jwt)
        .await
        .map_err(map_network_error)?;

    Ok(Json(UserResponse::from(user)))
}

/// GET /api/users/:id — proxy to aura-network, returns a user by ID.
pub(crate) async fn get_user(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(user_id): Path<String>,
) -> ApiResult<Json<UserResponse>> {
    let client = state.require_network_client()?;

    let user = client
        .get_user(&user_id, &jwt)
        .await
        .map_err(map_network_error)?;

    Ok(Json(UserResponse::from(user)))
}

/// PUT /api/users/me — proxy to aura-network, updates the current user.
pub(crate) async fn update_me(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Json(req): Json<UpdateMeRequest>,
) -> ApiResult<Json<UserResponse>> {
    let client = state.require_network_client()?;

    let network_req = aura_os_network::UpdateUserRequest {
        display_name: req.display_name,
        avatar_url: req.avatar_url,
        bio: req.bio,
        location: req.location,
        website: req.website,
    };

    let user = client
        .update_current_user(&jwt, &network_req)
        .await
        .map_err(map_network_error)?;

    Ok(Json(UserResponse::from(user)))
}

/// GET /api/users/:id/profile — proxy to aura-network, returns a user's profile.
pub(crate) async fn get_user_profile(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(user_id): Path<String>,
) -> ApiResult<Json<ProfileResponse>> {
    let client = state.require_network_client()?;

    let profile = client
        .get_user_profile(&user_id, &jwt)
        .await
        .map_err(map_network_error)?;

    Ok(Json(ProfileResponse::from(profile)))
}

/// GET /api/profiles/:id — proxy to aura-network, returns a profile by ID.
pub(crate) async fn get_profile(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(profile_id): Path<String>,
) -> ApiResult<Json<ProfileResponse>> {
    let client = state.require_network_client()?;

    let profile = client
        .get_profile(&profile_id, &jwt)
        .await
        .map_err(map_network_error)?;

    Ok(Json(ProfileResponse::from(profile)))
}

/// Sync user to aura-network: populates `network_user_id` and `profile_id`
/// on the session and refreshes the server-side auth cache plus
/// the in-memory validation cache. Best-effort — logs warnings on failure
/// but never errors out.
pub(crate) async fn sync_user_to_network(state: &AppState, session: &mut ZeroAuthSession) {
    if let Some(client) = &state.network_client {
        match client.get_current_user(&session.access_token).await {
            Ok(user) => {
                session.network_user_id = user.user_id_typed();
                session.profile_id = user.profile_id_typed();
                session.is_access_granted = user.is_access_granted;

                // Auto-grant access for Pro users who don't have it yet
                if session.is_zero_pro && !user.is_access_granted {
                    match client.grant_access(&session.access_token).await {
                        Ok(()) => {
                            session.is_access_granted = true;
                            tracing::info!("Auto-granted access for Pro user");
                        }
                        Err(e) => {
                            tracing::warn!(error = %e, "Failed to auto-grant access for Pro user");
                        }
                    }
                }

                // Update validation cache with enriched session
                state.validation_cache.insert(
                    session.access_token.clone(),
                    crate::state::CachedSession {
                        session: session.clone(),
                        validated_at: std::time::Instant::now(),
                        zero_pro_refresh_error: None,
                    },
                );
                persist_zero_auth_session(&state.store, session);

                let local_name = &session.display_name;
                let remote_name = user.display_name.as_deref().unwrap_or("");
                let is_uuid = remote_name.len() == 36
                    && remote_name.chars().filter(|c| *c == '-').count() == 4;
                let should_push = !local_name.is_empty()
                    && local_name != remote_name
                    && (remote_name.is_empty() || is_uuid);

                if should_push {
                    let update = aura_os_network::UpdateUserRequest {
                        display_name: Some(local_name.clone()),
                        avatar_url: None,
                        bio: None,
                        location: None,
                        website: None,
                    };
                    match client
                        .update_current_user(&session.access_token, &update)
                        .await
                    {
                        Ok(_) => tracing::info!(
                            display_name = %local_name,
                            "Pushed display name to aura-network"
                        ),
                        Err(e) => warn!(error = %e, "Failed to push display name (non-fatal)"),
                    }
                }

                tracing::info!(
                    network_user_id = %user.id,
                    profile_id = ?user.profile_id,
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
