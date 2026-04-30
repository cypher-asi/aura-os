use axum::extract::{Path, State};
use axum::Json;
use serde::Serialize;
use tracing::debug;

use aura_os_core::{ProjectId, TaskId};
use aura_os_harness::signals::HarnessSignal;

use crate::error::ApiResult;
use crate::reconciler::{decide_reconcile_action, ReconcileAction, ReconcileInputs};
use crate::state::{AppState, AuthJwt};
use crate::sync_state::{
    checkpoint_from_git_step, derive_checkpoint_summary, derive_recovery_point, derive_sync_state,
    derive_sync_state_from_checkpoints, TaskCheckpointSummary, TaskRecoveryPoint,
    TaskSyncCheckpoint, TaskSyncState,
};

#[derive(Serialize)]
pub(crate) struct TaskOutputResponse {
    pub output: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub build_steps: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub test_steps: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub git_steps: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync_state: Option<TaskSyncState>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub sync_checkpoints: Vec<TaskSyncCheckpoint>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checkpoints: Option<TaskCheckpointSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recovery_point: Option<TaskRecoveryPoint>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recommended_action: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub unavailable: bool,
}

fn has_task_output_content(response: &TaskOutputResponse) -> bool {
    !response.output.is_empty()
        || !response.build_steps.is_empty()
        || !response.test_steps.is_empty()
        || !response.git_steps.is_empty()
        || !response.sync_checkpoints.is_empty()
        || response.sync_state.is_some()
        || response.checkpoints.as_ref().is_some_and(|checkpoints| {
            checkpoints.execution_started
                || checkpoints.files_changed
                || checkpoints.verification_passed
                || checkpoints.commit_created
                || checkpoints.push_confirmed
                || checkpoints.push_failed
        })
        || response.recovery_point.is_some()
}

fn recommended_action_from_state(
    sync_state: Option<&TaskSyncState>,
    recovery_point: Option<&TaskRecoveryPoint>,
    latest_signal: Option<&HarnessSignal>,
    has_live_automaton: bool,
    has_test_pass_evidence: bool,
) -> Option<serde_json::Value> {
    let effective_state;
    let state_ref = match sync_state {
        Some(state) => state,
        None => {
            effective_state = TaskSyncState::default();
            &effective_state
        }
    };
    let mut inputs = ReconcileInputs::from_sync_state(state_ref);
    inputs.recovery_point = recovery_point;
    inputs.latest_signal = latest_signal;
    inputs.has_live_automaton = has_live_automaton;
    inputs.has_test_pass_evidence = has_test_pass_evidence;
    let action = decide_reconcile_action(&inputs);
    (!matches!(action, ReconcileAction::Noop)).then(|| action.to_json())
}

fn signal_targets(signal: &HarnessSignal, task_id: &str) -> bool {
    signal.task_id().map_or(true, |id| id == task_id)
}

fn signals_from_event(event: &aura_os_storage::StorageSessionEvent) -> Vec<HarnessSignal> {
    let Some(event_type) = event.event_type.as_deref() else {
        return Vec::new();
    };
    let Some(content) = event.content.as_ref() else {
        return Vec::new();
    };

    if event_type == "task_git_steps" {
        let parent_task_id = content.get("task_id").and_then(|value| value.as_str());
        return content
            .get("git_steps")
            .and_then(|steps| steps.as_array())
            .into_iter()
            .flatten()
            .filter_map(|step| {
                let mut step = step.clone();
                if let (Some(object), Some(task_id)) = (step.as_object_mut(), parent_task_id) {
                    object
                        .entry("task_id")
                        .or_insert_with(|| serde_json::Value::String(task_id.to_string()));
                }
                HarnessSignal::from_event_value(&step)
            })
            .collect();
    }

    HarnessSignal::from_event(event_type, content)
        .into_iter()
        .collect()
}

fn latest_signal_for_task(
    task_id_str: &str,
    events: &[aura_os_storage::StorageSessionEvent],
) -> Option<HarnessSignal> {
    events
        .iter()
        .rev()
        .flat_map(signals_from_event)
        .find(|signal| signal_targets(signal, task_id_str) && signal.failure_kind().is_some())
}

pub(crate) fn task_output_from_events(
    task_id_str: &str,
    events: &[aura_os_storage::StorageSessionEvent],
) -> Option<TaskOutputResponse> {
    let matches_task = |e: &&aura_os_storage::StorageSessionEvent, expected_type: &str| -> bool {
        e.event_type.as_deref() == Some(expected_type)
            && e.content
                .as_ref()
                .and_then(|c| c.get("task_id"))
                .and_then(|v| v.as_str())
                .is_some_and(|id| id == task_id_str)
    };

    let output = events
        .iter()
        .filter(|e| matches_task(e, "task_output"))
        .filter_map(|e| {
            e.content
                .as_ref()
                .and_then(|c| c.get("text"))
                .and_then(|v| v.as_str())
        })
        .collect::<Vec<_>>()
        .join("\n");

    let (mut build_steps, mut test_steps, mut git_steps) = (Vec::new(), Vec::new(), Vec::new());
    let (mut sync_state, mut sync_checkpoints, mut checkpoints, mut recovery_point) =
        (None, Vec::new(), None, None);
    for evt in events {
        if !matches_task(&evt, "task_steps") {
            if matches_task(&evt, "task_git_steps") {
                if let Some(gs) = evt
                    .content
                    .as_ref()
                    .and_then(|content| content.get("git_steps"))
                    .and_then(|steps| steps.as_array())
                {
                    git_steps = gs.clone();
                }
            }
            hydrate_checkpoint_state(
                &mut sync_state,
                &mut sync_checkpoints,
                &mut checkpoints,
                &mut recovery_point,
                task_id_str,
                evt,
            );
            continue;
        }
        if let Some(content) = evt.content.as_ref() {
            if let Some(bs) = content.get("build_steps").and_then(|v| v.as_array()) {
                build_steps = bs.clone();
            }
            if let Some(ts) = content.get("test_steps").and_then(|v| v.as_array()) {
                test_steps = ts.clone();
            }
        }
    }

    if output.is_empty()
        && build_steps.is_empty()
        && test_steps.is_empty()
        && git_steps.is_empty()
        && sync_state.is_none()
        && sync_checkpoints.is_empty()
        && checkpoints.is_none()
    {
        return None;
    }
    if sync_checkpoints.is_empty() && !git_steps.is_empty() {
        sync_checkpoints = git_steps
            .iter()
            .filter_map(checkpoint_from_git_step)
            .collect();
    }
    if sync_state.is_none() {
        sync_state = derive_sync_state_from_checkpoints(&sync_checkpoints)
            .or_else(|| Some(derive_sync_state(&git_steps)));
    }
    if checkpoints.is_none() {
        checkpoints = Some(derive_checkpoint_summary(
            !output.is_empty(),
            0,
            &build_steps,
            &test_steps,
            &git_steps,
        ));
    }
    if recovery_point.is_none() {
        recovery_point = sync_state.as_ref().and_then(derive_recovery_point);
    }

    let latest_signal = latest_signal_for_task(task_id_str, events);
    // Persisted-event reconstruction has no access to the live cache,
    // so test-pass evidence is implicitly absent here. The override
    // path runs from the streaming side-effects; this advisory render
    // path only needs to mirror the harness verdict for already-failed
    // tasks the user is inspecting.
    let recommended_action = recommended_action_from_state(
        sync_state.as_ref(),
        recovery_point.as_ref(),
        latest_signal.as_ref(),
        false,
        false,
    );
    let response = TaskOutputResponse {
        output,
        build_steps,
        test_steps,
        git_steps,
        sync_state,
        sync_checkpoints,
        checkpoints,
        recovery_point,
        recommended_action,
        unavailable: false,
    };
    has_task_output_content(&response).then_some(response)
}

fn hydrate_checkpoint_state(
    sync_state: &mut Option<TaskSyncState>,
    sync_checkpoints: &mut Vec<TaskSyncCheckpoint>,
    checkpoints: &mut Option<TaskCheckpointSummary>,
    recovery_point: &mut Option<TaskRecoveryPoint>,
    task_id: &str,
    evt: &aura_os_storage::StorageSessionEvent,
) {
    let matches_task = |expected_type: &str| -> bool {
        evt.event_type.as_deref() == Some(expected_type)
            && evt
                .content
                .as_ref()
                .and_then(|c| c.get("task_id"))
                .and_then(|v| v.as_str())
                .is_some_and(|id| id == task_id)
    };
    let Some(content) = evt.content.as_ref() else {
        return;
    };
    if matches_task("task_sync_checkpoint") {
        if let Some(checkpoint) = content
            .get("checkpoint")
            .cloned()
            .and_then(|value| serde_json::from_value(value).ok())
        {
            sync_checkpoints.push(checkpoint);
        }
    }
    if matches_task("task_sync_state") {
        *sync_state = content
            .get("sync_state")
            .cloned()
            .and_then(|value| serde_json::from_value(value).ok());
    }
    if matches_task("task_checkpoint_state") {
        *sync_state = content
            .get("sync_state")
            .cloned()
            .and_then(|value| serde_json::from_value(value).ok());
        *checkpoints = content
            .get("checkpoints")
            .cloned()
            .and_then(|value| serde_json::from_value(value).ok());
        *recovery_point = content
            .get("recovery_point")
            .cloned()
            .and_then(|value| serde_json::from_value(value).ok());
    }
    if matches!(
        evt.event_type.as_deref(),
        Some(
            "git_committed"
                | "commit_created"
                | "git_commit_failed"
                | "git_pushed"
                | "push_succeeded"
                | "git_push_failed"
                | "push_failed"
        )
    ) {
        let mut step = content.clone();
        if let Some(object) = step.as_object_mut() {
            if let Some(event_type) = evt.event_type.as_deref() {
                object
                    .entry("type")
                    .or_insert_with(|| serde_json::Value::String(event_type.to_string()));
            }
        }
        if let Some(checkpoint) = checkpoint_from_git_step(&step) {
            sync_checkpoints.push(checkpoint);
        }
    }
    if matches_task("tool_call_completed") && is_git_commit_push_timeout(content) {
        sync_checkpoints.push(TaskSyncCheckpoint {
            kind: "git_push_failed".to_string(),
            phase: Some("push_failed".to_string()),
            commit_sha: sync_checkpoints
                .iter()
                .rev()
                .find_map(|checkpoint| checkpoint.commit_sha.clone()),
            reason: event_reason(content),
            ..Default::default()
        });
    }
}

fn is_git_commit_push_timeout(event: &serde_json::Value) -> bool {
    event
        .get("is_error")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
        && event
            .get("name")
            .or_else(|| event.get("tool_name"))
            .and_then(|value| value.as_str())
            == Some("git_commit_push")
        && event_reason(event).is_some_and(|reason| {
            let reason = reason.to_ascii_lowercase();
            reason.contains("timeout") || reason.contains("timed out")
        })
}

fn event_reason(event: &serde_json::Value) -> Option<String> {
    ["reason", "message", "error", "result", "result_preview"]
        .into_iter()
        .find_map(|key| {
            event
                .get(key)
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
}

async fn fetch_task_output_from_storage(
    storage: &aura_os_storage::StorageClient,
    jwt: &str,
    task_id: &TaskId,
    cached_session_id: Option<&str>,
) -> Option<TaskOutputResponse> {
    let task = storage.get_task(&task_id.to_string(), jwt).await.ok()?;
    let session_id = match task
        .session_id
        .or_else(|| cached_session_id.map(String::from))
    {
        Some(sid) => sid,
        None => {
            debug!(%task_id, "Task has no session_id in storage; cannot fetch persisted output");
            return None;
        }
    };
    let events = storage
        .list_events(&session_id, jwt, None, None)
        .await
        .ok()?;

    let task_id_str = task_id.to_string();
    task_output_from_events(&task_id_str, &events).or_else(|| {
        debug!(
            %task_id, %session_id,
            total_events = events.len(),
            "Session has events but none matched this task_id or all were empty"
        );
        None
    })
}

pub(crate) async fn get_task_output(
    State(state): State<AppState>,
    AuthJwt(jwt): AuthJwt,
    Path((project_id, task_id)): Path<(ProjectId, TaskId)>,
) -> ApiResult<Json<TaskOutputResponse>> {
    let cached_session_id = {
        let cache = state.task_output_cache.lock().await;
        if let Some(entry) = cache.get(&(project_id, task_id)) {
            let sync_state = entry
                .sync_state
                .clone()
                .or_else(|| derive_sync_state_from_checkpoints(&entry.sync_checkpoints))
                .or_else(|| {
                    (!entry.git_steps.is_empty()).then(|| derive_sync_state(&entry.git_steps))
                });
            let recovery_point = sync_state.as_ref().and_then(derive_recovery_point);
            let has_test_pass_evidence = entry.test_pass_evidence.is_some();
            let recommended_action = recommended_action_from_state(
                sync_state.as_ref(),
                recovery_point.as_ref(),
                None,
                true,
                has_test_pass_evidence,
            );
            let response = TaskOutputResponse {
                output: entry.live_output.clone(),
                build_steps: entry.build_steps.clone(),
                test_steps: entry.test_steps.clone(),
                git_steps: entry.git_steps.clone(),
                sync_state: sync_state.clone(),
                sync_checkpoints: entry.sync_checkpoints.clone(),
                checkpoints: Some(derive_checkpoint_summary(
                    !entry.live_output.is_empty(),
                    entry.files_changed.len(),
                    &entry.build_steps,
                    &entry.test_steps,
                    &entry.git_steps,
                )),
                recovery_point,
                recommended_action,
                unavailable: false,
            };
            if has_task_output_content(&response) {
                return Ok(Json(response));
            }
            entry.session_id.clone()
        } else {
            None
        }
    };

    if let Some(storage) = state.storage_client.as_ref() {
        if let Some(resp) =
            fetch_task_output_from_storage(storage, &jwt, &task_id, cached_session_id.as_deref())
                .await
        {
            return Ok(Json(resp));
        }
    }

    Ok(Json(TaskOutputResponse {
        output: String::new(),
        build_steps: Vec::new(),
        test_steps: Vec::new(),
        git_steps: Vec::new(),
        sync_state: None,
        sync_checkpoints: Vec::new(),
        checkpoints: None,
        recovery_point: None,
        recommended_action: None,
        unavailable: true,
    }))
}

#[cfg(test)]
#[path = "output_tests.rs"]
mod output_tests;
