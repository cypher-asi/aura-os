//! Cursor pagination for single-session chat history reads.
//!
//! Powers the `.../sessions/:session_id/events/paginated` routes (both
//! the project-scoped and standalone-agent variants) so the chat
//! scroller can hydrate long sessions page-by-page instead of pulling
//! the entire transcript on open. Both variants share the same loading
//! core ([`load_session_page`]) and the pure windowing helpers in
//! [`window`]; only the auth/ownership checks differ, and those mirror
//! the corresponding non-paginated handlers exactly.
//!
//! Tail-fetch strategy: aura-storage only exposes ascending,
//! offset-based event reads — there is no descending order and no
//! events-count endpoint. There *is* a trigger-maintained per-session
//! `event_count` (migration 0014) on the session row, which we use to
//! start the read at `count - window` and fetch only a raw tail. The
//! window carries a generous multiplier because reconstruction skips
//! streaming deltas; if it still yields too few messages we widen to a
//! single full fetch from offset 0. Pre-0014 deployments report no
//! count and degrade to the bounded full fetch (reconstruct once, slice
//! the window).

mod window;

use aura_os_core::{AgentId, AgentInstanceId, ProjectId, SessionId};
use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;

use crate::error::{map_storage_error, ApiError, ApiResult};
use crate::handlers::agents::sessions::reject_deleted_storage_session;
use crate::state::{AppState, AuthJwt};

use super::super::conversions::events_to_session_history;
use super::request::PaginatedEventsResponse;
use super::session_access::resolve_agent_owned_session;
use aura_os_storage::{StorageClient, StorageError};

pub(crate) use window::{cursor_page_available, tail_page};

/// Raw storage events fetched per requested message in the tail window.
/// Reconstruction keeps only terminal events (`user_message`,
/// `assistant_message_end`, `task_output`), and assistant turns are
/// accompanied by many streaming-delta rows, so the raw tail must be a
/// generous multiple of the message budget to fill a page in one fetch.
const RAW_EVENTS_PER_MESSAGE_HINT: usize = 12;

/// Floor for the raw tail window, in storage events. Keeps the window
/// useful for tiny limits and at least one full aura-storage page (500).
const MIN_RAW_TAIL_WINDOW: usize = 600;

#[derive(Debug, Clone, Deserialize, Default)]
pub(crate) struct SessionEventsPageQuery {
    /// Page size in reconstructed messages; default 100, clamped 1..=400.
    pub limit: Option<usize>,
    /// `event_id` cursor from a previous page: return the `limit`
    /// messages immediately preceding it (ascending).
    pub before: Option<String>,
}

/// Everything the shared loader needs to read and reconstruct one
/// session's history, regardless of which route variant resolved it.
struct SessionPageScope {
    session_id: String,
    project_agent_id: String,
    project_id: String,
    /// Trigger-maintained raw event count from the session row
    /// (migration 0014); `None` on pre-0014 deployments or when the
    /// session row could not be read.
    raw_event_count: Option<u32>,
}

/// `GET /api/projects/:project_id/agents/:agent_instance_id/sessions/:session_id/events/paginated`
///
/// Paginated sister of `sessions::list_session_events` with the same
/// access model: aura-storage authorizes the `list_events` read via the
/// caller's JWT and no additional ownership checks are layered on top.
/// The extra `get_session` below feeds the tail-window optimisation and
/// is the authoritative deleted-session visibility check. If that lookup
/// fails for anything other than 404, fail closed instead of falling back
/// to an unchecked event read.
pub(crate) async fn list_session_events_paginated(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((project_id, agent_instance_id, session_id)): Path<(
        ProjectId,
        AgentInstanceId,
        SessionId,
    )>,
    Query(query): Query<SessionEventsPageQuery>,
) -> ApiResult<Json<PaginatedEventsResponse>> {
    let storage = state.require_storage_client()?;
    let session_id = session_id.to_string();
    let raw_event_count = match storage.get_session(&session_id, &jwt).await {
        Ok(session) => {
            reject_deleted_storage_session(&session, "session not found")?;
            session.event_count
        }
        Err(aura_os_storage::StorageError::Server { status: 404, .. }) => {
            return Err(ApiError::not_found("session not found"));
        }
        Err(error) => return Err(map_storage_error(error)),
    };
    let scope = SessionPageScope {
        session_id,
        project_agent_id: agent_instance_id.to_string(),
        project_id: project_id.to_string(),
        raw_event_count,
    };
    let page = load_session_page(storage, &jwt, &scope, &query)
        .await
        .map_err(map_storage_error)?;
    Ok(Json(page))
}

/// `GET /api/agents/:agent_id/sessions/:session_id/events/paginated`
///
/// Paginated sister of `list_agent_session_events`, sharing its
/// ownership enforcement verbatim via [`resolve_agent_owned_session`]:
/// the session must belong to a project-agent binding of the URL
/// `agent_id`, and any mismatch is an indistinguishable 404.
pub(crate) async fn list_agent_session_events_paginated(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((agent_id, session_id)): Path<(AgentId, SessionId)>,
    Query(query): Query<SessionEventsPageQuery>,
) -> ApiResult<Json<PaginatedEventsResponse>> {
    let storage = state.require_storage_client()?;
    let owned = resolve_agent_owned_session(storage, &jwt, &agent_id, &session_id).await?;
    let scope = SessionPageScope {
        session_id: session_id.to_string(),
        project_id: owned.session.project_id.clone().unwrap_or_default(),
        raw_event_count: owned.session.event_count,
        project_agent_id: owned.project_agent_id,
    };
    let page = load_session_page(storage, &jwt, &scope, &query)
        .await
        .map_err(map_storage_error)?;
    Ok(Json(page))
}

/// Shared per-session page loader for both route variants.
async fn load_session_page(
    storage: &StorageClient,
    jwt: &str,
    scope: &SessionPageScope,
    query: &SessionEventsPageQuery,
) -> Result<PaginatedEventsResponse, StorageError> {
    let limit = window::normalize_session_page_limit(query.limit);
    if let Some(before) = query.before.as_deref() {
        // A `before` page cannot use the count-based tail window: the
        // cursor is an opaque message id and storage has no id→offset
        // lookup, so we cannot know where the anchor sits without
        // reading up to it. Work stays bounded — one reconstruction
        // pass over this session, response sliced to ≤ `limit`.
        let messages = load_full_session_history(storage, jwt, scope).await?;
        return Ok(window::page_before_cursor(messages, Some(before), limit));
    }
    load_tail_page(storage, jwt, scope, limit).await
}

/// First (cursor-less) page: the most recent `limit` messages.
///
/// Uses the session row's raw `event_count` to fetch only a tail window
/// of raw events. `has_more = true` whenever raw events remain below
/// the window even though they might all be deltas; the worst case is
/// one extra client request that comes back as an empty terminal page.
async fn load_tail_page(
    storage: &StorageClient,
    jwt: &str,
    scope: &SessionPageScope,
    limit: usize,
) -> Result<PaginatedEventsResponse, StorageError> {
    let raw_window = raw_tail_window(limit);
    let tail_offset = scope
        .raw_event_count
        .map(|count| (count as usize).saturating_sub(raw_window))
        .filter(|&offset| offset > 0)
        .and_then(|offset| u32::try_from(offset).ok());
    let Some(tail_offset) = tail_offset else {
        // No usable count (pre-migration-0014 aura-storage) or the whole
        // session fits inside the window: single bounded full fetch.
        let messages = load_full_session_history(storage, jwt, scope).await?;
        return Ok(window::tail_page(messages, limit, false));
    };

    let raw_tail = storage
        .list_events(&scope.session_id, jwt, None, Some(tail_offset))
        .await?;
    let messages = events_to_session_history(&raw_tail, &scope.project_agent_id, &scope.project_id);
    if messages.len() <= limit {
        // Delta-heavy tail reconstructed too few messages — widen to a
        // full fetch from offset 0. `<=` (not `<`) keeps a one-message
        // margin so the oldest reconstruction in a mid-turn-truncated
        // window is never the oldest message we return.
        let messages = load_full_session_history(storage, jwt, scope).await?;
        return Ok(window::tail_page(messages, limit, false));
    }
    Ok(window::tail_page(messages, limit, true))
}

async fn load_full_session_history(
    storage: &StorageClient,
    jwt: &str,
    scope: &SessionPageScope,
) -> Result<Vec<aura_os_core::SessionEvent>, StorageError> {
    let raw = storage
        .list_events(&scope.session_id, jwt, None, None)
        .await?;
    Ok(events_to_session_history(
        &raw,
        &scope.project_agent_id,
        &scope.project_id,
    ))
}

fn raw_tail_window(limit: usize) -> usize {
    limit
        .saturating_mul(RAW_EVENTS_PER_MESSAGE_HINT)
        .max(MIN_RAW_TAIL_WINDOW)
}
