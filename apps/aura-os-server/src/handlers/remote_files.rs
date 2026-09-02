//! Proxy file operations (list directory, read file, write file) to a remote agent
//! running on the swarm gateway. Follows the same validation and proxy
//! pattern used by `swarm.rs` and `remote_terminal.rs`.

use axum::extract::{Path, State};
use axum::Json;
use reqwest::Method;
use tracing::warn;

use aura_os_core::HarnessMode;

use crate::error::{map_network_error, ApiError, ApiResult};
use crate::state::{AppState, AuthJwt};

#[derive(serde::Deserialize)]
pub(crate) struct RemoteFileRequest {
    path: String,
}

#[derive(serde::Deserialize)]
pub(crate) struct RemoteFileWriteRequest {
    path: String,
    content_base64: String,
    expected_revision: String,
}

/// Validate that the agent is remote and return the swarm base URL + JWT.
async fn resolve_remote_context(
    state: &AppState,
    agent_id: &str,
    jwt: &str,
) -> Result<(String, String), (axum::http::StatusCode, Json<ApiError>)> {
    let network = state.require_network_client()?;
    let net_agent = network
        .get_agent(agent_id, jwt)
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

fn map_write_gateway_status(status: u16, body: &str) -> (axum::http::StatusCode, Json<ApiError>) {
    match status {
        400 => ApiError::bad_request("remote workspace rejected the file write"),
        403 => ApiError::forbidden("remote workspace denied access to the file"),
        409 => ApiError::conflict("file changed since it was opened; reopen it before saving"),
        413 => (
            axum::http::StatusCode::PAYLOAD_TOO_LARGE,
            Json(ApiError {
                error: "file is too large to edit in Aura Web".to_string(),
                code: "payload_too_large".to_string(),
                details: None,
                data: None,
            }),
        ),
        _ => map_gateway_status(status, body),
    }
}

/// Build a request whose origin is fixed by the configured Swarm gateway.
///
/// Agent IDs come from the request path, so they must be appended as one
/// percent-encoded URL segment instead of interpolated into a URL string.
fn trusted_swarm_request(
    client: &reqwest::Client,
    configured_base: &str,
    method: Method,
    agent_id: &str,
    action: &'static str,
) -> ApiResult<reqwest::RequestBuilder> {
    let mut url = reqwest::Url::parse(configured_base.trim())
        .map_err(|_| ApiError::service_unavailable("swarm gateway URL is invalid"))?;

    let valid_origin = matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none();
    if !valid_origin {
        return Err(ApiError::service_unavailable(
            "swarm gateway URL is invalid",
        ));
    }

    {
        let mut segments = url.path_segments_mut().map_err(|_| {
            ApiError::service_unavailable("swarm gateway URL cannot contain path segments")
        })?;
        segments
            .pop_if_empty()
            .extend(["v1", "agents", agent_id, action]);
    }

    // The configured URL above owns the validated origin, while `agent_id` is
    // encoded as a single path segment. CodeQL cannot infer that boundary.
    // codeql[rust/request-forgery]
    Ok(client.request(method, url))
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
    let resp = trusted_swarm_request(
        network.http_client(),
        &base_url,
        Method::POST,
        &agent_id,
        "files",
    )?
    .json(&serde_json::json!({ "path": req.path, "depth": 20 }))
    .header("Authorization", format!("Bearer {jwt}"))
    .send()
    .await
    // A reqwest error can retain request metadata after the Authorization
    // header is attached, so do not surface or log its formatted value.
    .map_err(|_| ApiError::bad_gateway("swarm gateway unreachable"))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        // Keep user-derived workspace and agent identifiers out of logs.
        warn!(status, "remote list_directory failed");
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
    let resp = trusted_swarm_request(
        network.http_client(),
        &base_url,
        Method::POST,
        &agent_id,
        "read-file",
    )?
    .json(&serde_json::json!({ "path": req.path }))
    .header("Authorization", format!("Bearer {jwt}"))
    .send()
    .await
    // A reqwest error can retain request metadata after the Authorization
    // header is attached, so do not surface or log its formatted value.
    .map_err(|_| ApiError::bad_gateway("swarm gateway unreachable"))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        // Keep user-derived workspace and agent identifiers out of logs.
        warn!(status, "remote read_file failed");
        return Err(map_gateway_status(status, &body));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| ApiError::internal(format!("failed to parse gateway response: {e}")))?;

    Ok(Json(body))
}

/// `PUT /api/agents/:agent_id/remote_agent/write-file`
///
/// Proxy a revision-checked text-file replacement to the remote agent.
pub(crate) async fn write_remote_file(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<String>,
    Json(req): Json<RemoteFileWriteRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    let (base_url, jwt) = resolve_remote_context(&state, &agent_id, &jwt).await?;
    let network = state.require_network_client()?;
    let resp = trusted_swarm_request(
        network.http_client(),
        &base_url,
        Method::PUT,
        &agent_id,
        "write-file",
    )?
    .json(&serde_json::json!({
        "path": &req.path,
        "content_base64": &req.content_base64,
        "expected_revision": &req.expected_revision,
    }))
    .header("Authorization", format!("Bearer {jwt}"))
    .send()
    .await
    // A reqwest error can retain request metadata after the Authorization
    // header is attached, so do not surface or log its formatted value.
    .map_err(|_| ApiError::bad_gateway("swarm gateway unreachable"))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        // Keep user-derived workspace and agent identifiers out of logs.
        warn!(status, "remote write_file failed");
        return Err(map_write_gateway_status(status, &body));
    }

    let body = resp.json().await.map_err(|error| {
        ApiError::internal(format!("failed to parse gateway response: {error}"))
    })?;
    Ok(Json(body))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_conflicts_are_preserved_for_the_web_editor() {
        let (status, Json(error)) = map_write_gateway_status(409, "ignored");
        assert_eq!(status, axum::http::StatusCode::CONFLICT);
        assert_eq!(error.code, "conflict");
    }

    #[test]
    fn ordinary_file_proxy_errors_keep_the_existing_mapping() {
        let (status, Json(error)) = map_gateway_status(400, "pod rejected request");
        assert_eq!(status, axum::http::StatusCode::BAD_GATEWAY);
        assert_eq!(error.code, "bad_gateway");
    }

    #[test]
    fn swarm_request_keeps_untrusted_agent_id_inside_the_path() {
        let request = trusted_swarm_request(
            &reqwest::Client::new(),
            "https://swarm.example/gateway/",
            Method::PUT,
            "../../https://attacker.example/?redirect=true",
            "write-file",
        )
        .expect("request URL should be constructed")
        .build()
        .expect("request should build");

        assert_eq!(request.url().scheme(), "https");
        assert_eq!(request.url().host_str(), Some("swarm.example"));
        assert_eq!(request.url().query(), None);
        assert!(request.url().path().starts_with("/gateway/v1/agents/"));
        assert!(request.url().path().contains("%2F"));
    }
}
