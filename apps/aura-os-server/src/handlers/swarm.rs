use axum::extract::{Path, State};
use axum::Json;
use serde::{Deserialize, Serialize};

use aura_os_core::HarnessMode;

use crate::error::{ApiError, ApiResult, map_network_error};
use crate::state::AppState;

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct RemoteAgentStateResponse {
    pub state: String,
    pub uptime_seconds: u64,
    pub active_sessions: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_heartbeat_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
}

pub(crate) async fn get_remote_agent_state(
    State(state): State<AppState>,
    Path(agent_id): Path<String>,
) -> ApiResult<Json<RemoteAgentStateResponse>> {
    let jwt = state.get_jwt()?;

    let network = state.require_network_client()?;
    let net_agent = network
        .get_agent(&agent_id, &jwt)
        .await
        .map_err(map_network_error)?;

    let machine_type = net_agent.machine_type.as_deref().unwrap_or("local");
    if HarnessMode::from_machine_type(machine_type) != HarnessMode::Swarm {
        return Err(ApiError::bad_request("agent is not a remote agent"));
    }

    let base_url = state
        .swarm_base_url
        .as_deref()
        .ok_or_else(|| ApiError::service_unavailable("swarm gateway is not configured"))?;

    let url = format!("{}/v1/agents/{}/state", base_url, agent_id);

    let resp = network
        .http_client()
        .get(&url)
        .header("Authorization", format!("Bearer {jwt}"))
        .send()
        .await
        .map_err(|e| ApiError::bad_gateway(format!("swarm gateway unreachable: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(match status {
            404 => ApiError::not_found("remote agent not found on swarm gateway"),
            401 => ApiError::unauthorized("swarm gateway rejected auth token"),
            _ => ApiError::bad_gateway(format!("swarm gateway returned {status}: {body}")),
        });
    }

    let gateway_state: RemoteAgentStateResponse = resp
        .json()
        .await
        .map_err(|e| ApiError::internal(format!("failed to parse gateway response: {e}")))?;

    Ok(Json(gateway_state))
}
