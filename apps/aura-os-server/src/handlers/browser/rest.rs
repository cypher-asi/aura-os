//! REST endpoints for the in-app browser.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use tracing::warn;
use url::Url;

use aura_os_browser::{
    DetectedUrl, Error as BrowserError, ProjectBrowserSettings, SessionInfo, SettingsPatch,
    SpawnOptions,
};
use aura_os_core::{HarnessMode, ProjectId};

use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthJwt, AuthSession};

/// Payload for `POST /api/browser`.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SpawnRequest {
    #[serde(default = "default_width")]
    width: u16,
    #[serde(default = "default_height")]
    height: u16,
    #[serde(default)]
    project_id: Option<String>,
    #[serde(default)]
    initial_url: Option<Url>,
    #[serde(default)]
    remote_agent_id: Option<String>,
}

fn default_width() -> u16 {
    1280
}
fn default_height() -> u16 {
    800
}

#[derive(Debug, Serialize)]
pub(crate) struct SpawnResponse {
    id: String,
    initial_url: Option<String>,
    focus_address_bar: bool,
}

pub(crate) async fn spawn_browser(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Json(body): Json<SpawnRequest>,
) -> ApiResult<Json<SpawnResponse>> {
    let project_id = parse_optional_project_id(body.project_id.as_deref())?;
    if let Some(pid) = project_id.as_ref() {
        ensure_project_access(&state, &jwt, pid).await?;
    }
    let mut opts = SpawnOptions::new(body.width, body.height);
    opts.project_id = project_id;
    opts.initial_url = body.initial_url;

    if let Some(agent_id) = body.remote_agent_id {
        if opts.project_id.is_none() {
            return Err(ApiError::bad_request(
                "remote_agent_id requires a project_id",
            ));
        }
        let network = state.require_network_client()?;
        let agent = network
            .get_agent(&agent_id, &jwt)
            .await
            .map_err(crate::error::map_network_error)?;
        let machine_type = agent.machine_type.as_deref().unwrap_or("local");
        if HarnessMode::from_machine_type(machine_type) != HarnessMode::Swarm {
            return Err(ApiError::bad_request(
                "remote_agent_id does not identify a remote agent",
            ));
        }
        let swarm_base_url = state.swarm_base_url.as_deref().ok_or_else(|| {
            ApiError::service_unavailable("remote Preview gateway is not configured")
        })?;
        let proxy = crate::remote_preview::RemotePreviewProxy::start(swarm_base_url, agent.id, jwt)
            .await
            .map_err(|error| {
                warn!(%error, "failed to start remote Preview proxy");
                ApiError::service_unavailable("remote Preview proxy could not start")
            })?;
        opts.proxy_server = Some(proxy.proxy_server);
        // Chromium implicitly bypasses proxies for localhost. This special
        // rule removes that implicit bypass so the selected agent receives
        // loopback traffic through its authenticated tunnel.
        opts.proxy_bypass_list = Some("<-loopback>".to_string());
        opts.cleanup_token = Some(proxy.cleanup_token);
    }

    let handle = state
        .browser_manager
        .spawn_for_owner(session.user_id, opts)
        .await
        .map_err(map_browser_error)?;

    Ok(Json(SpawnResponse {
        id: handle.id.to_string(),
        initial_url: handle.initial_url.as_ref().map(|u| u.to_string()),
        focus_address_bar: handle.focus_address_bar,
    }))
}

pub(crate) async fn list_browsers(
    State(state): State<AppState>,
    AuthSession(session): AuthSession,
) -> Json<Vec<SessionInfo>> {
    Json(state.browser_manager.list_for_owner(&session.user_id))
}

pub(crate) async fn kill_browser(
    State(state): State<AppState>,
    AuthSession(session): AuthSession,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    let session_id = id
        .parse()
        .map_err(|_| ApiError::bad_request("invalid session id"))?;
    if !state
        .browser_manager
        .is_owned_by(session_id, &session.user_id)
    {
        return Err(ApiError::not_found("browser session not found"));
    }
    state
        .browser_manager
        .kill(session_id)
        .await
        .map_err(map_browser_error)?;
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) async fn get_project_settings(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<String>,
) -> ApiResult<Json<ProjectBrowserSettings>> {
    let pid = parse_project_id(&project_id)?;
    ensure_project_access(&state, &jwt, &pid).await?;
    Ok(Json(state.browser_manager.get_project_settings(&pid).await))
}

pub(crate) async fn update_project_settings(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<String>,
    Json(patch): Json<SettingsPatch>,
) -> ApiResult<Json<ProjectBrowserSettings>> {
    let pid = parse_project_id(&project_id)?;
    ensure_project_access(&state, &jwt, &pid).await?;
    let updated = state
        .browser_manager
        .update_project_settings(&pid, patch)
        .await
        .map_err(map_browser_error)?;
    Ok(Json(updated))
}

#[derive(Debug, Serialize)]
pub(crate) struct DetectResponse {
    detected: Vec<DetectedUrl>,
}

pub(crate) async fn run_detect(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<String>,
) -> ApiResult<Json<DetectResponse>> {
    let pid = parse_project_id(&project_id)?;
    ensure_project_access(&state, &jwt, &pid).await?;
    let detected = state
        .browser_manager
        .run_detect(Some(&pid))
        .await
        .map_err(map_browser_error)?;
    Ok(Json(DetectResponse { detected }))
}

fn parse_optional_project_id(raw: Option<&str>) -> ApiResult<Option<ProjectId>> {
    match raw {
        None => Ok(None),
        Some("") => Ok(None),
        Some(raw) => raw
            .parse()
            .map(Some)
            .map_err(|_| ApiError::bad_request("invalid project id")),
    }
}

fn parse_project_id(raw: &str) -> ApiResult<ProjectId> {
    raw.parse()
        .map_err(|_| ApiError::bad_request("invalid project id"))
}

async fn ensure_project_access(
    state: &AppState,
    jwt: &str,
    project_id: &ProjectId,
) -> ApiResult<()> {
    if let Some(client) = &state.network_client {
        client
            .get_project(&project_id.to_string(), jwt)
            .await
            .map_err(crate::error::map_network_error)?;
        return Ok(());
    }
    state
        .project_service
        .get_project(project_id)
        .map(|_| ())
        .map_err(|err| match err {
            aura_os_projects::ProjectError::NotFound(_) => ApiError::not_found("project not found"),
            other => ApiError::internal(format!("fetching project: {other}")),
        })
}

fn map_browser_error(err: BrowserError) -> (StatusCode, Json<ApiError>) {
    match err {
        BrowserError::InvalidInput { .. } => ApiError::bad_request(err.to_string()),
        BrowserError::SessionNotFound(_) => ApiError::not_found(err.to_string()),
        BrowserError::CapacityExceeded(_) => (
            StatusCode::TOO_MANY_REQUESTS,
            Json(ApiError {
                error: err.to_string(),
                code: "capacity_exceeded".to_string(),
                details: None,
                data: None,
            }),
        ),
        BrowserError::Timeout { .. } => (
            StatusCode::GATEWAY_TIMEOUT,
            Json(ApiError {
                error: err.to_string(),
                code: "timeout".to_string(),
                details: None,
                data: None,
            }),
        ),
        BrowserError::NotSupported(_) => (
            StatusCode::NOT_IMPLEMENTED,
            Json(ApiError {
                error: err.to_string(),
                code: "not_supported".to_string(),
                details: None,
                data: None,
            }),
        ),
        BrowserError::Backend {
            op: "chromium_launch" | "chromium_config",
            reason,
        } => {
            warn!(%reason, "browser executable launch failed");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ApiError {
                    error: "Preview could not start because this AURA server's browser runtime is unavailable.".to_string(),
                    code: "browser_launch_failed".to_string(),
                    details: Some(reason),
                    data: None,
                }),
            )
        }
        _ => {
            warn!(%err, "browser handler error");
            ApiError::internal(err.to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chromium_launch_errors_are_actionable_and_structured() {
        let (status, Json(body)) = map_browser_error(BrowserError::backend(
            "chromium_launch",
            "Could not auto detect a chrome executable",
        ));

        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(body.code, "browser_launch_failed");
        assert!(body.error.contains("server's browser runtime"));
        assert_eq!(
            body.details.as_deref(),
            Some("Could not auto detect a chrome executable")
        );
    }

    #[test]
    fn chromium_config_errors_use_the_same_recovery_path() {
        let (status, Json(body)) = map_browser_error(BrowserError::backend(
            "chromium_config",
            "Could not auto detect a chrome executable",
        ));

        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(body.code, "browser_launch_failed");
        assert!(body.error.contains("server's browser runtime"));
    }
}
