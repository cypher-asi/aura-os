//! Three-source merge that produces the canonical [`AgentInstance`]
//! returned to API consumers.

use aura_os_core::{
    parse_dt, Agent, AgentInstance, AgentInstanceId, AgentInstanceRole, AgentStatus, ProjectId,
    RuntimeAgentState,
};

use crate::convert::parse_agent_status;

/// Merge three sources into a single `AgentInstance`:
/// - `spa`: execution state from aura-storage (status, model, tokens, timestamps)
/// - `agent`: config from aura-network (agent template; name, role, personality, etc.) when available;
///   otherwise falls back to storage project-agent fields.
/// - `runtime`: volatile in-memory state (current_task_id, current_session_id)
pub fn merge_agent_instance(
    spa: &aura_os_storage::StorageProjectAgent,
    agent: Option<&Agent>,
    runtime: Option<&RuntimeAgentState>,
) -> AgentInstance {
    AgentInstance {
        agent_instance_id: spa.id.parse().unwrap_or_else(|_| AgentInstanceId::new()),
        project_id: spa
            .project_id
            .as_deref()
            .unwrap_or("")
            .parse()
            .unwrap_or_else(|_| ProjectId::new()),
        agent_id: agent
            .map(|a| a.agent_id)
            .or_else(|| spa.agent_id.as_deref().and_then(|s: &str| s.parse().ok()))
            .unwrap_or_default(),
        org_id: agent.and_then(|a| a.org_id),
        name: agent
            .map(|a| a.name.clone())
            .unwrap_or_else(|| spa.name.clone().unwrap_or_default()),
        role: agent
            .map(|a| a.role.clone())
            .unwrap_or_else(|| spa.role.clone().unwrap_or_default()),
        personality: agent
            .map(|a| a.personality.clone())
            .unwrap_or_else(|| spa.personality.clone().unwrap_or_default()),
        system_prompt: agent
            .map(|a| a.system_prompt.clone())
            .unwrap_or_else(|| spa.system_prompt.clone().unwrap_or_default()),
        skills: agent
            .map(|a| a.skills.clone())
            .unwrap_or_else(|| spa.skills.clone().unwrap_or_default()),
        icon: agent
            .and_then(|a| a.icon.clone())
            .or_else(|| spa.icon.clone()),
        machine_type: agent
            .map(|a| a.machine_type.clone())
            .unwrap_or_else(|| "local".to_string()),
        adapter_type: agent
            .map(|a| a.adapter_type.clone())
            .unwrap_or_else(|| "aura_harness".to_string()),
        environment: agent
            .map(|a| a.environment.clone())
            .unwrap_or_else(|| "local_host".to_string()),
        auth_source: agent
            .map(|a| {
                aura_os_core::effective_auth_source(
                    &a.adapter_type,
                    Some(a.auth_source.as_str()),
                    a.integration_id.as_deref(),
                )
            })
            .unwrap_or_else(|| "aura_managed".to_string()),
        integration_id: agent.and_then(|a| a.integration_id.clone()),
        default_model: agent.and_then(|a| a.default_model.clone()),
        workspace_path: None,
        status: spa
            .status
            .as_deref()
            .map(parse_agent_status)
            .unwrap_or(AgentStatus::Idle),
        current_task_id: runtime.and_then(|r| r.current_task_id),
        current_session_id: runtime.and_then(|r| r.current_session_id),
        instance_role: spa
            .instance_role
            .as_deref()
            .map(AgentInstanceRole::from_wire_str)
            .unwrap_or_default(),
        total_input_tokens: spa.total_input_tokens.unwrap_or(0),
        total_output_tokens: spa.total_output_tokens.unwrap_or(0),
        model: spa.model.clone(),
        // Prefer the live parent Agent's permissions when available so
        // template edits propagate to fresh sessions. Fall back to the
        // snapshot persisted on the storage record so offline / 404
        // paths don't silently drop to an empty bundle.
        permissions: agent
            .map(|a| a.permissions.clone())
            .or_else(|| spa.permissions.clone())
            .unwrap_or_default(),
        intent_classifier: agent
            .and_then(|a| a.intent_classifier.clone())
            .or_else(|| spa.intent_classifier.clone()),
        created_at: parse_dt(&spa.created_at),
        updated_at: parse_dt(&spa.updated_at),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_os_core::AgentId;

    fn make_storage_project_agent(role: Option<&str>) -> aura_os_storage::StorageProjectAgent {
        aura_os_storage::StorageProjectAgent {
            id: AgentInstanceId::new().to_string(),
            project_id: Some(ProjectId::new().to_string()),
            org_id: None,
            agent_id: Some(AgentId::new().to_string()),
            name: Some("Atlas".to_string()),
            role: Some("Engineer".to_string()),
            personality: None,
            system_prompt: None,
            skills: None,
            icon: None,
            harness: None,
            status: Some("idle".to_string()),
            model: None,
            total_input_tokens: None,
            total_output_tokens: None,
            instance_role: role.map(str::to_string),
            permissions: None,
            intent_classifier: None,
            created_at: None,
            updated_at: None,
        }
    }

    #[test]
    fn merge_agent_instance_propagates_known_instance_role() {
        for (wire, expected) in [
            ("chat", AgentInstanceRole::Chat),
            ("loop", AgentInstanceRole::Loop),
            ("executor", AgentInstanceRole::Executor),
        ] {
            let spa = make_storage_project_agent(Some(wire));
            let merged = merge_agent_instance(&spa, None, None);
            assert_eq!(merged.instance_role, expected);
        }
    }

    #[test]
    fn merge_agent_instance_defaults_legacy_rows_to_chat() {
        let spa = make_storage_project_agent(None);
        let merged = merge_agent_instance(&spa, None, None);
        assert_eq!(merged.instance_role, AgentInstanceRole::Chat);
    }

    #[test]
    fn merge_agent_instance_treats_unknown_role_as_chat() {
        let spa = make_storage_project_agent(Some("supervisor"));
        let merged = merge_agent_instance(&spa, None, None);
        assert_eq!(merged.instance_role, AgentInstanceRole::Chat);
    }
}
