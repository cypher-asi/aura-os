//! Read-only status of a previously accepted chat command. Mobile can poll
//! this without uploading attachments again or opening another harness turn.

use aura_os_core::{AgentId, AgentInstanceId, ProjectId, SessionId};
use aura_os_storage::{StorageClient, StorageSessionEvent};
use axum::extract::{Path, State};
use axum::Json;
use serde::Serialize;

use crate::error::{map_storage_error, ApiError, ApiResult};
use crate::state::{AppState, AuthJwt, AuthSession};

use super::agent_route::resolve_agent_for_chat;
use super::persist::{try_pin_session, PinnedSessionOutcome};
use super::session_access::resolve_agent_owned_session;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatCommandStatusResponse {
    command_id: String,
    session_id: String,
    execution_status: &'static str,
}

pub(crate) async fn get_agent_command_status(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(auth_session): AuthSession,
    Path((agent_id, session_id, command_id)): Path<(AgentId, SessionId, String)>,
) -> ApiResult<Json<ChatCommandStatusResponse>> {
    validate_command_id(&command_id)?;
    resolve_agent_for_chat(&state, &agent_id, &jwt, &auth_session).await?;
    let storage = state.require_storage_client()?;
    resolve_agent_owned_session(storage, &jwt, &agent_id, &session_id).await?;
    read_command_status(
        &state,
        storage,
        &jwt,
        &auth_session.user_id,
        &session_id,
        &command_id,
    )
    .await
}

pub(crate) async fn get_instance_command_status(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(auth_session): AuthSession,
    Path((project_id, agent_instance_id, session_id, command_id)): Path<(
        ProjectId,
        AgentInstanceId,
        SessionId,
        String,
    )>,
) -> ApiResult<Json<ChatCommandStatusResponse>> {
    validate_command_id(&command_id)?;
    let instance = state
        .agent_instance_service
        .get_instance(&project_id, &agent_instance_id)
        .await
        .map_err(|_| ApiError::not_found("agent instance not found"))?;
    if instance.project_id != project_id {
        return Err(ApiError::not_found("agent instance not found"));
    }
    let storage = state.require_storage_client()?;
    match try_pin_session(
        storage,
        &jwt,
        &agent_instance_id.to_string(),
        Some(&session_id),
    )
    .await
    {
        PinnedSessionOutcome::Matched(_) => {}
        _ => return Err(ApiError::not_found("session not found")),
    }
    read_command_status(
        &state,
        storage,
        &jwt,
        &auth_session.user_id,
        &session_id,
        &command_id,
    )
    .await
}

async fn read_command_status(
    state: &AppState,
    storage: &StorageClient,
    jwt: &str,
    owner_id: &str,
    session_id: &SessionId,
    command_id: &str,
) -> ApiResult<Json<ChatCommandStatusResponse>> {
    let session_id_str = session_id.to_string();
    if let Some(command) = state
        .live_streams
        .find_chat_command(Some(owner_id), command_id)
    {
        if command.session_id == session_id_str
            && command
                .stream
                .as_ref()
                .is_some_and(|stream| !stream.is_terminated())
        {
            return Ok(Json(ChatCommandStatusResponse {
                command_id: command_id.to_string(),
                session_id: session_id_str,
                execution_status: "attached",
            }));
        }
    }

    let events = storage
        .list_events(&session_id_str, jwt, None, None)
        .await
        .map_err(map_storage_error)?;
    if !has_user_command(&events, command_id) {
        return Err(ApiError::not_found("chat command not found"));
    }
    let execution_status = find_command_terminal(&events, command_id).unwrap_or("unconfirmed");
    Ok(Json(ChatCommandStatusResponse {
        command_id: command_id.to_string(),
        session_id: session_id_str,
        execution_status,
    }))
}

pub(super) fn find_command_terminal(
    events: &[StorageSessionEvent],
    command_id: &str,
) -> Option<&'static str> {
    events.iter().rev().find_map(|event| {
        if event.event_type.as_deref() != Some("chat_command_terminal") {
            return None;
        }
        let content = event.content.as_ref()?;
        if content.get("client_command_id")?.as_str()? != command_id {
            return None;
        }
        match content.get("status")?.as_str()? {
            "completed" => Some("completed"),
            "failed" => Some("failed"),
            _ => None,
        }
    })
}

fn has_user_command(events: &[StorageSessionEvent], command_id: &str) -> bool {
    events.iter().any(|event| {
        event.event_type.as_deref() == Some("user_message")
            && event
                .content
                .as_ref()
                .and_then(|content| content.get("client_command_id"))
                .and_then(|value| value.as_str())
                == Some(command_id)
    })
}

fn validate_command_id(command_id: &str) -> ApiResult<()> {
    if command_id.is_empty()
        || command_id.len() > 128
        || !command_id.is_ascii()
        || command_id.bytes().any(|byte| byte.is_ascii_control())
    {
        return Err(ApiError::bad_request("invalid client_command_id"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{find_command_terminal, has_user_command, validate_command_id};
    use aura_os_storage::StorageSessionEvent;

    fn event(event_type: &str, content: serde_json::Value) -> StorageSessionEvent {
        StorageSessionEvent {
            id: uuid::Uuid::new_v4().to_string(),
            session_id: None,
            user_id: None,
            agent_id: None,
            sender: None,
            project_id: None,
            org_id: None,
            event_type: Some(event_type.to_string()),
            content: Some(content),
            created_at: None,
        }
    }

    #[test]
    fn status_requires_the_exact_saved_user_command() {
        let events = vec![
            event(
                "user_message",
                serde_json::json!({"client_command_id": "wanted"}),
            ),
            event(
                "chat_command_terminal",
                serde_json::json!({"client_command_id": "other", "status": "completed"}),
            ),
            event(
                "chat_command_terminal",
                serde_json::json!({"client_command_id": "wanted", "status": "failed"}),
            ),
        ];
        assert!(has_user_command(&events, "wanted"));
        assert!(!has_user_command(&events, "other"));
        assert_eq!(find_command_terminal(&events, "wanted"), Some("failed"));
        assert_eq!(find_command_terminal(&events, "absent"), None);
    }

    #[test]
    fn command_id_is_bounded_before_storage_lookup() {
        assert!(validate_command_id("mobile-123").is_ok());
        assert!(validate_command_id("").is_err());
        assert!(validate_command_id(&"x".repeat(129)).is_err());
        assert!(validate_command_id("bad\nvalue").is_err());
    }
}
