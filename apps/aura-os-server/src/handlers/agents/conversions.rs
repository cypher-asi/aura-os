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
    use aura_os_core::{AgentPermissions, ChatContentBlock};
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
}
