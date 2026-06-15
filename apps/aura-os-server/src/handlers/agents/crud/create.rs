use axum::extract::State;
use axum::Json;

use aura_os_core::{Agent, AgentRuntimeConfig, HarnessMode};

use crate::dto::CreateAgentRequest;
use crate::error::{map_network_error, ApiError, ApiResult};
use crate::handlers::agents::conversions::agent_from_network;
use crate::handlers::agents::marketplace_fields::{
    merge_marketplace_tags, normalize_marketplace_fields,
};
use crate::state::{AppState, AuthJwt};

use super::swarm::provision_remote_agent;
use super::validation::{
    build_runtime_config, ensure_remote_runtime_create_allowed, ensure_supported_agent_name,
    RuntimeConfigInputs,
};

/// Bundle of validated inputs derived from a [`CreateAgentRequest`]. Splitting
/// the request prep out of [`create_agent`] keeps the handler body under the
/// 50-line cap while still giving the orchestrator one cohesive call.
pub(crate) struct PreparedCreate {
    pub(crate) runtime_config: AgentRuntimeConfig,
    pub(crate) net_req: aura_os_network::CreateAgentRequest,
    pub(crate) machine_type: Option<String>,
    pub(crate) submitted_local_path: Option<String>,
}

pub(crate) async fn create_agent(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Json(body): Json<CreateAgentRequest>,
) -> ApiResult<Json<Agent>> {
    ensure_supported_agent_name(body.name.trim())?;
    let prepared = prepare_create(body)?;
    ensure_remote_runtime_create_allowed(state.remote_only, &prepared.runtime_config)?;
    let client = state.require_network_client()?;

    let is_remote =
        HarnessMode::from_machine_type(prepared.machine_type.as_deref().unwrap_or("remote"))
            == HarnessMode::Swarm;
    let agent = if is_remote {
        create_and_provision_remote_agent(&state, client, &jwt, &prepared).await?
    } else {
        let net_agent = client
            .create_agent(&jwt, &prepared.net_req)
            .await
            .map_err(map_network_error)?;
        hydrate_local_state(&state, &net_agent, &prepared)?
    };

    let _ = state.agent_service.save_agent_shadow(&agent);

    // Auto-bind the newly created agent to a per-org Home project so
    // the very first chat turn has somewhere to persist. See the
    // `chat::setup_agent_chat_persistence` lazy repair path for the
    // best-effort retry on the user's first chat.
    crate::handlers::agents::home_project::ensure_agent_home_project_and_binding(
        &state, &jwt, &agent,
    )
    .await;

    Ok(Json(agent))
}

pub(crate) async fn create_and_provision_remote_agent(
    state: &AppState,
    client: &aura_os_network::NetworkClient,
    jwt: &str,
    prepared: &PreparedCreate,
) -> ApiResult<Agent> {
    let net_agent = client
        .create_agent(jwt, &prepared.net_req)
        .await
        .map_err(map_network_error)?;
    hydrate_local_state(state, &net_agent, prepared)?;
    // Pass the org the user submitted on create so provisioning re-asserts
    // it even when aura-network's create response doesn't echo `org_id`
    // back — otherwise the post-provision PUT could persist a NULL org and
    // the remote agent's card would render a blank Organization.
    let reprovisioned = provision_remote_agent(
        state,
        client,
        jwt,
        &net_agent,
        prepared.net_req.org_id.as_deref(),
    )
    .await?;
    let mut agent = reprovisioned.agent;
    // Preserve the user-supplied local override even though it doesn't
    // apply to remote agents today — keeps the value stable if the user
    // later converts the agent back to local.
    agent.local_workspace_path = prepared.submitted_local_path.clone();
    Ok(agent)
}

fn hydrate_local_state(
    state: &AppState,
    net_agent: &aura_os_network::NetworkAgent,
    prepared: &PreparedCreate,
) -> ApiResult<Agent> {
    let mut agent = agent_from_network(net_agent);
    apply_submitted_org_fallback(&mut agent, prepared);
    apply_submitted_permissions_fallback(&mut agent, prepared);
    state
        .agent_service
        .save_agent_runtime_config(&agent.agent_id, &prepared.runtime_config)
        .map_err(|e| ApiError::internal(format!("saving agent runtime config: {e}")))?;
    state
        .agent_service
        .apply_runtime_config(&mut agent)
        .map_err(|e| ApiError::internal(format!("applying agent runtime config: {e}")))?;
    agent.local_workspace_path = prepared.submitted_local_path.clone();
    let _ = state.agent_service.save_agent_shadow(&agent);
    Ok(agent)
}

fn apply_submitted_org_fallback(agent: &mut Agent, prepared: &PreparedCreate) {
    if agent.org_id.is_some() {
        return;
    }
    agent.org_id = prepared
        .net_req
        .org_id
        .as_deref()
        .and_then(|org_id| org_id.parse().ok());
}

fn apply_submitted_permissions_fallback(agent: &mut Agent, prepared: &PreparedCreate) {
    if agent.permissions == prepared.net_req.permissions {
        return;
    }
    tracing::warn!(
        agent_id = %agent.agent_id,
        submitted_capabilities = prepared.net_req.permissions.capabilities.len(),
        response_capabilities = agent.permissions.capabilities.len(),
        "aura-network create response did not echo submitted permissions; using request-side value"
    );
    agent.permissions = prepared.net_req.permissions.clone();
}

pub(crate) fn prepare_create(body: CreateAgentRequest) -> ApiResult<PreparedCreate> {
    let runtime_config = build_runtime_config(RuntimeConfigInputs {
        adapter_type: body.adapter_type.clone(),
        environment: body.environment.clone(),
        auth_source: body.auth_source.clone(),
        integration_id: body.integration_id.clone(),
        default_model: body.default_model.clone(),
        machine_type: body.machine_type.clone(),
    })?;
    let machine_type = Some(if runtime_config.environment == "swarm_microvm" {
        "remote".to_string()
    } else {
        "local".to_string()
    });

    let marketplace =
        normalize_marketplace_fields(body.listing_status.as_deref(), body.expertise.as_deref())?;
    let dual_write_tags = merge_marketplace_tags(body.tags, &marketplace);
    let submitted_local_path = trim_local_path(body.local_workspace_path.as_deref());
    // Resolve the agent's starting permission bundle through the
    // canonical flow. The CEO identity promotion still wins for an
    // empty CEO bundle; otherwise an empty bundle (the common case for
    // a freshly created agent) is seeded with the default new-agent
    // preset (everything except billing) so the agent can act
    // autonomously out of the box. A caller that submits an explicit
    // bundle (e.g. the Permissions tab) is always respected as-is.
    let permissions = body
        .permissions
        .normalized_for_identity(&body.name, Some(body.role.as_str()));
    let permissions = if permissions.is_empty() {
        aura_os_core::AgentPermissions::default_new_agent()
    } else {
        permissions
    };

    let net_req = aura_os_network::CreateAgentRequest {
        org_id: body.org_id.map(|id| id.to_string()),
        name: body.name.trim().to_string(),
        role: Some(body.role),
        personality: Some(body.personality),
        system_prompt: Some(body.system_prompt),
        skills: Some(body.skills),
        icon: body.icon,
        machine_type: machine_type.clone(),
        harness: None,
        tags: dual_write_tags,
        listing_status: marketplace.listing_status,
        expertise: marketplace.expertise,
        permissions,
        intent_classifier: body.intent_classifier,
    };

    Ok(PreparedCreate {
        runtime_config,
        net_req,
        machine_type,
        submitted_local_path,
    })
}

fn trim_local_path(value: Option<&str>) -> Option<String> {
    value.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_os_core::{AgentPermissions, AgentScope, OrgId};

    fn create_request(org_id: OrgId) -> CreateAgentRequest {
        CreateAgentRequest {
            org_id: Some(org_id),
            name: "Status Probe".to_string(),
            role: "status-probe".to_string(),
            personality: "Deterministic".to_string(),
            system_prompt: "Reply exactly as requested.".to_string(),
            skills: vec![],
            icon: None,
            machine_type: Some("local".to_string()),
            adapter_type: Some("aura_harness".to_string()),
            environment: Some("local_host".to_string()),
            auth_source: Some("aura_managed".to_string()),
            integration_id: None,
            default_model: None,
            tags: None,
            listing_status: None,
            expertise: None,
            local_workspace_path: None,
            permissions: aura_os_core::AgentPermissions::default(),
            intent_classifier: None,
        }
    }

    fn network_agent_with_permissions(
        permissions: AgentPermissions,
    ) -> aura_os_network::NetworkAgent {
        aura_os_network::NetworkAgent {
            id: aura_os_core::AgentId::new().to_string(),
            name: "Status Probe".to_string(),
            role: Some("status-probe".to_string()),
            personality: Some("Deterministic".to_string()),
            system_prompt: Some("Reply exactly as requested.".to_string()),
            skills: Some(vec![]),
            icon: None,
            harness: None,
            machine_type: Some("local".to_string()),
            vm_id: None,
            wallet_address: None,
            user_id: "user-1".to_string(),
            org_id: None,
            profile_id: None,
            tags: None,
            listing_status: None,
            expertise: None,
            jobs: None,
            revenue_usd: None,
            reputation: None,
            permissions,
            intent_classifier: None,
            created_at: None,
            updated_at: None,
        }
    }

    #[test]
    fn submitted_org_fallback_preserves_local_agent_identity() {
        let org_id = OrgId::new();
        let prepared = prepare_create(create_request(org_id)).expect("valid create request");
        let net_agent = network_agent_with_permissions(AgentPermissions::default());
        let mut agent = agent_from_network(&net_agent);

        apply_submitted_org_fallback(&mut agent, &prepared);

        assert_eq!(agent.org_id, Some(org_id));
    }

    #[test]
    fn prepare_create_preserves_scoped_zero_capability_permissions() {
        let org_id = OrgId::new();
        let mut request = create_request(org_id);
        request.permissions = AgentPermissions {
            scope: AgentScope {
                orgs: vec![org_id.to_string()],
                ..AgentScope::default()
            },
            capabilities: Vec::new(),
            ..Default::default()
        };

        let prepared = prepare_create(request).expect("valid create request");

        assert!(prepared.net_req.permissions.capabilities.is_empty());
        assert_eq!(
            prepared.net_req.permissions.scope.orgs,
            vec![org_id.to_string()]
        );
    }

    #[test]
    fn submitted_permissions_fallback_preserves_scoped_zero_capability_permissions() {
        let org_id = OrgId::new();
        let mut request = create_request(org_id);
        request.permissions = AgentPermissions {
            scope: AgentScope {
                orgs: vec![org_id.to_string()],
                ..AgentScope::default()
            },
            capabilities: Vec::new(),
            ..Default::default()
        };
        let prepared = prepare_create(request).expect("valid create request");
        let net_agent = network_agent_with_permissions(AgentPermissions::default());
        let mut agent = agent_from_network(&net_agent);

        apply_submitted_permissions_fallback(&mut agent, &prepared);

        assert_eq!(agent.permissions, prepared.net_req.permissions);
        assert!(agent.permissions.capabilities.is_empty());
        assert_eq!(agent.permissions.scope.orgs, vec![org_id.to_string()]);
    }
}
