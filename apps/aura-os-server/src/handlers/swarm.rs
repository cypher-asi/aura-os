use axum::extract::{Path, State};
use axum::Json;
use serde::{Deserialize, Serialize};

use aura_os_core::HarnessMode;

use crate::error::{map_network_error, ApiError, ApiResult};
use crate::handlers::agents::reprovision_remote_agent;
use crate::state::{AppState, AuthJwt};

const VALID_LIFECYCLE_ACTIONS: &[&str] = &["hibernate", "stop", "restart", "wake", "start"];

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct LifecycleActionResponse {
    pub agent_id: String,
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct RecoveryActionResponse {
    pub agent_id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_vm_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vm_id: Option<String>,
    pub vm_id_changed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct RemoteAgentStateResponse {
    pub state: String,
    pub uptime_seconds: u64,
    pub active_sessions: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_heartbeat_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default)]
    pub cpu_millicores: Option<u32>,
    #[serde(default)]
    pub memory_mb: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub isolation: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

pub(crate) async fn get_remote_agent_state(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<String>,
) -> ApiResult<Json<RemoteAgentStateResponse>> {
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

    let _ = state.event_broadcast.send(serde_json::json!({
        "type": "remote_agent_state_changed",
        "agent_id": agent_id,
        "state": gateway_state.state,
        "uptime_seconds": gateway_state.uptime_seconds,
        "active_sessions": gateway_state.active_sessions,
        "error_message": gateway_state.error_message,
    }));

    Ok(Json(gateway_state))
}

/// Proxy a lifecycle action (hibernate, stop, restart, wake, start) to the
/// swarm gateway for a remote agent.
pub(crate) async fn remote_agent_lifecycle(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((agent_id, action)): Path<(String, String)>,
) -> ApiResult<Json<LifecycleActionResponse>> {
    if !VALID_LIFECYCLE_ACTIONS.contains(&action.as_str()) {
        return Err(ApiError::bad_request(format!(
            "invalid action '{action}'; must be one of: {}",
            VALID_LIFECYCLE_ACTIONS.join(", ")
        )));
    }

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

    let url = format!("{}/v1/agents/{}/{}", base_url, agent_id, action);

    let resp = network
        .http_client()
        .post(&url)
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
            409 => ApiError::conflict(format!("invalid state transition: {body}")),
            _ => ApiError::bad_gateway(format!("swarm gateway returned {status}: {body}")),
        });
    }

    let result: LifecycleActionResponse = resp
        .json()
        .await
        .map_err(|e| ApiError::internal(format!("failed to parse gateway response: {e}")))?;

    let _ = state.event_broadcast.send(serde_json::json!({
        "type": "remote_agent_state_changed",
        "agent_id": agent_id,
        "state": result.status,
        "action": action,
    }));

    Ok(Json(result))
}

pub(crate) async fn recover_remote_agent(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<String>,
) -> ApiResult<Json<RecoveryActionResponse>> {
    let network = state.require_network_client()?;
    let net_agent = network
        .get_agent(&agent_id, &jwt)
        .await
        .map_err(map_network_error)?;

    let machine_type = net_agent.machine_type.as_deref().unwrap_or("local");
    if HarnessMode::from_machine_type(machine_type) != HarnessMode::Swarm {
        return Err(ApiError::bad_request("agent is not a remote agent"));
    }

    let reprovisioned = reprovision_remote_agent(&state, network, &jwt, &net_agent).await?;

    let _ = state.event_broadcast.send(serde_json::json!({
        "type": "remote_agent_state_changed",
        "agent_id": agent_id,
        "state": reprovisioned.status,
        "uptime_seconds": 0,
        "active_sessions": 0,
        "error_message": reprovisioned.message,
        "action": "recover",
        "vm_id": reprovisioned.agent.vm_id,
        "previous_vm_id": reprovisioned.previous_vm_id,
        "vm_id_changed": reprovisioned.vm_id_changed,
    }));

    Ok(Json(RecoveryActionResponse {
        agent_id,
        status: reprovisioned.status,
        previous_vm_id: reprovisioned.previous_vm_id,
        vm_id: reprovisioned.agent.vm_id.clone(),
        vm_id_changed: reprovisioned.vm_id_changed,
        message: reprovisioned.message,
    }))
}
