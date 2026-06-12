use axum::extract::{Path, State};
use axum::Json;
use futures_util::future::join_all;
use tracing::{info, warn};

use aura_os_core::{
    AgentInstanceId, EnrichedSession, ProjectId, Session, SessionEvent, SessionId, Task,
};
use aura_os_sessions::{storage_enriched_session_to_enriched_session, storage_session_to_session};
use aura_os_storage::StorageClient;

use crate::error::{map_storage_error, ApiError, ApiResult};
use crate::handlers::agents::chat::is_subagent_session_summary;
use crate::state::{AppState, AuthJwt};

use super::conversions::events_to_session_history;
use super::session_titles::{generate_session_summary, TitleGenScope};

/// Project-scoped session list.
///
/// Fast path: single indexed query into aura-storage's
/// `idx_sessions_project_recent` partial index (migration 0014):
/// `WHERE project_id = $1 AND event_count > 0 ORDER BY
/// last_event_at DESC NULLS LAST, started_at DESC`. Empty orphan
/// rows (sessions created before the first message persisted) are
/// filtered server-side by aura-storage; aura-os-server is a
/// straight pass-through.
///
/// Compatibility fallback: when aura-storage returns a 404 from the
/// fast path, the migration 0014 + `/api/projects/:id/sessions`
/// endpoint has not been deployed yet (this can happen when the
/// aura-os side ships ahead of the aura-storage Render deploy).
/// Fall back to the legacy per-agent fan-out + `list_events?limit=1`
/// orphan filter so the surface keeps working — at the old cost of
/// `1 + A + N` round-trips. The fallback becomes dormant the
/// moment aura-storage rolls out, so there is no permanent perf hit.
///
/// Status mapping: ONLY a 404 trips the fallback. Other upstream
/// errors (5xx, network failures, etc.) bubble up through
/// `map_storage_error` so genuine outages still surface as the
/// correct status to the caller.
pub(crate) async fn list_project_sessions(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<Vec<Session>>> {
    let storage = state.require_storage_client()?;

    match storage
        .list_project_sessions(&project_id.to_string(), &jwt)
        .await
    {
        Ok(storage_sessions) => {
            let sessions: Vec<Session> = storage_sessions
                .into_iter()
                .filter_map(|s| {
                    storage_session_to_session(s, None)
                        .map_err(|e| warn!(error = %e, "skipping malformed session"))
                        .ok()
                })
                // Nested subagent sessions surface inside the parent chat
                // as panes, never as top-level sidebar rows.
                .filter(|s| !is_subagent_session_summary(&s.summary_of_previous_context))
                .collect();
            Ok(Json(sessions))
        }
        Err(aura_os_storage::StorageError::Server { status: 404, .. }) => {
            info!(
                project_id = %project_id,
                "aura-storage list_project_sessions returned 404; \
                 falling back to legacy per-agent fan-out \
                 (upstream missing migration 0014 + new endpoint)"
            );
            list_project_sessions_legacy(storage, &jwt, &project_id).await
        }
        Err(e) => Err(map_storage_error(e)),
    }
}

/// Pre-migration-0014 implementation of `list_project_sessions`,
/// preserved as a fallback for the period between an aura-os deploy
/// and the matching aura-storage deploy. Walks
/// `list_project_agents`, calls `list_sessions(agent)` per agent,
/// then probes each result with `list_events?limit=1` to drop empty
/// orphan rows. Sorts client-side because the per-agent calls don't
/// guarantee cross-agent ordering. Identical behaviour to the
/// pre-`19f5203ad` handler; do not "modernize" without checking
/// that aura-storage has been updated everywhere this server can
/// be pointed at.
async fn list_project_sessions_legacy(
    storage: &StorageClient,
    jwt: &str,
    project_id: &ProjectId,
) -> ApiResult<Json<Vec<Session>>> {
    let storage_agents = storage
        .list_project_agents(&project_id.to_string(), jwt)
        .await
        .map_err(map_storage_error)?;

    let mut sessions = Vec::new();
    for agent in &storage_agents {
        match storage.list_sessions(&agent.id, jwt).await {
            Ok(agent_sessions) => {
                for ss in agent_sessions {
                    match storage_session_to_session(ss, None) {
                        Ok(s) => sessions.push(s),
                        Err(e) => warn!(error = %e, "skipping malformed session"),
                    }
                }
            }
            Err(e) => warn!(
                agent_id = %agent.id,
                error = %e,
                "fallback list_sessions failed for agent; keeping other agents' rows"
            ),
        }
    }
    let mut sessions = filter_nonempty_sessions_legacy(storage, jwt, sessions).await;
    sessions.retain(|s| !is_subagent_session_summary(&s.summary_of_previous_context));
    sessions.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    Ok(Json(sessions))
}

/// Pre-migration-0014 orphan filter. Fans out one
/// `list_events?limit=1` probe per session; probe errors fail-open
/// (the row is kept) so a transient aura-storage hiccup never makes
/// a real chat disappear. Identical to the pre-`19f5203ad`
/// `filter_nonempty_sessions`; renamed `_legacy` to make its scope
/// (only the upstream-404 fallback path) obvious.
async fn filter_nonempty_sessions_legacy(
    storage: &StorageClient,
    jwt: &str,
    sessions: Vec<Session>,
) -> Vec<Session> {
    if sessions.is_empty() {
        return sessions;
    }
    let probes = sessions.iter().map(|s| {
        let sid = s.session_id.to_string();
        async move {
            match storage.list_events(&sid, jwt, Some(1), None).await {
                Ok(events) => !events.is_empty(),
                Err(e) => {
                    warn!(
                        session_id = %sid,
                        error = %e,
                        "list_events probe failed while filtering empty sessions; keeping row",
                    );
                    true
                }
            }
        }
    });
    let keep = join_all(probes).await;
    sessions
        .into_iter()
        .zip(keep)
        .filter_map(|(s, k)| if k { Some(s) } else { None })
        .collect()
}

/// User-scoped cross-agent session list. Powers the chat-app left
/// panel (`apps/chat-app/components/ChatAppLeftPanel/ChatAppLeftPanel.tsx`)
/// which used to fan out one `/api/projects/:p/agents/:a/sessions`
/// call per (agent, project_binding) pair on first paint -- for a
/// user with `A` agents and `B` average bindings each, that was
/// `A x (1 + B)` HTTP calls before any rows could render. With
/// this endpoint the panel makes a single request and aura-storage
/// answers it with one indexed query against
/// `idx_sessions_user_recent` (migration 0015).
///
/// The response carries `EnrichedSession` rows (Session +
/// `agent_id`) so the FE can key avatars and stream lanes off the
/// row directly without a follow-up `listProjectBindings` to map
/// `agent_instance_id -> agent_id`. aura-storage performs the
/// `LEFT JOIN project_agents` server-side; aura-os-server is a
/// straight pass-through.
pub(crate) async fn list_my_sessions(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
) -> ApiResult<Json<Vec<EnrichedSession>>> {
    let storage = state.require_storage_client()?;
    let storage_sessions = storage
        .list_my_sessions(&jwt)
        .await
        .map_err(map_storage_error)?;
    let sessions: Vec<EnrichedSession> = storage_sessions
        .into_iter()
        .filter_map(|s| {
            storage_enriched_session_to_enriched_session(s, None)
                .map_err(|e| warn!(error = %e, "skipping malformed enriched session"))
                .ok()
        })
        .filter(|e| !is_subagent_session_summary(&e.session.summary_of_previous_context))
        .collect();
    Ok(Json(sessions))
}

/// Per-agent session list. Same single-query story as
/// `list_project_sessions` — the empty-row filter and ordering are
/// pushed into aura-storage (migration 0014).
pub(crate) async fn list_sessions(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
) -> ApiResult<Json<Vec<Session>>> {
    let storage = state.require_storage_client()?;
    let storage_sessions = storage
        .list_sessions(&agent_instance_id.to_string(), &jwt)
        .await
        .map_err(map_storage_error)?;
    let sessions: Vec<Session> = storage_sessions
        .into_iter()
        .filter_map(|s| {
            storage_session_to_session(s, None)
                .map_err(|e| warn!(error = %e, "skipping malformed session"))
                .ok()
        })
        .filter(|s| !is_subagent_session_summary(&s.summary_of_previous_context))
        .collect();
    Ok(Json(sessions))
}

pub(crate) async fn get_session(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, _agent_instance_id, session_id)): Path<(
        ProjectId,
        AgentInstanceId,
        SessionId,
    )>,
) -> ApiResult<Json<Session>> {
    let storage = state.require_storage_client()?;
    let ss = storage
        .get_session(&session_id.to_string(), &jwt)
        .await
        .map_err(|e| match &e {
            aura_os_storage::StorageError::Server { status: 404, .. } => {
                ApiError::not_found("session not found")
            }
            _ => map_storage_error(e),
        })?;
    let session = storage_session_to_session(ss, None).map_err(ApiError::internal)?;
    Ok(Json(session))
}

pub(crate) async fn delete_session(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, _agent_instance_id, session_id)): Path<(
        ProjectId,
        AgentInstanceId,
        SessionId,
    )>,
) -> ApiResult<axum::http::StatusCode> {
    let storage = state.require_storage_client()?;

    storage
        .delete_session(&session_id.to_string(), &jwt)
        .await
        .map_err(|e| match &e {
            aura_os_storage::StorageError::Server { status: 404, .. } => {
                ApiError::not_found("session not found")
            }
            // Anything else from aura-storage (auth, FK conflict, 5xx,
            // transport, validation) used to be collapsed into a flat
            // `ApiError::internal` with no server-side log, which made
            // right-click "Delete session" appear silently broken — the
            // tower-http `on_failure` line only carried the 500 and the
            // optimistic UI rolled back without surfacing a reason.
            // Log the upstream status + a body preview here and reuse
            // the same `map_storage_error` mapping the sibling handlers
            // (`get_session`, `list_session_tasks`, …) already use so
            // the response carries the real upstream status (e.g. 409
            // / 502) and the FE toast can show the actual reason.
            aura_os_storage::StorageError::Server { status, body } => {
                let preview: String = body.chars().take(300).collect();
                warn!(
                    %session_id,
                    upstream_status = status,
                    body_preview = %preview,
                    "delete_session: aura-storage rejected DELETE",
                );
                map_storage_error(e)
            }
            _ => {
                warn!(%session_id, error = %e, "delete_session: storage call failed");
                map_storage_error(e)
            }
        })?;

    info!(%session_id, "Session deleted");

    Ok(axum::http::StatusCode::NO_CONTENT)
}

pub(crate) async fn list_session_tasks(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, _agent_instance_id, session_id)): Path<(
        ProjectId,
        AgentInstanceId,
        SessionId,
    )>,
) -> ApiResult<Json<Vec<Task>>> {
    let storage = state.require_storage_client()?;

    storage
        .get_session(&session_id.to_string(), &jwt)
        .await
        .map_err(|e| match &e {
            aura_os_storage::StorageError::Server { status: 404, .. } => {
                ApiError::not_found("session not found")
            }
            _ => map_storage_error(e),
        })?;

    let storage_tasks = storage
        .list_tasks(&_project_id.to_string(), &jwt)
        .await
        .map_err(map_storage_error)?;

    let tasks: Vec<Task> = storage_tasks
        .into_iter()
        .filter(|t| t.session_id.as_deref() == Some(&session_id.to_string()))
        .filter_map(|s| crate::handlers::tasks::storage_task_to_task(s).ok())
        .collect();

    Ok(Json(tasks))
}

pub(crate) async fn list_session_events(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, _agent_instance_id, session_id)): Path<(
        ProjectId,
        AgentInstanceId,
        SessionId,
    )>,
) -> ApiResult<Json<Vec<SessionEvent>>> {
    let storage = state.require_storage_client()?;

    let events = storage
        .list_events(&session_id.to_string(), &jwt, None, None)
        .await
        .map_err(map_storage_error)?;

    let messages = events_to_session_history(
        &events,
        &_agent_instance_id.to_string(),
        &_project_id.to_string(),
    );
    Ok(Json(messages))
}

pub(crate) async fn summarize_session(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((project_id, agent_instance_id, session_id)): Path<(
        ProjectId,
        AgentInstanceId,
        SessionId,
    )>,
) -> ApiResult<Json<Session>> {
    let storage = state.require_storage_client()?;

    let sid = session_id.to_string();
    let pid = project_id.to_string();
    let aid = agent_instance_id.to_string();
    info!(%session_id, "Session summary generation requested");

    let scope = TitleGenScope {
        storage,
        http: &state.http_client,
        router_url: &state.router_url,
        jwt: &jwt,
        session_id: &sid,
        project_id: &pid,
        agent_id: &aid,
    };
    let summary = generate_session_summary(&scope)
        .await
        .map_err(|e| ApiError::internal(format!("summarizing session: {e}")))?;

    info!(%session_id, summary_len = summary.len(), "Session summary generated");

    let ss = storage
        .get_session(&sid, &jwt)
        .await
        .map_err(map_storage_error)?;
    let session = storage_session_to_session(ss, None).map_err(ApiError::internal)?;
    Ok(Json(session))
}
