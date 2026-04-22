use chrono::{DateTime, Utc};

use aura_os_core::{
    parse_dt, FileChangeSummary, Session, SessionStatus, Spec, Task, TaskId, TaskStatus,
};

use crate::{StorageSession, StorageSpec, StorageTask, StorageTaskFileChangeSummary};

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

impl TryFrom<StorageSpec> for Spec {
    type Error = String;

    fn try_from(val: StorageSpec) -> Result<Self, Self::Error> {
        Ok(Spec {
            spec_id: val
                .id
                .parse()
                .map_err(|e| format!("invalid spec id: {e}"))?,
            project_id: val
                .project_id
                .as_deref()
                .unwrap_or("")
                .parse()
                .map_err(|e| format!("invalid project id: {e}"))?,
            title: val.title.unwrap_or_default(),
            order_index: val.order_index.unwrap_or(0) as u32,
            markdown_contents: val.markdown_contents.unwrap_or_default(),
            created_at: parse_dt(&val.created_at),
            updated_at: parse_dt(&val.updated_at),
        })
    }
}

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

fn parse_task_status(raw: &str) -> TaskStatus {
    serde_json::from_value(serde_json::Value::String(raw.to_string()))
        .unwrap_or(TaskStatus::Pending)
}

fn parse_dependency_ids(ids: Option<Vec<String>>) -> Vec<TaskId> {
    ids.unwrap_or_default()
        .into_iter()
        .filter_map(|id| id.parse().ok())
        .collect()
}

fn convert_files_changed(
    changes: Option<Vec<StorageTaskFileChangeSummary>>,
) -> Vec<FileChangeSummary> {
    changes
        .unwrap_or_default()
        .into_iter()
        .map(|fc| FileChangeSummary {
            op: fc.op,
            path: fc.path,
            lines_added: fc.lines_added,
            lines_removed: fc.lines_removed,
        })
        .collect()
}

impl TryFrom<StorageTask> for Task {
    type Error = String;

    fn try_from(val: StorageTask) -> Result<Self, Self::Error> {
        let status = parse_task_status(val.status.as_deref().unwrap_or("pending"));
        let assigned_id = val
            .assigned_project_agent_id
            .as_deref()
            .and_then(|id| id.parse().ok());
        let completed_id = if status == TaskStatus::Done {
            assigned_id
        } else {
            None
        };
        Ok(Task {
            task_id: val
                .id
                .parse()
                .map_err(|e| format!("invalid task id: {e}"))?,
            project_id: val
                .project_id
                .as_deref()
                .unwrap_or("")
                .parse()
                .map_err(|e| format!("invalid project id: {e}"))?,
            spec_id: val
                .spec_id
                .as_deref()
                .unwrap_or("")
                .parse()
                .map_err(|e| format!("invalid spec id: {e}"))?,
            title: val.title.unwrap_or_default(),
            description: val.description.unwrap_or_default(),
            status,
            order_index: val.order_index.unwrap_or(0) as u32,
            dependency_ids: parse_dependency_ids(val.dependency_ids),
            parent_task_id: None,
            skip_auto_decompose: false,
            assigned_agent_instance_id: assigned_id,
            completed_by_agent_instance_id: completed_id,
            session_id: val.session_id.and_then(|id| id.parse().ok()),
            execution_notes: val.execution_notes.unwrap_or_default(),
            files_changed: convert_files_changed(val.files_changed),
            live_output: String::new(),
            build_steps: vec![],
            test_steps: vec![],
            user_id: None,
            model: val.model,
            total_input_tokens: val.total_input_tokens.unwrap_or(0),
            total_output_tokens: val.total_output_tokens.unwrap_or(0),
            created_at: parse_dt(&val.created_at),
            updated_at: parse_dt(&val.updated_at),
        })
    }
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

fn parse_session_status(raw: &str) -> SessionStatus {
    match raw {
        "active" => SessionStatus::Active,
        "completed" => SessionStatus::Completed,
        "failed" => SessionStatus::Failed,
        "rolled_over" => SessionStatus::RolledOver,
        _ => SessionStatus::Active,
    }
}

impl TryFrom<StorageSession> for Session {
    type Error = String;

    fn try_from(val: StorageSession) -> Result<Self, Self::Error> {
        Ok(Session {
            session_id: val
                .id
                .parse()
                .map_err(|e| format!("invalid session id: {e}"))?,
            agent_instance_id: val
                .project_agent_id
                .as_deref()
                .unwrap_or("")
                .parse()
                .map_err(|e| format!("invalid project_agent_id: {e}"))?,
            project_id: val
                .project_id
                .as_deref()
                .unwrap_or("")
                .parse()
                .map_err(|e| format!("invalid project_id: {e}"))?,
            active_task_id: None,
            tasks_worked: {
                let count = val.tasks_worked_count.unwrap_or(0) as usize;
                (0..count).map(|_| TaskId::new()).collect()
            },
            context_usage_estimate: val.context_usage_estimate.unwrap_or(0.0),
            total_input_tokens: val.total_input_tokens.unwrap_or(0),
            total_output_tokens: val.total_output_tokens.unwrap_or(0),
            summary_of_previous_context: val.summary_of_previous_context.unwrap_or_default(),
            status: parse_session_status(val.status.as_deref().unwrap_or("active")),
            user_id: None,
            model: val.model,
            started_at: parse_dt(&val.started_at.or(val.created_at)),
            ended_at: val
                .ended_at
                .as_deref()
                .and_then(|ts| DateTime::parse_from_rfc3339(ts).ok())
                .map(|dt| dt.with_timezone(&Utc)),
        })
    }
}
