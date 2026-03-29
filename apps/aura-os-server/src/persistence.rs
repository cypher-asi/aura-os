use std::sync::Arc;

use tracing::{info, warn};

use aura_os_storage::StorageClient;

use crate::state::CachedTaskOutput;

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

    if cached.input_tokens > 0 || cached.output_tokens > 0 {
        let req = aura_os_storage::UpdateTaskRequest {
            title: None,
            description: None,
            order_index: None,
            dependency_ids: None,
            execution_notes: None,
            files_changed: None,
            model: None,
            total_input_tokens: Some(cached.input_tokens),
            total_output_tokens: Some(cached.output_tokens),
            assigned_project_agent_id: None,
            session_id: None,
        };
        if let Err(e) = storage.update_task(task_id, jwt, &req).await {
            warn!(task_id, error = %e, "Failed to persist task token usage");
        } else {
            info!(
                task_id,
                input_tokens = cached.input_tokens,
                output_tokens = cached.output_tokens,
                "Persisted task token usage"
            );
        }
    }

    let Some(ref session_id) = cached.session_id else {
        warn!(task_id, "Cannot persist task output: session_id is missing from cache");
        return;
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

        if let Err(e) = storage.create_event(session_id, jwt, &req).await {
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

        if let Err(e) = storage.create_event(session_id, jwt, &req).await {
            warn!(task_id, %session_id, error = %e, "Failed to persist task steps event");
        } else {
            info!(task_id, %session_id, "Persisted task steps event");
        }
    }
}
