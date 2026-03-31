use axum::extract::{Path, State};
use axum::Json;
use serde::Serialize;
use tracing::info;

use aura_os_core::{Agent, AgentId, ProfileId, SuperAgentOrchestration};
use chrono::{DateTime, Utc};

use crate::error::{map_network_error, ApiError, ApiResult};
use crate::state::{AppState, AuthJwt, AuthSession};

#[derive(Serialize)]
pub(crate) struct SetupResponse {
    pub agent: Agent,
    pub created: bool,
}

pub(crate) async fn setup_super_agent(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(_session): AuthSession,
) -> ApiResult<Json<SetupResponse>> {
    let network = state.require_network_client()?;

    let net_agents = network
        .list_agents(&jwt)
        .await
        .map_err(map_network_error)?;

    if let Some(net_agent) = net_agents
        .iter()
        .find(|a| a.role.as_deref() == Some("super_agent"))
    {
        let agent = agent_from_net(net_agent);
        return Ok(Json(SetupResponse {
            agent,
            created: false,
        }));
    }

    let prompt =
        aura_os_super_agent::prompt::super_agent_system_prompt("Default Org", "default");

    let net_req = aura_os_network::CreateAgentRequest {
        name: "CEO".to_string(),
        role: Some("super_agent".to_string()),
        personality: Some(
            "Strategic, efficient, and proactive. I orchestrate your entire development operation."
                .to_string(),
        ),
        system_prompt: Some(prompt),
        skills: Some(vec![
            "orchestration".into(),
            "project-management".into(),
            "fleet-management".into(),
            "cost-analysis".into(),
        ]),
        icon: None,
        harness: None,
        machine_type: Some("local".to_string()),
        org_id: None,
    };

    let net_agent = network
        .create_agent(&jwt, &net_req)
        .await
        .map_err(map_network_error)?;

    let agent = agent_from_net(&net_agent);

    info!(agent_id = %agent.agent_id, "SuperAgent created");
    Ok(Json(SetupResponse {
        agent,
        created: true,
    }))
}

pub(crate) async fn list_orchestrations(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
) -> ApiResult<Json<Vec<SuperAgentOrchestration>>> {
    let store = aura_os_super_agent::state::OrchestrationStore::new(state.store.clone());
    let orchestrations = store.list().map_err(ApiError::internal)?;
    Ok(Json(orchestrations))
}

pub(crate) async fn get_orchestration(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
    AuthSession(_session): AuthSession,
    Path(orchestration_id): Path<String>,
) -> ApiResult<Json<SuperAgentOrchestration>> {
    let id = uuid::Uuid::parse_str(&orchestration_id)
        .map_err(|_| ApiError::bad_request("invalid orchestration ID"))?;
    let store = aura_os_super_agent::state::OrchestrationStore::new(state.store.clone());
    let orch = store
        .get(&id)
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::not_found("orchestration not found"))?;
    Ok(Json(orch))
}

pub(crate) async fn list_pending_events(
    State(state): State<AppState>,
    AuthJwt(_jwt): AuthJwt,
) -> ApiResult<Json<Vec<aura_os_super_agent::events::SuperAgentEvent>>> {
    let events = state.super_agent_service.event_listener.peek_events().await;
    Ok(Json(events))
}

fn agent_from_net(net: &aura_os_network::NetworkAgent) -> Agent {
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

    let is_super = net.role.as_deref() == Some("super_agent");

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
