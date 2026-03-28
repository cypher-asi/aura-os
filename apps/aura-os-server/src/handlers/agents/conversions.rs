use std::collections::HashMap;

use chrono::{DateTime, Utc};

use axum::http::StatusCode;
use axum::Json;

use aura_os_core::parse_dt;
use aura_os_core::{
    Agent, AgentId, AgentInstanceId, ChatContentBlock, ChatRole, ProfileId, ProjectId,
    SessionEvent, SessionEventId, ZeroAuthSession,
};
use aura_os_network::NetworkAgent;
use aura_os_storage::StorageSessionEvent;

use crate::error::ApiError;
use crate::state::AppState;

pub(crate) fn get_user_id(state: &AppState) -> Result<String, (StatusCode, Json<ApiError>)> {
    let session_bytes = state
        .store
        .get_setting("zero_auth_session")
        .map_err(|_| ApiError::unauthorized("not authenticated"))?;
    let session: ZeroAuthSession = serde_json::from_slice(&session_bytes)
        .map_err(|e| ApiError::internal(format!("deserializing auth session: {e}")))?;
    Ok(session.user_id)
}

pub(crate) fn agent_from_network(net: &NetworkAgent) -> Agent {
    let agent_id = net.id.parse::<AgentId>().unwrap_or_else(|_| AgentId::new());
    let profile_id: Option<ProfileId> = net.profile_id_typed();
    let epoch = DateTime::<Utc>::from(std::time::UNIX_EPOCH);
    let created_at = net
        .created_at
        .as_deref()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or(epoch);
    let updated_at = net
        .updated_at
        .as_deref()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or(created_at);

    Agent {
        agent_id,
        user_id: net.user_id.clone(),
        name: net.name.clone(),
        role: net.role.clone().unwrap_or_default(),
        personality: net.personality.clone().unwrap_or_default(),
        system_prompt: net.system_prompt.clone().unwrap_or_default(),
        skills: net.skills.clone().unwrap_or_default(),
        icon: net.icon.clone(),
        machine_type: net
            .machine_type
            .clone()
            .unwrap_or_else(|| "local".to_string()),
        vm_id: net.vm_id.clone(),
        network_agent_id: net.id.parse().ok(),
        profile_id,
        created_at,
        updated_at,
    }
}

/// Compute the workspace path for an agent instance based on its machine type.
///
/// Both local and remote paths are derived from the project name (slugified)
/// so directory names are human-readable and consistent.
///
/// - **local**: prefer the stored absolute `project_folder`; fall back to the
///   canonical `{data_dir}/workspaces/{slug}` path derived from the project name.
/// - **remote / swarm**: `/state/workspaces/{slug}` — under the pod's PVC mount
///   (`AURA_DATA_DIR=/state`, writable by uid 1000 / fs_group 1000).
pub(crate) fn resolve_workspace_path(
    machine_type: &str,
    project_folder: Option<&str>,
    data_dir: &std::path::Path,
    project_name: &str,
) -> String {
    if machine_type == "local" {
        project_folder
            .filter(|s| !s.is_empty())
            .filter(|s| std::path::Path::new(s).is_absolute())
            .map(String::from)
            .unwrap_or_else(|| {
                super::super::projects_helpers::canonical_workspace_path(data_dir, project_name)
                    .to_string_lossy()
                    .to_string()
            })
    } else {
        let slug = super::super::projects_helpers::slugify(project_name);
        format!("/state/workspaces/{slug}")
    }
}


/// Fetch all agents from the network, returning a map by network agent ID.
pub(crate) async fn resolve_network_agents(state: &AppState, jwt: &str) -> HashMap<String, Agent> {
    if let Some(ref client) = state.network_client {
        if let Ok(net_agents) = client.list_agents(jwt).await {
            return net_agents
                .iter()
                .map(|na| (na.id.clone(), agent_from_network(na)))
                .collect();
        }
    }
    HashMap::new()
}

/// Fetch a single agent's config from the network only (no local fallback).
pub(crate) async fn resolve_single_agent(
    state: &AppState,
    jwt: &str,
    agent_id: &str,
) -> Option<Agent> {
    let client = state.network_client.as_ref()?;
    let net_agent = client.get_agent(agent_id, jwt).await.ok()?;
    Some(agent_from_network(&net_agent))
}

/// Reconstruct `Vec<SessionEvent>` from persisted session events.
///
/// Only `user_message`, `assistant_message_end`, and `task_output` events
/// produce `SessionEvent` objects.  Incremental events (`text_delta`, `tool_use_start`,
/// etc.) are stored for replay but skipped here — the `assistant_message_end`
/// event contains the full synthesis (text, thinking, content_blocks, usage).
pub fn events_to_session_history(
    events: &[StorageSessionEvent],
    project_agent_id: &str,
    project_id: &str,
) -> Vec<SessionEvent> {
    let agent_instance_id = project_agent_id
        .parse::<AgentInstanceId>()
        .unwrap_or_else(|_| AgentInstanceId::nil());
    let pid = project_id
        .parse::<ProjectId>()
        .unwrap_or_else(|_| ProjectId::nil());

    let mut sorted = events.to_vec();
    sorted.sort_by(|a, b| {
        let ta = a.created_at.as_deref().unwrap_or("");
        let tb = b.created_at.as_deref().unwrap_or("");
        ta.cmp(tb).then_with(|| a.id.cmp(&b.id))
    });

    let mut messages = Vec::new();

    for event in &sorted {
        let event_type = event.event_type.as_deref().unwrap_or("");
        let content = event.content.as_ref();

        match event_type {
            "user_message" => {
                let text = content
                    .and_then(|c| c.get("text"))
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                messages.push(SessionEvent {
                    event_id: SessionEventId::new(),
                    agent_instance_id,
                    project_id: pid,
                    role: ChatRole::User,
                    content: text.to_string(),
                    content_blocks: None,
                    thinking: None,
                    thinking_duration_ms: None,
                    created_at: parse_dt(&event.created_at),
                });
            }
            "assistant_message_end" => {
                let text = content
                    .and_then(|c| c.get("text"))
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();

                let thinking = content
                    .and_then(|c| c.get("thinking"))
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .map(String::from);

                let content_blocks: Option<Vec<ChatContentBlock>> = content
                    .and_then(|c| c.get("content_blocks"))
                    .and_then(|v| serde_json::from_value(v.clone()).ok());

                if text.is_empty() && content_blocks.is_none() && thinking.is_none() {
                    continue;
                }

                messages.push(SessionEvent {
                    event_id: SessionEventId::new(),
                    agent_instance_id,
                    project_id: pid,
                    role: ChatRole::Assistant,
                    content: text,
                    content_blocks,
                    thinking,
                    thinking_duration_ms: None,
                    created_at: parse_dt(&event.created_at),
                });
            }
            "task_output" => {
                let text = content
                    .and_then(|c| c.get("text"))
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                if text.is_empty() {
                    continue;
                }
                messages.push(SessionEvent {
                    event_id: SessionEventId::new(),
                    agent_instance_id,
                    project_id: pid,
                    role: ChatRole::Assistant,
                    content: text.to_string(),
                    content_blocks: None,
                    thinking: None,
                    thinking_duration_ms: None,
                    created_at: parse_dt(&event.created_at),
                });
            }
            _ => {}
        }
    }

    messages
}
