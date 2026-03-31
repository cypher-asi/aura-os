//! Proxy file operations (list directory, read file) to a remote agent
//! running on the swarm gateway. Follows the same validation and proxy
//! pattern used by `swarm.rs` and `remote_terminal.rs`.

use axum::extract::{Path, State};
use axum::Json;
use tracing::warn;

use aura_os_core::HarnessMode;

use crate::error::{map_network_error, ApiError, ApiResult};
use crate::state::{AppState, AuthJwt};

#[derive(serde::Deserialize)]
pub(crate) struct RemoteFileRequest {
    path: String,
}

/// Validate that the agent is remote and return the swarm base URL + JWT.
async fn resolve_remote_context(
    state: &AppState,
    agent_id: &str,
    jwt: &str,
) -> Result<(String, String), (axum::http::StatusCode, Json<ApiError>)> {
    let network = state.require_network_client()?;
    let net_agent = network
        .get_agent(agent_id, &jwt)
        .await
        .map_err(map_network_error)?;

    let machine_type = net_agent.machine_type.as_deref().unwrap_or("local");
    if HarnessMode::from_machine_type(machine_type) != HarnessMode::Swarm {
        return Err(ApiError::bad_request("agent is not a remote agent"));
    }

    let base_url = state
        .swarm_base_url
        .as_deref()
        .ok_or_else(|| ApiError::service_unavailable("swarm gateway is not configured"))?
        .to_string();

    Ok((base_url, jwt.to_string()))
}

fn map_gateway_status(status: u16, body: &str) -> (axum::http::StatusCode, Json<ApiError>) {
    match status {
        404 => ApiError::not_found("remote agent not found on swarm gateway"),
        401 => ApiError::unauthorized("swarm gateway rejected auth token"),
        _ => ApiError::bad_gateway(format!("swarm gateway returned {status}: {body}")),
    }
}

/// `POST /api/agents/:agent_id/remote_agent/files`
///
/// Proxy a directory listing request to the swarm gateway.
/// Body: `{ "path": "/home/aura/project" }`
/// Returns the same `{ ok, entries }` shape as the local `list_directory`.
pub(crate) async fn list_remote_directory(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<String>,
    Json(req): Json<RemoteFileRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    let (base_url, jwt) = resolve_remote_context(&state, &agent_id, &jwt).await?;
    let network = state.require_network_client()?;

    let url = format!("{}/v1/agents/{}/files", base_url, agent_id);

    let resp = network
        .http_client()
        .post(&url)
        .json(&serde_json::json!({ "path": req.path, "depth": 20 }))
        .header("Authorization", format!("Bearer {jwt}"))
        .send()
        .await
        .map_err(|e| ApiError::bad_gateway(format!("swarm gateway unreachable: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        warn!(agent_id = %agent_id, path = %req.path, status, "remote list_directory failed");
        return Err(map_gateway_status(status, &body));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| ApiError::internal(format!("failed to parse gateway response: {e}")))?;

    Ok(Json(body))
}

/// `POST /api/agents/:agent_id/remote_agent/read-file`
///
/// Proxy a file read request to the swarm gateway.
/// Body: `{ "path": "/home/aura/project/src/main.rs" }`
/// Returns the same `{ ok, content, path }` shape as the local `read_file`.
pub(crate) async fn read_remote_file(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<String>,
    Json(req): Json<RemoteFileRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    let (base_url, jwt) = resolve_remote_context(&state, &agent_id, &jwt).await?;
    let network = state.require_network_client()?;

    let url = format!("{}/v1/agents/{}/read-file", base_url, agent_id);

    let resp = network
        .http_client()
        .post(&url)
        .json(&serde_json::json!({ "path": req.path }))
        .header("Authorization", format!("Bearer {jwt}"))
        .send()
        .await
        .map_err(|e| ApiError::bad_gateway(format!("swarm gateway unreachable: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        warn!(agent_id = %agent_id, path = %req.path, status, "remote read_file failed");
        return Err(map_gateway_status(status, &body));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| ApiError::internal(format!("failed to parse gateway response: {e}")))?;

    Ok(Json(body))
}
