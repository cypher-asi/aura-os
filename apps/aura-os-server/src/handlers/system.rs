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
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeCapabilitiesResponse {
    pub remote_only: bool,
    pub local_agent_runtime_available: bool,
    pub hosted_local_harness: bool,
}

pub(crate) async fn get_runtime_capabilities(
    State(state): State<AppState>,
) -> Json<RuntimeCapabilitiesResponse> {
    let hosted_local_harness = hosted_local_harness_configured();
    Json(RuntimeCapabilitiesResponse {
        remote_only: state.remote_only,
        local_agent_runtime_available: !state.remote_only && hosted_local_harness,
        hosted_local_harness,
    })
}

fn hosted_local_harness_configured() -> bool {
    hosted_local_harness_configured_from_env(std::env::var("LOCAL_HARNESS_URL").ok().as_deref())
}

fn hosted_local_harness_configured_from_env(raw: Option<&str>) -> bool {
    let Some(raw) = raw else {
        return false;
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return false;
    }
    let Ok(parsed) = url::Url::parse(trimmed) else {
        return false;
    };
    if !matches!(parsed.scheme(), "http" | "https") {
        return false;
    }
    match parsed.host_str() {
        Some(host) => {
            let normalized = host.trim_start_matches('[').trim_end_matches(']');
            !matches!(normalized, "127.0.0.1" | "::1")
                && !normalized.eq_ignore_ascii_case("localhost")
        }
        None => false,
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hosted_local_harness_requires_explicit_non_loopback_url() {
        assert!(hosted_local_harness_configured_from_env(Some(
            "https://aura-harness-latest.onrender.com",
        )));
    }

    #[test]
    fn hosted_local_harness_rejects_loopback_and_missing_urls() {
        assert!(!hosted_local_harness_configured_from_env(Some(
            "http://127.0.0.1:8080",
        )));
        assert!(!hosted_local_harness_configured_from_env(Some(
            "http://localhost:8080",
        )));
        assert!(!hosted_local_harness_configured_from_env(None));
    }
}
