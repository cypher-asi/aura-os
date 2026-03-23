use std::convert::Infallible;

use axum::extract::{Path, State};
use axum::http::HeaderValue;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use futures_util::future::join_all;
use tokio_stream::wrappers::UnboundedReceiverStream;
use tokio_stream::StreamExt;
use tracing::{info, warn};

use aura_os_core::{AgentId, AgentInstanceId, Message, ProjectId};

use crate::dto::SendMessageRequest;
use crate::error::{ApiError, ApiResult};
use crate::handlers::projects;
use crate::state::AppState;

use super::conversions::storage_message_to_message;

const SSE_NO_BUFFERING_HEADERS: [(&str, HeaderValue); 1] =
    [("X-Accel-Buffering", HeaderValue::from_static("no"))];

async fn find_matching_project_agents(
    state: &AppState,
    storage: &aura_os_storage::StorageClient,
    jwt: &str,
    agent_id_str: &str,
) -> Vec<aura_os_storage::StorageProjectAgent> {
    let all_projects = match projects::list_all_projects_from_network(state).await {
        Ok(p) => p,
        Err((status, body)) => {
            warn!(?status, ?body, "failed to list projects for agent matching");
            return Vec::new();
        }
    };
    let pids: Vec<String> = all_projects
        .iter()
        .map(|p| p.project_id.to_string())
        .collect();
    let futs: Vec<_> = pids
        .iter()
        .map(|pid| storage.list_project_agents(pid, jwt))
        .collect();
    let results = join_all(futs).await;

    results
        .into_iter()
        .enumerate()
        .flat_map(|(i, result)| match result {
            Ok(agents) => agents
                .into_iter()
                .filter(|a| a.agent_id.as_deref() == Some(agent_id_str))
                .collect::<Vec<_>>(),
            Err(e) => {
                warn!(project_id = %pids[i], error = %e, "Failed to list project agents");
                Vec::new()
            }
        })
        .collect()
}

async fn collect_session_messages(
    storage: &aura_os_storage::StorageClient,
    jwt: &str,
    agents: &[aura_os_storage::StorageProjectAgent],
) -> Vec<Message> {
    let all_sessions = fetch_all_sessions(storage, jwt, agents).await;
    let msg_futs: Vec<_> = all_sessions
        .iter()
        .map(|s| storage.list_messages(&s.id, jwt, None, None))
        .collect();
    let msg_results: Vec<Result<Vec<aura_os_storage::StorageMessage>, _>> = join_all(msg_futs).await;
    let mut messages = Vec::new();
    for (i, result) in msg_results.into_iter().enumerate() {
        match result {
            Ok(session_msgs) => {
                for sm in session_msgs
                    .iter()
                    .filter(|sm| sm.role.as_deref() != Some("system"))
                {
                    messages.push(storage_message_to_message(sm));
                }
            }
            Err(e) => {
                warn!(session_id = %all_sessions[i].id, error = %e, "Failed to list messages");
            }
        }
    }
    messages
}

async fn fetch_all_sessions(
    storage: &aura_os_storage::StorageClient,
    jwt: &str,
    agents: &[aura_os_storage::StorageProjectAgent],
) -> Vec<aura_os_storage::StorageSession> {
    let futs: Vec<_> = agents
        .iter()
        .map(|pa| storage.list_sessions(&pa.id, jwt))
        .collect();
    let results: Vec<Result<Vec<aura_os_storage::StorageSession>, _>> = join_all(futs).await;
    results
        .into_iter()
        .enumerate()
        .flat_map(|(i, result)| match result {
            Ok(sessions) => sessions,
            Err(e) => {
                warn!(project_agent_id = %agents[i].id, error = %e, "Failed to list sessions");
                Vec::new()
            }
        })
        .collect()
}

/// Aggregate agent-level messages from aura-storage (all project-agents for
/// this agent_id -> sessions -> messages).
pub async fn aggregate_agent_messages_from_storage(
    state: &AppState,
    agent_id: &AgentId,
) -> Vec<Message> {
    let (Some(ref storage), Ok(jwt)) = (&state.storage_client, state.get_jwt()) else {
        return Vec::new();
    };
    let agent_id_str = agent_id.to_string();
    let matching = find_matching_project_agents(state, storage, &jwt, &agent_id_str).await;
    let mut messages = collect_session_messages(storage, &jwt, &matching).await;
    messages.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    messages
}

pub async fn list_agent_messages(
    State(state): State<AppState>,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<Json<Vec<Message>>> {
    let _ = state.require_storage_client()?;
    let _ = state.get_jwt()?;
    let messages = aggregate_agent_messages_from_storage(&state, &agent_id).await;
    Ok(Json(messages))
}

pub async fn send_agent_message_stream(
    State(state): State<AppState>,
    Path(agent_id): Path<AgentId>,
    Json(body): Json<SendMessageRequest>,
) -> ApiResult<(
    [(&'static str, HeaderValue); 1],
    Sse<impl futures_core::Stream<Item = Result<Event, Infallible>>>,
)> {
    super::super::billing::require_credits(&state).await?;
    info!(%agent_id, action = ?body.action, "Agent message stream requested");

    let config = serde_json::json!({
        "agent_id": agent_id.to_string(),
        "content": body.content,
        "action": body.action,
        "attachments": body.attachments,
    });

    let resp = state
        .swarm_client
        .install("chat", config)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;

    let events_rx = state
        .swarm_client
        .events(&resp.automaton_id)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;

    let stream = UnboundedReceiverStream::new(events_rx)
        .map(|evt| super::super::sse::automaton_event_to_sse(&evt));

    Ok((
        SSE_NO_BUFFERING_HEADERS,
        Sse::new(stream).keep_alive(KeepAlive::default()),
    ))
}

pub async fn list_messages(
    State(state): State<AppState>,
    Path((_project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
) -> ApiResult<Json<Vec<Message>>> {
    let storage = state.require_storage_client()?;
    let jwt = state.get_jwt()?;

    let sessions = storage
        .list_sessions(&agent_instance_id.to_string(), &jwt)
        .await
        .unwrap_or_else(|e| {
            warn!(agent_instance_id = %agent_instance_id, error = %e, "failed to list sessions");
            Vec::new()
        });

    let mut messages = Vec::new();
    for session in &sessions {
        if let Ok(session_msgs) = storage.list_messages(&session.id, &jwt, None, None).await {
            for sm in session_msgs
                .iter()
                .filter(|sm| sm.role.as_deref() != Some("system"))
            {
                messages.push(storage_message_to_message(sm));
            }
        }
    }
    messages.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    Ok(Json(messages))
}

pub async fn send_message_stream(
    State(state): State<AppState>,
    Path((project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
    Json(body): Json<SendMessageRequest>,
) -> ApiResult<(
    [(&'static str, HeaderValue); 1],
    Sse<impl futures_core::Stream<Item = Result<Event, Infallible>>>,
)> {
    super::super::billing::require_credits(&state).await?;
    info!(%project_id, %agent_instance_id, action = ?body.action, "Message stream requested");

    let config = serde_json::json!({
        "project_id": project_id.to_string(),
        "agent_instance_id": agent_instance_id.to_string(),
        "content": body.content,
        "action": body.action,
        "attachments": body.attachments,
    });

    let resp = state
        .swarm_client
        .install("chat", config)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;

    let events_rx = state
        .swarm_client
        .events(&resp.automaton_id)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;

    let stream = UnboundedReceiverStream::new(events_rx)
        .map(|evt| super::super::sse::automaton_event_to_sse(&evt));

    Ok((
        SSE_NO_BUFFERING_HEADERS,
        Sse::new(stream).keep_alive(KeepAlive::default()),
    ))
}
