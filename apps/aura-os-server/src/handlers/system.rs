use axum::extract::State;
use axum::Json;
use serde::Serialize;

use crate::error::ApiResult;
use crate::state::AppState;

pub(crate) async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "timestamp": chrono::Utc::now().to_rfc3339()
    }))
}

#[derive(Debug, Serialize)]
pub(crate) struct EnvironmentInfoResponse {
    pub os: String,
    pub architecture: String,
    pub hostname: String,
    pub ip: String,
    pub cwd: String,
}

pub(crate) async fn get_environment_info() -> ApiResult<Json<EnvironmentInfoResponse>> {
    let hostname = hostname::get()
        .map(|h| h.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "unknown".into());

    let ip = local_ip_address::local_ip()
        .map(|addr| addr.to_string())
        .unwrap_or_else(|_| "127.0.0.1".into());

    let cwd = std::env::current_dir()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| "unknown".into());

    Ok(Json(EnvironmentInfoResponse {
        os: std::env::consts::OS.into(),
        architecture: std::env::consts::ARCH.into(),
        hostname,
        ip,
        cwd,
    }))
}

#[derive(Debug, Serialize)]
pub(crate) struct WorkspaceDefaultsResponse {
    /// Base directory where aura-os stores per-project workspaces by default.
    /// A specific project's default folder is `{workspace_root}/{project_id}`.
    pub workspace_root: String,
}

pub(crate) async fn get_workspace_defaults(
    State(state): State<AppState>,
) -> ApiResult<Json<WorkspaceDefaultsResponse>> {
    let workspace_root = state.data_dir.join("workspaces");
    Ok(Json(WorkspaceDefaultsResponse {
        workspace_root: workspace_root.display().to_string(),
    }))
}
