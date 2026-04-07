use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};

use aura_os_core::parse_dt;
use aura_os_core::{
    Agent, AgentId, AgentInstanceId, ChatContentBlock, ChatRole, ProfileId, ProjectId,
    SessionEvent, SessionEventId, ZeroAuthSession,
};
use aura_os_network::NetworkAgent;
use aura_os_storage::StorageSessionEvent;

use crate::state::AppState;

pub(crate) fn get_user_id(session: &ZeroAuthSession) -> String {
    session.user_id.clone()
}

pub(crate) fn agent_from_network(net: &NetworkAgent) -> Agent {
    let agent_id = net.id.parse::<AgentId>().unwrap_or_else(|_| AgentId::new());
    let profile_id: Option<ProfileId> = net.profile_id_typed();
    let org_id: Option<aura_os_core::OrgId> = net.org_id.as_ref().and_then(|s| s.parse().ok());
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

    let is_super = net.role.as_deref() == Some("super_agent");

    let machine_type = net
        .machine_type
        .clone()
        .unwrap_or_else(|| "local".to_string());
    let environment = if machine_type == "remote" {
        "swarm_microvm".to_string()
    } else {
        "local_host".to_string()
    };

    Agent {
        agent_id,
        user_id: net.user_id.clone(),
        org_id,
        name: net.name.clone(),
        role: net.role.clone().unwrap_or_default(),
        personality: net.personality.clone().unwrap_or_default(),
        system_prompt: net.system_prompt.clone().unwrap_or_default(),
        skills: net.skills.clone().unwrap_or_default(),
        icon: net.icon.clone(),
        machine_type,
        adapter_type: "aura_harness".to_string(),
        environment,
        auth_source: "aura_managed".to_string(),
        integration_id: None,
        default_model: None,
        vm_id: net.vm_id.clone(),
        network_agent_id: net.id.parse().ok(),
        profile_id,
        tags: if is_super {
            vec!["super_agent".to_string()]
        } else {
            Vec::new()
        },
        is_pinned: is_super,
        created_at,
        updated_at,
    }
}

/// Compute a workspace path hint for an agent instance.
///
/// For **local** agents the server is the authority: prefer the stored absolute
/// `project_folder`; fall back to `{data_dir}/workspaces/{slug}`.
///
/// For **remote / swarm** agents the harness is the authoritative source (via
/// `AutomatonClient::resolve_workspace`). This function returns a best-guess
/// hint using the same slug convention so that API responses are consistent
/// even before the harness has been queried. Callers that need the true path
/// (dev loop, task runner) should call `resolve_workspace` on the client.
pub(crate) fn resolve_workspace_path(
    machine_type: &str,
    project_id: &ProjectId,
    data_dir: &std::path::Path,
    project_name: &str,
) -> String {
    if machine_type == "local" {
        super::super::projects_helpers::canonical_workspace_path(data_dir, project_id)
            .to_string_lossy()
            .to_string()
    } else {
        let slug = super::super::projects_helpers::slugify(project_name);
        format!("/home/aura/{slug}")
    }
}

/// Fetch all agents from the network, returning a map by network agent ID.
pub(crate) async fn resolve_network_agents(state: &AppState, jwt: &str) -> HashMap<String, Agent> {
    if let Some(ref client) = state.network_client {
        if let Ok(net_agents) = client.list_agents(jwt).await {
            return net_agents
                .iter()
                .map(|na| {
                    let mut agent = agent_from_network(na);
                    let _ = state.agent_service.apply_runtime_config(&mut agent);
                    if agent.icon.is_none() {
                        if let Ok(shadow) = state.agent_service.get_agent_local(&agent.agent_id) {
                            agent.icon = shadow.icon;
                        }
                    }
                    (na.id.clone(), agent)
                })
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
    let mut agent = agent_from_network(&net_agent);
    let _ = state.agent_service.apply_runtime_config(&mut agent);
    Some(agent)
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
                let content_blocks: Option<Vec<ChatContentBlock>> = content
                    .and_then(|c| c.get("content_blocks"))
                    .and_then(|v| serde_json::from_value(v.clone()).ok());
                messages.push(SessionEvent {
                    event_id: SessionEventId::new(),
                    agent_instance_id,
                    project_id: pid,
                    role: ChatRole::User,
                    content: text.to_string(),
                    content_blocks,
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
                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                    .map(sanitize_assistant_content_blocks)
                    .filter(|blocks| !blocks.is_empty());

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

fn sanitize_assistant_content_blocks(blocks: Vec<ChatContentBlock>) -> Vec<ChatContentBlock> {
    let mut suppressed_tool_use_ids = HashSet::new();
    let mut sanitized = Vec::with_capacity(blocks.len());

    for block in blocks {
        match block {
            ChatContentBlock::ToolUse { id, name, input }
                if is_incomplete_write_tool_use(&name, &input) =>
            {
                suppressed_tool_use_ids.insert(id);
            }
            ChatContentBlock::ToolResult { tool_use_id, .. }
                if suppressed_tool_use_ids.contains(&tool_use_id) =>
            {
                continue;
            }
            other => sanitized.push(other),
        }
    }

    sanitized
}

fn is_incomplete_write_tool_use(name: &str, input: &serde_json::Value) -> bool {
    if name != "write_file" {
        return false;
    }

    match input {
        serde_json::Value::Null => true,
        serde_json::Value::Object(map) => {
            !matches!(map.get("content"), Some(serde_json::Value::String(_)))
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::events_to_session_history;
    use aura_os_storage::StorageSessionEvent;

    #[test]
    fn events_to_session_history_skips_incomplete_write_only_turns() {
        let events = vec![StorageSessionEvent {
            id: "evt-1".to_string(),
            session_id: Some("session-1".to_string()),
            user_id: None,
            agent_id: None,
            sender: None,
            project_id: Some("project-1".to_string()),
            org_id: None,
            event_type: Some("assistant_message_end".to_string()),
            content: Some(serde_json::json!({
                "text": "",
                "thinking": null,
                "content_blocks": [
                    {
                        "type": "tool_use",
                        "id": "tool-1",
                        "name": "write_file",
                        "input": null,
                    },
                    {
                        "type": "tool_result",
                        "tool_use_id": "tool-1",
                        "content": "ok",
                        "is_error": false,
                    }
                ]
            })),
            created_at: Some("2026-01-01T00:00:00Z".to_string()),
        }];

        let history = events_to_session_history(&events, "agent-1", "project-1");

        assert!(history.is_empty());
    }
}
