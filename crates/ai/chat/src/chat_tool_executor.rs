use std::sync::Arc;

use serde_json::{json, Value};
use tracing::info;

use aura_core::*;
use aura_store::RocksStore;

use aura_projects::ProjectService;
use aura_tasks::TaskService;

const MAX_TOOL_ITERATIONS: usize = 25;

pub struct ChatToolExecutor {
    pub(crate) store: Arc<RocksStore>,
    pub(crate) project_service: Arc<ProjectService>,
    pub(crate) task_service: Arc<TaskService>,
}

/// Result of a tool execution: JSON payload + whether it is an error.
pub struct ToolExecResult {
    pub content: String,
    pub is_error: bool,
    pub saved_spec: Option<Spec>,
    pub saved_task: Option<Box<Task>>,
}

impl ToolExecResult {
    pub(crate) fn ok(v: Value) -> Self {
        Self {
            content: serde_json::to_string_pretty(&v).unwrap_or_default(),
            is_error: false,
            saved_spec: None,
            saved_task: None,
        }
    }
    pub(crate) fn ok_with_spec(v: Value, spec: Spec) -> Self {
        Self {
            content: serde_json::to_string_pretty(&v).unwrap_or_default(),
            is_error: false,
            saved_spec: Some(spec),
            saved_task: None,
        }
    }
    pub(crate) fn ok_with_task(v: Value, task: Task) -> Self {
        Self {
            content: serde_json::to_string_pretty(&v).unwrap_or_default(),
            is_error: false,
            saved_spec: None,
            saved_task: Some(Box::new(task)),
        }
    }
    pub(crate) fn err(msg: impl std::fmt::Display) -> Self {
        Self {
            content: json!({ "error": msg.to_string() }).to_string(),
            is_error: true,
            saved_spec: None,
            saved_task: None,
        }
    }

    pub fn err_static(msg: &str) -> Self {
        Self {
            content: json!({ "error": msg }).to_string(),
            is_error: true,
            saved_spec: None,
            saved_task: None,
        }
    }
}

impl ChatToolExecutor {
    pub fn new(
        store: Arc<RocksStore>,
        project_service: Arc<ProjectService>,
        task_service: Arc<TaskService>,
    ) -> Self {
        Self {
            store,
            project_service,
            task_service,
        }
    }

    pub fn max_iterations() -> usize {
        MAX_TOOL_ITERATIONS
    }

    pub async fn execute(
        &self,
        project_id: &ProjectId,
        tool_name: &str,
        input: Value,
    ) -> ToolExecResult {
        info!(%project_id, tool_name, "Executing chat tool");
        match tool_name {
            // ── Specs ──────────────────────────────────────────────
            "list_specs" => self.list_specs(project_id),
            "get_spec" => self.get_spec(project_id, &input),
            "create_spec" => self.create_spec(project_id, &input),
            "update_spec" => self.update_spec(project_id, &input),
            "delete_spec" => self.delete_spec(project_id, &input),
            // ── Tasks ──────────────────────────────────────────────
            "list_tasks" => self.list_tasks(project_id, &input),
            "create_task" => self.create_task(project_id, &input),
            "update_task" => self.update_task(project_id, &input),
            "delete_task" => self.delete_task(project_id, &input),
            "transition_task" => self.transition_task(project_id, &input),
            "run_task" => ToolExecResult::ok(json!({
                "note": "run_task is handled at the handler level; this is a no-op inside the executor."
            })),
            // ── Project ────────────────────────────────────────────
            "get_project" => self.get_project(project_id),
            "update_project" => self.update_project(project_id, &input),
            // ── Dev loop (handled at handler level) ────────────────
            "start_dev_loop" | "pause_dev_loop" | "stop_dev_loop" => ToolExecResult::ok(json!({
                "note": "Loop control is handled at the handler level."
            })),
            // ── Filesystem ─────────────────────────────────────────
            "read_file" => self.read_file(project_id, &input),
            "write_file" => self.write_file(project_id, &input),
            "delete_file" => self.delete_file(project_id, &input),
            "list_files" => self.list_files(project_id, &input),
            // ── Targeted editing ───────────────────────────────────
            "edit_file" => self.edit_file(project_id, &input),
            // ── Shell ──────────────────────────────────────────────
            "run_command" => self.run_command(project_id, &input).await,
            // ── Search ─────────────────────────────────────────────
            "search_code" => self.search_code(project_id, &input),
            "find_files" => self.find_files(project_id, &input),
            // ── Progress ───────────────────────────────────────────
            "get_progress" => self.get_progress(project_id),
            _ => ToolExecResult::err(format!("Unknown tool: {tool_name}")),
        }
    }
}
