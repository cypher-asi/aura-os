use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use tracing::warn;

use aura_os_core::{Agent, AgentId};
use aura_os_network::{NetworkAgent, NetworkClient};

use crate::capture_auth::{demo_agent, demo_agent_id, is_capture_access_token};
use crate::error::{map_network_error, ApiError, ApiResult};
use crate::handlers::agents::conversions::agent_from_network;
use crate::handlers::agents::instances::{repair_agent_name_in_place, repair_agent_name_only};
use crate::state::{AppState, AuthJwt};

#[derive(Debug, Default, Deserialize)]
pub(crate) struct ListAgentsQuery {
    /// When set, return the fleet for this organization (every member's
    /// agents, not just the caller's). Mirrors aura-network's
    /// `/api/agents?org_id=...` contract — the aura-network handler
    /// verifies membership before dropping the user_id filter, so
    /// passing an arbitrary org id safely 403s instead of leaking.
    pub org_id: Option<String>,
}

pub(crate) async fn list_agents(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Query(query): Query<ListAgentsQuery>,
) -> ApiResult<Json<Vec<Agent>>> {
    if is_capture_access_token(&jwt) {
        return Ok(Json(vec![demo_agent()]));
    }

    if let Some(ref client) = state.network_client {
        let net_agents = fetch_list_for_caller(client, &jwt, query.org_id.as_deref()).await?;
        let agents = project_listed_agents(&state, &net_agents);
        spawn_shadow_flush(&state, &agents);
        return Ok(Json(agents));
    }

    let mut agents = state
        .agent_service
        .list_agents()
        .map_err(|e| ApiError::internal(format!("listing agents: {e}")))?;
    for agent in agents.iter_mut() {
        repair_agent_name_in_place(&state.agent_service, agent);
    }
    Ok(Json(agents))
}

/// Fetch the network-side agent list for the caller. When `org_id` is
/// provided we issue the org-scoped and user-scoped calls concurrently and
/// merge by `agent_id` so legacy NULL-org rows still surface in the sidebar.
/// The org-scoped entry wins on conflict to keep fleet-membership metadata
/// (e.g. teammate user_ids) intact.
async fn fetch_list_for_caller(
    client: &NetworkClient,
    jwt: &str,
    org_id: Option<&str>,
) -> ApiResult<Vec<NetworkAgent>> {
    let scoped_org = org_id
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned);
    let Some(org_id) = scoped_org else {
        return client.list_agents(jwt).await.map_err(map_network_error);
    };

    let org_scoped = client.list_agents_by_org(&org_id, jwt);
    let user_scoped = client.list_agents(jwt);
    let (org_agents, user_agents) = tokio::join!(org_scoped, user_scoped);
    let org_agents = org_agents.map_err(map_network_error)?;
    // The user-scoped call is a best-effort backstop for legacy NULL-org
    // agents; if it fails (e.g. transient aura-network blip), fall back to
    // the org view alone rather than failing the whole sidebar refresh.
    let user_agents = match user_agents {
        Ok(list) => list,
        Err(err) => {
            warn!(
                error = %err,
                "list_agents: user-scoped backstop failed; returning org-scoped result only"
            );
            Vec::new()
        }
    };

    let mut merged: Vec<NetworkAgent> = Vec::with_capacity(org_agents.len() + user_agents.len());
    let mut seen = std::collections::HashSet::with_capacity(org_agents.len() + user_agents.len());
    for na in org_agents.into_iter().chain(user_agents.into_iter()) {
        if seen.insert(na.id.clone()) {
            merged.push(na);
        }
    }
    Ok(merged)
}

fn project_listed_agents(state: &AppState, net_agents: &[NetworkAgent]) -> Vec<Agent> {
    net_agents
        .iter()
        .map(|na| {
            let mut agent = agent_from_network(na);
            let _ = state.agent_service.apply_runtime_config(&mut agent);
            if agent.icon.is_none() {
                if let Ok(shadow) = state.agent_service.get_agent_local(&agent.agent_id) {
                    agent.icon = shadow.icon;
                }
            }
            // Read-time reconciliation: aura-network's list response
            // historically drops the `permissions` column for non-CEO
            // agents, which meant every app-boot sidebar refresh
            // clobbered the shadow (and the UI toggles) with the
            // empty default. Mirrors the PUT-side defensive
            // reconciliation — see
            // `AgentService::reconcile_permissions_with_shadow` for
            // the full rationale.
            state
                .agent_service
                .reconcile_permissions_with_shadow(&mut agent);
            // Repair blank names in-memory so the "New Agent" placeholder
            // (and the UI renames that key off it) cascade to both
            // library and project listings. Persistence happens in the
            // batched background flush below.
            repair_agent_name_only(&mut agent);
            agent
        })
        .collect()
}

fn spawn_shadow_flush(state: &AppState, agents: &[Agent]) {
    // Flush shadow changes as a SINGLE batched write on a blocking
    // thread so the response isn't gated on N full `settings.json`
    // rewrites (see `AgentService::save_agent_shadows_if_changed`).
    // The shadow is a cache — failures are logged but don't fail the
    // request, matching the prior `let _ = save_agent_shadow(..)`
    // semantics.
    let service = state.agent_service.clone();
    let snapshot = agents.to_vec();
    tokio::task::spawn_blocking(move || {
        let refs: Vec<&Agent> = snapshot.iter().collect();
        match service.save_agent_shadows_if_changed(&refs) {
            Ok(n) if n > 0 => tracing::debug!(
                changed = n,
                total = refs.len(),
                "list_agents: persisted shadow diffs"
            ),
            Ok(_) => {}
            Err(e) => tracing::warn!(error = %e, "list_agents: shadow flush failed"),
        }
    });
}

pub(crate) async fn get_agent(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<Json<Agent>> {
    if is_capture_access_token(&jwt) && agent_id == demo_agent_id() {
        return Ok(Json(demo_agent()));
    }

    if let Some(ref client) = state.network_client {
        let net_agent = client
            .get_agent(&agent_id.to_string(), &jwt)
            .await
            .map_err(map_network_error)?;
        let mut agent = agent_from_network(&net_agent);
        let _ = state.agent_service.apply_runtime_config(&mut agent);
        if agent.icon.is_none() {
            if let Ok(shadow) = state.agent_service.get_agent_local(&agent.agent_id) {
                agent.icon = shadow.icon;
            }
        }
        // Read-time permissions reconciliation — see
        // `AgentService::reconcile_permissions_with_shadow`. Must run
        // before `save_agent_shadow` so an empty network response
        // never overwrites the last-known-good toggles on disk.
        state
            .agent_service
            .reconcile_permissions_with_shadow(&mut agent);
        repair_agent_name_in_place(&state.agent_service, &mut agent);
        let _ = state.agent_service.save_agent_shadow(&agent);
        return Ok(Json(agent));
    }

    let mut agent = state
        .agent_service
        .get_agent_local(&agent_id)
        .map_err(|e| match e {
            aura_os_agents::AgentError::NotFound => ApiError::not_found("agent not found"),
            _ => ApiError::internal(format!("fetching agent: {e}")),
        })?;
    repair_agent_name_in_place(&state.agent_service, &mut agent);
    Ok(Json(agent))
}
