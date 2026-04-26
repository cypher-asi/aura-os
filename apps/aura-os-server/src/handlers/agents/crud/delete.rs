use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use futures_util::future::join_all;
use serde::Serialize;

use aura_os_core::AgentId;

use crate::capture_auth::{
    demo_agent_id, demo_agent_instance_id, demo_project, is_capture_access_token,
};
use crate::error::{map_network_error, map_storage_error, ApiError, ApiResult};
use crate::handlers::projects;
use crate::state::{AppState, AuthJwt};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct AgentProjectBinding {
    pub project_agent_id: String,
    pub project_id: String,
    pub project_name: String,
}

pub(crate) async fn delete_agent(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<Json<()>> {
    let client = state.require_network_client()?;

    if let Some(ref storage) = state.storage_client {
        let bindings = resolve_agent_project_bindings(&state, storage, &jwt, &agent_id).await?;
        if !bindings.is_empty() {
            return Err(agent_delete_conflict(&bindings));
        }
    }

    client
        .delete_agent(&agent_id.to_string(), &jwt)
        .await
        .map_err(map_network_error)?;
    let _ = state.agent_service.delete_agent_runtime_config(&agent_id);
    let _ = state.agent_service.delete_agent_shadow(&agent_id);
    Ok(Json(()))
}

pub(crate) async fn list_agent_project_bindings(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<Json<Vec<AgentProjectBinding>>> {
    if is_capture_access_token(&jwt) && agent_id == demo_agent_id() {
        let project = demo_project();
        return Ok(Json(vec![AgentProjectBinding {
            project_agent_id: demo_agent_instance_id().to_string(),
            project_id: project.project_id.to_string(),
            project_name: project.name,
        }]));
    }

    let storage = state.require_storage_client()?;
    let bindings = resolve_agent_project_bindings(&state, storage, &jwt, &agent_id).await?;
    Ok(Json(bindings))
}

pub(crate) async fn remove_agent_project_binding(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_agent_id, project_agent_id)): Path<(AgentId, String)>,
) -> ApiResult<Json<()>> {
    let storage = state.require_storage_client()?;
    storage
        .delete_project_agent(&project_agent_id, &jwt)
        .await
        .map_err(|e| ApiError::internal(format!("failed to remove binding: {e}")))?;
    Ok(Json(()))
}

async fn resolve_agent_project_bindings(
    state: &AppState,
    storage: &aura_os_storage::StorageClient,
    jwt: &str,
    agent_id: &AgentId,
) -> ApiResult<Vec<AgentProjectBinding>> {
    let all_projects = projects::list_all_projects_from_network(state, jwt).await?;
    let agent_id_str = agent_id.to_string();
    let project_ids: Vec<String> = all_projects
        .iter()
        .map(|project| project.project_id.to_string())
        .collect();
    let requests: Vec<_> = project_ids
        .iter()
        .map(|project_id| storage.list_project_agents(project_id, jwt))
        .collect();
    let results = join_all(requests).await;

    let mut bindings = Vec::new();
    for (result, project) in results.into_iter().zip(all_projects.iter()) {
        let agents = result.map_err(map_storage_error)?;
        bindings.extend(
            agents
                .into_iter()
                .filter(|project_agent| project_agent.agent_id.as_deref() == Some(&agent_id_str))
                .map(|project_agent| AgentProjectBinding {
                    project_agent_id: project_agent.id,
                    project_id: project.project_id.to_string(),
                    project_name: project.name.clone(),
                }),
        );
    }

    Ok(bindings)
}

fn format_agent_binding_details(bindings: &[AgentProjectBinding]) -> Option<String> {
    let mut project_names: Vec<&str> = bindings
        .iter()
        .map(|binding| binding.project_name.trim())
        .filter(|name| !name.is_empty())
        .collect();
    project_names.sort_unstable();
    project_names.dedup();

    if project_names.is_empty() {
        return None;
    }

    let preview = project_names.iter().take(3).copied().collect::<Vec<_>>();
    let remaining = project_names.len().saturating_sub(preview.len());
    let suffix = if remaining > 0 {
        format!(" and {remaining} more")
    } else {
        String::new()
    };

    Some(format!("Still added to: {}{}.", preview.join(", "), suffix))
}

fn agent_delete_conflict(bindings: &[AgentProjectBinding]) -> (StatusCode, Json<ApiError>) {
    (
        StatusCode::CONFLICT,
        Json(ApiError {
            error: "Cannot delete agent while it is added to projects. Remove it from all projects first.".to_string(),
            code: "conflict".to_string(),
            details: format_agent_binding_details(bindings),
            data: None,
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::{format_agent_binding_details, AgentProjectBinding};

    #[test]
    fn binding_details_list_unique_project_names() {
        let details = format_agent_binding_details(&[
            AgentProjectBinding {
                project_agent_id: "pa-1".to_string(),
                project_id: "p-1".to_string(),
                project_name: "General".to_string(),
            },
            AgentProjectBinding {
                project_agent_id: "pa-2".to_string(),
                project_id: "p-2".to_string(),
                project_name: "General".to_string(),
            },
            AgentProjectBinding {
                project_agent_id: "pa-3".to_string(),
                project_id: "p-3".to_string(),
                project_name: "Workspace".to_string(),
            },
        ]);

        assert_eq!(
            details.as_deref(),
            Some("Still added to: General, Workspace.")
        );
    }

    #[test]
    fn binding_details_summarize_long_project_lists() {
        let details = format_agent_binding_details(&[
            AgentProjectBinding {
                project_agent_id: "pa-1".to_string(),
                project_id: "p-1".to_string(),
                project_name: "Alpha".to_string(),
            },
            AgentProjectBinding {
                project_agent_id: "pa-2".to_string(),
                project_id: "p-2".to_string(),
                project_name: "Beta".to_string(),
            },
            AgentProjectBinding {
                project_agent_id: "pa-3".to_string(),
                project_id: "p-3".to_string(),
                project_name: "Gamma".to_string(),
            },
            AgentProjectBinding {
                project_agent_id: "pa-4".to_string(),
                project_id: "p-4".to_string(),
                project_name: "Delta".to_string(),
            },
        ]);

        assert_eq!(
            details.as_deref(),
            Some("Still added to: Alpha, Beta, Delta and 1 more.")
        );
    }
}
