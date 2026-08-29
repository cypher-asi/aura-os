//! Project-scoped file access for workspaces owned by a hosted local Harness.
//!
//! Web deployments run AURA OS and the local Harness in different filesystem
//! namespaces. The generic `/api/list-directory` endpoint therefore cannot
//! inspect the workspace that an agent actually edits. These handlers resolve
//! the authoritative Harness path and proxy only workspace-relative reads.

use std::path::{Component, Path as FsPath, PathBuf};

use aura_os_core::{AgentInstanceId, HarnessMode, ProjectId};
use axum::extract::{Path, Query, State};
use axum::http::{Method, StatusCode};
use axum::response::Response;
use serde::Deserialize;
use url::form_urlencoded;

use crate::error::{map_network_error, map_storage_error, ApiError, ApiResult};
use crate::handlers::projects_helpers::resolve_hosted_local_workspace_path;
use crate::state::{AppState, AuthJwt};

const HOSTED_FILE_TREE_DEPTH: &str = "20";

#[derive(Debug, Deserialize)]
pub(crate) struct HostedReadFileQuery {
    path: String,
}

fn validated_relative_path(raw: &str, allow_root: bool) -> Result<PathBuf, String> {
    let mut relative = PathBuf::new();
    for component in FsPath::new(raw).components() {
        match component {
            Component::Normal(part) => relative.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("file path must stay inside the agent workspace".to_string());
            }
        }
    }
    if relative.as_os_str().is_empty() && !allow_root {
        return Err("file path is required".to_string());
    }
    Ok(relative)
}

fn absolute_workspace_path(root: &str, relative: &FsPath) -> Result<String, String> {
    let root = root.trim();
    if root.is_empty() {
        return Err("hosted Harness returned an empty workspace path".to_string());
    }
    Ok(FsPath::new(root)
        .join(relative)
        .to_string_lossy()
        .into_owned())
}

fn encoded_query(path: &str, include_depth: bool) -> String {
    let mut query = form_urlencoded::Serializer::new(String::new());
    query.append_pair("path", path);
    if include_depth {
        query.append_pair("depth", HOSTED_FILE_TREE_DEPTH);
    }
    query.finish()
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
            .map_err(map_network_error)?;
        return Ok(());
    }
    state
        .project_service
        .get_project(project_id)
        .map(|_| ())
        .map_err(|error| match error {
            aura_os_projects::ProjectError::NotFound(_) => ApiError::not_found("project not found"),
            other => ApiError::internal(format!("fetching project: {other}")),
        })
}

async fn ensure_hosted_local_instance(
    state: &AppState,
    jwt: &str,
    project_id: &ProjectId,
    agent_instance_id: &AgentInstanceId,
) -> ApiResult<()> {
    if !state.harness_http.hosted_local_runtime_available() {
        return Err(ApiError::service_unavailable(
            "hosted agent workspace is not available",
        ));
    }

    ensure_project_access(state, jwt, project_id).await?;

    // Fetch with the caller's token first. Besides enforcing ownership at the
    // storage boundary, the explicit project-id comparison prevents a valid
    // instance UUID from being replayed under another project route.
    let storage = state.require_storage_client()?;
    let stored = storage
        .get_project_agent(&agent_instance_id.to_string(), jwt)
        .await
        .map_err(map_storage_error)?;
    let expected_project_id = project_id.to_string();
    if stored.project_id.as_deref() != Some(expected_project_id.as_str()) {
        return Err(ApiError::not_found("agent instance not found"));
    }

    let instance = state
        .agent_instance_service
        .get_instance(project_id, agent_instance_id)
        .await
        .map_err(|_| ApiError::not_found("agent instance not found"))?;
    if instance.project_id != *project_id || instance.harness_mode() != HarnessMode::Local {
        return Err(ApiError::bad_request(
            "agent instance does not use the hosted local workspace",
        ));
    }
    Ok(())
}

async fn hosted_workspace_root(state: &AppState, project_id: &ProjectId) -> ApiResult<String> {
    resolve_hosted_local_workspace_path(state, project_id)
        .await
        .map_err(|error| {
            ApiError::bad_gateway(format!(
                "resolving workspace from hosted local Harness: {error}"
            ))
        })?
        .ok_or_else(|| ApiError::service_unavailable("hosted agent workspace is not available"))
}

fn map_proxy_error(status: StatusCode) -> (StatusCode, axum::Json<ApiError>) {
    match status {
        StatusCode::BAD_REQUEST => ApiError::bad_request("invalid hosted workspace request"),
        StatusCode::SERVICE_UNAVAILABLE => {
            ApiError::service_unavailable("hosted agent workspace is not available")
        }
        _ => ApiError::bad_gateway("hosted agent workspace request failed"),
    }
}

pub(crate) async fn list_hosted_workspace_files(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
) -> ApiResult<Response> {
    ensure_hosted_local_instance(&state, &jwt, &project_id, &agent_instance_id).await?;
    let root = hosted_workspace_root(&state, &project_id).await?;
    let query = encoded_query(&root, true);
    state
        .harness_http
        .proxy_json(Method::GET, "api/files", Some(query), None)
        .await
        .map_err(map_proxy_error)
}

pub(crate) async fn read_hosted_workspace_file(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((project_id, agent_instance_id)): Path<(ProjectId, AgentInstanceId)>,
    Query(query): Query<HostedReadFileQuery>,
) -> ApiResult<Response> {
    ensure_hosted_local_instance(&state, &jwt, &project_id, &agent_instance_id).await?;
    let relative = validated_relative_path(&query.path, false).map_err(ApiError::bad_request)?;
    let root = hosted_workspace_root(&state, &project_id).await?;
    let absolute = absolute_workspace_path(&root, &relative).map_err(ApiError::bad_gateway)?;
    let query = encoded_query(&absolute, false);
    state
        .harness_http
        .proxy_json(Method::GET, "api/read-file", Some(query), None)
        .await
        .map_err(map_proxy_error)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_paths_cannot_escape_the_hosted_workspace() {
        assert!(validated_relative_path("src/index.ts", false).is_ok());
        assert!(validated_relative_path("./src/index.ts", false).is_ok());
        assert!(validated_relative_path("../secrets.txt", false).is_err());
        assert!(validated_relative_path("/etc/passwd", false).is_err());
        assert!(validated_relative_path("", false).is_err());
    }

    #[test]
    fn harness_queries_encode_paths_and_pin_a_bounded_depth() {
        let query = encoded_query("/workspace/a project", true);
        assert!(query.contains("path=%2Fworkspace%2Fa+project"));
        assert!(query.contains("depth=20"));
    }
}
