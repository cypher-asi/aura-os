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
use aura_os_core::ProjectId;

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
    if !state.browser_manager.is_owned_by(session_id, &session.user_id) {
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

async fn ensure_project_access(state: &AppState, jwt: &str, project_id: &ProjectId) -> ApiResult<()> {
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
            }),
        ),
        BrowserError::Timeout { .. } => (
            StatusCode::GATEWAY_TIMEOUT,
            Json(ApiError {
                error: err.to_string(),
                code: "timeout".to_string(),
                details: None,
            }),
        ),
        BrowserError::NotSupported(_) => (
            StatusCode::NOT_IMPLEMENTED,
            Json(ApiError {
                error: err.to_string(),
                code: "not_supported".to_string(),
                details: None,
            }),
        ),
        _ => {
            warn!(%err, "browser handler error");
            ApiError::internal(err.to_string())
        }
    }
}
