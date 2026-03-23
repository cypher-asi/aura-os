use serde_json::{json, Value};

use aura_core::*;
use aura_tasks::storage_task_to_task;

use super::{parse_id, str_field};
use crate::chat_tool_executor::{ChatToolExecutor, ToolExecResult};

impl ChatToolExecutor {
    pub(crate) async fn list_tasks(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let tasks = if str_field(input, "spec_id").is_some() {
            match self.resolve_spec_id(project_id, input).await {
                Ok(spec_id) => {
                    self.task_service
                        .list_tasks_by_spec(project_id, &spec_id)
                        .await
                }
                Err(e) => return e,
            }
        } else {
            self.task_service.list_tasks(project_id).await
        };
        match tasks {
            Ok(tasks) => {
                let summaries: Vec<Value> = tasks
                    .iter()
                    .map(|t| {
                        json!({
                            "task_id": t.task_id.to_string(),
                            "spec_id": t.spec_id.to_string(),
                            "title": t.title,
                            "status": t.status,
                            "order_index": t.order_index,
                        })
                    })
                    .collect();
                ToolExecResult::ok(json!({ "tasks": summaries }))
            }
            Err(e) => ToolExecResult::err(format!("{e:?}")),
        }
    }

    pub(crate) async fn create_task(
        &self,
        project_id: &ProjectId,
        input: &Value,
    ) -> ToolExecResult {
        let spec_id = match self.resolve_spec_id(project_id, input).await {
            Ok(id) => id,
            Err(e) => return e,
        };
        let title = str_field(input, "title").unwrap_or_default();
        let description = str_field(input, "description").unwrap_or_default();

        let existing = self
            .task_service
            .list_tasks_by_spec(project_id, &spec_id)
            .await
            .unwrap_or_default();
        let order = existing.iter().map(|t| t.order_index).max().unwrap_or(0) + 1;

        let dep_ids: Option<Vec<String>> = input
            .get("dependency_ids")
            .and_then(|v| serde_json::from_value(v.clone()).ok());
        let has_deps = dep_ids.as_ref().is_some_and(|d| !d.is_empty());
        let status = if has_deps { "pending" } else { "ready" };

        let (storage, jwt) = match self.storage_and_jwt() {
            Ok(v) => v,
            Err(e) => return e,
        };
        let req = aura_storage::CreateTaskRequest {
            spec_id: spec_id.to_string(),
            title: title.clone(),
            description: Some(description),
            status: Some(status.to_string()),
            order_index: Some(order as i32),
            dependency_ids: dep_ids,
        };
        match storage
            .create_task(&project_id.to_string(), &jwt, &req)
            .await
        {
            Ok(st) => match storage_task_to_task(st) {
                Ok(task) => ToolExecResult::ok_with_task(json!(task), task),
                Err(e) => ToolExecResult::err(e),
            },
            Err(e) => ToolExecResult::err(format!("aura-storage: {e}")),
        }
    }

    pub(crate) async fn update_task(
        &self,
        _project_id: &ProjectId,
        input: &Value,
    ) -> ToolExecResult {
        let task_id = match parse_id::<TaskId>(input, "task_id") {
            Ok(id) => id,
            Err(e) => return e,
        };
        let (storage, jwt) = match self.storage_and_jwt() {
            Ok(v) => v,
            Err(e) => return e,
        };

        let req = aura_storage::UpdateTaskRequest {
            title: str_field(input, "title"),
            description: str_field(input, "description"),
            order_index: None,
            dependency_ids: None,
            execution_notes: None,
            files_changed: None,
            model: None,
            total_input_tokens: None,
            total_output_tokens: None,
            session_id: None,
            assigned_project_agent_id: None,
        };
        if let Err(e) = storage.update_task(&task_id.to_string(), &jwt, &req).await {
            return ToolExecResult::err(format!("aura-storage: {e}"));
        }

        if let Some(s) = str_field(input, "status") {
            let transition_req = aura_storage::TransitionTaskRequest { status: s };
            if let Err(e) = storage
                .transition_task(&task_id.to_string(), &jwt, &transition_req)
                .await
            {
                return ToolExecResult::err(format!("aura-storage transition: {e}"));
            }
        }

        match storage.get_task(&task_id.to_string(), &jwt).await {
            Ok(st) => match storage_task_to_task(st) {
                Ok(task) => ToolExecResult::ok_with_task(json!(task), task),
                Err(e) => ToolExecResult::err(e),
            },
            Err(e) => ToolExecResult::err(format!("aura-storage: {e}")),
        }
    }

    pub(crate) async fn delete_task(
        &self,
        _project_id: &ProjectId,
        input: &Value,
    ) -> ToolExecResult {
        let task_id = match parse_id::<TaskId>(input, "task_id") {
            Ok(id) => id,
            Err(e) => return e,
        };
        let (storage, jwt) = match self.storage_and_jwt() {
            Ok(v) => v,
            Err(e) => return e,
        };
        match storage.delete_task(&task_id.to_string(), &jwt).await {
            Ok(()) => ToolExecResult::ok(json!({ "deleted": task_id.to_string() })),
            Err(e) => ToolExecResult::err(format!("aura-storage: {e}")),
        }
    }

    pub(crate) async fn transition_task(
        &self,
        project_id: &ProjectId,
        input: &Value,
    ) -> ToolExecResult {
        let task_id = match parse_id::<TaskId>(input, "task_id") {
            Ok(id) => id,
            Err(e) => return e,
        };
        let status_str = str_field(input, "status").unwrap_or_default();
        let new_status: TaskStatus = match serde_json::from_value(json!(status_str)) {
            Ok(s) => s,
            Err(_) => return ToolExecResult::err(format!("Invalid status: {status_str}")),
        };

        let tasks = match self.task_service.list_tasks(project_id).await {
            Ok(t) => t,
            Err(e) => return ToolExecResult::err(format!("{e:?}")),
        };
        let task = match tasks.iter().find(|t| t.task_id == task_id) {
            Some(t) => t,
            None => return ToolExecResult::err("Task not found"),
        };

        match self
            .task_service
            .transition_task(project_id, &task.spec_id, &task_id, new_status)
            .await
        {
            Ok(t) => ToolExecResult::ok(json!(t)),
            Err(e) => ToolExecResult::err(format!("{e:?}")),
        }
    }
}
