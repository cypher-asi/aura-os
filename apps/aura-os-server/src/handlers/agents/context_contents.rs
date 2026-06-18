//! Agent / instance `context-contents` endpoints.
//!
//! These serve the rendered *text* the harness counted for each static
//! context bucket (system prompt, tool/skill/subagent definitions), so a
//! user can open a bucket in the "Context Composition" popover and
//! preview exactly what the model received. The payload is fetched
//! lazily (separate from `context-usage`) because the rendered text is
//! large and only needed when a bucket is opened.
//!
//! Everything is derived from the most recent persisted
//! `assistant_message_end` event for the relevant session, whose `usage`
//! payload mirrors [`aura_protocol::SessionUsage`] — specifically its
//! optional `context_contents` field ([`aura_protocol::ContextContents`]).
//! Older harness builds that omit the field simply yield an empty
//! response, mirroring the `context-usage` fallback behaviour.

use axum::extract::{Path, State};
use axum::Json;
use serde::Serialize;
use tracing::warn;

use aura_os_core::{AgentId, AgentInstanceId, ProjectId};
use aura_os_storage::StorageClient;
use aura_protocol::{ContextContents, ContextSegment};

use crate::capture_auth::{demo_agent_id, demo_agent_instance_id, is_capture_access_token};
use crate::error::{map_storage_error, ApiResult};
use crate::state::{AppState, AuthJwt};

use super::chat::{find_matching_project_agents, storage_session_sort_key};

/// Response for the `context-contents` endpoints. Wraps the latest
/// persisted [`ContextContents`] for the session, if any. The contents
/// themselves are the payload, so the field is omitted entirely (rather
/// than serialized as `null`) when no qualifying event exists — the
/// frontend treats an absent value as "not available from this harness
/// build yet" and renders an empty state.
#[derive(Serialize, Default)]
pub(crate) struct ContextContentsResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_contents: Option<ContextContents>,
}

impl From<Option<ContextContents>> for ContextContentsResponse {
    fn from(context_contents: Option<ContextContents>) -> Self {
        Self { context_contents }
    }
}

/// Representative contents returned by the demo capture-token branches so
/// the marketing surface can exercise the bucket-content viewer
/// end-to-end. Mirrors `context_usage::demo_context_breakdown`.
fn demo_context_contents() -> ContextContents {
    ContextContents {
        system_prompt: Some(
            "You are Aura, a helpful coding agent operating in the Aura OS workspace. \
             Follow the user's instructions and keep changes focused."
                .to_string(),
        ),
        tools: vec![ContextSegment {
            label: "read_file".to_string(),
            text: "Reads a file from the local filesystem and returns its contents.".to_string(),
            tokens: 18,
        }],
        skills: vec![ContextSegment {
            label: "babysit".to_string(),
            text: "Keep a PR merge-ready by triaging comments, resolving conflicts, \
                   and fixing CI in a loop."
                .to_string(),
            tokens: 22,
        }],
        subagents: Vec::new(),
        mcp: Vec::new(),
    }
}

fn demo_contents_response() -> ContextContentsResponse {
    ContextContentsResponse::from(Some(demo_context_contents()))
}

/// Decode the `usage.context_contents` of an `assistant_message_end`
/// event payload into a [`ContextContents`]. Returns `None` when the
/// field is missing, fails to decode, or is empty (per
/// [`ContextContents::is_empty`]).
///
/// Read defensively via `.get()/.and_then()` so older harness builds
/// that omit the field degrade to `None` rather than failing the decode.
fn context_contents_from_event_content(content: &serde_json::Value) -> Option<ContextContents> {
    let raw = content
        .get("usage")
        .and_then(|usage| usage.get("context_contents"))?;
    let contents = serde_json::from_value::<ContextContents>(raw.clone()).ok()?;
    if contents.is_empty() {
        return None;
    }
    Some(contents)
}

/// Pull the most recent rendered context contents out of a storage
/// session. Walks the session's events newest-first and returns the
/// first `assistant_message_end` carrying a non-empty
/// `usage.context_contents`.
///
/// Shared by both the agent and instance handlers so the newest-event
/// walk and field extraction are not duplicated across the two variants.
pub(crate) async fn latest_context_contents_for_session(
    storage: &StorageClient,
    jwt: &str,
    session: &aura_os_storage::StorageSession,
) -> Option<ContextContents> {
    let events = match storage.list_events(&session.id, jwt, None, None).await {
        Ok(events) => events,
        Err(err) => {
            warn!(session_id = %session.id, error = %err, "context-contents: list_events failed");
            return None;
        }
    };

    events
        .iter()
        .rev()
        .filter(|evt| evt.event_type.as_deref() == Some("assistant_message_end"))
        .find_map(|evt| context_contents_from_event_content(evt.content.as_ref()?))
}

async fn latest_context_contents_across_sessions(
    storage: &StorageClient,
    jwt: &str,
    mut sessions: Vec<aura_os_storage::StorageSession>,
) -> Option<ContextContents> {
    sessions.sort_by_key(storage_session_sort_key);
    sessions.reverse();

    for session in sessions {
        if let Some(contents) = latest_context_contents_for_session(storage, jwt, &session).await {
            return Some(contents);
        }
    }
    None
}

/// Collect sessions across every project_agent that shares this template
/// agent id. Selection happens after we inspect each session for a real
/// context payload, because newer child/subagent bookkeeping sessions can
/// legitimately have no assistant usage of their own.
async fn sessions_across_agents(
    state: &AppState,
    storage: &StorageClient,
    jwt: &str,
    agent_id_str: &str,
) -> Vec<aura_os_storage::StorageSession> {
    let matching = find_matching_project_agents(state, storage, jwt, agent_id_str).await;
    let mut all_sessions = Vec::new();
    for pa in &matching {
        let sessions = match storage.list_sessions(&pa.id, jwt).await {
            Ok(sessions) => sessions,
            Err(err) => {
                warn!(project_agent_id = %pa.id, error = %err, "context-contents: list_sessions failed; skipping");
                continue;
            }
        };
        all_sessions.extend(sessions);
    }
    all_sessions
}

/// GET `/api/agents/:agent_id/context-contents` — returns the latest
/// persisted rendered context contents across every session owned by
/// every project_agent that shares this template agent id. Used by the
/// UI to lazily hydrate the bucket-content preview when a user opens a
/// row in the Context Composition popover.
pub(crate) async fn get_agent_context_contents(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<Json<ContextContentsResponse>> {
    if is_capture_access_token(&jwt) && agent_id == demo_agent_id() {
        return Ok(Json(demo_contents_response()));
    }

    let storage = state.require_storage_client()?;
    let agent_id_str = agent_id.to_string();
    let sessions = sessions_across_agents(&state, storage, &jwt, &agent_id_str).await;
    let contents = latest_context_contents_across_sessions(storage, &jwt, sessions).await;
    Ok(Json(ContextContentsResponse::from(contents)))
}

/// GET
/// `/api/projects/:project_id/agents/:agent_instance_id/context-contents`
/// — project-scoped analogue: returns the latest persisted rendered
/// context contents for a single agent instance.
pub(crate) async fn get_instance_context_contents(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
) -> ApiResult<Json<ContextContentsResponse>> {
    if is_capture_access_token(&jwt) && agent_instance_id == demo_agent_instance_id() {
        return Ok(Json(demo_contents_response()));
    }

    let storage = state.require_storage_client()?;
    let sessions = storage
        .list_sessions(&agent_instance_id.to_string(), &jwt)
        .await
        .map_err(map_storage_error)?;

    let contents = latest_context_contents_across_sessions(storage, &jwt, sessions).await;
    Ok(Json(ContextContentsResponse::from(contents)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn assistant_event(context_contents: serde_json::Value) -> serde_json::Value {
        json!({ "usage": { "context_contents": context_contents } })
    }

    #[test]
    fn extracts_non_empty_context_contents() {
        let content = assistant_event(json!({
            "system_prompt": "You are helpful.",
            "tools": [{ "label": "read", "text": "Reads a file.", "tokens": 5 }],
        }));
        let parsed = context_contents_from_event_content(&content).expect("should parse contents");
        assert_eq!(parsed.system_prompt.as_deref(), Some("You are helpful."));
        assert_eq!(parsed.tools.len(), 1);
        assert_eq!(parsed.tools[0].label, "read");
    }

    #[test]
    fn returns_none_when_contents_all_empty() {
        let content = assistant_event(json!({}));
        assert!(context_contents_from_event_content(&content).is_none());
    }

    #[test]
    fn returns_none_when_usage_or_field_missing() {
        assert!(context_contents_from_event_content(&json!({})).is_none());
        assert!(context_contents_from_event_content(&json!({ "usage": {} })).is_none());
    }

    #[test]
    fn newest_first_walk_picks_most_recent_non_empty_event() {
        // Mirrors the production newest-first walk in
        // `latest_context_contents_for_session` over event contents.
        let events = [
            assistant_event(json!({ "system_prompt": "oldest" })),
            assistant_event(json!({})),
            assistant_event(json!({ "system_prompt": "newest" })),
        ];
        let found = events
            .iter()
            .rev()
            .find_map(context_contents_from_event_content);
        assert_eq!(
            found.and_then(|contents| contents.system_prompt).as_deref(),
            Some("newest"),
        );
    }
}
