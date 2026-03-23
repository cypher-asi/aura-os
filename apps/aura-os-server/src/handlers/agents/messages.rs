use std::convert::Infallible;

use axum::extract::{Path, State};
use axum::http::HeaderValue;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use futures_util::future::join_all;
use tokio_stream::wrappers::UnboundedReceiverStream;
use tokio_stream::StreamExt;
use tracing::{info, warn};

use aura_os_core::{AgentId, AgentInstanceId, HarnessMode, Message, ProjectId};
use aura_os_link::{HarnessInbound, SessionConfig};

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
        .zip(pids.iter())
        .flat_map(|(result, pid)| match result {
            Ok(agents) => agents
                .into_iter()
                .filter(|a| a.agent_id.as_deref() == Some(agent_id_str))
                .collect::<Vec<_>>(),
            Err(e) => {
                warn!(project_id = %pid, error = %e, "Failed to list project agents");
                Vec::new()
            }
        })
        .collect()
}

async fn collect_session_messages(
    storage: &aura_os_storage::StorageClient,
    jwt: &str,
    sessions: &[aura_os_storage::StorageSession],
) -> Vec<Message> {
    let msg_futs: Vec<_> = sessions
        .iter()
        .map(|s| storage.list_messages(&s.id, jwt, None, None))
        .collect();
    let msg_results: Vec<Result<Vec<aura_os_storage::StorageMessage>, _>> = join_all(msg_futs).await;
    let mut messages = Vec::new();
    for (result, session) in msg_results.into_iter().zip(sessions.iter()) {
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
                warn!(session_id = %session.id, error = %e, "Failed to list messages");
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
        .zip(agents.iter())
        .flat_map(|(result, agent)| match result {
            Ok(sessions) => sessions,
            Err(e) => {
                warn!(project_agent_id = %agent.id, error = %e, "Failed to list sessions");
                Vec::new()
            }
        })
        .collect()
}

/// Aggregate agent-level messages from aura-storage (all project-agents for
/// this agent_id -> sessions -> messages).
pub(crate) async fn aggregate_agent_messages_from_storage(
    state: &AppState,
    agent_id: &AgentId,
) -> Vec<Message> {
    let (Some(ref storage), Ok(jwt)) = (&state.storage_client, state.get_jwt()) else {
        return Vec::new();
    };
    let agent_id_str = agent_id.to_string();
    let matching = find_matching_project_agents(state, storage, &jwt, &agent_id_str).await;
    let sessions = fetch_all_sessions(storage, &jwt, &matching).await;
    let mut messages = collect_session_messages(storage, &jwt, &sessions).await;
    messages.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    messages
}

pub(crate) async fn list_agent_messages(
    State(state): State<AppState>,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<Json<Vec<Message>>> {
    let _ = state.require_storage_client()?;
    let _ = state.get_jwt()?;
    let messages = aggregate_agent_messages_from_storage(&state, &agent_id).await;
    Ok(Json(messages))
}

async fn open_harness_chat_stream(
    state: &AppState,
    harness_mode: HarnessMode,
    session_config: SessionConfig,
    user_content: String,
) -> ApiResult<(
    [(&'static str, HeaderValue); 1],
    Sse<impl futures_core::Stream<Item = Result<Event, Infallible>>>,
)> {
    let harness = state.harness_for(harness_mode);
    let session = harness
        .open_session(session_config)
        .await
        .map_err(|e| ApiError::internal(format!("opening harness session: {e}")))?;

    session
        .commands_tx
        .send(HarnessInbound::UserMessage {
            content: user_content,
        })
        .map_err(|e| ApiError::internal(format!("sending user message: {e}")))?;

    let commands_tx = session.commands_tx;
    let stream = UnboundedReceiverStream::new(session.events_rx).map(move |evt| {
        let _ = &commands_tx;
        super::super::sse::harness_event_to_sse(&evt)
    });

    Ok((
        SSE_NO_BUFFERING_HEADERS,
        Sse::new(stream).keep_alive(KeepAlive::default()),
    ))
}

pub(crate) async fn send_agent_message_stream(
    State(state): State<AppState>,
    Path(agent_id): Path<AgentId>,
    Json(body): Json<SendMessageRequest>,
) -> ApiResult<(
    [(&'static str, HeaderValue); 1],
    Sse<impl futures_core::Stream<Item = Result<Event, Infallible>>>,
)> {
    super::super::billing::require_credits(&state).await?;
    info!(%agent_id, action = ?body.action, "Agent message stream requested");

    let agent = state
        .agent_service
        .get_agent_async("", &agent_id)
        .await
        .map_err(|e| ApiError::internal(format!("looking up agent: {e}")))?;

    let config = SessionConfig {
        system_prompt: Some(agent.system_prompt.clone()),
        agent_id: Some(agent_id.to_string()),
        ..Default::default()
    };

    open_harness_chat_stream(&state, agent.harness_mode(), config, body.content).await
}

pub(crate) async fn list_messages(
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

    let mut messages = collect_session_messages(&storage, &jwt, &sessions).await;
    messages.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    Ok(Json(messages))
}

pub(crate) async fn send_message_stream(
    State(state): State<AppState>,
    Path((project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
    Json(body): Json<SendMessageRequest>,
) -> ApiResult<(
    [(&'static str, HeaderValue); 1],
    Sse<impl futures_core::Stream<Item = Result<Event, Infallible>>>,
)> {
    super::super::billing::require_credits(&state).await?;
    info!(%project_id, %agent_instance_id, action = ?body.action, "Message stream requested");

    let instance = state
        .agent_instance_service
        .get_instance(&project_id, &agent_instance_id)
        .await
        .map_err(|e| ApiError::internal(format!("looking up agent instance: {e}")))?;

    let config = SessionConfig {
        system_prompt: Some(instance.system_prompt.clone()),
        agent_id: Some(instance.agent_id.to_string()),
        ..Default::default()
    };

    open_harness_chat_stream(&state, instance.harness_mode(), config, body.content).await
}
