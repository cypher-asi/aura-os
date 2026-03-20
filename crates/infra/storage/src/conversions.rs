use chrono::{DateTime, Utc};

use aura_core::{
    parse_dt, FileChangeSummary, Session, SessionStatus, Spec, Task, TaskId, TaskStatus,
};

use crate::{StorageSession, StorageSpec, StorageTask};

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

impl TryFrom<StorageSpec> for Spec {
    type Error = String;

    fn try_from(s: StorageSpec) -> Result<Self, Self::Error> {
        Ok(Spec {
            spec_id: s.id.parse().map_err(|e| format!("invalid spec id: {e}"))?,
            project_id: s
                .project_id
                .as_deref()
                .unwrap_or("")
                .parse()
                .map_err(|e| format!("invalid project id: {e}"))?,
            title: s.title.unwrap_or_default(),
            order_index: s.order_index.unwrap_or(0) as u32,
            markdown_contents: s.markdown_contents.unwrap_or_default(),
            created_at: parse_dt(&s.created_at),
            updated_at: parse_dt(&s.updated_at),
        })
    }
}

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

fn parse_task_status(s: &str) -> TaskStatus {
    serde_json::from_str(&format!("\"{s}\"")).unwrap_or(TaskStatus::Pending)
}

impl TryFrom<StorageTask> for Task {
    type Error = String;

    fn try_from(s: StorageTask) -> Result<Self, Self::Error> {
        let status = parse_task_status(s.status.as_deref().unwrap_or("pending"));
        let assigned_id = s
            .assigned_project_agent_id
            .as_deref()
            .and_then(|id| id.parse().ok());
        let completed_id = if status == TaskStatus::Done {
            assigned_id
        } else {
            None
        };
        Ok(Task {
            task_id: s.id.parse().map_err(|e| format!("invalid task id: {e}"))?,
            project_id: s
                .project_id
                .as_deref()
                .unwrap_or("")
                .parse()
                .map_err(|e| format!("invalid project id: {e}"))?,
            spec_id: s
                .spec_id
                .as_deref()
                .unwrap_or("")
                .parse()
                .map_err(|e| format!("invalid spec id: {e}"))?,
            title: s.title.unwrap_or_default(),
            description: s.description.unwrap_or_default(),
            status,
            order_index: s.order_index.unwrap_or(0) as u32,
            dependency_ids: s
                .dependency_ids
                .unwrap_or_default()
                .into_iter()
                .filter_map(|id| id.parse().ok())
                .collect(),
            // Ephemeral: not stored in aura-storage
            parent_task_id: None,
            assigned_agent_instance_id: assigned_id,
            completed_by_agent_instance_id: completed_id,
            session_id: s.session_id.and_then(|id| id.parse().ok()),
            execution_notes: s.execution_notes.unwrap_or_default(),
            files_changed: s
                .files_changed
                .unwrap_or_default()
                .into_iter()
                .map(|f| FileChangeSummary {
                    op: f.op,
                    path: f.path,
                    lines_added: f.lines_added,
                    lines_removed: f.lines_removed,
                })
                .collect(),
            // Ephemeral: populated only during engine execution
            live_output: String::new(),
            build_steps: vec![],
            test_steps: vec![],
            user_id: None,
            model: s.model,
            total_input_tokens: s.total_input_tokens.unwrap_or(0),
            total_output_tokens: s.total_output_tokens.unwrap_or(0),
            created_at: parse_dt(&s.created_at),
            updated_at: parse_dt(&s.updated_at),
        })
    }
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

fn parse_session_status(s: &str) -> SessionStatus {
    match s {
        "active" => SessionStatus::Active,
        "completed" => SessionStatus::Completed,
        "failed" => SessionStatus::Failed,
        "rolled_over" => SessionStatus::RolledOver,
        _ => SessionStatus::Active,
    }
}

impl TryFrom<StorageSession> for Session {
    type Error = String;

    fn try_from(s: StorageSession) -> Result<Self, Self::Error> {
        Ok(Session {
            session_id: s
                .id
                .parse()
                .map_err(|e| format!("invalid session id: {e}"))?,
            agent_instance_id: s
                .project_agent_id
                .as_deref()
                .unwrap_or("")
                .parse()
                .map_err(|e| format!("invalid project_agent_id: {e}"))?,
            project_id: s
                .project_id
                .as_deref()
                .unwrap_or("")
                .parse()
                .map_err(|e| format!("invalid project_id: {e}"))?,
            // Ephemeral: set by caller from in-memory state
            active_task_id: None,
            tasks_worked: {
                let count = s.tasks_worked_count.unwrap_or(0) as usize;
                (0..count).map(|_| TaskId::new()).collect()
            },
            context_usage_estimate: s.context_usage_estimate.unwrap_or(0.0),
            // Ephemeral: token totals accumulate in-memory per engine run
            total_input_tokens: 0,
            total_output_tokens: 0,
            summary_of_previous_context: s.summary_of_previous_context.unwrap_or_default(),
            status: parse_session_status(s.status.as_deref().unwrap_or("active")),
            // Ephemeral: set by caller from auth context
            user_id: None,
            model: None,
            started_at: parse_dt(&s.created_at),
            ended_at: s
                .ended_at
                .as_deref()
                .and_then(|v| DateTime::parse_from_rfc3339(v).ok())
                .map(|dt| dt.with_timezone(&Utc)),
        })
    }
}
