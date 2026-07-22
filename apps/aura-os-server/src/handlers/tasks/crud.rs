use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;

use aura_os_core::{ProjectId, Spec, Task, TaskId, TaskStatus};
use aura_os_tasks::TaskService;

use super::common::storage_task_to_task;
use super::preflight::try_preflight_decompose_task;
use crate::dto::TransitionTaskRequest;
use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, AuthJwt};

const MANUAL_TASKS_SPEC_TITLE: &str = "Manual Tasks";

pub(crate) async fn transition_task(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, task_id)): Path<(ProjectId, TaskId)>,
    Json(req): Json<TransitionTaskRequest>,
) -> ApiResult<Json<Task>> {
    let storage = state.require_storage_client()?;
    // Capture the pre-transition status so the broadcast carries a
    // `{ from, to }` pair instead of just the destination — the UI
    // renders the badge as "in_progress -> done" only when both ends
    // are known. A failed lookup degrades gracefully: we still attempt
    // the transition, just without a `from` value on the event.
    let prev_status = storage
        .get_task(&task_id.to_string(), &jwt)
        .await
        .ok()
        .and_then(|t| storage_task_to_task(t).ok())
        .map(|t| t.status);
    let task = aura_os_tasks::safe_transition(storage, &jwt, &task_id.to_string(), req.new_status)
        .await
        .map_err(|e| match &e {
            aura_os_tasks::TaskError::Storage(aura_os_storage::StorageError::Server {
                status: 404,
                ..
            }) => ApiError::not_found("task not found"),
            aura_os_tasks::TaskError::Storage(aura_os_storage::StorageError::Server {
                status: 400,
                body,
            }) => ApiError::bad_request(body.clone()),
            aura_os_tasks::TaskError::IllegalTransition { .. } => {
                ApiError::bad_request(format!("transitioning task: {e}"))
            }
            _ => ApiError::internal(format!("transitioning task: {e}")),
        })?;
    let task_project_id = task.project_id;
    broadcast_task_updated(
        &state,
        &task_project_id,
        &task,
        &["status"],
        prev_status.map(|from| (from, task.status)),
    );
    clear_loop_task_pointer_if_terminal(&state, task_project_id, task_id, task.status);
    // Best-effort: a fix task created from an admin bug report carries a
    // back-link on the report record; when it lands on `Done` we mark the
    // report resolved and flip any associated feedback post to `done`.
    // Runs here so harness-driven completions (which complete via this
    // handler) trigger it too. Never unwinds the transition.
    if task.status == TaskStatus::Done {
        if let Err(error) =
            super::promote_unblocked_after_completion(&state, &jwt, task_project_id, task_id).await
        {
            tracing::warn!(%task_id, %error, "failed to promote newly-unblocked tasks");
        }
        crate::handlers::bug_reports::resolve_linked_bug_report_on_done(
            &state,
            &jwt,
            &task_id.to_string(),
        )
        .await;
    }
    Ok(Json(task))
}

pub(crate) async fn retry_task(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((project_id, task_id)): Path<(ProjectId, TaskId)>,
) -> ApiResult<Json<Task>> {
    let storage = state.require_storage_client()?;
    let prev_status = storage
        .get_task(&task_id.to_string(), &jwt)
        .await
        .ok()
        .and_then(|t| storage_task_to_task(t).ok())
        .map(|t| t.status);
    let task =
        aura_os_tasks::safe_transition(storage, &jwt, &task_id.to_string(), TaskStatus::Ready)
            .await
            .map_err(|e| match &e {
                aura_os_tasks::TaskError::Storage(aura_os_storage::StorageError::Server {
                    status: 404,
                    ..
                }) => ApiError::not_found("task not found"),
                aura_os_tasks::TaskError::Storage(aura_os_storage::StorageError::Server {
                    status: 400,
                    body,
                }) => ApiError::bad_request(body.clone()),
                aura_os_tasks::TaskError::IllegalTransition { .. } => {
                    ApiError::bad_request(format!("retrying task: {e}"))
                }
                _ => ApiError::internal(format!("retrying task: {e}")),
            })?;
    broadcast_task_updated(
        &state,
        &project_id,
        &task,
        &["status"],
        prev_status.map(|from| (from, task.status)),
    );
    Ok(Json(task))
}

/// User-initiated "Re-do" of a previously completed task. Mirrors
/// [`retry_task`] but drives `Done -> Ready` (the dedicated re-do edge
/// — see [`aura_os_tasks::transition`]) and additionally clears the
/// persisted `attempts` counter so the dev-loop's auto-retry ladder
/// (`MAX_TASK_ATTEMPTS`) starts fresh on the next run.
///
/// Re-do diverges from retry on two axes:
/// 1. Retry is the failure-recovery path (`Failed -> Ready`); it
///    preserves `attempts` because the retry budget guards against
///    infinite re-runs of a still-broken task. Re-do is explicitly
///    user-driven, so it resets that counter.
/// 2. Retry is also called automatically by
///    `streaming::side_effects::retry::maybe_apply_task_level_retry`
///    on every retryable `task_failed`. Re-do has no auto-caller; it
///    is only reachable through this handler.
pub(crate) async fn redo_task(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((project_id, task_id)): Path<(ProjectId, TaskId)>,
) -> ApiResult<Json<Task>> {
    let storage = state.require_storage_client()?;
    let prev_status = storage
        .get_task(&task_id.to_string(), &jwt)
        .await
        .ok()
        .and_then(|t| storage_task_to_task(t).ok())
        .map(|t| t.status);
    let task =
        aura_os_tasks::safe_transition(storage, &jwt, &task_id.to_string(), TaskStatus::Ready)
            .await
            .map_err(|e| match &e {
                aura_os_tasks::TaskError::Storage(aura_os_storage::StorageError::Server {
                    status: 404,
                    ..
                }) => ApiError::not_found("task not found"),
                aura_os_tasks::TaskError::Storage(aura_os_storage::StorageError::Server {
                    status: 400,
                    body,
                }) => ApiError::bad_request(body.clone()),
                aura_os_tasks::TaskError::IllegalTransition { .. } => {
                    ApiError::bad_request(format!("redoing task: {e}"))
                }
                _ => ApiError::internal(format!("redoing task: {e}")),
            })?;
    broadcast_task_updated(
        &state,
        &project_id,
        &task,
        &["status"],
        prev_status.map(|from| (from, task.status)),
    );

    // Reset the retry counter so a re-do that subsequently fails gets
    // its full `MAX_TASK_ATTEMPTS` budget, instead of inheriting
    // whatever was burned during the original run. Best-effort: a
    // transient storage error here would leave the task Ready but with
    // a stale counter, which still produces the user-visible re-do
    // behavior — log and continue rather than unwinding the transition.
    if let Err(e) = storage
        .update_task(
            &task_id.to_string(),
            &jwt,
            &aura_os_storage::UpdateTaskRequest {
                attempts: Some(0),
                ..Default::default()
            },
        )
        .await
    {
        tracing::warn!(
            task_id = %task_id,
            error = %e,
            "redo_task: failed to reset attempts counter; task is Ready but retries inherit prior count"
        );
    } else {
        // Best-effort follow-up broadcast for the `attempts` reset so
        // the timeline picks up the non-status field change too. Skip
        // when the storage write above failed (no actual change to
        // surface).
        broadcast_task_updated(&state, &project_id, &task, &["attempts"], None);
    }

    Ok(Json(task))
}

// Accept both camelCase and snake_case bodies so the frontend (snake_case)
// AND the harness's `HttpDomainApi::create_task` (camelCase, plus the legacy
// `dependencyTaskIds` name) deserialize cleanly. Without this, harness POSTs
// landed as 422 "missing field `spec_id`", which the harness wrapped in
// `domain_ok({"ok":false,"error":"HTTP 422: ..."})` — an `is_error=false`
// soft failure that the LLM read as "the task didn't save, try again", looping
// `create_task` ↔ `list_tasks` until the wall-clock deadline. The surface
// symptom was `[preflight] FAIL extract_tasks ... 0 tasks` after a 95s spin.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateTaskBody {
    pub title: String,
    #[serde(alias = "spec_id")]
    pub spec_id: Option<String>,
    pub description: Option<String>,
    pub status: Option<String>,
    #[serde(alias = "order_index")]
    pub order_index: Option<i32>,
    #[serde(alias = "dependency_ids", alias = "dependencyTaskIds")]
    pub dependency_ids: Option<Vec<String>>,
    #[serde(alias = "assigned_agent_instance_id")]
    pub assigned_agent_instance_id: Option<String>,
    #[serde(default, alias = "skip_auto_decompose")]
    pub skip_auto_decompose: bool,
}

pub(crate) async fn create_task(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path(project_id): Path<ProjectId>,
    Json(req): Json<CreateTaskBody>,
) -> ApiResult<Json<Task>> {
    let storage = state.require_storage_client()?;
    let skip_auto_decompose = req.skip_auto_decompose;
    let detection_title = req.title.clone();
    let detection_description = req.description.clone().unwrap_or_default();
    let norm_title = req.title.trim().to_lowercase();
    let spec_id =
        resolve_create_task_spec_id(storage, &state, &jwt, &project_id, req.spec_id).await?;
    let order_index =
        resolve_create_task_order_index(storage, &jwt, &project_id, &spec_id, req.order_index)
            .await;

    if !norm_title.is_empty() {
        match storage.list_tasks(&project_id.to_string(), &jwt).await {
            Ok(existing) => {
                if let Some(dup) = existing.into_iter().find(|t| {
                    t.spec_id.as_deref() == Some(spec_id.as_str())
                        && t.title
                            .as_deref()
                            .map(|title| title.trim().to_lowercase() == norm_title)
                            .unwrap_or(false)
                }) {
                    let mut task = storage_task_to_task(dup).map_err(ApiError::internal)?;
                    task.skip_auto_decompose = skip_auto_decompose;
                    broadcast_task_saved(&state, &project_id, &task);
                    return Ok(Json(task));
                }
            }
            Err(e) => tracing::warn!(
                %project_id,
                %e,
                "create_task dedupe pre-check failed; proceeding to create"
            ),
        }
    }

    let created = storage
        .create_task(
            &project_id.to_string(),
            &jwt,
            &aura_os_storage::CreateTaskRequest {
                spec_id,
                title: req.title,
                org_id: None,
                description: req.description,
                status: Some(req.status.unwrap_or_else(|| "backlog".to_string())),
                order_index: Some(order_index),
                dependency_ids: req.dependency_ids,
                assigned_project_agent_id: req.assigned_agent_instance_id,
            },
        )
        .await
        .map_err(|e| ApiError::internal(format!("creating task: {e}")))?;
    let mut task = storage_task_to_task(created).map_err(ApiError::internal)?;
    task.skip_auto_decompose = skip_auto_decompose;
    broadcast_task_saved(&state, &project_id, &task);

    if let Err(error) = try_preflight_decompose_task(
        &state,
        &jwt,
        &project_id,
        &task,
        &detection_title,
        &detection_description,
        skip_auto_decompose,
    )
    .await
    {
        tracing::warn!(
            task_id = %task.task_id,
            %error,
            "Phase 5 preflight decomposition failed; parent task left intact"
        );
    }

    Ok(Json(task))
}

async fn resolve_create_task_spec_id(
    storage: &aura_os_storage::StorageClient,
    state: &AppState,
    jwt: &str,
    project_id: &ProjectId,
    requested: Option<String>,
) -> ApiResult<String> {
    if let Some(spec_id) = requested.map(|value| value.trim().to_string()) {
        if !spec_id.is_empty() {
            return Ok(spec_id);
        }
    }

    let specs = storage
        .list_specs(&project_id.to_string(), jwt)
        .await
        .map_err(|e| ApiError::internal(format!("listing specs for manual task: {e}")))?;

    if let Some(existing) = specs
        .iter()
        .find(|spec| spec.title.as_deref() == Some(MANUAL_TASKS_SPEC_TITLE))
    {
        return Ok(existing.id.clone());
    }

    let order_index = specs
        .iter()
        .filter_map(|spec| spec.order_index)
        .max()
        .map_or(0, |max| max + 1);
    let created = storage
        .create_spec(
            &project_id.to_string(),
            jwt,
            &aura_os_storage::CreateSpecRequest {
                title: MANUAL_TASKS_SPEC_TITLE.to_string(),
                org_id: None,
                order_index: Some(order_index),
                markdown_contents: Some("Tasks created directly from the Tasks board.".to_string()),
            },
        )
        .await
        .map_err(|e| ApiError::internal(format!("creating manual task spec: {e}")))?;
    let spec = Spec::try_from(created).map_err(ApiError::internal)?;
    let spec_id = spec.spec_id.to_string();
    let _ = state.event_broadcast.send(serde_json::json!({
        "type": "spec_saved",
        "project_id": project_id.to_string(),
        "spec": spec,
        "spec_id": spec_id.clone(),
    }));
    Ok(spec_id)
}

async fn resolve_create_task_order_index(
    storage: &aura_os_storage::StorageClient,
    jwt: &str,
    project_id: &ProjectId,
    spec_id: &str,
    requested: Option<i32>,
) -> i32 {
    if let Some(order_index) = requested {
        return order_index;
    }

    match storage.list_tasks(&project_id.to_string(), jwt).await {
        Ok(tasks) => tasks
            .into_iter()
            .filter(|task| task.spec_id.as_deref() == Some(spec_id))
            .filter_map(|task| task.order_index)
            .max()
            .map_or(0, |max| max.saturating_add(1)),
        Err(error) => {
            tracing::warn!(
                %project_id,
                %spec_id,
                %error,
                "create_task order_index fallback using zero after task list failed"
            );
            0
        }
    }
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateTaskBody {
    pub title: Option<String>,
    pub description: Option<String>,
    pub status: Option<String>,
    #[serde(alias = "order_index")]
    pub order_index: Option<i32>,
    #[serde(alias = "dependency_ids", alias = "dependencyTaskIds")]
    pub dependency_ids: Option<Vec<String>>,
    #[serde(alias = "assigned_agent_instance_id")]
    pub assigned_agent_instance_id: Option<String>,
}

pub(crate) async fn update_task(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, task_id)): Path<(ProjectId, TaskId)>,
    Json(req): Json<UpdateTaskBody>,
) -> ApiResult<Json<Task>> {
    let storage = state.require_storage_client()?;
    let current = storage
        .get_task(&task_id.to_string(), &jwt)
        .await
        .map_err(|e| match &e {
            aura_os_storage::StorageError::Server { status: 404, .. } => {
                ApiError::not_found("task not found")
            }
            _ => ApiError::internal(format!("fetching task for update: {e}")),
        })?;
    let current_task = storage_task_to_task(current).map_err(ApiError::internal)?;

    // Track which fields actually changed so the broadcast at the end
    // carries the precise set the activity-timeline `update_task`
    // block uses to render its summary slot ("title, description").
    // Status is tracked separately because it produces a dedicated
    // `transition_task` block via the `status_change` arm.
    let mut changed: Vec<&'static str> = Vec::new();
    if req.title.is_some() {
        changed.push("title");
    }
    if req.description.is_some() {
        changed.push("description");
    }
    if req.order_index.is_some() {
        changed.push("order_index");
    }
    if req.dependency_ids.is_some() {
        changed.push("dependency_ids");
    }
    if req.assigned_agent_instance_id.is_some() {
        changed.push("assigned_agent_instance_id");
    }
    let has_direct_updates = !changed.is_empty();
    if has_direct_updates {
        storage
            .update_task(
                &task_id.to_string(),
                &jwt,
                &aura_os_storage::UpdateTaskRequest {
                    title: req.title,
                    description: req.description,
                    order_index: req.order_index,
                    dependency_ids: req.dependency_ids,
                    assigned_project_agent_id: req.assigned_agent_instance_id,
                    ..Default::default()
                },
            )
            .await
            .map_err(storage_transition_error("updating task"))?;
    }

    let mut status_change: Option<(TaskStatus, TaskStatus)> = None;
    if let Some(status) = req.status {
        let parsed_status =
            serde_json::from_value::<TaskStatus>(serde_json::Value::String(status.clone()))
                .map_err(|e| {
                    ApiError::bad_request(format!("invalid task status '{status}': {e}"))
                })?;
        if parsed_status != current_task.status {
            TaskService::validate_transition(current_task.status, parsed_status)
                .map_err(|e| ApiError::bad_request(format!("validating task transition: {e}")))?;
            storage
                .transition_task(
                    &task_id.to_string(),
                    &jwt,
                    &aura_os_storage::TransitionTaskRequest { status },
                )
                .await
                .map_err(storage_transition_error("transitioning updated task"))?;
            status_change = Some((current_task.status, parsed_status));
        }
    }

    let updated = storage
        .get_task(&task_id.to_string(), &jwt)
        .await
        .map_err(|e| ApiError::internal(format!("fetching updated task: {e}")))?;
    let updated_task = storage_task_to_task(updated).map_err(ApiError::internal)?;
    // Emit two distinct events when both happened so the timeline
    // gets one `update_task` block (field diff) and one
    // `transition_task` block (status edge), instead of a single
    // hybrid block the renderer would have to disambiguate.
    let task_project_id = updated_task.project_id;
    if has_direct_updates {
        broadcast_task_updated(&state, &task_project_id, &updated_task, &changed, None);
    }
    if let Some(edge) = status_change {
        broadcast_task_updated(
            &state,
            &task_project_id,
            &updated_task,
            &["status"],
            Some(edge),
        );
        clear_loop_task_pointer_if_terminal(&state, task_project_id, task_id, edge.1);
        if edge.1 == TaskStatus::Done {
            if let Err(error) =
                super::promote_unblocked_after_completion(&state, &jwt, task_project_id, task_id)
                    .await
            {
                tracing::warn!(%task_id, %error, "failed to promote newly-unblocked tasks");
            }
        }
    }
    Ok(Json(updated_task))
}

pub(crate) async fn delete_task(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((_project_id, task_id)): Path<(ProjectId, TaskId)>,
) -> ApiResult<axum::http::StatusCode> {
    let storage = state.require_storage_client()?;
    storage
        .delete_task(&task_id.to_string(), &jwt)
        .await
        .map_err(|e| match &e {
            aura_os_storage::StorageError::Server { status: 404, .. } => {
                ApiError::not_found("task not found")
            }
            _ => ApiError::internal(format!("deleting task: {e}")),
        })?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// Release the dev-loop / single-task activity pointer the instant a
/// tool-driven transition marks a task terminal.
///
/// The harness completes a task by calling `transition_task` /
/// `update_task` (this module's handlers), which emit only a
/// `task_updated` status edge — never the harness `task_completed` /
/// `task_failed` lifecycle event that the dev-loop forwarder's
/// side-effects pipeline uses to call `LoopHandle::set_current_task(None)`
/// (see
/// `apps/aura-os-server/src/handlers/dev_loop/streaming/side_effects/dispatch.rs`).
/// Without this, the loop keeps advertising the finished task as its
/// `current_task_id`, so every per-task spinner / "Cooking" indicator
/// the frontend binds via `selectTaskActivity` stays lit until a manual
/// refresh re-hydrates `GET /api/loops`. Running it from the HTTP
/// handler covers both the dev loop and ad-hoc single-task runs, since
/// both drive completion through the same endpoints.
///
/// No-op for non-terminal transitions (e.g. retry/redo `-> Ready`) and
/// for tasks no live loop is currently bound to (the registry method
/// compare-and-clears by `task_id`).
fn clear_loop_task_pointer_if_terminal(
    state: &AppState,
    project_id: ProjectId,
    task_id: TaskId,
    new_status: TaskStatus,
) {
    if matches!(new_status, TaskStatus::Done | TaskStatus::Failed) {
        state.loop_registry.clear_current_task(project_id, task_id);
    }
}

pub(crate) fn broadcast_task_saved(state: &AppState, project_id: &ProjectId, task: &Task) {
    let _ = state.event_broadcast.send(serde_json::json!({
        "type": "task_saved",
        "project_id": project_id.to_string(),
        "task": task,
        "task_id": task.task_id.to_string(),
    }));
}

/// Broadcast a `task_updated` event so the live activity timeline can
/// inject a synthetic block per server-side field write.
///
/// Distinct from [`broadcast_task_saved`] which is create-only and
/// carries the full task row: `task_updated` is fire-on-every-edit
/// and ships a structured diff (`changed_fields`, optional
/// `{ from, to }` for status flips). The frontend
/// (`task-stream-bootstrap::handleTaskUpdated`) routes status
/// changes into a `transition_task` block and field changes into an
/// `update_task` block, both rendered through
/// `interface/src/components/Block/renderers/TaskBlock.tsx`.
///
/// `status_change` is `Some` when this update flipped the task's
/// status (so the receiving handler can dedupe against the lifecycle
/// `task_started` / `task_completed` / `task_failed` events that
/// `task-stream-bootstrap` already turns into transition blocks). A
/// `None` value means the broadcast covers only non-status fields.
pub(crate) fn broadcast_task_updated(
    state: &AppState,
    project_id: &ProjectId,
    task: &Task,
    changed_fields: &[&str],
    status_change: Option<(TaskStatus, TaskStatus)>,
) {
    let payload = build_task_updated_payload(project_id, task, changed_fields, status_change);
    let _ = state.event_broadcast.send(payload);
}

/// Pure JSON-shape builder split out of [`broadcast_task_updated`] so
/// the wire format can be unit-tested without standing up an
/// `AppState`. Mirrored by the frontend variant in
/// `interface/src/shared/types/aura-events/events-domain.ts`.
fn build_task_updated_payload(
    project_id: &ProjectId,
    task: &Task,
    changed_fields: &[&str],
    status_change: Option<(TaskStatus, TaskStatus)>,
) -> serde_json::Value {
    let mut payload = serde_json::json!({
        "type": "task_updated",
        "project_id": project_id.to_string(),
        "task_id": task.task_id.to_string(),
        "changed_fields": changed_fields,
    });
    if let Some((from, to)) = status_change {
        payload["status"] = serde_json::json!({ "from": from, "to": to });
    }
    payload
}

fn storage_transition_error(
    context: &'static str,
) -> impl FnOnce(aura_os_storage::StorageError) -> (axum::http::StatusCode, Json<ApiError>) {
    move |e| match &e {
        aura_os_storage::StorageError::Server { status: 404, .. } => {
            ApiError::not_found("task not found")
        }
        aura_os_storage::StorageError::Server { status: 400, body } => {
            ApiError::bad_request(body.clone())
        }
        _ => ApiError::internal(format!("{context}: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_bridge_planner_contract() {
        use aura_os_tasks::compute_bridge;

        assert_eq!(
            compute_bridge(TaskStatus::Ready, TaskStatus::Ready),
            Some(vec![])
        );
        assert_eq!(
            compute_bridge(TaskStatus::InProgress, TaskStatus::Ready),
            Some(vec![TaskStatus::Failed, TaskStatus::Ready])
        );
        assert_eq!(
            compute_bridge(TaskStatus::Failed, TaskStatus::Ready),
            Some(vec![TaskStatus::Ready])
        );
        assert_eq!(
            compute_bridge(TaskStatus::Blocked, TaskStatus::Ready),
            Some(vec![TaskStatus::Ready])
        );
        assert_eq!(
            compute_bridge(TaskStatus::Pending, TaskStatus::Ready),
            Some(vec![TaskStatus::Ready])
        );
        // `Done -> Ready` is the user-initiated re-do edge. It must
        // resolve to a single direct hop so the bridge planner does not
        // try to detour through `InProgress` (which is itself
        // unreachable from `Done`).
        assert_eq!(
            compute_bridge(TaskStatus::Done, TaskStatus::Ready),
            Some(vec![TaskStatus::Ready])
        );
    }

    /// Frontend (`interface/src/shared/api/tasks.ts`) and the server's own
    /// integration tests use snake_case bodies; this guards that path from
    /// regressing while we add camelCase support.
    #[test]
    fn create_task_body_accepts_snake_case() {
        let body: CreateTaskBody = serde_json::from_str(
            r#"{
                "title": "T",
                "spec_id": "s",
                "description": "d",
                "status": "backlog",
                "order_index": 3,
                "dependency_ids": ["a", "b"],
                "assigned_agent_instance_id": "ai",
                "skip_auto_decompose": true
            }"#,
        )
        .expect("snake_case body should deserialize");
        assert_eq!(body.title, "T");
        assert_eq!(body.spec_id.as_deref(), Some("s"));
        assert_eq!(body.description.as_deref(), Some("d"));
        assert_eq!(body.order_index, Some(3));
        assert_eq!(
            body.dependency_ids.as_deref(),
            Some(&["a".to_string(), "b".to_string()][..])
        );
        assert_eq!(body.assigned_agent_instance_id.as_deref(), Some("ai"));
        assert!(body.skip_auto_decompose);
    }

    /// Harness `HttpDomainApi::create_task` sends a camelCase body. We add
    /// `rename_all = "camelCase"` so it deserializes natively without round-
    /// tripping through aliases.
    #[test]
    fn create_task_body_accepts_canonical_camel_case() {
        let body: CreateTaskBody = serde_json::from_str(
            r#"{
                "title": "T",
                "specId": "s",
                "description": "d",
                "orderIndex": 3,
                "dependencyIds": ["a"],
                "assignedAgentInstanceId": "ai",
                "skipAutoDecompose": true
            }"#,
        )
        .expect("camelCase body should deserialize");
        assert_eq!(body.spec_id.as_deref(), Some("s"));
        assert_eq!(body.order_index, Some(3));
        assert_eq!(body.dependency_ids.as_deref(), Some(&["a".to_string()][..]));
        assert!(body.skip_auto_decompose);
    }

    /// The current harness build literally serializes `dependencyTaskIds`
    /// (its own legacy name from before the field was renamed to
    /// `dependency_ids` everywhere else). Without this alias every harness
    /// `create_task` 422'd with "missing field `spec_id`" because serde
    /// stopped at the first unknown key, the harness wrapped the failure in
    /// a soft `domain_ok` envelope, and the LLM looped until the deadline —
    /// the regression that surfaced as `extract_tasks ... 0 tasks`.
    #[test]
    fn create_task_body_accepts_legacy_dependency_task_ids_alias() {
        let body: CreateTaskBody = serde_json::from_str(
            r#"{
                "title": "T",
                "specId": "s",
                "description": "d",
                "dependencyTaskIds": ["a", "b"],
                "orderIndex": 0
            }"#,
        )
        .expect("dependencyTaskIds alias should deserialize");
        assert_eq!(body.spec_id.as_deref(), Some("s"));
        assert_eq!(
            body.dependency_ids.as_deref(),
            Some(&["a".to_string(), "b".to_string()][..])
        );
    }

    #[test]
    fn create_task_body_allows_missing_spec_id_for_manual_tasks() {
        let body: CreateTaskBody = serde_json::from_str(
            r#"{
                "title": "Manual task",
                "description": "Created from the task board",
                "status": "backlog"
            }"#,
        )
        .expect("manual task body should deserialize without a spec id");

        assert_eq!(body.title, "Manual task");
        assert_eq!(body.spec_id, None);
    }

    /// `task_updated` payload pins the wire shape consumed by the
    /// frontend's `handleTaskUpdated` handler. Status edges include a
    /// `status: { from, to }` object; non-status edits omit the key
    /// entirely (so the JS `e.content.status` check works as the
    /// dedupe trigger).
    #[test]
    fn task_updated_payload_includes_status_edge_when_provided() {
        use aura_os_core::{
            AgentInstanceId, ProjectId, SessionId, SpecId, Task, TaskId, TaskStatus,
        };
        use chrono::Utc;
        let _ = (AgentInstanceId::nil(), SessionId::nil());
        let project_id = ProjectId::nil();
        let task = Task {
            task_id: TaskId::nil(),
            project_id,
            spec_id: SpecId::nil(),
            title: "T".into(),
            description: String::new(),
            status: TaskStatus::Done,
            order_index: 0,
            dependency_ids: vec![],
            parent_task_id: None,
            skip_auto_decompose: false,
            assigned_agent_instance_id: None,
            completed_by_agent_instance_id: None,
            session_id: None,
            execution_notes: String::new(),
            files_changed: vec![],
            live_output: String::new(),
            build_steps: vec![],
            test_steps: vec![],
            user_id: None,
            model: None,
            total_input_tokens: 0,
            total_output_tokens: 0,
            attempts: 0,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        let payload = super::build_task_updated_payload(
            &project_id,
            &task,
            &["status"],
            Some((TaskStatus::InProgress, TaskStatus::Done)),
        );
        assert_eq!(payload["type"], "task_updated");
        assert_eq!(payload["task_id"], task.task_id.to_string());
        assert_eq!(payload["project_id"], project_id.to_string());
        assert_eq!(
            payload["changed_fields"],
            serde_json::json!(["status"]),
            "changed_fields must round-trip as a JSON array even for single-element diffs",
        );
        assert_eq!(payload["status"]["from"], "in_progress");
        assert_eq!(payload["status"]["to"], "done");
    }

    /// Non-status updates must NOT carry a `status` key — the
    /// frontend uses its presence as the dedupe signal against the
    /// lifecycle `task_started` / `task_completed` events. Adding it
    /// here would cause every `update_task` block (e.g. an
    /// `execution_notes` write) to be silently swallowed.
    #[test]
    fn task_updated_payload_omits_status_for_non_status_edits() {
        use aura_os_core::{ProjectId, SpecId, Task, TaskId, TaskStatus};
        use chrono::Utc;
        let project_id = ProjectId::nil();
        let task = Task {
            task_id: TaskId::nil(),
            project_id,
            spec_id: SpecId::nil(),
            title: "T".into(),
            description: String::new(),
            status: TaskStatus::Failed,
            order_index: 0,
            dependency_ids: vec![],
            parent_task_id: None,
            skip_auto_decompose: false,
            assigned_agent_instance_id: None,
            completed_by_agent_instance_id: None,
            session_id: None,
            execution_notes: "boom".into(),
            files_changed: vec![],
            live_output: String::new(),
            build_steps: vec![],
            test_steps: vec![],
            user_id: None,
            model: None,
            total_input_tokens: 0,
            total_output_tokens: 0,
            attempts: 1,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        let payload =
            super::build_task_updated_payload(&project_id, &task, &["execution_notes"], None);
        assert_eq!(payload["type"], "task_updated");
        assert_eq!(
            payload["changed_fields"],
            serde_json::json!(["execution_notes"])
        );
        assert!(
            payload.get("status").is_none(),
            "non-status edits must omit the `status` key, found: {payload}",
        );
    }

    #[test]
    fn update_task_body_accepts_snake_and_camel_case() {
        let snake: UpdateTaskBody = serde_json::from_str(
            r#"{
                "title": "T",
                "order_index": 1,
                "dependency_ids": ["a"],
                "assigned_agent_instance_id": "ai"
            }"#,
        )
        .expect("snake_case update body should deserialize");
        assert_eq!(snake.order_index, Some(1));
        assert_eq!(snake.assigned_agent_instance_id.as_deref(), Some("ai"));

        let camel: UpdateTaskBody = serde_json::from_str(
            r#"{
                "title": "T",
                "orderIndex": 2,
                "dependencyTaskIds": ["b"],
                "assignedAgentInstanceId": "ai2"
            }"#,
        )
        .expect("camelCase update body should deserialize");
        assert_eq!(camel.order_index, Some(2));
        assert_eq!(
            camel.dependency_ids.as_deref(),
            Some(&["b".to_string()][..])
        );
        assert_eq!(camel.assigned_agent_instance_id.as_deref(), Some("ai2"));
    }
}
