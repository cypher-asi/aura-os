use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use std::collections::HashMap;
use std::time::Duration;

use aura_os_core::{AgentInstanceId, HarnessMode, ProjectId, SpecId, Task};
use aura_os_harness::{HarnessInbound, HarnessOutbound, UserMessage};

use super::common::storage_task_to_task;
use crate::error::{ApiError, ApiResult};
use crate::handlers::agents::chat::errors::map_harness_error_to_api;
use crate::handlers::projects_helpers::{project_tool_deadline, project_tool_session_config};
use crate::state::{AppState, AuthJwt, AuthSession};

const TASK_RESULT_POLL_INTERVAL: Duration = Duration::from_millis(250);
const TASK_RESULT_POLL_TIMEOUT: Duration = Duration::from_secs(5);

fn task_extraction_tool_hints() -> Vec<String> {
    [
        "read_file",
        "list_files",
        "find_files",
        "search_code",
        "list_specs",
        "get_spec",
        "list_tasks",
        "create_task",
        "update_task",
    ]
    .into_iter()
    .map(str::to_string)
    .collect()
}

#[derive(Debug, Deserialize, Default)]
pub(crate) struct TaskQueryParams {
    pub agent_instance_id: Option<AgentInstanceId>,
}

async fn load_extracted_tasks(
    state: &AppState,
    project_id: &ProjectId,
    jwt: &str,
) -> ApiResult<Vec<Task>> {
    let storage = state.require_storage_client()?;
    let started_at = tokio::time::Instant::now();
    let mut tasks: Vec<Task> = loop {
        let storage_tasks = storage
            .list_tasks(&project_id.to_string(), jwt)
            .await
            .map_err(|e| ApiError::internal(format!("listing tasks: {e}")))?;
        let tasks: Vec<Task> = storage_tasks
            .into_iter()
            .filter_map(|s| storage_task_to_task(s).ok())
            .collect();
        if !tasks.is_empty() || started_at.elapsed() >= TASK_RESULT_POLL_TIMEOUT {
            break tasks;
        }
        tokio::time::sleep(TASK_RESULT_POLL_INTERVAL).await;
    };
    tasks.sort_by_key(|t| t.order_index);
    Ok(tasks)
}

fn tasks_changed_since(before: &[Task], after: &[Task]) -> bool {
    if before.len() != after.len() {
        return true;
    }

    let before_versions: HashMap<_, _> = before
        .iter()
        .map(|task| (task.task_id, task.updated_at))
        .collect();

    after.iter().any(|task| {
        before_versions
            .get(&task.task_id)
            .map_or(true, |updated_at| *updated_at != task.updated_at)
    })
}

fn task_extraction_prompt(project_id: impl std::fmt::Display) -> String {
    format!(
        "Extract tasks for project {project_id}. Review the existing specs, then create or update \
         the project's tasks until the task list is populated. This workflow is only for planning, \
         not execution: do not run commands, do not execute tasks, do not transition task states, \
         and do not mark tasks done/failed/blocked. Prefer actionable implementation tasks with \
         concrete source files or acceptance evidence. Task descriptions for implementation work \
         must tell the executor to briefly inspect, call `submit_plan` with the target files, and \
         only then use `write_file`, `edit_file`, or `delete_file`. Fold inspection or verification \
         into the implementation task when possible. Do not create a standalone verification-only \
         task unless it genuinely requires no source edits; if you do, its description must explicitly \
         tell the executor to call `task_done` with `no_changes_needed: true` and notes explaining why \
         no file changes are needed. Never call the `extract_tasks` tool from inside this workflow \
         because that would recursively restart task extraction. Use the spec and task CRUD/listing \
         tools directly instead."
    )
}

pub(crate) async fn list_tasks(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<ProjectId>,
) -> ApiResult<Json<Vec<Task>>> {
    let storage = state.require_storage_client()?;
    let storage_tasks = storage
        .list_tasks(&project_id.to_string(), &jwt)
        .await
        .map_err(|e| ApiError::internal(format!("listing tasks: {e}")))?;
    let mut tasks: Vec<Task> = storage_tasks
        .into_iter()
        .filter_map(|s| storage_task_to_task(s).ok())
        .collect();
    tasks.sort_by_key(|t| t.order_index);
    Ok(Json(tasks))
}

pub(crate) async fn list_tasks_by_spec(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((project_id, spec_id)): Path<(ProjectId, SpecId)>,
) -> ApiResult<Json<Vec<Task>>> {
    let storage = state.require_storage_client()?;
    let storage_tasks = storage
        .list_tasks(&project_id.to_string(), &jwt)
        .await
        .map_err(|e| ApiError::internal(format!("listing tasks by spec: {e}")))?;
    let mut tasks: Vec<Task> = storage_tasks
        .into_iter()
        .filter_map(|s| storage_task_to_task(s).ok())
        .filter(|t| t.spec_id == spec_id)
        .collect();
    tasks.sort_by_key(|t| t.order_index);
    Ok(Json(tasks))
}

pub(crate) async fn get_task(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, task_id)): Path<(ProjectId, aura_os_core::TaskId)>,
) -> ApiResult<Json<Task>> {
    let storage = state.require_storage_client()?;
    let storage_task =
        storage
            .get_task(&task_id.to_string(), &jwt)
            .await
            .map_err(|e| match &e {
                aura_os_storage::StorageError::Server { status: 404, .. } => {
                    ApiError::not_found("task not found")
                }
                _ => ApiError::internal(format!("fetching task: {e}")),
            })?;
    Ok(Json(
        storage_task_to_task(storage_task).map_err(ApiError::internal)?,
    ))
}

pub(crate) async fn extract_tasks(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    AuthSession(session): AuthSession,
    Path(project_id): Path<ProjectId>,
    Query(params): Query<TaskQueryParams>,
) -> ApiResult<Json<Vec<Task>>> {
    let baseline_tasks = load_extracted_tasks(&state, &project_id, &jwt).await?;
    let harness_mode = if let Some(aiid) = params.agent_instance_id {
        state
            .agent_instance_service
            .get_instance(&project_id, &aiid)
            .await
            .map_err(|e| match e {
                aura_os_agents::AgentError::NotFound => {
                    ApiError::not_found(format!("agent instance {aiid} not found"))
                }
                other => ApiError::internal(format!("looking up agent instance {aiid}: {other}")),
            })?
            .harness_mode()
    } else {
        HarnessMode::Local
    };
    let harness = state.harness_for(harness_mode);
    let session_config = project_tool_session_config(
        &state,
        &project_id,
        "task-extract",
        harness_mode,
        params.agent_instance_id,
        &jwt,
        Some(&session.user_id),
    )
    .await?;
    let session = harness.open_session(session_config).await.map_err(|e| {
        map_harness_error_to_api(&e, state.harness_ws_slots, |err| {
            ApiError::internal(format!("opening task extraction session: {err}"))
        })
    })?;

    session
        .commands_tx
        .try_send(HarnessInbound::UserMessage(UserMessage {
            content: task_extraction_prompt(&project_id),
            tool_hints: Some(task_extraction_tool_hints()),
            attachments: None,
        }))
        .map_err(|e| ApiError::internal(format!("sending task extract command: {e}")))?;

    let mut rx = session.events_tx.subscribe();
    let deadline = project_tool_deadline();
    let extraction_loop = async {
        while let Ok(event) = rx.recv().await {
            match event {
                HarnessOutbound::AssistantMessageEnd(_) => return ExtractionOutcome::Completed,
                HarnessOutbound::Error(err) => return ExtractionOutcome::HarnessError(err.message),
                _ => continue,
            }
        }
        ExtractionOutcome::StreamEnded
    };

    match tokio::time::timeout(deadline, extraction_loop).await {
        Ok(ExtractionOutcome::Completed) => {
            let tasks = load_extracted_tasks(&state, &project_id, &jwt).await?;
            if tasks_changed_since(&baseline_tasks, &tasks) || !tasks.is_empty() {
                Ok(Json(tasks))
            } else {
                Err(ApiError::internal(
                    "task extraction completed without creating tasks; check harness logs for the model/tool error",
                ))
            }
        }
        Ok(ExtractionOutcome::HarnessError(message)) => {
            // Even on a harness error the LLM may have already populated
            // some tasks via tool calls before failing — surface those if
            // present so the caller doesn't lose partial progress.
            let tasks = load_extracted_tasks(&state, &project_id, &jwt).await?;
            if tasks_changed_since(&baseline_tasks, &tasks) {
                Ok(Json(tasks))
            } else {
                Err(ApiError::internal(message))
            }
        }
        Ok(ExtractionOutcome::StreamEnded) => Err(ApiError::internal(
            "task extraction stream ended without result",
        )),
        Err(_) => {
            // Wall-clock deadline exceeded — recover any tasks the LLM
            // managed to persist before the loop stalled, otherwise
            // surface a clear timeout error so the JS client doesn't
            // see Node's default `headersTimeout` as `fetch failed`.
            tracing::warn!(
                project_id = %project_id,
                deadline_secs = deadline.as_secs(),
                "task extraction deadline exceeded; returning best-effort task list"
            );
            let tasks = load_extracted_tasks(&state, &project_id, &jwt).await?;
            if tasks_changed_since(&baseline_tasks, &tasks) {
                Ok(Json(tasks))
            } else {
                Err(ApiError::internal(format!(
                    "task extraction exceeded {}s deadline without producing tasks",
                    deadline.as_secs()
                )))
            }
        }
    }
}

enum ExtractionOutcome {
    Completed,
    HarnessError(String),
    StreamEnded,
}

#[cfg(test)]
mod tests {
    use super::{task_extraction_prompt, task_extraction_tool_hints};

    #[test]
    fn task_extraction_prompt_guides_no_change_verification_tasks() {
        let prompt = task_extraction_prompt("project-123");

        assert!(prompt.contains("project project-123"));
        assert!(prompt.contains("Fold inspection or verification into the implementation task"));
        assert!(prompt.contains("call `submit_plan` with the target files"));
        assert!(prompt.contains("`write_file`, `edit_file`, or `delete_file`"));
        assert!(prompt.contains("standalone verification-only task"));
        assert!(prompt.contains("task_done"));
        assert!(prompt.contains("no_changes_needed: true"));
        assert!(prompt.contains("Never call the `extract_tasks` tool"));
    }

    #[test]
    fn task_extraction_tool_hints_scope_project_planning_surface() {
        let hints = task_extraction_tool_hints();

        assert!(hints.contains(&"read_file".to_string()));
        assert!(hints.contains(&"create_task".to_string()));
        assert!(!hints.contains(&"run_command".to_string()));
        assert!(!hints.contains(&"generate_image".to_string()));
    }
}
