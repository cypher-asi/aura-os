//! Read-side endpoints: list events for an agent or for a
//! project-bound agent instance, and the paginated cursor variant
//! used by the chat-window scroller.

use aura_os_core::{AgentId, AgentInstanceId, ProjectId, SessionEvent};
use axum::extract::{Path, Query, State};
use axum::Json;

use crate::capture_auth::{
    demo_agent_events, demo_agent_id, demo_agent_instance_id, demo_project_id,
    is_capture_access_token,
};
use crate::error::{map_storage_error, ApiResult};
use crate::state::{AppState, AuthJwt};

use super::constants::MAX_AGENT_HISTORY_WINDOW_LIMIT;
use super::loaders::{load_latest_agent_events_from_storage_result, load_project_session_history};
use super::request::{
    apply_cursor_filter, normalize_agent_history_limit, slice_recent_agent_events,
    target_window_size, AgentEventsQuery, PaginatedEventsQuery, PaginatedEventsResponse,
};

pub(crate) async fn list_events(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
) -> ApiResult<Json<Vec<SessionEvent>>> {
    if is_capture_access_token(&jwt)
        && project_id == demo_project_id()
        && agent_instance_id == demo_agent_instance_id()
    {
        return Ok(Json(demo_agent_events()));
    }

    // Project-scoped UI endpoint has no explicit limit parameter yet, but
    // the `AgentChatView` currently renders at most the last
    // `MAX_AGENT_HISTORY_WINDOW_LIMIT` messages — cap the load so we don't
    // walk every historical session just to throw most of it away.
    let target_size = Some(MAX_AGENT_HISTORY_WINDOW_LIMIT);
    let messages = load_project_session_history(&state, &agent_instance_id, &jwt, target_size)
        .await
        .map_err(map_storage_error)?;
    Ok(Json(messages))
}

pub(crate) async fn list_agent_events(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
    Query(query): Query<AgentEventsQuery>,
) -> ApiResult<Json<Vec<SessionEvent>>> {
    if is_capture_access_token(&jwt) && agent_id == demo_agent_id() {
        return Ok(Json(slice_recent_agent_events(
            demo_agent_events(),
            query.limit,
            query.offset,
        )));
    }

    let _ = state.require_storage_client()?;
    let target_size = target_window_size(query.limit, query.offset);
    let messages =
        load_latest_agent_events_from_storage_result(&state, &agent_id, &jwt, target_size)
            .await
            .map_err(map_storage_error)?;
    Ok(Json(slice_recent_agent_events(
        messages,
        query.limit,
        query.offset,
    )))
}

pub(crate) async fn list_agent_events_paginated(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
    Query(query): Query<PaginatedEventsQuery>,
) -> ApiResult<Json<PaginatedEventsResponse>> {
    if is_capture_access_token(&jwt) && agent_id == demo_agent_id() {
        let filtered = apply_cursor_filter(
            demo_agent_events(),
            query.before.as_deref(),
            query.after.as_deref(),
        );
        let limit = normalize_agent_history_limit(query.limit).unwrap_or(50);
        let has_more = filtered.len() > limit;
        let start = filtered.len().saturating_sub(limit);
        let result = filtered[start..].to_vec();
        let next_cursor = if has_more {
            result.first().map(|m| m.event_id.to_string())
        } else {
            None
        };
        return Ok(Json(PaginatedEventsResponse {
            events: result,
            has_more,
            next_cursor,
        }));
    }

    let _ = state.require_storage_client()?;
    // When either cursor is present we need the full transcript so the
    // `before`/`after` anchor can be located; otherwise we only need
    // enough events to fill the requested window.
    let target_size = if query.before.is_some() || query.after.is_some() {
        None
    } else {
        target_window_size(query.limit, 0)
    };
    let messages =
        load_latest_agent_events_from_storage_result(&state, &agent_id, &jwt, target_size)
            .await
            .map_err(map_storage_error)?;

    let filtered = apply_cursor_filter(messages, query.before.as_deref(), query.after.as_deref());

    let limit = normalize_agent_history_limit(query.limit).unwrap_or(50);

    let has_more = filtered.len() > limit;
    let start = filtered.len().saturating_sub(limit);
    let result = filtered[start..].to_vec();

    let next_cursor = if has_more {
        result.first().map(|m| m.event_id.to_string())
    } else {
        None
    };

    Ok(Json(PaginatedEventsResponse {
        events: result,
        has_more,
        next_cursor,
    }))
}
