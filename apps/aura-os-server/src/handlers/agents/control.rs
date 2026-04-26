use axum::extract::{Path, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use aura_os_core::{Agent, AgentId, HarnessMode};

use crate::error::{ApiError, ApiResult};
use crate::handlers::agents::chat::find_matching_project_agents;
use crate::state::{AppState, AuthJwt};

#[derive(Debug, Deserialize)]
pub(crate) struct DelegateAgentTaskRequest {
    pub task: String,
    #[serde(default)]
    pub context: Option<Value>,
}

#[derive(Debug, Serialize)]
pub(crate) struct DelegateAgentTaskResponse {
    pub target_agent_id: String,
    pub delegated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_agent_id: Option<String>,
    pub notification_required: bool,
}

#[derive(Debug, Serialize)]
pub(crate) struct AgentStateSnapshotResponse {
    pub agent: Agent,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_state: Option<Value>,
    #[serde(default)]
    pub project_bindings: Vec<aura_os_storage::StorageProjectAgent>,
    #[serde(default)]
    pub sessions: Vec<aura_os_storage::StorageSession>,
}

pub(crate) async fn delegate_agent_task(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
    Json(req): Json<DelegateAgentTaskRequest>,
) -> ApiResult<Json<DelegateAgentTaskResponse>> {
    let storage = state.require_storage_client()?;
    let agent_id_str = agent_id.to_string();
    let bindings = find_matching_project_agents(&state, &storage, &jwt, &agent_id_str).await;
    let preferred_project_id = req
        .context
        .as_ref()
        .and_then(|ctx| ctx.get("project_id").or_else(|| ctx.get("projectId")))
        .and_then(Value::as_str);
    let binding = bindings
        .iter()
        .find(|binding| {
            preferred_project_id
                .map(|pid| binding.project_id.as_deref() == Some(pid))
                .unwrap_or(false)
        })
        .or_else(|| bindings.first());

    let (project_id, project_agent_id) = match binding {
        Some(binding) => (
            binding.project_id.clone().filter(|pid| !pid.is_empty()),
            Some(binding.id.clone()),
        ),
        None => (None, None),
    };

    let mut task_id = None;
    if let (Some(project_id), Some(project_agent_id), Some(spec_id)) = (
        project_id.as_ref(),
        project_agent_id.as_ref(),
        req.context
            .as_ref()
            .and_then(|ctx| ctx.get("spec_id").or_else(|| ctx.get("specId")))
            .and_then(Value::as_str),
    ) {
        let created = storage
            .create_task(
                project_id,
                &jwt,
                &aura_os_storage::CreateTaskRequest {
                    spec_id: spec_id.to_string(),
                    title: task_title(&req.task),
                    org_id: None,
                    description: Some(req.task.clone()),
                    status: Some("backlog".to_string()),
                    order_index: None,
                    dependency_ids: None,
                    assigned_project_agent_id: Some(project_agent_id.clone()),
                },
            )
            .await
            .map_err(|e| ApiError::internal(format!("creating delegated task: {e}")))?;
        task_id = Some(created.id);
    }

    Ok(Json(DelegateAgentTaskResponse {
        target_agent_id: agent_id_str,
        delegated: true,
        task_id,
        project_id,
        project_agent_id,
        // The harness sends the chat notification after this product-side
        // persistence step so target-agent delivery keeps using one code path.
        notification_required: true,
    }))
}

pub(crate) async fn get_agent_state_snapshot(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(agent_id): Path<AgentId>,
) -> ApiResult<Json<AgentStateSnapshotResponse>> {
    let agent = resolve_agent(&state, &jwt, &agent_id).await?;
    let mut project_bindings = Vec::new();
    let mut sessions = Vec::new();
    if let Some(storage) = state.storage_client.as_ref() {
        project_bindings =
            find_matching_project_agents(&state, storage, &jwt, &agent_id.to_string()).await;
        for binding in &project_bindings {
            match storage.list_sessions(&binding.id, &jwt).await {
                Ok(mut listed) => sessions.append(&mut listed),
                Err(e) => tracing::warn!(
                    project_agent_id = %binding.id,
                    error = %e,
                    "agent state snapshot: failed to list sessions"
                ),
            }
        }
    }

    let remote_state = if agent.harness_mode() == HarnessMode::Swarm {
        fetch_remote_state_value(&state, &jwt, &agent_id.to_string()).await
    } else {
        None
    };

    Ok(Json(AgentStateSnapshotResponse {
        agent,
        remote_state,
        project_bindings,
        sessions,
    }))
}

async fn resolve_agent(state: &AppState, jwt: &str, agent_id: &AgentId) -> ApiResult<Agent> {
    match state.agent_service.get_agent_with_jwt(jwt, agent_id).await {
        Ok(agent) => Ok(agent),
        Err(aura_os_agents::AgentError::NotFound) => state
            .agent_service
            .get_agent_local(agent_id)
            .map_err(|_| ApiError::not_found("agent not found")),
        Err(e) => Err(ApiError::internal(format!("fetching agent: {e}"))),
    }
}

async fn fetch_remote_state_value(state: &AppState, jwt: &str, agent_id: &str) -> Option<Value> {
    let base_url = state.swarm_base_url.as_deref()?;
    let network = state.network_client.as_ref()?;
    let url = format!("{}/v1/agents/{}/state", base_url, agent_id);
    let resp = network
        .http_client()
        .get(url)
        .header("Authorization", format!("Bearer {jwt}"))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.json::<Value>().await.ok()
}

fn task_title(task: &str) -> String {
    const MAX_TITLE_CHARS: usize = 80;
    let trimmed = task.trim();
    if trimmed.chars().count() <= MAX_TITLE_CHARS {
        return trimmed.to_string();
    }
    let mut title: String = trimmed.chars().take(MAX_TITLE_CHARS).collect();
    title.push_str("...");
    title
}
