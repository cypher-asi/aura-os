use aura_os_core::Task;
use aura_os_storage::StorageTask;

/// Convert a `StorageTask` into a domain `Task`.
///
/// Delegates to the canonical `TryFrom<StorageTask>` impl in `aura_os_storage`.
pub(crate) fn storage_task_to_task(s: StorageTask) -> Result<Task, String> {
    Task::try_from(s)
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_os_core::TaskStatus;

    fn make_valid_storage_task() -> StorageTask {
        StorageTask {
            id: uuid::Uuid::new_v4().to_string(),
            project_id: Some(uuid::Uuid::new_v4().to_string()),
            org_id: None,
            spec_id: Some(uuid::Uuid::new_v4().to_string()),
            title: Some("Test task".into()),
            description: Some("A test description".into()),
            status: Some("pending".into()),
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
        }
    }

    #[test]
    fn storage_task_to_task_valid() {
        let task = storage_task_to_task(make_valid_storage_task()).expect("task");

        assert_eq!(task.title, "Test task");
        assert_eq!(task.status, TaskStatus::Pending);
    }

    #[test]
    fn storage_task_to_task_invalid_id() {
        let mut task = make_valid_storage_task();
        task.id = "not-a-uuid".to_string();

        assert!(storage_task_to_task(task).is_err());
    }
}
