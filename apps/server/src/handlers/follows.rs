use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::Utc;

use aura_core::*;

use crate::dto::{FollowCheckResponse, FollowRequest};
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

fn get_user_id(state: &AppState) -> Result<String, (StatusCode, Json<ApiError>)> {
    let session_bytes = state
        .store
        .get_setting("zero_auth_session")
        .map_err(|_| ApiError::unauthorized("not authenticated"))?;
    let session: ZeroAuthSession =
        serde_json::from_slice(&session_bytes).map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(session.user_id)
}

pub async fn follow(
    State(state): State<AppState>,
    Json(req): Json<FollowRequest>,
) -> ApiResult<(StatusCode, Json<Follow>)> {
    let user_id = get_user_id(&state)?;
    let follow = Follow {
        follower_user_id: user_id,
        target_type: req.target_type,
        target_id: req.target_id,
        created_at: Utc::now(),
    };
    state
        .store
        .put_follow(&follow)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok((StatusCode::CREATED, Json(follow)))
}

pub async fn unfollow(
    State(state): State<AppState>,
    Path((target_type, target_id)): Path<(String, String)>,
) -> ApiResult<StatusCode> {
    let user_id = get_user_id(&state)?;
    let tt: FollowTargetType = serde_json::from_value(serde_json::Value::String(target_type))
        .map_err(|_| ApiError::bad_request("invalid target_type, must be 'user' or 'agent'"))?;
    state
        .store
        .delete_follow(&user_id, tt, &target_id)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn list_follows(State(state): State<AppState>) -> ApiResult<Json<Vec<Follow>>> {
    let user_id = get_user_id(&state)?;
    let follows = state
        .store
        .list_follows_by_user(&user_id)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(follows))
}

pub async fn check_follow(
    State(state): State<AppState>,
    Path((target_type, target_id)): Path<(String, String)>,
) -> ApiResult<Json<FollowCheckResponse>> {
    let user_id = get_user_id(&state)?;
    let tt: FollowTargetType = serde_json::from_value(serde_json::Value::String(target_type))
        .map_err(|_| ApiError::bad_request("invalid target_type, must be 'user' or 'agent'"))?;
    let following = state
        .store
        .is_following(&user_id, tt, &target_id)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(FollowCheckResponse { following }))
}
