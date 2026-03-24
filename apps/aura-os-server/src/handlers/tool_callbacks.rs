// NOTE: When the harness has a DomainToolExecutor (INTERNAL_SERVICE_TOKEN set)
// and the session carries a JWT, domain tools (specs, tasks, project) are
// handled natively by the harness — it calls aura-storage directly with the
// user's JWT. These callback endpoints are only reached when the harness
// uses installed/external tools instead (e.g. no DomainToolExecutor configured).

use axum::extract::{Path, State};
use axum::Json;
use tracing::{info, warn};

use aura_os_core::{ProjectId, Spec, Task};

use crate::error::{map_storage_error, ApiError, ApiResult};
use crate::state::AppState;

pub(crate) async fn handle_tool_callback(
    State(state): State<AppState>,
    Path((project_id, tool_name)): Path<(ProjectId, String)>,
    Json(input): Json<serde_json::Value>,
) -> ApiResult<Json<serde_json::Value>> {
    info!(%project_id, %tool_name, "Tool callback received");

    let storage = state.require_storage_client()?;
    let jwt = state.get_jwt()?;
    let pid = project_id.to_string();

    match tool_name.as_str() {
        "get_project" => {
            let project = get_project_for_callback(&state, &project_id).await?;
            Ok(Json(serde_json::to_value(&project).unwrap_or_default()))
        }

        "update_project" => {
            let name = input.get("name").and_then(|v| v.as_str());
            let desc = input.get("description").and_then(|v| v.as_str());
            if let Some(client) = &state.network_client {
                let req = aura_os_network::UpdateProjectRequest {
                    name: name.map(|s| s.to_string()),
                    description: desc.map(|s| s.to_string()),
                    folder: None,
                    git_repo_url: None,
                    git_branch: None,
                    orbit_base_url: None,
                    orbit_owner: None,
                    orbit_repo: None,
                };
                client
                    .update_project(&pid, &jwt, &req)
                    .await
                    .map_err(|e| ApiError::internal(format!("updating project: {e}")))?;
            }
            Ok(Json(serde_json::json!({ "ok": true })))
        }

        "create_spec" => {
            let title = input.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled");
            let req = aura_os_storage::CreateSpecRequest {
                title: title.to_string(),
                org_id: None,
                order_index: input.get("order_index").and_then(|v| v.as_i64()).map(|v| v as i32),
                markdown_contents: input.get("markdown_contents").and_then(|v| v.as_str()).map(|s| s.to_string()),
            };
            let spec = storage
                .create_spec(&pid, &jwt, &req)
                .await
                .map_err(map_storage_error)?;
            let core_spec = Spec::try_from(spec)
                .map_err(|e| ApiError::internal(format!("converting spec: {e}")))?;
            Ok(Json(serde_json::to_value(&core_spec).unwrap_or_default()))
        }

        "list_specs" => {
            let specs = storage.list_specs(&pid, &jwt).await.map_err(map_storage_error)?;
            let core_specs: Vec<Spec> = specs.into_iter().filter_map(|s| Spec::try_from(s).ok()).collect();
            Ok(Json(serde_json::to_value(&core_specs).unwrap_or_default()))
        }

        "get_spec" => {
            let spec_id = input.get("spec_id").and_then(|v| v.as_str())
                .ok_or_else(|| ApiError::bad_request("spec_id is required"))?;
            let spec = storage.get_spec(spec_id, &jwt).await.map_err(map_storage_error)?;
            let core_spec = Spec::try_from(spec)
                .map_err(|e| ApiError::internal(format!("converting spec: {e}")))?;
            Ok(Json(serde_json::to_value(&core_spec).unwrap_or_default()))
        }

        "update_spec" => {
            let spec_id = input.get("spec_id").and_then(|v| v.as_str())
                .ok_or_else(|| ApiError::bad_request("spec_id is required"))?;
            let req = aura_os_storage::types::UpdateSpecRequest {
                title: input.get("title").and_then(|v| v.as_str()).map(|s| s.to_string()),
                markdown_contents: input.get("markdown_contents").and_then(|v| v.as_str()).map(|s| s.to_string()),
                order_index: input.get("order_index").and_then(|v| v.as_i64()).map(|v| v as i32),
            };
            storage.update_spec(spec_id, &jwt, &req).await.map_err(map_storage_error)?;
            Ok(Json(serde_json::json!({ "ok": true })))
        }

        "delete_spec" => {
            let spec_id = input.get("spec_id").and_then(|v| v.as_str())
                .ok_or_else(|| ApiError::bad_request("spec_id is required"))?;
            storage.delete_spec(spec_id, &jwt).await.map_err(map_storage_error)?;
            Ok(Json(serde_json::json!({ "deleted": spec_id })))
        }

        "create_task" => {
            let spec_id = input.get("spec_id").and_then(|v| v.as_str())
                .ok_or_else(|| ApiError::bad_request("spec_id is required"))?;
            let title = input.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled");
            let req = aura_os_storage::CreateTaskRequest {
                spec_id: spec_id.to_string(),
                title: title.to_string(),
                org_id: None,
                description: input.get("description").and_then(|v| v.as_str()).map(|s| s.to_string()),
                status: input.get("status").and_then(|v| v.as_str()).map(|s| s.to_string()),
                order_index: input.get("order_index").and_then(|v| v.as_i64()).map(|v| v as i32),
                dependency_ids: None,
            };
            let task = storage.create_task(&pid, &jwt, &req).await.map_err(map_storage_error)?;
            let core_task = Task::try_from(task)
                .map_err(|e| ApiError::internal(format!("converting task: {e}")))?;
            Ok(Json(serde_json::to_value(&core_task).unwrap_or_default()))
        }

        "list_tasks" => {
            let tasks = storage.list_tasks(&pid, &jwt).await.map_err(map_storage_error)?;
            let core_tasks: Vec<Task> = tasks.into_iter().filter_map(|t| Task::try_from(t).ok()).collect();
            Ok(Json(serde_json::to_value(&core_tasks).unwrap_or_default()))
        }

        "get_task" => {
            let task_id = input.get("task_id").and_then(|v| v.as_str())
                .ok_or_else(|| ApiError::bad_request("task_id is required"))?;
            let task = storage.get_task(task_id, &jwt).await.map_err(map_storage_error)?;
            let core_task = Task::try_from(task)
                .map_err(|e| ApiError::internal(format!("converting task: {e}")))?;
            Ok(Json(serde_json::to_value(&core_task).unwrap_or_default()))
        }

        "delete_task" => {
            let task_id = input.get("task_id").and_then(|v| v.as_str())
                .ok_or_else(|| ApiError::bad_request("task_id is required"))?;
            storage.delete_task(task_id, &jwt).await.map_err(map_storage_error)?;
            Ok(Json(serde_json::json!({ "deleted": task_id })))
        }

        other => {
            warn!(tool = %other, "Unknown tool callback");
            Err(ApiError::not_found(format!("unknown tool: {other}")))
        }
    }
}

async fn get_project_for_callback(
    state: &AppState,
    project_id: &ProjectId,
) -> ApiResult<aura_os_core::Project> {
    if let Some(client) = &state.network_client {
        let jwt = state.get_jwt()?;
        let net = client
            .get_project(&project_id.to_string(), &jwt)
            .await
            .map_err(|e| ApiError::internal(format!("fetching project: {e}")))?;
        let local = state.project_service.get_project(project_id).ok();
        super::projects_helpers::project_from_network(&net, local.as_ref())
    } else {
        state
            .project_service
            .get_project(project_id)
            .map_err(|e| ApiError::not_found(format!("project not found: {e}")))
    }
}
