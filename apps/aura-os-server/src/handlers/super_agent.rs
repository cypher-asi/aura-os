use axum::extract::{Path, State};
use axum::Json;
use serde::Serialize;
use tracing::info;

use aura_os_core::{Agent, SuperAgentOrchestration};

use crate::error::{map_network_error, ApiError, ApiResult};
use crate::handlers::agents::conversions_pub::agent_from_network;
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

    let net_agents = network.list_agents(&jwt).await.map_err(map_network_error)?;

    let (org_name, org_id) = match network.list_orgs(&jwt).await {
        Ok(orgs) => orgs
            .first()
            .map(|o| (o.name.clone(), o.id.clone()))
            .unwrap_or_else(|| ("My Organization".into(), "default".into())),
        Err(_) => ("My Organization".into(), "default".into()),
    };

    if let Some(net_agent) = net_agents
        .iter()
        .find(|a| a.role.as_deref() == Some("super_agent"))
    {
        let fresh_prompt =
            aura_os_super_agent::prompt::super_agent_system_prompt(&org_name, &org_id);
        let needs_update = net_agent
            .system_prompt
            .as_deref()
            .map(|p| p.contains("Default Org") || !p.contains(&org_name))
            .unwrap_or(true);

        let source = if needs_update {
            let update_req = aura_os_network::UpdateAgentRequest {
                name: None,
                role: None,
                personality: None,
                system_prompt: Some(fresh_prompt),
                skills: None,
                icon: None,
                harness: None,
                machine_type: None,
                vm_id: None,
            };
            network
                .update_agent(&net_agent.id, &jwt, &update_req)
                .await
                .ok()
        } else {
            None
        };
        let mut agent = agent_from_network(source.as_ref().unwrap_or(net_agent));
        let _ = state.agent_service.apply_runtime_config(&mut agent);
        if agent.icon.is_none() {
            if let Ok(shadow) = state.agent_service.get_agent_local(&agent.agent_id) {
                agent.icon = shadow.icon;
            }
        }
        let _ = state.agent_service.save_agent_shadow(&agent);
        return Ok(Json(SetupResponse {
            agent,
            created: false,
        }));
    }

    let prompt = aura_os_super_agent::prompt::super_agent_system_prompt(&org_name, &org_id);

    let net_req = aura_os_network::CreateAgentRequest {
        name: "CEO".to_string(),
        role: Some("super_agent".to_string()),
        personality: Some(
            "Strategic, efficient, and proactive. I orchestrate your entire development operation."
                .to_string(),
        ),
        system_prompt: Some(prompt),
        skills: None,
        icon: None,
        harness: None,
        machine_type: Some("local".to_string()),
        org_id: Some(org_id),
    };

    let net_agent = network
        .create_agent(&jwt, &net_req)
        .await
        .map_err(map_network_error)?;

    let mut agent = agent_from_network(&net_agent);
    let _ = state.agent_service.apply_runtime_config(&mut agent);
    let _ = state.agent_service.save_agent_shadow(&agent);

    let default_skills = [
        "orchestration",
        "project-management",
        "fleet-management",
        "cost-analysis",
    ];
    let agent_id_str = agent.agent_id.to_string();
    for skill in default_skills {
        state
            .harness_http
            .install_skill_for_agent(&agent_id_str, skill)
            .await;
    }

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
