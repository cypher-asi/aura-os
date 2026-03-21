use std::sync::Arc;

use tracing::{info, warn};

use aura_engine::EngineEvent;
use aura_storage::StorageClient;

use crate::TaskSessionEntry;

pub(crate) async fn persist_task_to_storage(
    storage: &Arc<StorageClient>,
    jwt: &str,
    event: &EngineEvent,
    live_output: &str,
    session_entry: Option<&TaskSessionEntry>,
    build_steps: &[serde_json::Value],
    test_steps: &[serde_json::Value],
) {
    match event {
        EngineEvent::TaskCompleted {
            task_id,
            execution_notes,
            file_changes,
            input_tokens,
            output_tokens,
            model,
            ..
        } => {
            let files_changed: Vec<aura_storage::StorageTaskFileChangeSummary> = file_changes
                .iter()
                .map(|f| aura_storage::StorageTaskFileChangeSummary {
                    op: f.op.clone(),
                    path: f.path.clone(),
                    lines_added: f.lines_added,
                    lines_removed: f.lines_removed,
                })
                .collect();

            let update = aura_storage::UpdateTaskRequest {
                title: None,
                description: None,
                order_index: None,
                dependency_ids: None,
                execution_notes: Some(execution_notes.clone()),
                files_changed: Some(files_changed),
                model: model.clone(),
                total_input_tokens: *input_tokens,
                total_output_tokens: *output_tokens,
                session_id: session_entry.map(|e| e.session_id.to_string()),
                assigned_project_agent_id: session_entry.map(|e| e.agent_instance_id.to_string()),
            };

            if let Err(e) = storage.update_task(&task_id.to_string(), jwt, &update).await {
                warn!(task_id = %task_id, error = %e, "Failed to persist task execution data to aura-storage");
            } else {
                info!(task_id = %task_id, "Persisted task execution data to aura-storage");
            }
        }
        EngineEvent::TaskFailed {
            task_id,
            reason,
            model,
            ..
        } => {
            let update = aura_storage::UpdateTaskRequest {
                title: None,
                description: None,
                order_index: None,
                dependency_ids: None,
                execution_notes: Some(reason.clone()),
                files_changed: None,
                model: model.clone(),
                total_input_tokens: None,
                total_output_tokens: None,
                session_id: session_entry.map(|e| e.session_id.to_string()),
                assigned_project_agent_id: session_entry.map(|e| e.agent_instance_id.to_string()),
            };

            if let Err(e) = storage.update_task(&task_id.to_string(), jwt, &update).await {
                warn!(task_id = %task_id, error = %e, "Failed to persist failed task data to aura-storage");
            }
        }
        _ => return,
    }

    persist_task_output_message(storage, jwt, event, live_output, session_entry).await;
    persist_task_steps(storage, jwt, event, build_steps, test_steps, session_entry).await;
}

async fn persist_task_output_message(
    storage: &Arc<StorageClient>,
    jwt: &str,
    event: &EngineEvent,
    live_output: &str,
    session_entry: Option<&TaskSessionEntry>,
) {
    let Some(entry) = session_entry else { return };
    if live_output.is_empty() { return; }

    let task_id = match event {
        EngineEvent::TaskCompleted { task_id, .. }
        | EngineEvent::TaskFailed { task_id, .. } => task_id,
        _ => return,
    };
    let (input_tokens, output_tokens) = match event {
        EngineEvent::TaskCompleted { input_tokens, output_tokens, .. } => (*input_tokens, *output_tokens),
        _ => (None, None),
    };

    let msg_req = aura_storage::CreateMessageRequest {
        project_agent_id: entry.agent_instance_id.to_string(),
        project_id: entry.project_id.to_string(),
        role: "assistant".to_string(),
        content: live_output.to_string(),
        input_tokens,
        output_tokens,
    };

    if let Err(e) = storage
        .create_message(&entry.session_id.to_string(), jwt, &msg_req)
        .await
    {
        warn!(task_id = %task_id, session_id = %entry.session_id, error = %e, "Failed to persist task output as session message");
    } else {
        info!(task_id = %task_id, session_id = %entry.session_id, "Persisted task output as session message");
    }
}

async fn persist_task_steps(
    storage: &Arc<StorageClient>,
    jwt: &str,
    event: &EngineEvent,
    build_steps: &[serde_json::Value],
    test_steps: &[serde_json::Value],
    session_entry: Option<&TaskSessionEntry>,
) {
    let Some(entry) = session_entry else { return };
    if build_steps.is_empty() && test_steps.is_empty() { return; }

    let task_id = match event {
        EngineEvent::TaskCompleted { task_id, .. }
        | EngineEvent::TaskFailed { task_id, .. } => task_id,
        _ => return,
    };
    let steps_payload = serde_json::json!({
        "_type": "task_steps",
        "build_steps": build_steps,
        "test_steps": test_steps,
    });
    let steps_msg = aura_storage::CreateMessageRequest {
        project_agent_id: entry.agent_instance_id.to_string(),
        project_id: entry.project_id.to_string(),
        role: "system".to_string(),
        content: steps_payload.to_string(),
        input_tokens: None,
        output_tokens: None,
    };
    if let Err(e) = storage
        .create_message(&entry.session_id.to_string(), jwt, &steps_msg)
        .await
    {
        warn!(task_id = %task_id, session_id = %entry.session_id, error = %e, "Failed to persist task steps as session message");
    } else {
        info!(task_id = %task_id, session_id = %entry.session_id, "Persisted task build/test steps as session message");
    }
}
