use std::convert::Infallible;

use axum::extract::{Path, State};
use axum::response::sse::{Event, Sse};
use axum::Json;
use serde::Deserialize;
use tokio::sync::mpsc;
use tokio_stream::wrappers::UnboundedReceiverStream;
use tokio_stream::StreamExt;
use tracing::info;

use aura_core::{ChatMessage, ChatSession, ChatSessionId, ProjectId};
use aura_chat::ChatStreamEvent;

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

#[derive(Deserialize)]
pub struct CreateChatSessionRequest {
    pub title: String,
}

#[derive(Deserialize)]
pub struct UpdateChatSessionRequest {
    pub title: String,
}

#[derive(Deserialize)]
pub struct SendMessageRequest {
    pub content: String,
    pub action: Option<String>,
}

pub async fn create_chat_session(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
    Json(body): Json<CreateChatSessionRequest>,
) -> ApiResult<Json<ChatSession>> {
    let session = state
        .chat_service
        .create_session(&project_id, &body.title)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(session))
}

pub async fn list_chat_sessions(
    State(state): State<AppState>,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<Vec<ChatSession>>> {
    let sessions = state
        .chat_service
        .list_sessions(&project_id)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(sessions))
}

pub async fn delete_chat_session(
    State(state): State<AppState>,
    Path((project_id, chat_session_id)): Path<(ProjectId, ChatSessionId)>,
) -> ApiResult<Json<()>> {
    state
        .chat_service
        .delete_session(&project_id, &chat_session_id)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(()))
}

pub async fn update_chat_session(
    State(state): State<AppState>,
    Path((project_id, chat_session_id)): Path<(ProjectId, ChatSessionId)>,
    Json(body): Json<UpdateChatSessionRequest>,
) -> ApiResult<Json<ChatSession>> {
    let session = state
        .chat_service
        .update_session_title(&project_id, &chat_session_id, &body.title)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(session))
}

pub async fn list_messages(
    State(state): State<AppState>,
    Path((project_id, chat_session_id)): Path<(ProjectId, ChatSessionId)>,
) -> ApiResult<Json<Vec<ChatMessage>>> {
    let messages = state
        .chat_service
        .list_messages(&project_id, &chat_session_id)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(messages))
}

pub async fn send_message_stream(
    State(state): State<AppState>,
    Path((project_id, chat_session_id)): Path<(ProjectId, ChatSessionId)>,
    Json(body): Json<SendMessageRequest>,
) -> Sse<impl futures_core::Stream<Item = Result<Event, Infallible>>> {
    info!(%project_id, %chat_session_id, action = ?body.action, "Chat message stream requested");

    let (tx, rx) = mpsc::unbounded_channel::<ChatStreamEvent>();

    let chat_service = state.chat_service.clone();
    let pid = project_id;
    let sid = chat_session_id;
    let content = body.content;
    let action = body.action;
    tokio::spawn(async move {
        chat_service
            .send_message_streaming(&pid, &sid, &content, action.as_deref(), tx)
            .await;
    });

    let stream = UnboundedReceiverStream::new(rx).map(move |evt| {
        let sse_event = match &evt {
            ChatStreamEvent::Delta(text) => Event::default()
                .event("delta")
                .json_data(serde_json::json!({ "text": text }))
                .unwrap(),
            ChatStreamEvent::ToolCall { id, name, input } => Event::default()
                .event("tool_call")
                .json_data(serde_json::json!({ "id": id, "name": name, "input": input }))
                .unwrap(),
            ChatStreamEvent::ToolResult { id, name, result, is_error } => Event::default()
                .event("tool_result")
                .json_data(serde_json::json!({
                    "id": id, "name": name, "result": result, "is_error": is_error
                }))
                .unwrap(),
            ChatStreamEvent::SpecSaved(spec) => Event::default()
                .event("spec_saved")
                .json_data(serde_json::json!({ "spec": spec }))
                .unwrap(),
            ChatStreamEvent::TaskSaved(task) => Event::default()
                .event("task_saved")
                .json_data(serde_json::json!({ "task": task }))
                .unwrap(),
            ChatStreamEvent::MessageSaved(msg) => Event::default()
                .event("message_saved")
                .json_data(serde_json::json!({ "message": msg }))
                .unwrap(),
            ChatStreamEvent::TitleUpdated(session) => Event::default()
                .event("title_updated")
                .json_data(serde_json::json!({ "session": session }))
                .unwrap(),
            ChatStreamEvent::Error(msg) => Event::default()
                .event("error")
                .json_data(serde_json::json!({ "message": msg }))
                .unwrap(),
            ChatStreamEvent::Done => Event::default()
                .event("done")
                .json_data(serde_json::json!({}))
                .unwrap(),
        };
        Ok(sse_event)
    });

    Sse::new(stream)
}
