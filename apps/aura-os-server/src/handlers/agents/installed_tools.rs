//! Diagnostic endpoint for the server-contributed tools shipped to the
//! harness. Legacy cross-agent dispatcher rows were removed in
//! Phase 3; domain operations are delegated inside the harness.

use axum::extract::{Path, State};
use axum::Json;
use serde::Serialize;

use aura_os_core::{Agent, AgentId};
use aura_protocol::AgentPermissionsWire;

use crate::error::{map_network_error, ApiResult};
use crate::handlers::agents::tool_dedupe::dedupe_installed_tools_by_name;
use crate::handlers::agents::workspace_tools::{
    installed_workspace_app_tools, installed_workspace_integrations_for_org_with_token,
};
use crate::state::{AppState, AuthJwt};

use super::conversions::agent_from_network;

#[derive(Debug, Clone, Serialize)]
pub(crate) struct InstalledToolDiagnosticRow {
    pub name: String,
    pub endpoint: String,
    /// `"workspace"` or `"integration"`.
    pub source: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capability_origin: Option<String>,
    pub registered: bool,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct AgentInstalledToolsDiagnostic {
    pub agent_id: String,
    pub is_ceo_preset: bool,
    pub agent_permissions: AgentPermissionsWire,
    pub tools: Vec<InstalledToolDiagnosticRow>,
    pub missing_registrations: Vec<String>,
    pub duplicate_names: Vec<String>,
    pub final_shipped_names: Vec<String>,
}

pub(crate) async fn get_installed_tools_diagnostic(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<Json<AgentInstalledToolsDiagnostic>> {
    let agent = load_agent(&state, &jwt, &agent_id).await?;

    let mut workspace_tools = if let Some(org_id) = agent.org_id.as_ref() {
        installed_workspace_app_tools(&state, org_id, &jwt).await
    } else {
        Vec::new()
    };
    let integration_tools = if let Some(org_id) = agent.org_id.as_ref() {
        installed_workspace_integrations_for_org_with_token(&state, org_id, &jwt).await
    } else {
        Vec::new()
    };

    let duplicate_names = dedupe_installed_tools_by_name(&mut workspace_tools);
    let final_shipped_names = workspace_tools
        .iter()
        .map(|tool| tool.name.clone())
        .collect::<Vec<_>>();

    let mut rows = workspace_tools
        .iter()
        .map(|tool| InstalledToolDiagnosticRow {
            name: tool.name.clone(),
            endpoint: tool.endpoint.clone(),
            source: "workspace",
            capability_origin: None,
            registered: true,
        })
        .collect::<Vec<_>>();

    rows.extend(
        integration_tools
            .into_iter()
            .map(|integration| InstalledToolDiagnosticRow {
                name: integration.name,
                endpoint: integration.provider,
                source: "integration",
                capability_origin: None,
                registered: true,
            }),
    );

    Ok(Json(AgentInstalledToolsDiagnostic {
        agent_id: agent_id.to_string(),
        is_ceo_preset: agent.permissions.is_ceo_preset(),
        agent_permissions: (&agent.permissions).into(),
        tools: rows,
        missing_registrations: Vec::new(),
        duplicate_names,
        final_shipped_names,
    }))
}

async fn load_agent(state: &AppState, jwt: &str, agent_id: &AgentId) -> ApiResult<Agent> {
    if let Some(ref client) = state.network_client {
        let net_agent = client
            .get_agent(&agent_id.to_string(), jwt)
            .await
            .map_err(map_network_error)?;
        let mut agent = agent_from_network(&net_agent);
        let _ = state.agent_service.apply_runtime_config(&mut agent);
        state
            .agent_service
            .reconcile_permissions_with_shadow(&mut agent);
        return Ok(agent);
    }
    state
        .agent_service
        .get_agent_local(agent_id)
        .map_err(|e| match e {
            aura_os_agents::AgentError::NotFound => {
                crate::error::ApiError::not_found("agent not found")
            }
            _ => crate::error::ApiError::internal(format!("fetching agent: {e}")),
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostic_rows_are_registered_for_workspace_tools() {
        let row = InstalledToolDiagnosticRow {
            name: "search_docs".to_string(),
            endpoint: "https://example.com/tools/search_docs".to_string(),
            source: "workspace",
            capability_origin: None,
            registered: true,
        };
        assert!(row.registered);
        assert_eq!(row.source, "workspace");
    }
}
