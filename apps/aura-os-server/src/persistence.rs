use std::sync::Arc;

use tracing::{info, warn};

use aura_engine::EngineEvent;
use aura_os_storage::StorageClient;

use crate::TaskSessionEntry;

#[derive(Debug)]
pub(crate) struct PersistTaskParams<'a> {
    pub storage: &'a Arc<StorageClient>,
    pub jwt: &'a str,
    pub event: &'a EngineEvent,
    pub live_output: &'a str,
    pub session_entry: Option<&'a TaskSessionEntry>,
    pub build_steps: &'a [serde_json::Value],
    pub test_steps: &'a [serde_json::Value],
}

fn make_update_request(
    execution_notes: String,
    files_changed: Option<Vec<aura_os_storage::StorageTaskFileChangeSummary>>,
    model: &Option<String>,
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    session_entry: Option<&TaskSessionEntry>,
) -> aura_os_storage::UpdateTaskRequest {
    aura_os_storage::UpdateTaskRequest {
        title: None,
        description: None,
        order_index: None,
        dependency_ids: None,
        execution_notes: Some(execution_notes),
        files_changed,
        model: model.clone(),
        total_input_tokens: input_tokens,
        total_output_tokens: output_tokens,
        session_id: session_entry.map(|e| e.session_id.to_string()),
        assigned_project_agent_id: session_entry.map(|e| e.agent_instance_id.to_string()),
    }
}

fn build_file_change_summaries(
    file_changes: &[aura_engine::FileChangeSummary],
) -> Vec<aura_os_storage::StorageTaskFileChangeSummary> {
    file_changes
        .iter()
        .map(|f| aura_os_storage::StorageTaskFileChangeSummary {
            op: f.op.clone(),
            path: f.path.clone(),
            lines_added: f.lines_added,
            lines_removed: f.lines_removed,
        })
        .collect()
}

pub(crate) async fn persist_task_to_storage(params: &PersistTaskParams<'_>) {
    match params.event {
        EngineEvent::TaskCompleted {
            task_id,
            execution_notes,
            file_changes,
            input_tokens,
            output_tokens,
            model,
            ..
        } => {
            let update = make_update_request(
                execution_notes.clone(),
                Some(build_file_change_summaries(file_changes)),
                model,
                *input_tokens,
                *output_tokens,
                params.session_entry,
            );
            if let Err(e) = params
                .storage
                .update_task(&task_id.to_string(), params.jwt, &update)
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
            let update = make_update_request(
                reason.clone(),
                None,
                model,
                None,
                None,
                params.session_entry,
            );
            if let Err(e) = params
                .storage
                .update_task(&task_id.to_string(), params.jwt, &update)
                .await
            {
                warn!(task_id = %task_id, error = %e, "Failed to persist failed task data to aura-storage");
            }
        }
        _ => return,
    }

    persist_task_output_message(params).await;
    persist_task_steps(params).await;
}

async fn persist_task_output_message(params: &PersistTaskParams<'_>) {
    let Some(entry) = params.session_entry else {
        return;
    };
    if params.live_output.is_empty() {
        return;
    }

    let task_id = match params.event {
        EngineEvent::TaskCompleted { task_id, .. } | EngineEvent::TaskFailed { task_id, .. } => {
            task_id
        }
        _ => return,
    };
    let (input_tokens, output_tokens) = match params.event {
        EngineEvent::TaskCompleted {
            input_tokens,
            output_tokens,
            ..
        } => (*input_tokens, *output_tokens),
        _ => (None, None),
    };

    let req = aura_os_storage::CreateSessionEventRequest {
        session_id: Some(entry.session_id.to_string()),
        user_id: None,
        agent_id: Some(entry.agent_instance_id.to_string()),
        sender: Some("agent".to_string()),
        project_id: Some(entry.project_id.to_string()),
        org_id: None,
        event_type: "task_output".to_string(),
        content: Some(serde_json::json!({
            "task_id": task_id.to_string(),
            "text": params.live_output,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
        })),
    };

    if let Err(e) = params
        .storage
        .create_event(&entry.session_id.to_string(), params.jwt, &req)
        .await
    {
        warn!(task_id = %task_id, session_id = %entry.session_id, error = %e, "Failed to persist task output event");
    } else {
        info!(task_id = %task_id, session_id = %entry.session_id, "Persisted task output event");
    }
}

async fn persist_task_steps(params: &PersistTaskParams<'_>) {
    let Some(entry) = params.session_entry else {
        return;
    };
    if params.build_steps.is_empty() && params.test_steps.is_empty() {
        return;
    }

    let task_id = match params.event {
        EngineEvent::TaskCompleted { task_id, .. } | EngineEvent::TaskFailed { task_id, .. } => {
            task_id
        }
        _ => return,
    };

    let req = aura_os_storage::CreateSessionEventRequest {
        session_id: Some(entry.session_id.to_string()),
        user_id: None,
        agent_id: Some(entry.agent_instance_id.to_string()),
        sender: Some("agent".to_string()),
        project_id: Some(entry.project_id.to_string()),
        org_id: None,
        event_type: "task_steps".to_string(),
        content: Some(serde_json::json!({
            "task_id": task_id.to_string(),
            "build_steps": params.build_steps,
            "test_steps": params.test_steps,
        })),
    };

    if let Err(e) = params
        .storage
        .create_event(&entry.session_id.to_string(), params.jwt, &req)
        .await
    {
        warn!(task_id = %task_id, session_id = %entry.session_id, error = %e, "Failed to persist task steps event");
    } else {
        info!(task_id = %task_id, session_id = %entry.session_id, "Persisted task steps event");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_os_core::*;
    use aura_engine::EngineEvent;
    use aura_os_storage::StorageClient;
    use std::sync::Arc;

    async fn setup_mock() -> (Arc<StorageClient>, aura_os_storage::testutil::SharedDb) {
        let (url, db) = aura_os_storage::testutil::start_mock_storage().await;
        let client = Arc::new(StorageClient::with_base_url(&url));
        let task_id = uuid::Uuid::new_v4().to_string();
        {
            let mut guard = db.lock().await;
            guard.tasks.push(aura_os_storage::StorageTask {
                id: task_id.clone(),
                project_id: Some(uuid::Uuid::new_v4().to_string()),
                org_id: None,
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
        persist_task_to_storage(&PersistTaskParams {
            storage: &client,
            jwt: "jwt",
            event: &event,
            live_output: "live output here",
            session_entry: Some(&entry),
            build_steps: &[],
            test_steps: &[],
        })
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
        persist_task_to_storage(&PersistTaskParams {
            storage: &client,
            jwt: "jwt",
            event: &event,
            live_output: "",
            session_entry: Some(&entry),
            build_steps: &[],
            test_steps: &[],
        })
        .await;

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

        persist_task_to_storage(&PersistTaskParams {
            storage: &client,
            jwt: "jwt",
            event: &event,
            live_output: "some output",
            session_entry: None,
            build_steps: &[],
            test_steps: &[],
        })
        .await;

        let guard = db.lock().await;
        let task = &guard.tasks[0];
        assert_eq!(
            task.execution_notes.as_deref(),
            Some("Should update task but not create messages")
        );
        assert!(
            guard.events.is_empty(),
            "no events should be persisted without session entry"
        );
    }
}
