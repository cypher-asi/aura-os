use std::sync::Arc;

use tracing::{info, warn};

use aura_os_storage::StorageClient;

use crate::state::CachedTaskOutput;
use crate::sync_state::{derive_checkpoint_summary, derive_recovery_point, derive_sync_state};
use crate::sync_state::{TaskSyncCheckpoint, TaskSyncState};

// ---------------------------------------------------------------------------
// Log-worthy event filter
// ---------------------------------------------------------------------------

const LOG_WORTHY_TYPES: &[&str] = &[
    // Loop lifecycle
    "loop_started",
    "loop_paused",
    "loop_resumed",
    "loop_stopped",
    "loop_finished",
    "loop_iteration_summary",
    // Task lifecycle
    "task_started",
    "task_completed",
    "task_failed",
    "task_retrying",
    "task_became_ready",
    "tasks_became_ready",
    "follow_up_task_created",
    // File operations
    "file_ops_applied",
    // Session
    "session_rolled_over",
    "log_line",
    // Spec generation
    "spec_gen_started",
    "spec_gen_progress",
    "spec_gen_completed",
    "spec_gen_failed",
    "spec_saved",
    // Build verification
    "build_verification_skipped",
    "build_verification_started",
    "build_verification_passed",
    "build_verification_failed",
    "build_fix_attempt",
    // Test verification
    "test_verification_started",
    "test_verification_passed",
    "test_verification_failed",
    "test_fix_attempt",
    // Git
    "git_committed",
    "git_commit_rolled_back",
    "git_pushed",
    "git_push_failed",
    // Errors
    "error",
];

pub(crate) fn is_log_worthy(event_type: &str) -> bool {
    LOG_WORTHY_TYPES.contains(&event_type)
}

pub(crate) fn is_session_event_worthy(event_type: &str) -> bool {
    matches!(event_type, "assistant_message_end" | "token_usage")
}

fn log_level_for_event(event_type: &str) -> &'static str {
    match event_type {
        "task_failed" | "error" => "error",
        "build_verification_failed" | "test_verification_failed" => "warn",
        _ => "info",
    }
}

fn log_message_for_event(event: &serde_json::Value) -> String {
    let event_type = event
        .get("type")
        .and_then(|t| t.as_str())
        .unwrap_or("unknown");

    let task_id = event.get("task_id").and_then(|v| v.as_str());
    let task_title = event.get("task_title").and_then(|v| v.as_str());
    let label = task_title.or(task_id).unwrap_or("");

    match event_type {
        "loop_started" => "Dev loop started".to_string(),
        "loop_paused" => "Dev loop paused".to_string(),
        "loop_resumed" => "Dev loop resumed".to_string(),
        "loop_stopped" => "Dev loop stopped".to_string(),
        "loop_finished" => "Dev loop finished".to_string(),
        "task_started" => format!("Task started: {label}"),
        "task_completed" => format!("Task completed: {label}"),
        "task_failed" => {
            let reason = event
                .get("reason")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            format!("Task failed: {label} — {reason}")
        }
        "task_retrying" => format!("Task retrying: {label}"),
        "git_committed" => {
            let sha = event
                .get("commit_sha")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            format!("Git commit: {}", &sha[..sha.len().min(8)])
        }
        "git_commit_rolled_back" => {
            let sha = event
                .get("commit_sha")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let reason = event
                .get("reason")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            format!(
                "Git commit rolled back ({}): {reason}",
                &sha[..sha.len().min(8)]
            )
        }
        "git_pushed" => {
            let branch = event.get("branch").and_then(|v| v.as_str()).unwrap_or("");
            format!("Git push: {branch}")
        }
        "git_push_failed" => {
            let reason = event
                .get("reason")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            format!("Git push failed: {reason}")
        }
        "error" => {
            let msg = event
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            format!("Error: {msg}")
        }
        other => other.replace('_', " "),
    }
}

/// Persist a single domain event as a log entry in aura-storage.
/// Designed to be called from a fire-and-forget `tokio::spawn`.
pub(crate) async fn persist_log_event(
    storage: Option<&Arc<StorageClient>>,
    jwt: Option<&str>,
    project_id: &str,
    event: &serde_json::Value,
) {
    let (Some(storage), Some(jwt)) = (storage, jwt) else {
        return;
    };
    if project_id.is_empty() {
        return;
    }

    let event_type = event
        .get("type")
        .and_then(|t| t.as_str())
        .unwrap_or("unknown");

    let req = aura_os_storage::CreateLogEntryRequest {
        level: log_level_for_event(event_type).to_string(),
        message: log_message_for_event(event),
        org_id: None,
        metadata: Some(event.clone()),
    };

    if let Err(e) = storage.create_log_entry(project_id, jwt, &req).await {
        warn!(
            project_id,
            event_type,
            error = %e,
            "Failed to persist log event to storage"
        );
    }
}

/// Persist accumulated task output (live text + build/test steps) to
/// aura-storage as session events, and update the task record with
/// accumulated token counts. Called from `forward_automaton_events`
/// when a task completes or fails.
pub(crate) async fn persist_task_output(
    storage: Option<&Arc<StorageClient>>,
    jwt: Option<&str>,
    task_id: &str,
    cached: &CachedTaskOutput,
) {
    let (Some(storage), Some(jwt)) = (storage, jwt) else {
        return;
    };

    if cached.total_input_tokens > 0
        || cached.total_output_tokens > 0
        || !cached.files_changed.is_empty()
    {
        let req = aura_os_storage::UpdateTaskRequest {
            total_input_tokens: Some(cached.total_input_tokens),
            total_output_tokens: Some(cached.total_output_tokens),
            files_changed: (!cached.files_changed.is_empty())
                .then_some(cached.files_changed.clone()),
            ..Default::default()
        };
        if let Err(e) = storage.update_task(task_id, jwt, &req).await {
            warn!(task_id, error = %e, "Failed to persist task token usage");
        } else {
            info!(
                task_id,
                input_tokens = cached.total_input_tokens,
                output_tokens = cached.total_output_tokens,
                files_changed = cached.files_changed.len(),
                "Persisted task token usage"
            );
        }
    }

    // The automaton does not include session_id in its WS event payloads,
    // so the cache usually has None.  Fall back to the task document which
    // gets session_id written by TaskService::assign_task when the harness
    // claims the task.
    let session_id: String = match cached.session_id.clone() {
        Some(sid) => sid,
        None => match storage.get_task(task_id, jwt).await {
            Ok(task) if task.session_id.is_some() => {
                let sid = task.session_id.unwrap();
                info!(task_id, %sid, "Resolved session_id from task document (cache miss fallback)");
                sid
            }
            Ok(_) => {
                warn!(task_id, "Cannot persist task output: session_id missing from both cache and task document");
                return;
            }
            Err(e) => {
                warn!(task_id, error = %e, "Cannot persist task output: failed to fetch task for session_id fallback");
                return;
            }
        },
    };

    // Ensure the task document in aura-storage carries the session_id so
    // the cold read path (`fetch_task_output_from_storage`) can locate the
    // session events after the in-memory cache is gone.
    let update_req = aura_os_storage::UpdateTaskRequest {
        session_id: Some(session_id.clone()),
        ..Default::default()
    };
    if let Err(e) = storage.update_task(task_id, jwt, &update_req).await {
        warn!(task_id, %session_id, error = %e, "Failed to update task session_id in storage");
    }
    let agent_id = cached.agent_instance_id.as_deref();
    let project_id = cached.project_id.as_deref();

    if !cached.live_output.is_empty() {
        let req = aura_os_storage::CreateSessionEventRequest {
            session_id: Some(session_id.to_string()),
            user_id: None,
            agent_id: agent_id.map(str::to_owned),
            sender: Some("agent".to_string()),
            project_id: project_id.map(str::to_owned),
            org_id: None,
            event_type: "task_output".to_string(),
            content: Some(serde_json::json!({
                "task_id": task_id,
                "text": cached.live_output,
            })),
        };

        if let Err(e) = storage.create_event(&session_id, jwt, &req).await {
            warn!(task_id, %session_id, error = %e, "Failed to persist task output event");
        } else {
            info!(task_id, %session_id, "Persisted task output event");
        }
    }

    if !cached.build_steps.is_empty() || !cached.test_steps.is_empty() {
        let req = aura_os_storage::CreateSessionEventRequest {
            session_id: Some(session_id.to_string()),
            user_id: None,
            agent_id: agent_id.map(str::to_owned),
            sender: Some("agent".to_string()),
            project_id: project_id.map(str::to_owned),
            org_id: None,
            event_type: "task_steps".to_string(),
            content: Some(serde_json::json!({
                "task_id": task_id,
                "build_steps": cached.build_steps,
                "test_steps": cached.test_steps,
            })),
        };

        if let Err(e) = storage.create_event(&session_id, jwt, &req).await {
            warn!(task_id, %session_id, error = %e, "Failed to persist task steps event");
        } else {
            info!(task_id, %session_id, "Persisted task steps event");
        }
    }

    if !cached.git_steps.is_empty() {
        let req = aura_os_storage::CreateSessionEventRequest {
            session_id: Some(session_id.to_string()),
            user_id: None,
            agent_id: agent_id.map(str::to_owned),
            sender: Some("agent".to_string()),
            project_id: project_id.map(str::to_owned),
            org_id: None,
            event_type: "task_git_steps".to_string(),
            content: Some(serde_json::json!({
                "task_id": task_id,
                "git_steps": cached.git_steps,
            })),
        };

        if let Err(e) = storage.create_event(&session_id, jwt, &req).await {
            warn!(task_id, %session_id, error = %e, "Failed to persist task git steps event");
        } else {
            info!(task_id, %session_id, git_steps = cached.git_steps.len(), "Persisted task git steps event");
        }
    }

    let sync_state = derive_sync_state(&cached.git_steps);
    let checkpoints = derive_checkpoint_summary(
        !cached.live_output.is_empty(),
        cached.files_changed.len(),
        &cached.build_steps,
        &cached.test_steps,
        &cached.git_steps,
    );
    let recovery_point = derive_recovery_point(&sync_state);
    if checkpoints.execution_started {
        let req = aura_os_storage::CreateSessionEventRequest {
            session_id: Some(session_id.to_string()),
            user_id: None,
            agent_id: agent_id.map(str::to_owned),
            sender: Some("agent".to_string()),
            project_id: project_id.map(str::to_owned),
            org_id: None,
            event_type: "task_checkpoint_state".to_string(),
            content: Some(serde_json::json!({
                "task_id": task_id,
                "sync_state": sync_state,
                "checkpoints": checkpoints,
                "recovery_point": recovery_point,
            })),
        };

        if let Err(e) = storage.create_event(&session_id, jwt, &req).await {
            warn!(task_id, %session_id, error = %e, "Failed to persist task checkpoint state event");
        }
    }
}

pub(crate) async fn persist_task_sync_progress(
    storage: Option<&Arc<StorageClient>>,
    jwt: Option<&str>,
    session_id: &str,
    task_id: &str,
    checkpoint: &TaskSyncCheckpoint,
    sync_state: &TaskSyncState,
) {
    let (Some(storage), Some(jwt)) = (storage, jwt) else {
        return;
    };
    if session_id.is_empty() || task_id.is_empty() {
        return;
    }

    let checkpoint_req = aura_os_storage::CreateSessionEventRequest {
        session_id: Some(session_id.to_string()),
        user_id: None,
        agent_id: None,
        sender: Some("agent".to_string()),
        project_id: None,
        org_id: None,
        event_type: "task_sync_checkpoint".to_string(),
        content: Some(serde_json::json!({
            "task_id": task_id,
            "checkpoint": checkpoint,
        })),
    };
    if let Err(error) = storage.create_event(session_id, jwt, &checkpoint_req).await {
        warn!(
            %session_id,
            %task_id,
            checkpoint = checkpoint.kind,
            %error,
            "Failed to persist task sync checkpoint"
        );
    }

    let state_req = aura_os_storage::CreateSessionEventRequest {
        session_id: Some(session_id.to_string()),
        user_id: None,
        agent_id: None,
        sender: Some("agent".to_string()),
        project_id: None,
        org_id: None,
        event_type: "task_sync_state".to_string(),
        content: Some(serde_json::json!({
            "task_id": task_id,
            "sync_state": sync_state,
        })),
    };
    if let Err(error) = storage.create_event(session_id, jwt, &state_req).await {
        warn!(
            %session_id,
            %task_id,
            phase = sync_state.phase.as_deref().unwrap_or("unknown"),
            %error,
            "Failed to persist task sync state"
        );
    }
}

pub(crate) async fn persist_session_event(
    storage: Option<&Arc<StorageClient>>,
    jwt: Option<&str>,
    session_id: &str,
    event: &serde_json::Value,
) {
    let (Some(storage), Some(jwt)) = (storage, jwt) else {
        return;
    };
    if session_id.is_empty() {
        return;
    }

    let Some(event_type) = event.get("type").and_then(|t| t.as_str()) else {
        return;
    };
    if !is_session_event_worthy(event_type) {
        return;
    }

    let req = aura_os_storage::CreateSessionEventRequest {
        session_id: Some(session_id.to_string()),
        user_id: None,
        agent_id: event
            .get("agent_instance_id")
            .and_then(|v| v.as_str())
            .map(str::to_owned),
        sender: Some("agent".to_string()),
        project_id: event
            .get("project_id")
            .and_then(|v| v.as_str())
            .map(str::to_owned),
        org_id: None,
        event_type: event_type.to_string(),
        content: Some(event.clone()),
    };

    if let Err(e) = storage.create_event(session_id, jwt, &req).await {
        warn!(%session_id, event_type, error = %e, "Failed to persist session event");
    }
}
