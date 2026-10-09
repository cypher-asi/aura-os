use std::sync::LazyLock;
use std::time::{Duration, Instant};

use axum::extract::{Path, State};
use axum::Json;
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use tracing::warn;

use aura_os_core::ZeroAuthSession;
use aura_os_network::{NetworkProfile, NetworkUser};

use crate::capture_auth::is_capture_access_token;
use crate::error::{map_network_error, ApiResult};
use crate::state::{persist_zero_auth_session, AppState, AuthJwt};

use super::upload::PresignResponse;

/// How long a successful aura-network sync is "fresh" for. Hit at the top
/// of [`sync_user_to_network`] to short-circuit the per-request sync that
/// otherwise fires on every `GET /api/auth/session` — the frontend host
/// probe in `host-store.ts` polls that endpoint every 20 s purely as a
/// connectivity check, and the unthrottled sync was both spamming the
/// log and round-tripping to aura-network on every poll.
///
/// Five minutes is short enough that any meaningful profile change
/// becomes visible within a single page-load worth of polls, and long
/// enough that an idle session does not generate background network
/// traffic. Callers that need an authoritative refresh (currently only
/// the `POST /api/auth/validate` handler) pass `force = true` to bypass
/// the cache.
const SYNC_DEDUPE_TTL: Duration = Duration::from_secs(300);

/// Tracks the last time we successfully ran the aura-network sync for a
/// given zOS access token. Keyed by token so a token rotation (new login,
/// new refresh, capture-session import) starts fresh; stale entries for
/// expired tokens leak a `(String, Instant)` pair (~50 B) until logout,
/// which is acceptable given the bounded number of concurrent users.
static LAST_NETWORK_SYNC: LazyLock<DashMap<String, Instant>> = LazyLock::new(DashMap::new);

/// Drop the cached "last synced" entry for `access_token`. Wired into the
/// logout handler so the dedupe map doesn't retain entries for tokens
/// that have been explicitly invalidated.
pub(crate) fn clear_user_network_sync_dedupe(access_token: &str) {
    LAST_NETWORK_SYNC.remove(access_token);
}

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

fn zos_api_url() -> String {
    std::env::var("ZOS_API_URL").unwrap_or_else(|_| "https://zosapi.zero.tech".to_string())
}

/// Download an mxc:// image from the Matrix homeserver and re-upload it to
/// AURA's S3 via the presign flow.  Returns the permanent S3 URL.
///
/// Flow:  zOS SSO token → Matrix login → authenticated media download → S3.
/// Returns `None` on any failure (non-fatal).
async fn rehost_mxc_avatar(
    state: &AppState,
    mxc_url: &str,
    zos_access_token: &str,
    router_jwt: &str,
) -> Option<String> {
    let rest = mxc_url.strip_prefix("mxc://")?;
    let (server, media_id) = rest.split_once('/')?;

    // 1. Get Matrix SSO token from zOS API
    let sso_resp = state
        .http_client
        .get(format!("{}/accounts/ssoToken", zos_api_url()))
        .bearer_auth(zos_access_token)
        .send()
        .await
        .ok()?;
    if !sso_resp.status().is_success() {
        tracing::warn!(status = %sso_resp.status(), "Failed to get zOS SSO token for avatar download");
        return None;
    }
    let sso_body: serde_json::Value = sso_resp.json().await.ok()?;
    let sso_token = sso_body.get("token")?.as_str()?;

    // 2. Discover the real Matrix homeserver URL via .well-known
    let well_known_resp = state
        .http_client
        .get(format!("https://{server}/.well-known/matrix/client"))
        .send()
        .await
        .ok()?;
    let homeserver_url = if well_known_resp.status().is_success() {
        let wk: serde_json::Value = well_known_resp.json().await.ok()?;
        wk.get("m.homeserver")?
            .get("base_url")?
            .as_str()?
            .trim_end_matches('/')
            .to_string()
    } else {
        format!("https://{server}")
    };

    // 3. Login to Matrix with the SSO token to get a Matrix access token
    let login_resp = state
        .http_client
        .post(format!("{homeserver_url}/_matrix/client/v3/login"))
        .json(&serde_json::json!({
            "type": "org.matrix.login.jwt",
            "token": sso_token,
        }))
        .send()
        .await
        .ok()?;
    if !login_resp.status().is_success() {
        tracing::warn!(status = %login_resp.status(), "Failed Matrix login for avatar download");
        return None;
    }
    let login_body: serde_json::Value = login_resp.json().await.ok()?;
    let matrix_access_token = login_body.get("access_token")?.as_str()?;

    // 4. Download the avatar image from Matrix
    let download_url =
        format!("{homeserver_url}/_matrix/client/v1/media/download/{server}/{media_id}");
    let image_resp = state
        .http_client
        .get(&download_url)
        .bearer_auth(matrix_access_token)
        .send()
        .await
        .ok()?;
    if !image_resp.status().is_success() {
        tracing::warn!(status = %image_resp.status(), "Failed to download mxc avatar from Matrix");
        return None;
    }

    let content_type = image_resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/png")
        .to_string();
    let image_bytes = image_resp.bytes().await.ok()?;

    // 5. Presign via aura-router and upload to S3
    let presign_url = format!("{}/v1/upload/presign", state.router_url);
    let presign_resp = state
        .http_client
        .post(&presign_url)
        .bearer_auth(router_jwt)
        .json(&serde_json::json!({
            "content_type": content_type,
            "filename": format!("zos-avatar-{media_id}.{ext}",
                ext = match content_type.as_str() {
                    "image/jpeg" => "jpg",
                    "image/gif" => "gif",
                    "image/webp" => "webp",
                    _ => "png",
                }),
        }))
        .send()
        .await
        .ok()?;
    if !presign_resp.status().is_success() {
        tracing::warn!(status = %presign_resp.status(), "Failed to get presigned URL for avatar re-upload");
        return None;
    }
    let presign: PresignResponse = presign_resp.json().await.ok()?;

    let upload_resp = state
        .http_client
        .put(&presign.upload_url)
        .header("content-type", &content_type)
        .body(image_bytes)
        .send()
        .await
        .ok()?;
    if !upload_resp.status().is_success() {
        let status = upload_resp.status();
        let body = upload_resp.text().await.unwrap_or_default();
        tracing::warn!(%status, s3_error_code = ?super::upload::s3_error_code(&body), "Failed to upload avatar to S3");
        return None;
    }

    // Clean up the Matrix session we created for the download.
    match state
        .http_client
        .post(format!("{homeserver_url}/_matrix/client/v3/logout"))
        .bearer_auth(matrix_access_token)
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            tracing::debug!("Matrix session cleaned up after avatar download");
        }
        Ok(resp) => {
            tracing::warn!(status = %resp.status(), "Matrix logout returned non-success (session may linger)");
        }
        Err(e) => {
            tracing::warn!(error = %e, "Matrix logout request failed (session may linger)");
        }
    }

    tracing::info!(file_url = %presign.file_url, "Re-hosted mxc avatar to S3");
    Some(presign.file_url)
}

/// Sync user to aura-network: populates `network_user_id` and `profile_id`
/// on the session and refreshes the server-side auth cache plus
/// the in-memory validation cache. Best-effort — logs warnings on failure
/// but never errors out.
///
/// When `force` is `false` (the common path — login, register, import,
/// `GET /api/auth/session`), a successful sync within the last
/// [`SYNC_DEDUPE_TTL`] for the same access token short-circuits the
/// entire body. This keeps the 20 s frontend host probe from triggering
/// an aura-network round-trip and a `persist_zero_auth_session` write on
/// every poll. `force = true` (only `POST /api/auth/validate`) bypasses
/// the cache so an explicit refresh always reaches aura-network.
pub(crate) async fn sync_user_to_network(
    state: &AppState,
    session: &mut ZeroAuthSession,
    force: bool,
) {
    if let Some(client) = &state.network_client {
        if !force {
            if let Some(last) = LAST_NETWORK_SYNC.get(&session.access_token) {
                if last.elapsed() < SYNC_DEDUPE_TTL {
                    return;
                }
            }
        }
        match client.get_current_user(&session.access_token).await {
            Ok(user) => {
                session.network_user_id = user.user_id_typed();
                session.profile_id = user.profile_id_typed();
                session.is_access_granted = user.is_access_granted;
                // OR-in rather than overwrite: the session may already have
                // been granted sys-admin via the SYS_ADMIN_EMAILS allowlist
                // at build time, which aura-network has no knowledge of.
                session.is_sys_admin = user.is_sys_admin || session.is_sys_admin;

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
                let should_push_name = !local_name.is_empty()
                    && local_name != remote_name
                    && (remote_name.is_empty() || is_uuid);

                // Seed the zOS profile image into aura-network when the
                // network user doesn't have one yet (or has a stale mxc://
                // URL from an earlier sync). Once the user uploads a custom
                // avatar via the AURA profile editor it will be an https://
                // URL, so this won't overwrite it.
                let remote_avatar = user.avatar_url.as_deref().unwrap_or("");
                let remote_needs_avatar = remote_avatar.is_empty()
                    || remote_avatar.starts_with("mxc://")
                    || remote_avatar.contains("/_matrix/");
                let has_mxc_avatar = session.profile_image.starts_with("mxc://");

                // If the session avatar is an mxc:// URL, download from
                // Matrix and re-host to S3 so browsers can render it.
                let mut resolved_avatar: Option<String> = None;
                if remote_needs_avatar && has_mxc_avatar {
                    resolved_avatar = rehost_mxc_avatar(
                        state,
                        &session.profile_image,
                        &session.access_token,
                        &session.access_token,
                    )
                    .await;
                    // Update session so the frontend gets the S3 URL immediately
                    if let Some(ref s3_url) = resolved_avatar {
                        session.profile_image = s3_url.clone();
                    }
                } else if remote_needs_avatar
                    && !session.profile_image.is_empty()
                    && session.profile_image.starts_with("http")
                {
                    resolved_avatar = Some(session.profile_image.clone());
                }

                let should_push_avatar = resolved_avatar.is_some();

                if should_push_name || should_push_avatar {
                    let update = aura_os_network::UpdateUserRequest {
                        display_name: if should_push_name {
                            Some(local_name.clone())
                        } else {
                            None
                        },
                        avatar_url: resolved_avatar,
                        bio: None,
                        location: None,
                        website: None,
                    };
                    match client
                        .update_current_user(&session.access_token, &update)
                        .await
                    {
                        Ok(_) => tracing::info!(
                            push_name = should_push_name,
                            push_avatar = should_push_avatar,
                            "Pushed user data to aura-network"
                        ),
                        Err(e) => warn!(error = %e, "Failed to push user data (non-fatal)"),
                    }

                    // Re-flush the session cache so concurrent / subsequent
                    // requests see the resolved S3 avatar URL immediately.
                    state.validation_cache.insert(
                        session.access_token.clone(),
                        crate::state::CachedSession {
                            session: session.clone(),
                            validated_at: std::time::Instant::now(),
                            zero_pro_refresh_error: None,
                        },
                    );
                    persist_zero_auth_session(&state.store, session);
                }

                LAST_NETWORK_SYNC.insert(session.access_token.clone(), Instant::now());

                tracing::info!(
                    network_user_id = %user.id,
                    profile_id = user.profile_id.as_deref().unwrap_or("-"),
                    display_name = user.display_name.as_deref().unwrap_or("-"),
                    "User synced to aura-network"
                );
            }
            Err(e) => {
                warn!(error = %e, "Failed to sync user to aura-network (non-fatal)");
            }
        }
    }
}
