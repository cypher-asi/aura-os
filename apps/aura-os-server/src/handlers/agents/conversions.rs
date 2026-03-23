use std::collections::HashMap;

use chrono::{DateTime, Utc};

use axum::http::StatusCode;
use axum::Json;

use aura_os_core::parse_dt;
use aura_os_core::{
    Agent, AgentId, AgentInstanceId, ChatContentBlock, ChatRole, Message, MessageId, ProfileId,
    ProjectId, ZeroAuthSession,
};
use aura_os_network::NetworkAgent;
use aura_os_storage::StorageMessage;

use crate::error::ApiError;
use crate::state::AppState;

pub(crate) fn get_user_id(state: &AppState) -> Result<String, (StatusCode, Json<ApiError>)> {
    let session_bytes = state
        .store
        .get_setting("zero_auth_session")
        .map_err(|_| ApiError::unauthorized("not authenticated"))?;
    let session: ZeroAuthSession =
        serde_json::from_slice(&session_bytes).map_err(|e| ApiError::internal(format!("deserializing auth session: {e}")))?;
    Ok(session.user_id)
}

pub(crate) fn agent_from_network(net: &NetworkAgent) -> Agent {
    let agent_id = net.id.parse::<AgentId>().unwrap_or_else(|_| AgentId::new());
    let profile_id: Option<ProfileId> = net.profile_id_typed();
    let created_at = net
        .created_at
        .as_deref()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(Utc::now);
    let updated_at = net
        .updated_at
        .as_deref()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(Utc::now);

    Agent {
        agent_id,
        user_id: net.user_id.clone(),
        name: net.name.clone(),
        role: net.role.clone().unwrap_or_default(),
        personality: net.personality.clone().unwrap_or_default(),
        system_prompt: net.system_prompt.clone().unwrap_or_default(),
        skills: net.skills.clone().unwrap_or_default(),
        icon: net.icon.clone(),
        machine_type: net.machine_type.clone().unwrap_or_else(|| "local".to_string()),
        network_agent_id: net.id.parse().ok(),
        profile_id,
        created_at,
        updated_at,
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

struct DecodedContent {
    text: String,
    content_blocks: Option<Vec<ChatContentBlock>>,
    thinking: Option<String>,
    thinking_duration_ms: Option<u64>,
}

/// Decode a stored message content string into structured parts.
///
/// The content may be a JSON object with `text`, `content_blocks`, `thinking`,
/// and `thinking_duration_ms` fields, or plain text.
fn decode_message_content(raw: &str) -> DecodedContent {
    if let Ok(obj) = serde_json::from_str::<serde_json::Value>(raw) {
        if let Some(map) = obj.as_object() {
            let text = map
                .get("text")
                .and_then(|v| v.as_str())
                .unwrap_or(raw)
                .to_string();
            let content_blocks: Option<Vec<ChatContentBlock>> = map
                .get("content_blocks")
                .and_then(|v| serde_json::from_value(v.clone()).ok());
            let thinking = map
                .get("thinking")
                .and_then(|v| v.as_str())
                .map(String::from);
            let thinking_duration_ms = map
                .get("thinking_duration_ms")
                .and_then(|v| v.as_u64());
            return DecodedContent {
                text,
                content_blocks,
                thinking,
                thinking_duration_ms,
            };
        }
    }
    DecodedContent {
        text: raw.to_string(),
        content_blocks: None,
        thinking: None,
        thinking_duration_ms: None,
    }
}

pub(crate) fn storage_message_to_message(sm: &StorageMessage) -> Message {
    let message_id = sm
        .id
        .parse::<MessageId>()
        .unwrap_or_else(|_| MessageId::new());
    let agent_instance_id = sm
        .project_agent_id
        .as_deref()
        .and_then(|s| s.parse::<AgentInstanceId>().ok())
        .unwrap_or_else(AgentInstanceId::nil);
    let project_id = sm
        .project_id
        .as_deref()
        .and_then(|s| s.parse::<ProjectId>().ok())
        .unwrap_or_else(ProjectId::nil);
    let role = match sm.role.as_deref() {
        Some("user") => ChatRole::User,
        Some("assistant") => ChatRole::Assistant,
        _ => ChatRole::User,
    };

    let raw_content = sm.content.as_deref().unwrap_or_default();
    let decoded = decode_message_content(raw_content);

    Message {
        message_id,
        agent_instance_id,
        project_id,
        role,
        content: decoded.text,
        content_blocks: decoded.content_blocks,
        thinking: decoded.thinking,
        thinking_duration_ms: decoded.thinking_duration_ms,
        created_at: parse_dt(&sm.created_at),
    }
}
