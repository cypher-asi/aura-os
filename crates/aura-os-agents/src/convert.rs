//! Conversion helpers between aura-network/aura-storage shapes and the
//! local `aura_os_core` `Agent` type.
//!
//! These helpers are intentionally `pub(crate)` — they are wiring used
//! by both [`crate::service::AgentService`] and
//! [`crate::AgentInstanceService`] when materialising an `Agent` from
//! upstream payloads. Only [`parse_agent_status`] is part of the
//! public API because the server's instance handlers also use it to
//! map externally-supplied status strings.

use aura_os_core::{
    parse_dt, Agent, AgentId, AgentPermissions, AgentRuntimeConfig, AgentStatus, OrgId, ProfileId,
};
use aura_os_network::NetworkAgent;

/// Convert `NetworkAgent` to core `Agent` (no local store side-effects).
///
/// Includes a read-time safety net for legacy records whose
/// `permissions` column was never persisted: if this agent is the CEO
/// by name+role but the bundle isn't the canonical preset, promote it
/// in-memory so the harness tool manifest / sidekick toggles behave
/// correctly until `ensure_canonical_ceo_permissions_persisted`
/// patches the network record on the next bootstrap.
pub(crate) fn network_agent_to_core(net: &NetworkAgent) -> Agent {
    let agent_id = net.id.parse::<AgentId>().unwrap_or_else(|_| AgentId::new());
    let profile_id: Option<ProfileId> = net.profile_id.as_ref().and_then(|s| s.parse().ok());
    let org_id: Option<OrgId> = net.org_id.as_ref().and_then(|s| s.parse().ok());
    let created_at = parse_dt(&net.created_at);
    let updated_at = parse_dt(&net.updated_at);
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
        tags: Vec::new(),
        is_pinned: false,
        listing_status: Default::default(),
        expertise: Vec::new(),
        jobs: 0,
        revenue_usd: 0.0,
        reputation: 0.0,
        local_workspace_path: None,
        permissions: net
            .permissions
            .clone()
            .normalized_for_identity(&net.name, net.role.as_deref()),
        intent_classifier: net.intent_classifier.clone(),
        created_at,
        updated_at,
    }
}

/// Map a serialized status string to [`AgentStatus`].
///
/// Unknown values fall back to [`AgentStatus::Idle`] so a stale
/// upstream value never breaks an instance lookup.
pub fn parse_agent_status(s: &str) -> AgentStatus {
    match s {
        "idle" => AgentStatus::Idle,
        "working" => AgentStatus::Working,
        "blocked" => AgentStatus::Blocked,
        "stopped" => AgentStatus::Stopped,
        "error" => AgentStatus::Error,
        "archived" => AgentStatus::Archived,
        _ => AgentStatus::Idle,
    }
}

/// Synthesize a minimal `Agent` from an `aura-storage` project-agent
/// row plus a locally-stored runtime config.
///
/// Used as a last-resort fallback when aura-network is unavailable and
/// the local shadow has been evicted: the project record carries
/// enough fields (name, role, system prompt, skills) to keep chat
/// flowing, and the runtime config supplies adapter/environment/model
/// metadata that never round-trips through the storage row.
pub(crate) fn synthesize_agent_from_project_agent(
    spa: &aura_os_storage::StorageProjectAgent,
    config: &AgentRuntimeConfig,
) -> Option<Agent> {
    let agent_id = spa.agent_id.as_deref()?.parse::<AgentId>().ok()?;
    let auth_source = aura_os_core::effective_auth_source(
        &config.adapter_type,
        Some(config.auth_source.as_str()),
        config.integration_id.as_deref(),
    );
    let machine_type = if config.environment == "swarm_microvm" {
        "remote".to_string()
    } else {
        "local".to_string()
    };

    Some(Agent {
        agent_id,
        user_id: String::new(),
        org_id: spa.org_id.as_deref().and_then(|value| value.parse().ok()),
        name: spa.name.clone().unwrap_or_default(),
        role: spa.role.clone().unwrap_or_default(),
        personality: spa.personality.clone().unwrap_or_default(),
        system_prompt: spa.system_prompt.clone().unwrap_or_default(),
        skills: spa.skills.clone().unwrap_or_default(),
        icon: spa.icon.clone(),
        machine_type,
        adapter_type: config.adapter_type.clone(),
        environment: config.environment.clone(),
        auth_source,
        integration_id: config.integration_id.clone(),
        default_model: config.default_model.clone(),
        vm_id: None,
        network_agent_id: None,
        profile_id: None,
        tags: Vec::new(),
        is_pinned: false,
        listing_status: Default::default(),
        expertise: Vec::new(),
        jobs: 0,
        revenue_usd: 0.0,
        reputation: 0.0,
        local_workspace_path: None,
        permissions: AgentPermissions::empty(),
        intent_classifier: None,
        created_at: parse_dt(&spa.created_at),
        updated_at: parse_dt(&spa.updated_at),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_os_core::{AgentInstanceId, ProjectId};
    use aura_os_storage::StorageProjectAgent;

    #[test]
    fn synthesize_agent_from_project_agent_preserves_remote_runtime() {
        let agent_id = AgentId::new();
        let org_id = OrgId::new();
        let spa = StorageProjectAgent {
            id: AgentInstanceId::new().to_string(),
            project_id: Some(ProjectId::new().to_string()),
            org_id: Some(org_id.to_string()),
            agent_id: Some(agent_id.to_string()),
            name: Some("Atlas".to_string()),
            role: Some("Engineer".to_string()),
            personality: Some(String::new()),
            system_prompt: Some("Help with the project.".to_string()),
            skills: Some(vec!["search".to_string()]),
            icon: None,
            harness: None,
            status: Some("idle".to_string()),
            model: None,
            total_input_tokens: None,
            total_output_tokens: None,
            instance_role: None,
            permissions: None,
            intent_classifier: None,
            created_at: None,
            updated_at: None,
        };
        let runtime = AgentRuntimeConfig {
            adapter_type: "aura_harness".to_string(),
            environment: "swarm_microvm".to_string(),
            auth_source: "aura_managed".to_string(),
            integration_id: None,
            default_model: Some("claude-sonnet".to_string()),
        };

        let agent = synthesize_agent_from_project_agent(&spa, &runtime)
            .expect("runtime fallback should synthesize an agent");

        assert_eq!(agent.agent_id, agent_id);
        assert_eq!(agent.org_id, Some(org_id));
        assert_eq!(agent.name, "Atlas");
        assert_eq!(agent.machine_type, "remote");
        assert_eq!(agent.environment, "swarm_microvm");
        assert_eq!(agent.auth_source, "aura_managed");
        assert_eq!(agent.default_model.as_deref(), Some("claude-sonnet"));
    }

    fn minimal_network_agent(name: &str, role: Option<&str>) -> NetworkAgent {
        NetworkAgent {
            id: AgentId::new().to_string(),
            name: name.to_string(),
            role: role.map(str::to_string),
            personality: None,
            system_prompt: None,
            skills: None,
            icon: None,
            harness: None,
            machine_type: None,
            vm_id: None,
            user_id: "u1".to_string(),
            org_id: Some(OrgId::new().to_string()),
            profile_id: None,
            tags: None,
            listing_status: None,
            expertise: None,
            jobs: None,
            revenue_usd: None,
            reputation: None,
            permissions: AgentPermissions::empty(),
            intent_classifier: None,
            created_at: None,
            updated_at: None,
        }
    }

    #[test]
    fn network_agent_to_core_repairs_empty_ceo_permissions() {
        // Regression for the CEO-has-no-tools bug: this converter is
        // hit by the project-agent-instance chat path. When the
        // network record has empty permissions but the agent is
        // clearly the CEO (name + role both "CEO"), we must return
        // the canonical preset so `build_cross_agent_tools` takes the
        // CEO branch and emits the full manifest.
        let net = minimal_network_agent("CEO", Some("CEO"));
        let agent = network_agent_to_core(&net);
        assert!(
            agent.permissions.is_ceo_preset(),
            "CEO with empty network permissions must be promoted to the preset on read"
        );
    }

    #[test]
    fn network_agent_to_core_leaves_non_ceo_empty_permissions_alone() {
        // The safety net is intentionally narrow: a non-CEO agent with
        // empty permissions stays empty. Prevents other agents from
        // silently picking up the CEO capability bundle.
        let net = minimal_network_agent("Atlas", Some("Engineer"));
        let agent = network_agent_to_core(&net);
        assert!(!agent.permissions.is_ceo_preset());
        assert!(agent.permissions.capabilities.is_empty());
    }
}
