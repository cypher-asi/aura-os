//! Proxy file operations (list directory, read file, write file) to a remote agent
//! running on the swarm gateway. Follows the same validation and proxy
//! pattern used by `swarm.rs` and `remote_terminal.rs`.

use axum::extract::{Path, State};
use axum::Json;
use reqwest::Method;
use std::time::Duration;
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

#[derive(serde::Deserialize)]
pub(crate) struct RemoteGitStatusRequest {
    path: String,
}

#[derive(serde::Deserialize)]
pub(crate) struct RemoteGitDiffRequest {
    path: String,
    file: String,
    area: String,
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

fn map_gateway_status(status: u16) -> (axum::http::StatusCode, Json<ApiError>) {
    match status {
        401 => ApiError::unauthorized("swarm gateway rejected auth token"),
        403 => ApiError::forbidden("remote workspace access denied"),
        404 => ApiError::not_found("remote agent or workspace path not found"),
        400 => ApiError::bad_request("remote workspace rejected the path"),
        413 => (
            axum::http::StatusCode::PAYLOAD_TOO_LARGE,
            Json(ApiError {
                error: "remote workspace file exceeds the read limit".to_string(),
                code: "payload_too_large".to_string(),
                details: None,
                data: None,
            }),
        ),
        503 => ApiError::service_unavailable("remote agent workspace is unavailable"),
        _ => ApiError::bad_gateway(format!("swarm gateway returned {status}")),
    }
}

fn map_write_gateway_status(status: u16) -> (axum::http::StatusCode, Json<ApiError>) {
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
        _ => map_gateway_status(status),
    }
}

fn map_git_gateway_status(status: u16) -> (axum::http::StatusCode, Json<ApiError>) {
    match status {
        413 => (
            axum::http::StatusCode::PAYLOAD_TOO_LARGE,
            Json(ApiError {
                error: "remote Git result exceeds the review limit".to_string(),
                code: "payload_too_large".to_string(),
                details: None,
                data: None,
            }),
        ),
        _ => map_gateway_status(status),
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
    action: &[&str],
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
        segments.pop_if_empty().extend(["v1", "agents", agent_id]);
        segments.extend(action.iter().copied());
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
        &["files"],
    )?
    .json(&serde_json::json!({ "path": req.path, "depth": 20 }))
    // `bearer_auth` sets a sensitive HTTP header; it does not write to logs.
    // codeql[rust/cleartext-logging]
    .bearer_auth(&jwt)
    .send()
    .await
    // A reqwest error can retain request metadata after the Authorization
    // header is attached, so do not surface or log its formatted value.
    .map_err(|_| ApiError::bad_gateway("swarm gateway unreachable"))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        // Keep user-derived workspace and agent identifiers out of logs.
        warn!(status, "remote list_directory failed");
        return Err(map_gateway_status(status));
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
        &["read-file"],
    )?
    .json(&serde_json::json!({ "path": req.path }))
    // `bearer_auth` sets a sensitive HTTP header; it does not write to logs.
    // codeql[rust/cleartext-logging]
    .bearer_auth(&jwt)
    .send()
    .await
    // A reqwest error can retain request metadata after the Authorization
    // header is attached, so do not surface or log its formatted value.
    .map_err(|_| ApiError::bad_gateway("swarm gateway unreachable"))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        // Keep user-derived workspace and agent identifiers out of logs.
        warn!(status, "remote read_file failed");
        return Err(map_gateway_status(status));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| ApiError::internal(format!("failed to parse gateway response: {e}")))?;

    Ok(Json(body))
}

async fn proxy_remote_git(
    state: &AppState,
    agent_id: &str,
    jwt: &str,
    action: &'static str,
    body: serde_json::Value,
) -> ApiResult<Json<serde_json::Value>> {
    let (base_url, jwt) = resolve_remote_context(state, agent_id, jwt).await?;
    let network = state.require_network_client()?;
    let response = trusted_swarm_request(
        network.http_client(),
        &base_url,
        Method::POST,
        agent_id,
        &["git", action],
    )?
    .json(&body)
    // `bearer_auth` sets a sensitive HTTP header; it does not write to logs.
    // codeql[rust/cleartext-logging]
    .bearer_auth(&jwt)
    .timeout(Duration::from_secs(15))
    .send()
    .await
    .map_err(|_| ApiError::bad_gateway("swarm gateway unreachable"))?;
    if !response.status().is_success() {
        let status = response.status().as_u16();
        warn!(status, "remote Git inspection failed");
        return Err(map_git_gateway_status(status));
    }
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|_| ApiError::bad_gateway("invalid remote Git response"))?;
    if !valid_remote_git_response(action, &body) {
        return Err(ApiError::bad_gateway("invalid remote Git response"));
    }
    Ok(Json(body))
}

fn valid_remote_git_response(action: &str, body: &serde_json::Value) -> bool {
    match action {
        "status" => {
            body.get("available")
                .and_then(serde_json::Value::as_bool)
                .is_some()
                && body
                    .get("files")
                    .and_then(serde_json::Value::as_array)
                    .is_some()
        }
        "diff" => {
            body.get("path")
                .and_then(serde_json::Value::as_str)
                .is_some()
                && body
                    .get("area")
                    .and_then(serde_json::Value::as_str)
                    .is_some()
                && body
                    .get("diff")
                    .and_then(serde_json::Value::as_str)
                    .is_some()
                && body
                    .get("truncated")
                    .and_then(serde_json::Value::as_bool)
                    .is_some()
                && body
                    .get("binary")
                    .and_then(serde_json::Value::as_bool)
                    .is_some()
        }
        _ => false,
    }
}

/// Read-only source-control status from the agent's own remote workspace.
pub(crate) async fn remote_git_status(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<String>,
    Json(request): Json<RemoteGitStatusRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    if request.path.trim().is_empty() || request.path.len() > 4096 {
        return Err(ApiError::bad_request("invalid remote Git workspace path"));
    }
    proxy_remote_git(
        &state,
        &agent_id,
        &jwt,
        "status",
        serde_json::json!({ "path": request.path }),
    )
    .await
}

/// Read-only staged or worktree diff from the agent's own remote workspace.
pub(crate) async fn remote_git_diff(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<String>,
    Json(request): Json<RemoteGitDiffRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    if request.path.trim().is_empty()
        || request.path.len() > 4096
        || request.file.trim().is_empty()
        || request.file.len() > 4096
        || !matches!(request.area.as_str(), "staged" | "worktree")
    {
        return Err(ApiError::bad_request("invalid remote Git diff request"));
    }
    proxy_remote_git(
        &state,
        &agent_id,
        &jwt,
        "diff",
        serde_json::json!({ "path": request.path, "file": request.file, "area": request.area }),
    )
    .await
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
        &["write-file"],
    )?
    .json(&serde_json::json!({
        "path": &req.path,
        "content_base64": &req.content_base64,
        "expected_revision": &req.expected_revision,
    }))
    // `bearer_auth` sets a sensitive HTTP header; it does not write to logs.
    // codeql[rust/cleartext-logging]
    .bearer_auth(&jwt)
    .send()
    .await
    // A reqwest error can retain request metadata after the Authorization
    // header is attached, so do not surface or log its formatted value.
    .map_err(|_| ApiError::bad_gateway("swarm gateway unreachable"))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        // Keep user-derived workspace and agent identifiers out of logs.
        warn!(status, "remote write_file failed");
        return Err(map_write_gateway_status(status));
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
        let (status, Json(error)) = map_write_gateway_status(409);
        assert_eq!(status, axum::http::StatusCode::CONFLICT);
        assert_eq!(error.code, "conflict");
    }

    #[test]
    fn ordinary_file_proxy_errors_preserve_remote_failure_types() {
        for (upstream, expected) in [
            (400, axum::http::StatusCode::BAD_REQUEST),
            (403, axum::http::StatusCode::FORBIDDEN),
            (404, axum::http::StatusCode::NOT_FOUND),
            (413, axum::http::StatusCode::PAYLOAD_TOO_LARGE),
            (503, axum::http::StatusCode::SERVICE_UNAVAILABLE),
        ] {
            assert_eq!(map_gateway_status(upstream).0, expected);
        }
        let (_, Json(error)) = map_gateway_status(500);
        assert_eq!(error.error, "swarm gateway returned 500");
    }

    #[test]
    fn swarm_request_keeps_untrusted_agent_id_inside_the_path() {
        let request = trusted_swarm_request(
            &reqwest::Client::new(),
            "https://swarm.example/gateway/",
            Method::PUT,
            "../../https://attacker.example/?redirect=true",
            &["write-file"],
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

    #[test]
    fn remote_git_proxy_builds_fixed_subroutes_and_rejects_malformed_responses() {
        let (status, Json(error)) = map_git_gateway_status(413);
        assert_eq!(status, axum::http::StatusCode::PAYLOAD_TOO_LARGE);
        assert!(error.error.contains("review limit"));
        let request = trusted_swarm_request(
            &reqwest::Client::new(),
            "https://swarm.example/gateway/",
            Method::POST,
            "agent-1",
            &["git", "diff"],
        )
        .unwrap()
        .build()
        .unwrap();
        assert_eq!(request.url().path(), "/gateway/v1/agents/agent-1/git/diff");
        assert!(valid_remote_git_response(
            "status",
            &serde_json::json!({"available": false, "files": []}),
        ));
        assert!(!valid_remote_git_response(
            "status",
            &serde_json::json!({"available": true}),
        ));
        assert!(!valid_remote_git_response(
            "diff",
            &serde_json::json!({"path": "src/main.rs", "diff": "text"}),
        ));
    }
}
