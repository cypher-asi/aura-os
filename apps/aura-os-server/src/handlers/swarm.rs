use axum::extract::{Path, Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};

use aura_os_core::HarnessMode;

use crate::error::{map_network_error, ApiError, ApiResult};
use crate::handlers::agents::recover_remote_agent_pipeline;
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
    /// AWS instance type backing a confidential pod VM (e.g. `m6a.xlarge`),
    /// when the gateway knows it. Used to report real resources instead of
    /// the stripped tier spec.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vm_instance_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_version: Option<String>,
    /// Git commit of the harness build running in the pod, reported by the
    /// swarm gateway (sourced from the harness /health endpoint).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub harness_git_sha: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub isolation: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

/// A single merged VM/platform log entry from the swarm gateway: the
/// live pod tail interleaved with stored termination snapshots.
#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct RemoteAgentLogEntry {
    pub timestamp: String,
    pub line: String,
    /// `"live"` (running pod stdout) or `"snapshot"` (final tail captured
    /// when a previous pod was terminated).
    pub source: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct RemoteAgentLogsResponse {
    pub logs: Vec<RemoteAgentLogEntry>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RemoteAgentLogsQuery {
    /// Keep only the last N merged entries (gateway default 100).
    pub tail: Option<u32>,
    /// RFC3339 timestamp; only entries at or after it.
    pub since: Option<String>,
}

/// Proxy `GET /v1/agents/:id/logs` on the swarm gateway: per-VM platform
/// logs (boot, attestation, health, harness lifecycle) as a merged
/// live-tail + termination-snapshot list.
pub(crate) async fn get_remote_agent_logs(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<String>,
    Query(query): Query<RemoteAgentLogsQuery>,
) -> ApiResult<Json<RemoteAgentLogsResponse>> {
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

    let url = format!("{}/v1/agents/{}/logs", base_url, agent_id);

    let mut request = network
        .http_client()
        .get(&url)
        .header("Authorization", format!("Bearer {jwt}"));
    if let Some(tail) = query.tail {
        request = request.query(&[("tail", tail.to_string())]);
    }
    if let Some(since) = query.since.as_deref() {
        request = request.query(&[("since", since)]);
    }

    let resp = request
        .send()
        .await
        .map_err(|e| ApiError::bad_gateway(format!("swarm gateway unreachable: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(match status {
            404 => ApiError::not_found("remote agent not found on swarm gateway"),
            401 => ApiError::unauthorized("swarm gateway rejected auth token"),
            400 => ApiError::bad_request(format!("swarm gateway rejected request: {body}")),
            _ => ApiError::bad_gateway(format!("swarm gateway returned {status}: {body}")),
        });
    }

    let logs: RemoteAgentLogsResponse = resp
        .json()
        .await
        .map_err(|e| ApiError::internal(format!("failed to parse gateway response: {e}")))?;

    Ok(Json(logs))
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

    // Every valid lifecycle action recycles or pauses the VM's harness
    // run, so any warm `chat_session` we hold for this agent now points
    // at a stale run. `ChatSession::is_alive` can't see that (it only
    // checks the local command channel), so drop the warm entries and
    // let the next chat turn cold-open against the live VM instead of
    // stalling until the first-event watchdog.
    state.evict_chat_sessions_for_agent(&agent_id);

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

    let recovered = recover_remote_agent_pipeline(&state, network, &jwt, &net_agent).await?;

    let _ = state.event_broadcast.send(serde_json::json!({
        "type": "remote_agent_state_changed",
        "agent_id": agent_id,
        "state": recovered.status,
        "uptime_seconds": 0,
        "active_sessions": 0,
        "action": "recover",
        "phase": "ready",
        "vm_id": recovered.agent.vm_id,
        "previous_vm_id": recovered.previous_vm_id,
    }));

    Ok(Json(RecoveryActionResponse {
        agent_id,
        status: recovered.status,
        previous_vm_id: recovered.previous_vm_id,
        vm_id: recovered.agent.vm_id.clone(),
    }))
}
