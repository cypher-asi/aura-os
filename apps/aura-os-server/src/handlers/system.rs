use axum::Json;
use serde::Serialize;

use crate::error::ApiResult;

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
