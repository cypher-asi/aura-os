use std::sync::Arc;

use serde_json::{json, Value};
use tracing::info;

use aura_core::*;
use aura_storage::StorageClient;
use aura_store::RocksStore;

use aura_projects::ProjectService;
use aura_tasks::TaskService;

const MAX_TOOL_ITERATIONS: usize = 25;

pub struct ChatToolExecutor {
    pub(crate) store: Arc<RocksStore>,
    pub(crate) storage_client: Option<Arc<StorageClient>>,
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

fn pretty_json(v: &Value) -> String {
    serde_json::to_string_pretty(v).unwrap_or_else(|e| {
        tracing::warn!(error = %e, "failed to serialize tool result to JSON");
        v.to_string()
    })
}

impl ToolExecResult {
    pub(crate) fn ok(v: Value) -> Self {
        Self {
            content: pretty_json(&v),
            is_error: false,
            saved_spec: None,
            saved_task: None,
        }
    }
    pub(crate) fn ok_with_spec(v: Value, spec: Spec) -> Self {
        Self {
            content: pretty_json(&v),
            is_error: false,
            saved_spec: Some(spec),
            saved_task: None,
        }
    }
    pub(crate) fn ok_with_task(v: Value, task: Task) -> Self {
        Self {
            content: pretty_json(&v),
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
        storage_client: Option<Arc<StorageClient>>,
        project_service: Arc<ProjectService>,
        task_service: Arc<TaskService>,
    ) -> Self {
        Self {
            store,
            storage_client,
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
            "list_specs" => self.list_specs(project_id).await,
            "get_spec" => self.get_spec(project_id, &input).await,
            "create_spec" => self.create_spec(project_id, &input).await,
            "update_spec" => self.update_spec(project_id, &input).await,
            "delete_spec" => self.delete_spec(project_id, &input).await,
            // ── Tasks ──────────────────────────────────────────────
            "list_tasks" => self.list_tasks(project_id, &input).await,
            "create_task" => self.create_task(project_id, &input).await,
            "update_task" => self.update_task(project_id, &input).await,
            "delete_task" => self.delete_task(project_id, &input).await,
            "transition_task" => self.transition_task(project_id, &input).await,
            "run_task" => ToolExecResult::ok(json!({
                "note": "run_task is handled at the handler level; this is a no-op inside the executor."
            })),
            // ── Project ────────────────────────────────────────────
            "get_project" => self.get_project(project_id).await,
            "update_project" => self.update_project(project_id, &input).await,
            // ── Dev loop (handled at handler level) ────────────────
            "start_dev_loop" | "pause_dev_loop" | "stop_dev_loop" => ToolExecResult::ok(json!({
                "note": "Loop control is handled at the handler level."
            })),
            // ── Filesystem ─────────────────────────────────────────
            "read_file" => self.read_file(project_id, &input).await,
            "write_file" => self.write_file(project_id, &input).await,
            "delete_file" => self.delete_file(project_id, &input).await,
            "list_files" => self.list_files(project_id, &input).await,
            // ── Targeted editing ───────────────────────────────────
            "edit_file" => self.edit_file(project_id, &input).await,
            // ── Shell ──────────────────────────────────────────────
            "run_command" => self.run_command(project_id, &input).await,
            // ── Search ─────────────────────────────────────────────
            "search_code" => self.search_code(project_id, &input).await,
            "find_files" => self.find_files(project_id, &input).await,
            // ── Progress ───────────────────────────────────────────
            "get_progress" => self.get_progress(project_id).await,
            _ => ToolExecResult::err(format!("Unknown tool: {tool_name}")),
        }
    }
}
