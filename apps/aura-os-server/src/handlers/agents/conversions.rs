use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};
use tracing::warn;

use aura_os_core::expertise;
use aura_os_core::listing_status::AgentListingStatus;
use aura_os_core::parse_dt;
use aura_os_core::{
    Agent, AgentId, AgentInstanceId, AgentPermissions, ChatContentBlock, ChatRole, ProfileId,
    ProjectId, SessionEvent, SessionEventId, ZeroAuthSession,
};
use aura_os_network::NetworkAgent;
use aura_os_storage::StorageSessionEvent;
use aura_protocol::IntentClassifierSpec;

use crate::state::AppState;

pub(crate) fn get_user_id(session: &ZeroAuthSession) -> String {
    session.user_id.clone()
}

/// Safety-net repair for CEO agents whose stored permissions bundle is
/// empty (or otherwise doesn't match the canonical CEO preset).
///
/// Older aura-network deployments didn't persist the `permissions` column
/// for agents, so `NetworkAgent.permissions` deserializes to the default
/// (empty) [`AgentPermissions`] via `#[serde(default)]`. When the rest of
/// the server reads that record, callers like [`build_cross_agent_tools`]
/// (aura-os-agent-runtime) and the Permissions sidekick toggles key off
/// [`AgentPermissions::is_ceo_preset`] — so a CEO with an empty bundle
/// ends up with zero cross-agent tools installed and every capability
/// toggle rendered as "off", even though the agent is clearly the CEO.
///
/// The canonical "this is a CEO" signal is
/// [`AgentPermissions::is_ceo_preset`] on the stored bundle. When that
/// returns `false` but the agent's name and role both spell `CEO`, we
/// treat the stored bundle as corrupted-on-read and return the preset +
/// canonical intent classifier instead.
///
/// Permission normalisation is delegated to
/// [`AgentPermissions::normalized_for_identity`] so this handler and the
/// other read-time converter in `aura-os-agents::network_agent_to_core`
/// can't drift apart — both now route through the same `aura-os-core`
/// helper. The classifier fix-up stays here because it pulls the
/// canonical spec from `aura-os-agent-runtime`, which sits above
/// `aura-os-agents` in the crate graph.
///
/// [`build_cross_agent_tools`]: aura_os_agent_runtime::ceo::build_cross_agent_tools
fn effective_permissions_and_classifier(
    net: &NetworkAgent,
) -> (AgentPermissions, Option<IntentClassifierSpec>) {
    let permissions = net
        .permissions
        .clone()
        .normalized_for_identity(&net.name, net.role.as_deref());
    let permissions_were_repaired = permissions != net.permissions;
    if permissions_were_repaired {
        warn!(
            agent_id = %net.id,
            "CEO agent has non-preset permissions in network record; applying read-time preset"
        );
        // CEO agents no longer ship an IntentClassifierSpec — the CEO
        // cross-agent tool list is a static allowlist (see
        // `aura_os_agent_runtime::ceo::CEO_CORE_TOOLS`). Preserve whatever
        // the network record carries (typically `None`) so legacy
        // deployments that still have a stored classifier don't have it
        // retroactively clobbered by the read-time repair path.
        return (permissions, net.intent_classifier.clone());
    }
    (permissions, net.intent_classifier.clone())
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

    let machine_type = net
        .machine_type
        .clone()
        .unwrap_or_else(|| "local".to_string());
    let environment = if machine_type == "remote" {
        "swarm_microvm".to_string()
    } else {
        "local_host".to_string()
    };

    let tags: Vec<String> = net.tags.clone().unwrap_or_default();

    // Marketplace listing_status: prefer the typed field; fall back to the
    // legacy `listing_status:<value>` tag so agents written before Phase 3
    // still render correctly. Unknown values default to Closed.
    let listing_status = net
        .listing_status
        .as_deref()
        .and_then(|raw| AgentListingStatus::from_str(raw).ok())
        .or_else(|| listing_status_from_tags(&tags))
        .unwrap_or_default();

    // Marketplace expertise: prefer the typed field; fall back to the
    // `expertise:<slug>` tag encoding. Unknown slugs are filtered out so
    // stale client data cannot introduce invalid slugs on read.
    let expertise: Vec<String> = match net.expertise.as_ref() {
        Some(slugs) => slugs
            .iter()
            .filter(|slug| expertise::is_valid_slug(slug))
            .cloned()
            .collect(),
        None => expertise_from_tags(&tags),
    };

    let (permissions, intent_classifier) = effective_permissions_and_classifier(net);

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
        tags,
        is_pinned: false,
        listing_status,
        expertise,
        jobs: net.jobs.unwrap_or(0),
        revenue_usd: net.revenue_usd.unwrap_or(0.0),
        reputation: net.reputation.unwrap_or(0.0),
        // Network-derived agents never carry a local override; populated later
        // from the local shadow if present.
        local_workspace_path: None,
        permissions,
        intent_classifier,
        created_at,
        updated_at,
    }
}

/// Parse `listing_status:<value>` from a tag list. Retained only as a
/// backward-compatibility fallback for agents that predate Phase 3.
fn listing_status_from_tags(tags: &[String]) -> Option<AgentListingStatus> {
    for tag in tags {
        if let Some(raw) = tag.strip_prefix(aura_os_core::listing_status::LISTING_STATUS_TAG_PREFIX)
        {
            if let Ok(parsed) = AgentListingStatus::from_str(raw) {
                return Some(parsed);
            }
        }
    }
    None
}

/// Parse `expertise:<slug>` entries from a tag list, filtering out any
/// unknown slugs so the server never forwards invalid data to clients.
fn expertise_from_tags(tags: &[String]) -> Vec<String> {
    tags.iter()
        .filter_map(|tag| tag.strip_prefix(expertise::EXPERTISE_TAG_PREFIX))
        .filter(|slug| expertise::is_valid_slug(slug))
        .map(|slug| slug.to_string())
        .collect()
}

/// Compute a workspace path hint for an agent instance.
///
/// For **local** agents the server is the authority. Resolution order:
///   1. `agent_local_path` — per-agent override from the agent template shadow.
///   2. `project_local_path` — per-project override from the project shadow.
///   3. `{data_dir}/workspaces/{project_id}` — canonical default.
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
    project_local_path: Option<&str>,
    agent_local_path: Option<&str>,
) -> String {
    fn non_empty(value: Option<&str>) -> Option<&str> {
        value.map(str::trim).filter(|s| !s.is_empty())
    }

    if machine_type == "local" {
        if let Some(path) = non_empty(agent_local_path) {
            return path.to_string();
        }
        if let Some(path) = non_empty(project_local_path) {
            return path.to_string();
        }
        super::super::projects_helpers::canonical_workspace_path(data_dir, project_id)
            .to_string_lossy()
            .to_string()
    } else {
        let slug = super::super::projects_helpers::slugify(project_name);
        format!("/home/aura/{slug}")
    }
}

/// Resolve agent templates referenced by project agent rows only.
///
/// Semantics match merging a full network+local map then taking a subset: network rows win over
/// local shadows, and only IDs present in `needed_ids` are populated (avoids hashing every local
/// agent and skips `agent_from_network` work for unrelated network rows).
pub(crate) async fn resolve_merge_agents_for_ids(
    state: &AppState,
    jwt: &str,
    needed_ids: &HashSet<String>,
) -> HashMap<String, Agent> {
    if needed_ids.is_empty() {
        return HashMap::new();
    }

    let mut resolved = HashMap::with_capacity(needed_ids.len());

    if let Ok(local_agents) = state.agent_service.list_agents() {
        for agent in local_agents {
            let id = agent.agent_id.to_string();
            if needed_ids.contains(&id) {
                resolved.entry(id).or_insert(agent);
            }
        }
    }

    let Some(ref client) = state.network_client else {
        return resolved;
    };

    let Ok(net_agents) = client.list_agents(jwt).await else {
        return resolved;
    };

    for na in net_agents {
        if !needed_ids.contains(&na.id) {
            continue;
        }
        let mut agent = agent_from_network(&na);
        let _ = state.agent_service.apply_runtime_config(&mut agent);
        if agent.icon.is_none() {
            if let Ok(shadow) = state.agent_service.get_agent_local(&agent.agent_id) {
                agent.icon = shadow.icon;
            }
        }
        resolved.insert(na.id.clone(), agent);
    }

    resolved
}

/// Fetch a single agent config, preferring network and falling back to local shadows.
pub(crate) async fn resolve_single_agent(
    state: &AppState,
    jwt: &str,
    agent_id: &str,
) -> Option<Agent> {
    if let Some(client) = state.network_client.as_ref() {
        if let Ok(net_agent) = client.get_agent(agent_id, jwt).await {
            let mut agent = agent_from_network(&net_agent);
            let _ = state.agent_service.apply_runtime_config(&mut agent);
            return Some(agent);
        }
    }

    let parsed = agent_id.parse().ok()?;
    state.agent_service.get_agent_local(&parsed).ok()
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
                // Deserialize per-block so a single malformed or unknown block
                // variant (e.g. an image block written by a future client, or
                // a legacy shape) does not silently nuke the entire user
                // message. A strict `Vec<ChatContentBlock>` deserialize would
                // return `None` on any mismatch, which — combined with the
                // empty-content check on the display side — causes image-only
                // or attachment-only user turns to disappear on reopen.
                let content_blocks: Option<Vec<ChatContentBlock>> = content
                    .and_then(|c| c.get("content_blocks"))
                    .and_then(|v| v.as_array().cloned())
                    .map(|raw_blocks| deserialize_content_blocks(&event.id, raw_blocks))
                    .filter(|blocks| !blocks.is_empty());
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
                    in_flight: None,
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

                // Deserialize per-block so a single malformed or newly-introduced
                // block variant does not nuke the entire turn. Previously a strict
                // `serde_json::from_value::<Vec<ChatContentBlock>>(..).ok()` would
                // silently return `None` on any mismatch and, combined with the
                // empty-content check below, drop the whole assistant turn — which
                // is exactly how tool-heavy turns were disappearing on reopen.
                let content_blocks: Option<Vec<ChatContentBlock>> = content
                    .and_then(|c| c.get("content_blocks"))
                    .and_then(|v| v.as_array().cloned())
                    .map(|raw_blocks| deserialize_content_blocks(&event.id, raw_blocks))
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
                    in_flight: None,
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
                    in_flight: None,
                });
            }
            _ => {}
        }
    }

    if let Some(partial) = reconstruct_in_flight_assistant_turn(&sorted, agent_instance_id, pid) {
        messages.push(partial);
    }

    messages
}

/// Walk the persisted incremental events for the latest assistant turn that
/// has been started but not yet terminated by `assistant_message_end`, and
/// rebuild a snapshot `SessionEvent` from the deltas. Returns `None` when
/// every started turn has a matching end row, when no `assistant_message_start`
/// has been persisted yet, or when the trailing turn has produced no
/// observable text / thinking / tool blocks at all.
///
/// The reconstruction mirrors `spawn_chat_persist_task` (in `chat.rs`) so the
/// snapshot matches what would have been written out as
/// `assistant_message_end` had the stream completed at this instant. This is
/// what powers mid-turn refresh recovery: the UI gets back the partial text,
/// thinking, and tool cards (including `pending-*` spec/task placeholders) it
/// would have seen had it not lost its in-memory state.
fn reconstruct_in_flight_assistant_turn(
    sorted: &[StorageSessionEvent],
    agent_instance_id: AgentInstanceId,
    project_id: ProjectId,
) -> Option<SessionEvent> {
    fn message_id_of(event: &StorageSessionEvent) -> Option<&str> {
        event
            .content
            .as_ref()
            .and_then(|c| c.get("message_id"))
            .and_then(|v| v.as_str())
    }

    let mut latest_start_idx: Option<usize> = None;
    let mut latest_message_id: Option<String> = None;

    for (idx, event) in sorted.iter().enumerate() {
        let event_type = event.event_type.as_deref().unwrap_or("");
        if event_type == "assistant_message_start" {
            if let Some(mid) = message_id_of(event) {
                latest_start_idx = Some(idx);
                latest_message_id = Some(mid.to_string());
            }
        }
    }

    let start_idx = latest_start_idx?;
    let target_message_id = latest_message_id?;

    let already_ended = sorted.iter().skip(start_idx + 1).any(|event| {
        event.event_type.as_deref() == Some("assistant_message_end")
            && message_id_of(event) == Some(target_message_id.as_str())
    });
    if already_ended {
        return None;
    }

    let start_event = &sorted[start_idx];

    let mut full_text = String::new();
    let mut text_segment = String::new();
    let mut thinking_buf = String::new();
    let mut content_blocks: Vec<ChatContentBlock> = Vec::new();
    let mut last_tool_use_id = String::new();

    for event in sorted.iter().skip(start_idx + 1) {
        if message_id_of(event) != Some(target_message_id.as_str()) {
            continue;
        }
        let event_type = event.event_type.as_deref().unwrap_or("");
        let content = event.content.as_ref();
        match event_type {
            "text_delta" => {
                if let Some(text) = content.and_then(|c| c.get("text")).and_then(|v| v.as_str()) {
                    full_text.push_str(text);
                    text_segment.push_str(text);
                }
            }
            "thinking_delta" => {
                if let Some(text) = content
                    .and_then(|c| c.get("thinking"))
                    .and_then(|v| v.as_str())
                {
                    thinking_buf.push_str(text);
                }
            }
            "tool_use_start" => {
                if !text_segment.is_empty() {
                    content_blocks.push(ChatContentBlock::Text {
                        text: std::mem::take(&mut text_segment),
                    });
                }
                let id = content
                    .and_then(|c| c.get("id"))
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                let name = content
                    .and_then(|c| c.get("name"))
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                if id.is_empty() && name.is_empty() {
                    continue;
                }
                last_tool_use_id = id.clone();
                content_blocks.push(ChatContentBlock::ToolUse {
                    id,
                    name,
                    input: serde_json::Value::Null,
                });
            }
            "tool_call_snapshot" => {
                let snap_id = content
                    .and_then(|c| c.get("id"))
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                let snap_input = content
                    .and_then(|c| c.get("input"))
                    .cloned()
                    .unwrap_or(serde_json::Value::Null);
                let snap_name = content
                    .and_then(|c| c.get("name"))
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                let mut patched = false;
                for block in content_blocks.iter_mut().rev() {
                    if let ChatContentBlock::ToolUse { id, input, .. } = block {
                        if *id == snap_id {
                            *input = snap_input.clone();
                            patched = true;
                            break;
                        }
                    }
                }
                if !patched && !snap_id.is_empty() {
                    content_blocks.push(ChatContentBlock::ToolUse {
                        id: snap_id,
                        name: snap_name,
                        input: snap_input,
                    });
                }
            }
            "tool_result" => {
                let tool_use_id = content
                    .and_then(|c| c.get("tool_use_id"))
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
                    .unwrap_or_else(|| last_tool_use_id.clone());
                let result_text = content
                    .and_then(|c| c.get("result"))
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                let is_error = content
                    .and_then(|c| c.get("is_error"))
                    .and_then(|v| v.as_bool());
                // Mirror chat.rs: any tool_use still carrying `Null` input
                // gets normalized to `{}` so replays don't fail validation.
                for block in content_blocks.iter_mut().rev() {
                    if let ChatContentBlock::ToolUse { id, input, .. } = block {
                        if *id == tool_use_id && matches!(input, serde_json::Value::Null) {
                            *input = serde_json::json!({});
                            break;
                        }
                    }
                }
                content_blocks.push(ChatContentBlock::ToolResult {
                    tool_use_id,
                    content: result_text,
                    is_error,
                });
            }
            _ => {}
        }
    }

    if !text_segment.is_empty() {
        content_blocks.push(ChatContentBlock::Text {
            text: std::mem::take(&mut text_segment),
        });
    }

    let blocks_opt = if content_blocks.is_empty() {
        None
    } else {
        Some(content_blocks)
    };
    let thinking_opt = if thinking_buf.is_empty() {
        None
    } else {
        Some(thinking_buf)
    };

    if full_text.is_empty() && blocks_opt.is_none() && thinking_opt.is_none() {
        return None;
    }

    Some(SessionEvent {
        event_id: SessionEventId::new(),
        agent_instance_id,
        project_id,
        role: ChatRole::Assistant,
        content: full_text,
        content_blocks: blocks_opt,
        thinking: thinking_opt,
        thinking_duration_ms: None,
        created_at: parse_dt(&start_event.created_at),
        in_flight: Some(true),
    })
}

/// Deserialize a stored `content_blocks` JSON array per-entry so that one
/// malformed or unknown variant does not discard the whole vector.
///
/// Anything that fails to deserialize into a known `ChatContentBlock` variant
/// is logged and skipped. This is strictly more forgiving than
/// `serde_json::from_value::<Vec<ChatContentBlock>>`, which is all-or-nothing.
fn deserialize_content_blocks(
    event_id: &str,
    raw_blocks: Vec<serde_json::Value>,
) -> Vec<ChatContentBlock> {
    let mut blocks = Vec::with_capacity(raw_blocks.len());
    for (idx, raw) in raw_blocks.into_iter().enumerate() {
        match serde_json::from_value::<ChatContentBlock>(raw.clone()) {
            Ok(block) => blocks.push(block),
            Err(error) => {
                let block_type = raw
                    .get("type")
                    .and_then(|t| t.as_str())
                    .unwrap_or("<unknown>");
                warn!(
                    %event_id,
                    block_index = idx,
                    block_type,
                    %error,
                    "skipping unparseable chat content block while reconstructing assistant turn"
                );
            }
        }
    }
    blocks
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
    use super::{agent_from_network, events_to_session_history};
    use aura_os_core::{AgentPermissions, ChatContentBlock, ChatRole};
    use aura_os_network::NetworkAgent;
    use aura_os_storage::StorageSessionEvent;

    fn blank_network_agent(name: &str, role: Option<&str>) -> NetworkAgent {
        NetworkAgent {
            id: "00000000-0000-0000-0000-000000000001".to_string(),
            name: name.to_string(),
            role: role.map(|s| s.to_string()),
            personality: None,
            system_prompt: None,
            skills: None,
            icon: None,
            harness: None,
            machine_type: None,
            vm_id: None,
            user_id: "user-1".to_string(),
            org_id: None,
            profile_id: None,
            tags: None,
            listing_status: None,
            expertise: None,
            jobs: None,
            revenue_usd: None,
            reputation: None,
            permissions: AgentPermissions::default(),
            intent_classifier: None,
            created_at: None,
            updated_at: None,
        }
    }

    #[test]
    fn agent_from_network_fills_ceo_preset_when_permissions_missing() {
        // Regression: older aura-network deployments didn't persist the
        // `permissions` column, so a CEO record round-tripped with an
        // empty bundle. The read-time safety net must restore the CEO
        // preset so `is_ceo_preset()`-gated callers behave correctly.
        let net = blank_network_agent("CEO", Some("CEO"));
        assert!(
            !net.permissions.is_ceo_preset(),
            "precondition: network record is not yet the preset"
        );

        let agent = agent_from_network(&net);

        assert!(
            agent.permissions.is_ceo_preset(),
            "empty CEO bundles are repaired to the canonical preset"
        );
        // CEO agents no longer ship an IntentClassifierSpec — the
        // read-time repair path preserves whatever the network record
        // carries (typically `None`) rather than synthesising the old
        // canonical classifier. See CEO_CORE_TOOLS for the rationale.
        assert!(
            agent.intent_classifier.is_none(),
            "read-time repair no longer fills a canonical classifier"
        );
    }

    #[test]
    fn agent_from_network_ceo_preset_matches_case_insensitively() {
        // Historical CEO records may have lowercase / mixed-case name or
        // role fields. The safety net mirrors the case-insensitive
        // matching in `looks_like_ceo`.
        let net = blank_network_agent("ceo", Some("ceo"));
        let agent = agent_from_network(&net);
        assert!(agent.permissions.is_ceo_preset());
    }

    #[test]
    fn agent_from_network_does_not_promote_non_ceo_agents() {
        // Users may legitimately create regular agents whose name or role
        // resembles "CEO" in isolation — only the (name="CEO" AND
        // role="CEO") pair triggers the safety net.
        let mut cases = Vec::new();
        cases.push(blank_network_agent("CEO", Some("Coach")));
        cases.push(blank_network_agent("Eve", Some("CEO")));
        cases.push(blank_network_agent("Regular", None));
        for net in cases {
            let agent = agent_from_network(&net);
            assert!(
                !agent.permissions.is_ceo_preset(),
                "non-CEO agents keep their empty permissions bundle"
            );
            assert!(
                agent.intent_classifier.is_none(),
                "non-CEO agents don't receive the canonical classifier"
            );
        }
    }

    #[test]
    fn agent_from_network_preserves_existing_ceo_preset() {
        // When aura-network *does* persist the preset, the safety net is
        // a no-op and must not churn the intent classifier either.
        let mut net = blank_network_agent("CEO", Some("CEO"));
        net.permissions = AgentPermissions::ceo_preset();

        let agent = agent_from_network(&net);

        assert!(agent.permissions.is_ceo_preset());
        assert!(
            agent.intent_classifier.is_none(),
            "preserved-preset path doesn't synthesize a classifier on its own"
        );
    }

    #[test]
    fn events_to_session_history_preserves_tool_only_assistant_turns() {
        // Regression: tool-only turns (no visible text) used to be dropped on
        // reopen, so the LLM saw user messages but no assistant context.
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
                        "name": "create_spec",
                        "input": { "title": "hello" },
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

        assert_eq!(history.len(), 1, "tool-only assistant turn must survive");
        let blocks = history[0]
            .content_blocks
            .as_ref()
            .expect("content_blocks preserved");
        assert_eq!(blocks.len(), 2, "both tool_use and tool_result kept");
        assert!(matches!(blocks[0], ChatContentBlock::ToolUse { .. }));
        assert!(matches!(blocks[1], ChatContentBlock::ToolResult { .. }));
    }

    #[test]
    fn events_to_session_history_tolerates_unknown_block_types() {
        // Regression: a single unknown/malformed block used to fail the whole
        // Vec<ChatContentBlock> deserialize and silently drop the turn.
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
                    { "type": "text", "text": "hello" },
                    { "type": "future_variant_we_dont_know_about", "foo": 1 },
                    {
                        "type": "tool_use",
                        "id": "tool-1",
                        "name": "create_spec",
                        "input": { "title": "hi" },
                    }
                ]
            })),
            created_at: Some("2026-01-01T00:00:00Z".to_string()),
        }];

        let history = events_to_session_history(&events, "agent-1", "project-1");
        assert_eq!(history.len(), 1);
        let blocks = history[0].content_blocks.as_ref().unwrap();
        assert_eq!(blocks.len(), 2, "known blocks survive, unknown is skipped");
    }

    #[test]
    fn events_to_session_history_preserves_user_image_only_turns() {
        // Regression: user messages with only image attachments (no text)
        // round-trip via JSON where a single malformed/unknown block would
        // previously clear the whole content_blocks vec. After clearing,
        // the display filter (empty content + empty blocks) would drop the
        // whole turn, and users would see "my conversation is missing
        // random messages" on reopen.
        let events = vec![StorageSessionEvent {
            id: "evt-1".to_string(),
            session_id: Some("session-1".to_string()),
            user_id: None,
            agent_id: None,
            sender: Some("user".to_string()),
            project_id: Some("project-1".to_string()),
            org_id: None,
            event_type: Some("user_message".to_string()),
            content: Some(serde_json::json!({
                "text": "",
                "content_blocks": [
                    {
                        "type": "image",
                        "media_type": "image/png",
                        "data": "aGVsbG8=",
                    },
                    { "type": "future_variant_we_dont_know_about", "foo": 1 },
                ]
            })),
            created_at: Some("2026-01-01T00:00:00Z".to_string()),
        }];

        let history = events_to_session_history(&events, "agent-1", "project-1");

        assert_eq!(history.len(), 1, "image-only user turn must survive");
        let blocks = history[0]
            .content_blocks
            .as_ref()
            .expect("content_blocks preserved");
        assert_eq!(
            blocks.len(),
            1,
            "known image block kept; unknown block skipped"
        );
        assert!(matches!(blocks[0], ChatContentBlock::Image { .. }));
    }

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

    fn raw_event(id: &str, ts: &str, event_type: &str, content: serde_json::Value) -> StorageSessionEvent {
        StorageSessionEvent {
            id: id.to_string(),
            session_id: Some("session-1".to_string()),
            user_id: None,
            agent_id: None,
            sender: None,
            project_id: Some("project-1".to_string()),
            org_id: None,
            event_type: Some(event_type.to_string()),
            content: Some(content),
            created_at: Some(ts.to_string()),
        }
    }

    #[test]
    fn events_to_session_history_reconstructs_partial_assistant_turn_text_only() {
        // Mid-turn refresh recovery: a turn that has streamed some `text_delta`
        // rows but not yet emitted `assistant_message_end` must surface as a
        // synthesized in-flight `SessionEvent` so the chat panel keeps
        // rendering the partial response after the page is reloaded.
        let events = vec![
            raw_event(
                "evt-user",
                "2026-01-01T00:00:00Z",
                "user_message",
                serde_json::json!({ "text": "hi" }),
            ),
            raw_event(
                "evt-start",
                "2026-01-01T00:00:01Z",
                "assistant_message_start",
                serde_json::json!({ "message_id": "m1", "seq": 1 }),
            ),
            raw_event(
                "evt-d1",
                "2026-01-01T00:00:02Z",
                "text_delta",
                serde_json::json!({ "message_id": "m1", "text": "Hello, " }),
            ),
            raw_event(
                "evt-d2",
                "2026-01-01T00:00:03Z",
                "text_delta",
                serde_json::json!({ "message_id": "m1", "text": "world" }),
            ),
        ];

        let history = events_to_session_history(&events, "agent-1", "project-1");

        assert_eq!(history.len(), 2, "user + reconstructed assistant in-flight");
        assert_eq!(history[0].role, ChatRole::User);
        let assistant = &history[1];
        assert_eq!(assistant.role, ChatRole::Assistant);
        assert_eq!(assistant.content, "Hello, world");
        assert_eq!(assistant.in_flight, Some(true));
        let blocks = assistant.content_blocks.as_ref().expect("text block flushed");
        assert_eq!(blocks.len(), 1);
        assert!(matches!(&blocks[0], ChatContentBlock::Text { text } if text == "Hello, world"));
    }

    #[test]
    fn events_to_session_history_reconstructs_partial_turn_with_tool_blocks() {
        // Tool calls fired during an in-flight turn must come back as
        // `tool_use` (+ optional `tool_result`) blocks so the UI can rebuild
        // its tool cards and `pending-*` spec/task placeholders on refresh.
        let events = vec![
            raw_event(
                "evt-start",
                "2026-01-01T00:00:01Z",
                "assistant_message_start",
                serde_json::json!({ "message_id": "m1", "seq": 1 }),
            ),
            raw_event(
                "evt-text",
                "2026-01-01T00:00:02Z",
                "text_delta",
                serde_json::json!({ "message_id": "m1", "text": "calling " }),
            ),
            raw_event(
                "evt-tool-start",
                "2026-01-01T00:00:03Z",
                "tool_use_start",
                serde_json::json!({ "message_id": "m1", "id": "tool-1", "name": "create_spec", "seq": 2 }),
            ),
            raw_event(
                "evt-snap",
                "2026-01-01T00:00:04Z",
                "tool_call_snapshot",
                serde_json::json!({
                    "message_id": "m1",
                    "id": "tool-1",
                    "name": "create_spec",
                    "input": { "title": "Hello" },
                }),
            ),
            raw_event(
                "evt-result",
                "2026-01-01T00:00:05Z",
                "tool_result",
                serde_json::json!({
                    "message_id": "m1",
                    "tool_use_id": "tool-1",
                    "name": "create_spec",
                    "result": "spec-123",
                    "is_error": false,
                }),
            ),
        ];

        let history = events_to_session_history(&events, "agent-1", "project-1");

        assert_eq!(history.len(), 1);
        let assistant = &history[0];
        assert_eq!(assistant.in_flight, Some(true));
        let blocks = assistant.content_blocks.as_ref().expect("blocks");
        assert_eq!(blocks.len(), 3, "text, tool_use, tool_result");
        assert!(matches!(&blocks[0], ChatContentBlock::Text { text } if text == "calling "));
        match &blocks[1] {
            ChatContentBlock::ToolUse { id, name, input } => {
                assert_eq!(id, "tool-1");
                assert_eq!(name, "create_spec");
                assert_eq!(input.get("title").and_then(|v| v.as_str()), Some("Hello"));
            }
            other => panic!("expected tool_use, got {:?}", other),
        }
        match &blocks[2] {
            ChatContentBlock::ToolResult { tool_use_id, content, is_error } => {
                assert_eq!(tool_use_id, "tool-1");
                assert_eq!(content, "spec-123");
                assert_eq!(*is_error, Some(false));
            }
            other => panic!("expected tool_result, got {:?}", other),
        }
    }

    #[test]
    fn events_to_session_history_skips_reconstruction_when_end_present() {
        // Once `assistant_message_end` has landed, the in-flight reconstruction
        // path must not double-render the turn — the existing terminal-row
        // branch already produced a complete `SessionEvent`.
        let events = vec![
            raw_event(
                "evt-start",
                "2026-01-01T00:00:01Z",
                "assistant_message_start",
                serde_json::json!({ "message_id": "m1", "seq": 1 }),
            ),
            raw_event(
                "evt-d1",
                "2026-01-01T00:00:02Z",
                "text_delta",
                serde_json::json!({ "message_id": "m1", "text": "hello" }),
            ),
            raw_event(
                "evt-end",
                "2026-01-01T00:00:03Z",
                "assistant_message_end",
                serde_json::json!({
                    "message_id": "m1",
                    "text": "hello",
                    "thinking": null,
                    "content_blocks": [{ "type": "text", "text": "hello" }],
                }),
            ),
        ];

        let history = events_to_session_history(&events, "agent-1", "project-1");

        assert_eq!(history.len(), 1, "only the terminal turn");
        assert_eq!(history[0].in_flight, None, "terminal turn is not in-flight");
    }

    #[test]
    fn events_to_session_history_reconstruction_captures_thinking() {
        let events = vec![
            raw_event(
                "evt-start",
                "2026-01-01T00:00:01Z",
                "assistant_message_start",
                serde_json::json!({ "message_id": "m1", "seq": 1 }),
            ),
            raw_event(
                "evt-think",
                "2026-01-01T00:00:02Z",
                "thinking_delta",
                serde_json::json!({ "message_id": "m1", "thinking": "Considering options..." }),
            ),
        ];

        let history = events_to_session_history(&events, "agent-1", "project-1");

        assert_eq!(history.len(), 1);
        let assistant = &history[0];
        assert_eq!(assistant.in_flight, Some(true));
        assert_eq!(
            assistant.thinking.as_deref(),
            Some("Considering options...")
        );
        assert!(assistant.content.is_empty(), "no text yet");
        assert!(assistant.content_blocks.is_none(), "no blocks yet");
    }

    #[test]
    fn events_to_session_history_reconstruction_only_uses_latest_message_id() {
        // Multiple turns in the same session: only the trailing in-flight one
        // (its `message_id` lacks an `assistant_message_end`) should be
        // reconstructed. Earlier completed turns are produced by the normal
        // `assistant_message_end` branch.
        let events = vec![
            raw_event(
                "evt-start-1",
                "2026-01-01T00:00:00Z",
                "assistant_message_start",
                serde_json::json!({ "message_id": "old", "seq": 1 }),
            ),
            raw_event(
                "evt-end-1",
                "2026-01-01T00:00:01Z",
                "assistant_message_end",
                serde_json::json!({
                    "message_id": "old",
                    "text": "first turn",
                    "thinking": null,
                    "content_blocks": [{ "type": "text", "text": "first turn" }],
                }),
            ),
            raw_event(
                "evt-start-2",
                "2026-01-01T00:00:02Z",
                "assistant_message_start",
                serde_json::json!({ "message_id": "new", "seq": 2 }),
            ),
            raw_event(
                "evt-d-2",
                "2026-01-01T00:00:03Z",
                "text_delta",
                serde_json::json!({ "message_id": "new", "text": "second " }),
            ),
        ];

        let history = events_to_session_history(&events, "agent-1", "project-1");

        assert_eq!(history.len(), 2);
        assert_eq!(history[0].in_flight, None, "completed turn unchanged");
        assert_eq!(history[0].content, "first turn");
        assert_eq!(history[1].in_flight, Some(true));
        assert_eq!(history[1].content, "second ");
    }
}
