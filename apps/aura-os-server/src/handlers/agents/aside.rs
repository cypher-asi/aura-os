use axum::extract::{Path, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tracing::warn;

use aura_os_core::{AgentId, AgentInstanceId, ProjectId, SessionId};
use aura_os_harness::ConversationMessage;
use aura_os_storage::{StorageClient, StorageSession};

use crate::error::{map_storage_error, ApiError, ApiResult};
use crate::state::{AppState, AuthJwt};

use super::chat::session_events_to_conversation_history;
use super::conversions::events_to_session_history;
use super::sessions::reject_deleted_storage_session;

const ASIDE_MODEL: &str = "aura-claude-sonnet-5";
const ASIDE_MAX_TOKENS: u32 = 1024;
const ASIDE_QUESTION_MAX_CHARS: usize = 4_000;
const ASIDE_SYSTEM_PROMPT: &str = "Answer a one-off side question using the supplied conversation as context. Be concise and direct. Do not continue the main task, call tools, propose tool calls, or modify project state. If the conversation does not contain enough context, say so plainly. This answer is ephemeral and will not be added to the main conversation.";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AskAsideRequest {
    question: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AskAsideResponse {
    answer: String,
}

pub(crate) async fn ask_instance_session_aside(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((project_id, agent_instance_id, session_id)): Path<(
        ProjectId,
        AgentInstanceId,
        SessionId,
    )>,
    Json(request): Json<AskAsideRequest>,
) -> ApiResult<Json<AskAsideResponse>> {
    let storage = state.require_storage_client()?;
    let session = load_session(storage, &jwt, &session_id).await?;
    let project_id = project_id.to_string();
    let agent_instance_id = agent_instance_id.to_string();
    if session.project_id.as_deref() != Some(project_id.as_str())
        || session.project_agent_id.as_deref() != Some(agent_instance_id.as_str())
    {
        return Err(ApiError::not_found("session not found"));
    }

    ask_aside(
        &state,
        &jwt,
        storage,
        &session_id.to_string(),
        &project_id,
        &agent_instance_id,
        &request.question,
    )
    .await
}

pub(crate) async fn ask_agent_session_aside(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((agent_id, session_id)): Path<(AgentId, SessionId)>,
    Json(request): Json<AskAsideRequest>,
) -> ApiResult<Json<AskAsideResponse>> {
    let storage = state.require_storage_client()?;
    let session = load_session(storage, &jwt, &session_id).await?;
    let project_agent_id = session
        .project_agent_id
        .as_deref()
        .ok_or_else(|| ApiError::not_found("session not found"))?;
    let project_id = session
        .project_id
        .as_deref()
        .ok_or_else(|| ApiError::not_found("session not found"))?;
    let binding = storage
        .get_project_agent(project_agent_id, &jwt)
        .await
        .map_err(map_session_lookup_error)?;
    let agent_id = agent_id.to_string();
    if binding.agent_id.as_deref() != Some(agent_id.as_str()) {
        return Err(ApiError::not_found("session not found"));
    }

    ask_aside(
        &state,
        &jwt,
        storage,
        &session_id.to_string(),
        project_id,
        project_agent_id,
        &request.question,
    )
    .await
}

async fn load_session(
    storage: &StorageClient,
    jwt: &str,
    session_id: &SessionId,
) -> ApiResult<StorageSession> {
    let session = storage
        .get_session(&session_id.to_string(), jwt)
        .await
        .map_err(map_session_lookup_error)?;
    reject_deleted_storage_session(&session, "session not found")?;
    Ok(session)
}

fn map_session_lookup_error(
    error: aura_os_storage::StorageError,
) -> (axum::http::StatusCode, Json<ApiError>) {
    match &error {
        aura_os_storage::StorageError::Server { status: 404, .. } => {
            ApiError::not_found("session not found")
        }
        _ => map_storage_error(error),
    }
}

async fn ask_aside(
    state: &AppState,
    jwt: &str,
    storage: &StorageClient,
    session_id: &str,
    project_id: &str,
    agent_id: &str,
    question: &str,
) -> ApiResult<Json<AskAsideResponse>> {
    let question = validate_question(question)?;
    let storage_events = storage
        .list_events(session_id, jwt, None, None)
        .await
        .map_err(map_storage_error)?;
    let events = events_to_session_history(&storage_events, agent_id, project_id);
    let history = session_events_to_conversation_history(&events);
    let request_body = build_aside_request(&history, question);

    // Deliberately omit x-aura-session-id. The router may mirror requests
    // carrying that header into the durable transcript; /btw must never do so.
    let response = state
        .http_client
        .post(format!("{}/v1/messages", state.router_url))
        .bearer_auth(jwt)
        .header("anthropic-beta", "prompt-caching-2024-07-31")
        .header("x-aura-project-id", project_id)
        .header("x-aura-agent-id", agent_id)
        .json(&request_body)
        .send()
        .await
        .map_err(|error| {
            warn!(%error, "aside router request failed");
            ApiError::internal("Could not answer the side question")
        })?;

    if !response.status().is_success() {
        let status = response.status();
        warn!(%status, "aside router returned an error");
        return Err(ApiError::internal("Could not answer the side question"));
    }
    let body: Value = response.json().await.map_err(|error| {
        warn!(%error, "aside router response was invalid");
        ApiError::internal("Could not read the side-question answer")
    })?;
    let answer = body
        .get("content")
        .and_then(Value::as_array)
        .and_then(|blocks| {
            blocks
                .iter()
                .filter_map(|block| block.get("text").and_then(Value::as_str))
                .find(|text| !text.trim().is_empty())
        })
        .map(str::trim)
        .unwrap_or_default();
    if answer.is_empty() {
        return Err(ApiError::internal(
            "The side question returned an empty answer",
        ));
    }

    Ok(Json(AskAsideResponse {
        answer: answer.to_string(),
    }))
}

fn validate_question(question: &str) -> ApiResult<&str> {
    let question = question.trim();
    if question.is_empty() {
        return Err(ApiError::bad_request("question is required"));
    }
    if question.chars().count() > ASIDE_QUESTION_MAX_CHARS {
        return Err(ApiError::bad_request(format!(
            "question must be at most {ASIDE_QUESTION_MAX_CHARS} characters"
        )));
    }
    Ok(question)
}

fn build_aside_request(history: &[ConversationMessage], question: &str) -> Value {
    let mut messages = history.to_vec();
    messages.push(ConversationMessage {
        role: "user".to_string(),
        content: question.to_string(),
    });
    json!({
        "model": ASIDE_MODEL,
        "max_tokens": ASIDE_MAX_TOKENS,
        "system": [{
            "type": "text",
            "text": ASIDE_SYSTEM_PROMPT,
            "cache_control": { "type": "ephemeral" }
        }],
        "messages": messages,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_is_tool_free_and_appends_the_question() {
        let body = build_aside_request(
            &[ConversationMessage {
                role: "assistant".to_string(),
                content: "The build is green.".to_string(),
            }],
            "Which build?",
        );
        assert!(body.get("tools").is_none());
        assert_eq!(body["messages"][1]["content"], "Which build?");
        assert_eq!(body["messages"][0]["content"], "The build is green.");
    }

    #[test]
    fn rejects_empty_and_oversized_questions() {
        assert!(validate_question("   ").is_err());
        assert!(validate_question(&"x".repeat(ASIDE_QUESTION_MAX_CHARS + 1)).is_err());
    }
}
