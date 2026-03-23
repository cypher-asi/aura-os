use std::convert::Infallible;
use std::time::{Duration, Instant};

use axum::extract::{Path, State};
use axum::http::HeaderValue;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use futures_util::future::join_all;
use tokio::sync::mpsc;
use tokio_stream::wrappers::UnboundedReceiverStream;
use tokio_stream::StreamExt;
use tracing::{info, warn};

use aura_chat::{AgentMessageParams, ChatMessageParams, ChatStreamEvent};
use aura_core::{AgentId, AgentInstanceId, Message, ProjectId};
use aura_engine::EngineEvent;

use crate::channel_ext::send_or_log;
use crate::dto::SendMessageRequest;
use crate::error::ApiResult;
use crate::handlers::projects;
use crate::state::AppState;

use super::conversions::{get_user_id, storage_message_to_message};

const AGENT_MSG_CACHE_TTL: Duration = Duration::from_secs(30);

const SSE_NO_BUFFERING_HEADERS: [(&str, HeaderValue); 1] =
    [("X-Accel-Buffering", HeaderValue::from_static("no"))];

async fn find_matching_project_agents(
    state: &AppState,
    storage: &aura_storage::StorageClient,
    jwt: &str,
    agent_id_str: &str,
) -> Vec<aura_storage::StorageProjectAgent> {
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
    storage: &aura_storage::StorageClient,
    jwt: &str,
    agents: &[aura_storage::StorageProjectAgent],
) -> Vec<Message> {
    let all_sessions = fetch_all_sessions(storage, jwt, agents).await;
    let msg_futs: Vec<_> = all_sessions
        .iter()
        .map(|s| storage.list_messages(&s.id, jwt, None, None))
        .collect();
    let msg_results: Vec<Result<Vec<aura_storage::StorageMessage>, _>> = join_all(msg_futs).await;
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
    storage: &aura_storage::StorageClient,
    jwt: &str,
    agents: &[aura_storage::StorageProjectAgent],
) -> Vec<aura_storage::StorageSession> {
    let futs: Vec<_> = agents
        .iter()
        .map(|pa| storage.list_sessions(&pa.id, jwt))
        .collect();
    let results: Vec<Result<Vec<aura_storage::StorageSession>, _>> = join_all(futs).await;
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

/// Aggregate agent-level messages from aura-storage only (all project-agents for this agent_id -> sessions -> messages).
/// Results are cached with a short TTL to avoid the expensive fan-out on repeated loads.
pub async fn aggregate_agent_messages_from_storage(
    state: &AppState,
    agent_id: &AgentId,
) -> Vec<Message> {
    let key = agent_id.to_string();

    {
        let cache = state.agent_message_cache.lock().await;
        if let Some((ts, msgs)) = cache.get(&key) {
            if ts.elapsed() < AGENT_MSG_CACHE_TTL {
                return msgs.clone();
            }
        }
    }

    let messages = fetch_agent_messages_uncached(state, agent_id).await;

    {
        let mut cache = state.agent_message_cache.lock().await;
        cache.insert(key, (Instant::now(), messages.clone()));
    }

    messages
}

/// Invalidate cached messages for an agent so the next read fetches fresh data.
pub fn invalidate_agent_message_cache(state: &AppState, agent_id: &AgentId) {
    let key = agent_id.to_string();
    let cache = state.agent_message_cache.clone();
    tokio::spawn(async move {
        cache.lock().await.remove(&key);
    });
}

async fn fetch_agent_messages_uncached(state: &AppState, agent_id: &AgentId) -> Vec<Message> {
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

    let agent = match get_user_id(&state) {
        Ok(uid) => state
            .agent_service
            .get_agent_async(&uid, &agent_id)
            .await
            .ok(),
        Err(_) => {
            warn!(%agent_id, "No authenticated user, cannot resolve agent");
            None
        }
    };

    invalidate_agent_message_cache(&state, &agent_id);
    let (storage_anchor, projects) = resolve_storage_anchor(&state, &agent_id).await;
    let messages = fetch_agent_messages_uncached(&state, &agent_id).await;

    let (tx, rx) = mpsc::unbounded_channel::<ChatStreamEvent>();

    let chat_service = state.chat_service.clone();
    let content = body.content;
    let action = body.action.clone();
    let attachments = body.attachments.unwrap_or_default();

    tokio::spawn(async move {
        if let Some(ref agent) = agent {
            chat_service
                .send_agent_message_streaming(
                    AgentMessageParams {
                        agent_id: &agent_id,
                        agent,
                        projects: &projects,
                        storage_messages: messages,
                        content: &content,
                        action: action.as_deref(),
                        attachments: &attachments,
                        storage_anchor,
                    },
                    tx,
                )
                .await;
        } else {
            send_or_log(&tx, ChatStreamEvent::Error("agent not found".to_string()));
            send_or_log(&tx, ChatStreamEvent::Done);
        }
    });

    let stream = UnboundedReceiverStream::new(rx)
        .map(move |evt| Ok(super::super::sse::chat_stream_event_to_sse(&evt)));

    Ok((
        SSE_NO_BUFFERING_HEADERS,
        Sse::new(stream).keep_alive(KeepAlive::default()),
    ))
}

async fn resolve_storage_anchor(
    state: &AppState,
    agent_id: &AgentId,
) -> (
    Option<(ProjectId, AgentInstanceId)>,
    Vec<aura_core::Project>,
) {
    let (Some(ref storage), Ok(jwt)) = (&state.storage_client, state.get_jwt()) else {
        return (None, Vec::new());
    };
    let all_projects = match projects::list_all_projects_from_network(state).await {
        Ok(p) => p,
        Err((status, body)) => {
            warn!(
                ?status,
                ?body,
                "failed to list projects for storage anchor resolution"
            );
            return (None, Vec::new());
        }
    };
    let agent_id_str = agent_id.to_string();
    let mut storage_anchor = None;
    let mut matched = Vec::new();
    for project in all_projects {
        if let Ok(agents) = storage
            .list_project_agents(&project.project_id.to_string(), &jwt)
            .await
        {
            for a in &agents {
                if a.agent_id.as_deref() == Some(&agent_id_str) {
                    if storage_anchor.is_none() {
                        if let Ok(inst_id) = a.id.parse::<AgentInstanceId>() {
                            storage_anchor = Some((project.project_id, inst_id));
                        }
                    }
                    matched.push(project.clone());
                    break;
                }
            }
        }
    }
    (storage_anchor, matched)
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

    let agent_instance = state
        .agent_instance_service
        .get_instance(&project_id, &agent_instance_id)
        .await
        .ok();

    let (tx, rx) = mpsc::unbounded_channel::<ChatStreamEvent>();
    let content = body.content;
    let action = body.action.clone();
    let attachments = body.attachments.unwrap_or_default();
    let is_generate_specs = body.action.as_deref() == Some("generate_specs");
    if is_generate_specs {
        send_or_log(&state.event_tx, EngineEvent::SpecGenStarted { project_id });
    }

    let chat_service = state.chat_service.clone();
    let pid = project_id;
    let aiid = agent_instance_id;
    tokio::spawn(async move {
        if let Some(ref instance) = agent_instance {
            chat_service
                .send_message_streaming(
                    ChatMessageParams {
                        project_id: &pid,
                        agent_instance_id: &aiid,
                        agent_instance: instance,
                        content: &content,
                        action: action.as_deref(),
                        attachments: &attachments,
                    },
                    tx,
                )
                .await;
        } else {
            send_or_log(
                &tx,
                ChatStreamEvent::Error("agent instance not found".to_string()),
            );
            send_or_log(&tx, ChatStreamEvent::Done);
        }
    });

    let stream =
        map_chat_stream_with_spec_events(rx, state.event_tx.clone(), project_id, is_generate_specs);
    Ok((
        SSE_NO_BUFFERING_HEADERS,
        Sse::new(stream).keep_alive(KeepAlive::default()),
    ))
}

fn map_chat_stream_with_spec_events(
    rx: mpsc::UnboundedReceiver<ChatStreamEvent>,
    event_tx: mpsc::UnboundedSender<EngineEvent>,
    project_id: ProjectId,
    is_generate_specs: bool,
) -> impl futures_core::Stream<Item = Result<Event, Infallible>> {
    let mut spec_count: usize = 0;
    UnboundedReceiverStream::new(rx).map(move |evt| {
        match &evt {
            ChatStreamEvent::SpecSaved(spec) => {
                spec_count += 1;
                send_or_log(
                    &event_tx,
                    EngineEvent::SpecSaved {
                        project_id,
                        spec: spec.clone(),
                    },
                );
            }
            ChatStreamEvent::Done if is_generate_specs => {
                send_or_log(
                    &event_tx,
                    EngineEvent::SpecGenCompleted {
                        project_id,
                        spec_count,
                    },
                );
            }
            _ => {}
        }
        Ok(super::super::sse::chat_stream_event_to_sse(&evt))
    })
}
