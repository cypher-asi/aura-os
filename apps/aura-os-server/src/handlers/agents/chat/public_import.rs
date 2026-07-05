//! Authenticated import path for logged-out public chat transcripts.
//!
//! Public chat intentionally stores guest transcripts in browser
//! localStorage only. After sign-in, the web app can copy those turns
//! into the normal storage-backed agent chat model through this route,
//! so the transcript survives as a first-class Aura chat session.

use std::sync::LazyLock;

use axum::Json;
use axum::extract::{Path, State};
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use aura_os_core::{AgentId, SessionId};
use aura_os_storage::{CreateSessionEventRequest, CreateSessionRequest, StorageClient};

use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthJwt};

use super::discovery::find_matching_project_agents;
use super::setup::lazy_repair_home_project_binding;

const IMPORT_MARKER_EVENT_TYPE: &str = "public_chat_import";
const MAX_IMPORT_TURNS: usize = 200;
const MAX_PUBLIC_SESSION_ID_CHARS: usize = 128;
const MAX_TITLE_CHARS: usize = 120;
const MAX_TURN_CONTENT_CHARS: usize = 20_000;
static PUBLIC_CHAT_IMPORT_LOCK: LazyLock<tokio::sync::Mutex<()>> =
    LazyLock::new(|| tokio::sync::Mutex::new(()));

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportPublicChatRequest {
    pub public_session_id: String,
    #[serde(default)]
    pub title: Option<String>,
    pub turns: Vec<ImportPublicChatTurn>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportPublicChatTurn {
    pub role: ImportPublicChatRole,
    pub content: String,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ImportPublicChatRole {
    User,
    Assistant,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportPublicChatResponse {
    pub agent_id: String,
    pub agent_instance_id: String,
    pub project_id: String,
    pub session_id: String,
    pub imported_turn_count: usize,
    pub reused_existing: bool,
}

struct NormalizedImport {
    public_session_id: String,
    title: String,
    turns: Vec<ImportPublicChatTurn>,
}

pub(crate) async fn import_public_chat_session(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
    Json(body): Json<ImportPublicChatRequest>,
) -> ApiResult<Json<ImportPublicChatResponse>> {
    let storage = state
        .storage_client
        .as_ref()
        .cloned()
        .ok_or_else(|| ApiError::internal("storage client not configured"))?;
    let normalized = normalize_import_request(body)?;
    let _import_guard = PUBLIC_CHAT_IMPORT_LOCK.lock().await;

    let mut matching =
        find_matching_project_agents(&state, &storage, &jwt, &agent_id.to_string()).await;
    if matching.is_empty() {
        matching = lazy_repair_home_project_binding(&state, &storage, &agent_id, &jwt).await;
    }
    if matching.is_empty() {
        return Err(ApiError::bad_request(
            "chat agent has no project binding to import into",
        ));
    }

    if let Some(existing) = find_existing_import(
        &storage,
        &jwt,
        &agent_id,
        &normalized.public_session_id,
        &matching,
    )
    .await
    {
        return Ok(Json(existing));
    }

    let selected = matching
        .first()
        .ok_or_else(|| ApiError::bad_request("chat agent has no project binding"))?;
    let project_id = selected
        .project_id
        .as_deref()
        .filter(|p| !p.trim().is_empty())
        .ok_or_else(|| ApiError::bad_request("chat agent project binding has no project_id"))?
        .to_string();

    let session = storage
        .create_session(
            &selected.id,
            &jwt,
            &CreateSessionRequest {
                project_id: project_id.clone(),
                org_id: selected.org_id.clone(),
                model: None,
                status: Some("active".to_string()),
                context_usage_estimate: Some(0.0),
                summary_of_previous_context: Some(normalized.title.clone()),
            },
        )
        .await
        .map_err(|error| ApiError::internal(format!("creating imported chat session: {error}")))?;

    parse_session_id(&session.id)?;

    if let Err(error) = create_import_events(
        &storage,
        &jwt,
        &session.id,
        &selected.id,
        &project_id,
        &normalized,
    )
    .await
    {
        warn!(
            session_id = %session.id,
            public_session_id = %normalized.public_session_id,
            error = ?error,
            "public chat import failed after creating session; deleting partial import"
        );
        if let Err(delete_error) = storage.delete_session(&session.id, &jwt).await {
            warn!(
                session_id = %session.id,
                error = %delete_error,
                "public chat import failed to delete partial imported session"
            );
        }
        return Err(error);
    }

    info!(
        agent_id = %agent_id,
        session_id = %session.id,
        public_session_id = %normalized.public_session_id,
        turns = normalized.turns.len(),
        "imported public chat session"
    );

    Ok(Json(ImportPublicChatResponse {
        agent_id: agent_id.to_string(),
        agent_instance_id: selected.id.clone(),
        project_id,
        session_id: session.id,
        imported_turn_count: normalized.turns.len(),
        reused_existing: false,
    }))
}

async fn create_import_events(
    storage: &StorageClient,
    jwt: &str,
    session_id: &str,
    project_agent_id: &str,
    project_id: &str,
    normalized: &NormalizedImport,
) -> ApiResult<()> {
    for turn in &normalized.turns {
        create_imported_turn_event(storage, jwt, session_id, project_agent_id, project_id, turn)
            .await?;
    }
    create_import_marker_event(
        storage,
        jwt,
        session_id,
        project_agent_id,
        project_id,
        normalized,
    )
    .await
}

fn normalize_import_request(body: ImportPublicChatRequest) -> ApiResult<NormalizedImport> {
    let public_session_id = body.public_session_id.trim();
    if public_session_id.is_empty() {
        return Err(ApiError::bad_request("public_session_id is required"));
    }
    if public_session_id.chars().count() > MAX_PUBLIC_SESSION_ID_CHARS {
        return Err(ApiError::bad_request("public_session_id is too long"));
    }

    let turns: Vec<ImportPublicChatTurn> = body
        .turns
        .into_iter()
        .filter_map(|turn| {
            let content = turn.content.trim();
            if content.is_empty() {
                return None;
            }
            Some(ImportPublicChatTurn {
                role: turn.role,
                content: truncate_chars(content, MAX_TURN_CONTENT_CHARS),
            })
        })
        .take(MAX_IMPORT_TURNS)
        .collect();
    if turns.is_empty() {
        return Err(ApiError::bad_request(
            "at least one public chat turn is required",
        ));
    }

    let title = body
        .title
        .as_deref()
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .map(|title| truncate_chars(title, MAX_TITLE_CHARS))
        .unwrap_or_else(|| derive_title_from_turns(&turns));

    Ok(NormalizedImport {
        public_session_id: public_session_id.to_string(),
        title,
        turns,
    })
}

fn derive_title_from_turns(turns: &[ImportPublicChatTurn]) -> String {
    turns
        .iter()
        .find(|turn| turn.role == ImportPublicChatRole::User)
        .map(|turn| truncate_chars(&turn.content, MAX_TITLE_CHARS))
        .unwrap_or_else(|| "Imported public chat".to_string())
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    let mut out = String::new();
    for ch in value.chars().take(max_chars) {
        out.push(ch);
    }
    out
}

async fn create_imported_turn_event(
    storage: &StorageClient,
    jwt: &str,
    session_id: &str,
    project_agent_id: &str,
    project_id: &str,
    turn: &ImportPublicChatTurn,
) -> ApiResult<()> {
    let (event_type, sender) = match turn.role {
        ImportPublicChatRole::User => ("user_message", "user"),
        ImportPublicChatRole::Assistant => ("assistant_message_end", "agent"),
    };
    let req = CreateSessionEventRequest {
        session_id: Some(session_id.to_string()),
        user_id: None,
        agent_id: Some(project_agent_id.to_string()),
        sender: Some(sender.to_string()),
        project_id: Some(project_id.to_string()),
        org_id: None,
        event_type: event_type.to_string(),
        content: Some(serde_json::json!({
            "text": turn.content,
            "source": "public_chat_import",
        })),
    };
    storage
        .create_event(session_id, jwt, &req)
        .await
        .map(|_| ())
        .map_err(|error| ApiError::internal(format!("importing public chat turn: {error}")))
}

async fn create_import_marker_event(
    storage: &StorageClient,
    jwt: &str,
    session_id: &str,
    project_agent_id: &str,
    project_id: &str,
    normalized: &NormalizedImport,
) -> ApiResult<()> {
    let req = CreateSessionEventRequest {
        session_id: Some(session_id.to_string()),
        user_id: None,
        agent_id: Some(project_agent_id.to_string()),
        sender: Some("system".to_string()),
        project_id: Some(project_id.to_string()),
        org_id: None,
        event_type: IMPORT_MARKER_EVENT_TYPE.to_string(),
        content: Some(serde_json::json!({
            "public_session_id": normalized.public_session_id,
            "title": normalized.title,
            "turn_count": normalized.turns.len(),
        })),
    };
    storage
        .create_event(session_id, jwt, &req)
        .await
        .map(|_| ())
        .map_err(|error| ApiError::internal(format!("marking public chat import: {error}")))
}

async fn find_existing_import(
    storage: &StorageClient,
    jwt: &str,
    agent_id: &AgentId,
    public_session_id: &str,
    matching: &[aura_os_storage::StorageProjectAgent],
) -> Option<ImportPublicChatResponse> {
    for project_agent in matching {
        let project_id = project_agent.project_id.clone().unwrap_or_default();
        let sessions = match storage.list_sessions(&project_agent.id, jwt).await {
            Ok(sessions) => sessions,
            Err(error) => {
                warn!(
                    project_agent_id = %project_agent.id,
                    error = %error,
                    "public chat import: failed to list sessions while checking idempotency"
                );
                continue;
            }
        };
        for session in sessions {
            let events = match storage.list_events(&session.id, jwt, None, None).await {
                Ok(events) => events,
                Err(error) => {
                    warn!(
                        session_id = %session.id,
                        error = %error,
                        "public chat import: failed to list events while checking idempotency"
                    );
                    continue;
                }
            };
            let imported_turn_count = events
                .iter()
                .find(|event| {
                    event.event_type.as_deref() == Some(IMPORT_MARKER_EVENT_TYPE)
                        && event
                            .content
                            .as_ref()
                            .and_then(|content| content.get("public_session_id"))
                            .and_then(|value| value.as_str())
                            == Some(public_session_id)
                })
                .and_then(|event| {
                    event
                        .content
                        .as_ref()
                        .and_then(|content| content.get("turn_count"))
                        .and_then(|value| value.as_u64())
                });
            if let Some(imported_turn_count) = imported_turn_count {
                return Some(ImportPublicChatResponse {
                    agent_id: agent_id.to_string(),
                    agent_instance_id: project_agent.id.clone(),
                    project_id: project_id.clone(),
                    session_id: session.id,
                    imported_turn_count: imported_turn_count as usize,
                    reused_existing: true,
                });
            }
        }
    }
    None
}

fn parse_session_id(raw: &str) -> ApiResult<SessionId> {
    raw.parse::<SessionId>()
        .map_err(|_| ApiError::internal("storage returned invalid imported session id"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn turn(role: ImportPublicChatRole, content: &str) -> ImportPublicChatTurn {
        ImportPublicChatTurn {
            role,
            content: content.to_string(),
        }
    }

    #[test]
    fn normalize_import_request_trims_and_derives_title() {
        let normalized = normalize_import_request(ImportPublicChatRequest {
            public_session_id: " public-1 ".to_string(),
            title: None,
            turns: vec![
                turn(ImportPublicChatRole::User, "  Build an app  "),
                turn(ImportPublicChatRole::Assistant, " Done "),
                turn(ImportPublicChatRole::Assistant, "   "),
            ],
        })
        .expect("request should normalize");

        assert_eq!(normalized.public_session_id, "public-1");
        assert_eq!(normalized.title, "Build an app");
        assert_eq!(normalized.turns.len(), 2);
        assert_eq!(normalized.turns[0].content, "Build an app");
    }
}
