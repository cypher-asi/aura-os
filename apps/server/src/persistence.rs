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

            if let Err(e) = storage
                .update_task(&task_id.to_string(), jwt, &update)
                .await
            {
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

            if let Err(e) = storage
                .update_task(&task_id.to_string(), jwt, &update)
                .await
            {
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
    if live_output.is_empty() {
        return;
    }

    let task_id = match event {
        EngineEvent::TaskCompleted { task_id, .. } | EngineEvent::TaskFailed { task_id, .. } => {
            task_id
        }
        _ => return,
    };
    let (input_tokens, output_tokens) = match event {
        EngineEvent::TaskCompleted {
            input_tokens,
            output_tokens,
            ..
        } => (*input_tokens, *output_tokens),
        _ => (None, None),
    };

    let msg_req = aura_storage::CreateMessageRequest {
        project_agent_id: entry.agent_instance_id.to_string(),
        project_id: entry.project_id.to_string(),
        role: "assistant".to_string(),
        content: live_output.to_string(),
        content_blocks: None,
        input_tokens,
        output_tokens,
        thinking: None,
        thinking_duration_ms: None,
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
    if build_steps.is_empty() && test_steps.is_empty() {
        return;
    }

    let task_id = match event {
        EngineEvent::TaskCompleted { task_id, .. } | EngineEvent::TaskFailed { task_id, .. } => {
            task_id
        }
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
        content_blocks: None,
        input_tokens: None,
        output_tokens: None,
        thinking: None,
        thinking_duration_ms: None,
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

#[cfg(test)]
mod tests {
    use super::*;
    use aura_core::*;
    use aura_engine::EngineEvent;
    use aura_storage::StorageClient;
    use std::sync::Arc;

    async fn setup_mock() -> (Arc<StorageClient>, aura_storage::testutil::SharedDb) {
        let (url, db) = aura_storage::testutil::start_mock_storage().await;
        let client = Arc::new(StorageClient::with_base_url(&url));
        let task_id = uuid::Uuid::new_v4().to_string();
        {
            let mut guard = db.lock().await;
            guard.tasks.push(aura_storage::StorageTask {
                id: task_id.clone(),
                project_id: Some(uuid::Uuid::new_v4().to_string()),
                spec_id: Some(uuid::Uuid::new_v4().to_string()),
                title: Some("test".into()),
                description: None,
                status: Some("in_progress".into()),
                order_index: Some(0),
                dependency_ids: None,
                execution_notes: None,
                files_changed: None,
                model: None,
                total_input_tokens: None,
                total_output_tokens: None,
                assigned_project_agent_id: None,
                session_id: None,
                created_at: Some(chrono::Utc::now().to_rfc3339()),
                updated_at: Some(chrono::Utc::now().to_rfc3339()),
            });
        }
        (client, db)
    }

    #[tokio::test]
    async fn test_persist_task_completed_event() {
        let (client, db) = setup_mock().await;
        let task_id: TaskId = {
            let guard = db.lock().await;
            guard.tasks[0].id.parse().unwrap()
        };
        let pid = ProjectId::new();
        let aiid = AgentInstanceId::new();
        let sid = SessionId::new();

        let event = EngineEvent::TaskCompleted {
            project_id: pid,
            agent_instance_id: aiid,
            task_id,
            execution_notes: "All done".into(),
            file_changes: vec![],
            duration_ms: Some(100),
            input_tokens: Some(500),
            output_tokens: Some(200),
            cost_usd: None,
            llm_duration_ms: None,
            build_verify_duration_ms: None,
            files_changed_count: None,
            parse_retries: None,
            build_fix_attempts: None,
            model: Some("claude-opus-4-6".into()),
        };

        let entry = crate::TaskSessionEntry {
            project_id: pid,
            agent_instance_id: aiid,
            session_id: sid,
        };
        persist_task_to_storage(
            &client,
            "jwt",
            &event,
            "live output here",
            Some(&entry),
            &[],
            &[],
        )
        .await;

        let guard = db.lock().await;
        let task = &guard.tasks[0];
        assert_eq!(task.execution_notes.as_deref(), Some("All done"));
    }

    #[tokio::test]
    async fn test_persist_task_failed_event() {
        let (client, db) = setup_mock().await;
        let task_id: TaskId = {
            let guard = db.lock().await;
            guard.tasks[0].id.parse().unwrap()
        };
        let pid = ProjectId::new();
        let aiid = AgentInstanceId::new();
        let sid = SessionId::new();

        let event = EngineEvent::TaskFailed {
            project_id: pid,
            agent_instance_id: aiid,
            task_id,
            reason: "Build failed".into(),
            duration_ms: None,
            phase: Some("build".into()),
            parse_retries: None,
            build_fix_attempts: None,
            model: None,
        };

        let entry = crate::TaskSessionEntry {
            project_id: pid,
            agent_instance_id: aiid,
            session_id: sid,
        };
        persist_task_to_storage(&client, "jwt", &event, "", Some(&entry), &[], &[]).await;

        let guard = db.lock().await;
        let task = &guard.tasks[0];
        assert_eq!(task.execution_notes.as_deref(), Some("Build failed"));
    }

    #[tokio::test]
    async fn test_persist_skips_when_no_session() {
        let (client, db) = setup_mock().await;
        let task_id: TaskId = {
            let guard = db.lock().await;
            guard.tasks[0].id.parse().unwrap()
        };

        let event = EngineEvent::TaskCompleted {
            project_id: ProjectId::new(),
            agent_instance_id: AgentInstanceId::new(),
            task_id,
            execution_notes: "Should update task but not create messages".into(),
            file_changes: vec![],
            duration_ms: None,
            input_tokens: None,
            output_tokens: None,
            cost_usd: None,
            llm_duration_ms: None,
            build_verify_duration_ms: None,
            files_changed_count: None,
            parse_retries: None,
            build_fix_attempts: None,
            model: None,
        };

        persist_task_to_storage(&client, "jwt", &event, "some output", None, &[], &[]).await;

        let guard = db.lock().await;
        let task = &guard.tasks[0];
        assert_eq!(
            task.execution_notes.as_deref(),
            Some("Should update task but not create messages")
        );
        assert!(
            guard.messages.is_empty(),
            "no messages should be persisted without session entry"
        );
    }
}
