//! Git checkpoint accounting: translate harness `git_committed` / `git_pushed` / `git_push_failed` / synthetic `git_commit_push` timeout events into the task-output cache's `sync_checkpoints` + `git_steps` so the dashboard sync banner reflects real progress.

use aura_os_core::ProjectId;

use super::common::{event_reason, parse_task_key};
use crate::state::{AppState, CachedTaskOutput};
use crate::sync_state::{
    checkpoint_from_git_step, derive_sync_state_from_checkpoints, TaskSyncCheckpoint,
};

pub(super) async fn record_git_checkpoint(
    state: &AppState,
    project_id: ProjectId,
    task_id: &str,
    event_type: &str,
    event: &serde_json::Value,
) {
    let mut step = event.clone();
    if let Some(object) = step.as_object_mut() {
        object
            .entry("type".to_string())
            .or_insert_with(|| event_type.to_string().into());
    }
    let Some(checkpoint) = checkpoint_from_git_step(&step) else {
        return;
    };
    record_sync_checkpoint(state, project_id, task_id, step, checkpoint).await;
}

pub(super) async fn record_git_commit_push_timeout(
    state: &AppState,
    project_id: ProjectId,
    task_id: &str,
    event: &serde_json::Value,
) {
    if !is_git_commit_push_timeout(event) {
        return;
    }
    let reason = event_reason(event).unwrap_or_else(|| "git_commit_push timed out".to_string());
    let Some(key) = parse_task_key(project_id, task_id) else {
        return;
    };

    let mut cache = state.task_output_cache.lock().await;
    let entry = cache.entry(key).or_default();
    let commit_sha = entry
        .sync_state
        .as_ref()
        .and_then(|state| state.last_commit_sha.clone())
        .or_else(|| {
            entry
                .sync_checkpoints
                .iter()
                .rev()
                .find_map(|checkpoint| checkpoint.commit_sha.clone())
        });
    let checkpoint = TaskSyncCheckpoint {
        kind: "git_push_failed".to_string(),
        phase: Some("push_failed".to_string()),
        commit_sha,
        reason: Some(reason.clone()),
        ..Default::default()
    };
    let step = serde_json::json!({
        "type": "git_push_failed",
        "commit_sha": checkpoint.commit_sha.clone(),
        "reason": reason,
    });
    record_sync_checkpoint_locked(entry, step, checkpoint);
}

async fn record_sync_checkpoint(
    state: &AppState,
    project_id: ProjectId,
    task_id: &str,
    step: serde_json::Value,
    checkpoint: TaskSyncCheckpoint,
) {
    let Some(key) = parse_task_key(project_id, task_id) else {
        return;
    };
    let mut cache = state.task_output_cache.lock().await;
    let entry = cache.entry(key).or_default();
    record_sync_checkpoint_locked(entry, step, checkpoint);
}

fn record_sync_checkpoint_locked(
    entry: &mut CachedTaskOutput,
    step: serde_json::Value,
    checkpoint: TaskSyncCheckpoint,
) {
    if !entry.sync_checkpoints.contains(&checkpoint) {
        entry.sync_checkpoints.push(checkpoint);
    }
    if !entry.git_steps.contains(&step) {
        entry.git_steps.push(step);
    }
    entry.sync_state = derive_sync_state_from_checkpoints(&entry.sync_checkpoints);
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
        && event_reason(event)
            .map(|reason| {
                let reason = reason.to_ascii_lowercase();
                reason.contains("timeout") || reason.contains("timed out")
            })
            .unwrap_or(false)
}
