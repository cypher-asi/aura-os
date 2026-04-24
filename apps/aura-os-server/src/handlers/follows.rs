use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::{DateTime, Utc};

use aura_os_core::*;
use aura_os_network::NetworkFollow;

use crate::capture_auth::is_capture_access_token;
use crate::dto::{FollowCheckResponse, FollowRequest};
use crate::error::{map_network_error, ApiResult};
use crate::state::{AppState, AuthJwt};

fn follow_from_network(net: &NetworkFollow) -> Follow {
    let follower_profile_id = net
        .follower_profile_id
        .parse::<ProfileId>()
        .unwrap_or_else(|_| ProfileId::new());
    let target_profile_id = net
        .target_profile_id
        .parse::<ProfileId>()
        .unwrap_or_else(|_| ProfileId::new());
    let created_at = net
        .created_at
        .as_deref()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(Utc::now);
    let follow_id = net
        .id
        .clone()
        .unwrap_or_else(|| format!("{}:{}", net.follower_profile_id, net.target_profile_id));

    Follow {
        id: follow_id,
        follower_profile_id,
        target_profile_id,
        created_at,
    }
}

pub(crate) async fn follow(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Json(req): Json<FollowRequest>,
) -> ApiResult<(StatusCode, Json<Follow>)> {
    let client = state.require_network_client()?;
    let net_req = aura_os_network::FollowRequest {
        target_profile_id: req.target_profile_id,
    };
    let net_follow = client
        .follow_profile(&jwt, &net_req)
        .await
        .map_err(map_network_error)?;
    Ok((StatusCode::CREATED, Json(follow_from_network(&net_follow))))
}

pub(crate) async fn unfollow(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(target_profile_id): Path<String>,
) -> ApiResult<StatusCode> {
    let client = state.require_network_client()?;
    client
        .unfollow_profile(&target_profile_id, &jwt)
        .await
        .map_err(map_network_error)?;
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) async fn list_follows(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
) -> ApiResult<Json<Vec<Follow>>> {
    if is_capture_access_token(&jwt) {
        return Ok(Json(Vec::new()));
    }

    let client = state.require_network_client()?;
    let net_follows = client.list_follows(&jwt).await.map_err(map_network_error)?;
    let follows: Vec<Follow> = net_follows.iter().map(follow_from_network).collect();
    Ok(Json(follows))
}

pub(crate) async fn check_follow(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(target_profile_id): Path<String>,
) -> ApiResult<Json<FollowCheckResponse>> {
    let client = state.require_network_client()?;
    let net_follows = client.list_follows(&jwt).await.map_err(map_network_error)?;
    let following = net_follows
        .iter()
        .any(|f| f.target_profile_id == target_profile_id);
    Ok(Json(FollowCheckResponse { following }))
}
