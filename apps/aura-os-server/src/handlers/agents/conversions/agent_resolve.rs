use std::collections::{HashMap, HashSet};

use aura_os_core::Agent;

use crate::state::AppState;

use super::agent::agent_from_network;

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
