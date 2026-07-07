//! Agent / instance `context-usage` endpoints.
//!
//! These power the bottom-right Context popover (utilization, the
//! per-bucket "Context Composition" breakdown) and the "Session Cost"
//! section. Everything is derived from the most recent persisted
//! `assistant_message_end` event for the relevant session, whose
//! `usage` payload mirrors [`aura_protocol::SessionUsage`].
//!
//! The cumulative token / model / provider fields are surfaced here so
//! the frontend Session Cost widget can hydrate after a page reload
//! instead of waiting for a fresh `AssistantMessageEnd` turn.

use axum::extract::{Path, State};
use axum::Json;
use serde::Serialize;
use tracing::warn;

use aura_os_core::{AgentId, AgentInstanceId, ProjectId};
use aura_os_storage::StorageClient;
use aura_protocol::ContextBreakdown;

use crate::capture_auth::{demo_agent_id, demo_agent_instance_id, is_capture_access_token};
use crate::error::{map_storage_error, ApiResult};
use crate::state::{AppState, AuthJwt};

use super::chat::{find_matching_project_agents, storage_session_sort_key};
use super::sessions::storage_session_is_deleted;

#[derive(Serialize, Default)]
pub(crate) struct ContextUsageResponse {
    pub context_utilization: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_context_tokens: Option<u64>,
    /// Per-bucket token estimates from the most recent persisted
    /// `assistant_message_end` event for the session. Absent on older
    /// harness builds (where the field was either missing or all-zero);
    /// the frontend treats an absent breakdown as "not available" and
    /// falls back to the legacy two-row Used/Total card.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_breakdown: Option<ContextBreakdown>,
    /// Session-cumulative token counts and the model/provider that
    /// produced them, used by the frontend "Session Cost" widget. All
    /// optional so older harness builds (and the dev-loop fallback)
    /// simply omit the Session Cost section client-side.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cumulative_input_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cumulative_output_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cumulative_cache_read_input_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cumulative_cache_creation_input_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
}

/// Usage snapshot derived from the most recent persisted
/// `assistant_message_end` event for a session.
#[derive(Clone, Default)]
pub(crate) struct SessionContextUsage {
    pub(crate) utilization: f32,
    pub(crate) estimated_context_tokens: Option<u64>,
    pub(crate) context_breakdown: Option<ContextBreakdown>,
    pub(crate) cumulative_input_tokens: Option<u64>,
    pub(crate) cumulative_output_tokens: Option<u64>,
    pub(crate) cumulative_cache_read_input_tokens: Option<u64>,
    pub(crate) cumulative_cache_creation_input_tokens: Option<u64>,
    pub(crate) model: Option<String>,
    pub(crate) provider: Option<String>,
}

impl From<SessionContextUsage> for ContextUsageResponse {
    fn from(usage: SessionContextUsage) -> Self {
        Self {
            context_utilization: usage.utilization,
            estimated_context_tokens: usage.estimated_context_tokens,
            context_breakdown: usage.context_breakdown,
            cumulative_input_tokens: usage.cumulative_input_tokens,
            cumulative_output_tokens: usage.cumulative_output_tokens,
            cumulative_cache_read_input_tokens: usage.cumulative_cache_read_input_tokens,
            cumulative_cache_creation_input_tokens: usage.cumulative_cache_creation_input_tokens,
            model: usage.model,
            provider: usage.provider,
        }
    }
}

/// Representative breakdown returned by the demo capture-token branches
/// of the context-usage endpoints. The buckets are sized to roughly
/// match the demo's `estimated_context_tokens = 33_280` so the marketing
/// surface can exercise the stacked-bar popover end-to-end.
fn demo_context_breakdown() -> ContextBreakdown {
    ContextBreakdown {
        system_prompt_tokens: 4_200,
        tools_tokens: 6_800,
        skills_tokens: 1_500,
        mcp_tokens: 0,
        subagents_tokens: 980,
        conversation_tokens: 19_800,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
    }
}

fn demo_usage_response() -> ContextUsageResponse {
    ContextUsageResponse {
        context_utilization: 0.34,
        estimated_context_tokens: Some(33_280),
        context_breakdown: Some(demo_context_breakdown()),
        ..Default::default()
    }
}

/// Decode the `usage.*` fields of an `assistant_message_end` event
/// payload into a [`SessionContextUsage`]. Returns `None` when the
/// payload lacks a usable (finite) `usage.context_utilization`.
///
/// Shared by both the session and task context-usage parsers so the
/// newest-event walk and field extraction are not duplicated across the
/// two variants. Every field is read defensively via `.get()/.and_then()`
/// so older harness builds that omit individual fields degrade to `None`
/// rather than failing the whole decode.
pub(crate) fn session_usage_from_event_content(
    content: &serde_json::Value,
) -> Option<SessionContextUsage> {
    let usage = content.get("usage")?;
    let utilization = usage.get("context_utilization").and_then(|v| v.as_f64())?;
    if !utilization.is_finite() {
        return None;
    }
    let u64_field = |key: &str| usage.get(key).and_then(|v| v.as_u64());
    let string_field = |key: &str| {
        usage
            .get(key)
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    // Older harness builds may omit `context_breakdown` entirely or emit
    // `ContextBreakdown::default()` (all zeros). In both cases we want
    // the response to *not* carry the field so the frontend stays on its
    // legacy popover branch via the existing `breakdown == null` check.
    let context_breakdown = usage
        .get("context_breakdown")
        .and_then(|cb| serde_json::from_value::<ContextBreakdown>(cb.clone()).ok())
        .filter(|cb| !cb.is_empty());
    Some(SessionContextUsage {
        utilization: utilization as f32,
        estimated_context_tokens: u64_field("estimated_context_tokens"),
        context_breakdown,
        cumulative_input_tokens: u64_field("cumulative_input_tokens"),
        cumulative_output_tokens: u64_field("cumulative_output_tokens"),
        cumulative_cache_read_input_tokens: u64_field("cumulative_cache_read_input_tokens"),
        cumulative_cache_creation_input_tokens: u64_field("cumulative_cache_creation_input_tokens"),
        model: string_field("model"),
        provider: string_field("provider"),
    })
}

fn fallback_usage(estimate: f64) -> SessionContextUsage {
    SessionContextUsage {
        utilization: estimate as f32,
        ..Default::default()
    }
}

/// Pull the most recent context usage out of a storage session.
///
/// Chat sessions do NOT update `Session.context_usage_estimate` today —
/// only the dev-loop writes that column. So for chat the authoritative
/// source is the `usage` field embedded in the most recent
/// `assistant_message_end` event for the session. Walks the session's
/// events newest-first and returns the first qualifying event; falls
/// back to `session.context_usage_estimate` (dev-loop's source) when no
/// such event exists.
pub(crate) async fn latest_context_usage_for_session(
    storage: &StorageClient,
    jwt: &str,
    session: &aura_os_storage::StorageSession,
) -> Option<SessionContextUsage> {
    let events = match storage.list_events(&session.id, jwt, None, None).await {
        Ok(events) => events,
        Err(err) => {
            warn!(session_id = %session.id, error = %err, "context-usage: list_events failed");
            return session.context_usage_estimate.map(fallback_usage);
        }
    };

    let found = events
        .iter()
        .rev()
        .filter(|evt| evt.event_type.as_deref() == Some("assistant_message_end"))
        .find_map(|evt| session_usage_from_event_content(evt.content.as_ref()?));

    found.or_else(|| session.context_usage_estimate.map(fallback_usage))
}

async fn latest_context_usage_across_sessions(
    storage: &StorageClient,
    jwt: &str,
    mut sessions: Vec<aura_os_storage::StorageSession>,
) -> Option<SessionContextUsage> {
    sessions.sort_by_key(storage_session_sort_key);
    sessions.reverse();

    for session in sessions {
        if let Some(usage) = latest_context_usage_for_session(storage, jwt, &session).await {
            return Some(usage);
        }
    }
    None
}

/// GET `/api/agents/:agent_id/context-usage` — returns the latest
/// observed usage across every session owned by every project_agent that
/// shares this template agent id. Used by the UI to seed the bottom-bar
/// context indicator and Session Cost widget on chat mount without
/// waiting for the first assistant turn.
///
/// Returns an empty response when storage is unavailable, when there are
/// no matching project_agents, or when none of them have any sessions
/// with recorded usage yet.
pub(crate) async fn get_agent_context_usage(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<Json<ContextUsageResponse>> {
    if is_capture_access_token(&jwt) && agent_id == demo_agent_id() {
        return Ok(Json(demo_usage_response()));
    }

    let storage = state.require_storage_client()?;
    let agent_id_str = agent_id.to_string();
    let matching = find_matching_project_agents(&state, storage, &jwt, &agent_id_str).await;
    if matching.is_empty() {
        return Ok(Json(ContextUsageResponse::default()));
    }

    let mut sessions_with_observations = Vec::new();
    for pa in &matching {
        let sessions = match storage.list_sessions(&pa.id, &jwt).await {
            Ok(sessions) => sessions,
            Err(err) => {
                warn!(project_agent_id = %pa.id, error = %err, "context-usage: list_sessions failed; skipping");
                continue;
            }
        };
        sessions_with_observations.extend(
            sessions
                .into_iter()
                .filter(|session| !storage_session_is_deleted(session)),
        );
    }

    let usage = latest_context_usage_across_sessions(storage, &jwt, sessions_with_observations)
        .await
        .unwrap_or_default();
    Ok(Json(usage.into()))
}

/// GET `/api/projects/:project_id/agents/:agent_instance_id/context-usage`
/// — project-scoped analogue: returns the latest observed usage for a
/// single agent instance.
pub(crate) async fn get_instance_context_usage(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
) -> ApiResult<Json<ContextUsageResponse>> {
    if is_capture_access_token(&jwt) && agent_instance_id == demo_agent_instance_id() {
        return Ok(Json(demo_usage_response()));
    }

    let storage = state.require_storage_client()?;
    let sessions: Vec<_> = storage
        .list_sessions(&agent_instance_id.to_string(), &jwt)
        .await
        .map_err(map_storage_error)?
        .into_iter()
        .filter(|session| !storage_session_is_deleted(session))
        .collect();

    let usage = latest_context_usage_across_sessions(storage, &jwt, sessions)
        .await
        .unwrap_or_default();
    Ok(Json(usage.into()))
}
