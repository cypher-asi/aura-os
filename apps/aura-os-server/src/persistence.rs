use std::sync::Arc;

use tracing::{info, warn};

use aura_os_storage::StorageClient;

use crate::state::CachedTaskOutput;

/// Persist accumulated task output (live text + build/test steps) to
/// aura-storage as session events. Called from `forward_automaton_events`
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
    let Some(ref session_id) = cached.session_id else {
        // Without a session there is nowhere to store events.
        return;
    };
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
