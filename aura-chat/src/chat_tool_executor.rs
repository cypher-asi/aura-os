use std::path::Path;
use std::sync::Arc;

use chrono::Utc;
use serde_json::{json, Value};
use tracing::info;

use aura_core::*;
use aura_store::RocksStore;

use aura_projects::{ProjectService, UpdateProjectInput};
use aura_tasks::TaskService;

const MAX_TOOL_ITERATIONS: usize = 25;

pub struct ChatToolExecutor {
    store: Arc<RocksStore>,
    project_service: Arc<ProjectService>,
    task_service: Arc<TaskService>,
}

/// Result of a tool execution: JSON payload + whether it is an error.
pub struct ToolExecResult {
    pub content: String,
    pub is_error: bool,
    pub saved_spec: Option<Spec>,
    pub saved_task: Option<Box<Task>>,
}

impl ToolExecResult {
    fn ok(v: Value) -> Self {
        Self {
            content: serde_json::to_string_pretty(&v).unwrap_or_default(),
            is_error: false,
            saved_spec: None,
            saved_task: None,
        }
    }
    fn ok_with_spec(v: Value, spec: Spec) -> Self {
        Self {
            content: serde_json::to_string_pretty(&v).unwrap_or_default(),
            is_error: false,
            saved_spec: Some(spec),
            saved_task: None,
        }
    }
    fn ok_with_task(v: Value, task: Task) -> Self {
        Self {
            content: serde_json::to_string_pretty(&v).unwrap_or_default(),
            is_error: false,
            saved_spec: None,
            saved_task: Some(Box::new(task)),
        }
    }
    fn err(msg: impl std::fmt::Display) -> Self {
        Self {
            content: json!({ "error": msg.to_string() }).to_string(),
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
            // ── Sprints ────────────────────────────────────────────
            "list_sprints" => self.list_sprints(project_id),
            "create_sprint" => self.create_sprint(project_id, &input),
            "update_sprint" => self.update_sprint(project_id, &input),
            "delete_sprint" => self.delete_sprint(project_id, &input),
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

    // -----------------------------------------------------------------------
    // Spec operations
    // -----------------------------------------------------------------------

    fn list_specs(&self, project_id: &ProjectId) -> ToolExecResult {
        match self.store.list_specs_by_project(project_id) {
            Ok(specs) => {
                let summaries: Vec<Value> = specs
                    .iter()
                    .map(|s| {
                        json!({
                            "spec_id": s.spec_id.to_string(),
                            "title": s.title,
                            "order_index": s.order_index,
                            "sprint_id": s.sprint_id.map(|id| id.to_string()),
                        })
                    })
                    .collect();
                ToolExecResult::ok(json!({ "specs": summaries }))
            }
            Err(e) => ToolExecResult::err(e),
        }
    }

    fn get_spec(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let spec_id = match parse_id::<SpecId>(input, "spec_id") {
            Ok(id) => id,
            Err(e) => return e,
        };
        match self.store.get_spec(project_id, &spec_id) {
            Ok(s) => ToolExecResult::ok(json!(s)),
            Err(e) => ToolExecResult::err(e),
        }
    }

    fn create_spec(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let title = str_field(input, "title").unwrap_or_default();
        let markdown = str_field(input, "markdown_contents").unwrap_or_default();
        let sprint_id = str_field(input, "sprint_id")
            .and_then(|s| s.parse::<SprintId>().ok());

        let existing = self.store.list_specs_by_project(project_id).unwrap_or_default();
        let order = existing.iter().map(|s| s.order_index).max().unwrap_or(0) + 1;

        let now = Utc::now();
        let spec = Spec {
            spec_id: SpecId::new(),
            project_id: *project_id,
            title,
            order_index: order,
            markdown_contents: markdown,
            sprint_id,
            created_at: now,
            updated_at: now,
        };
        match self.store.put_spec(&spec) {
            Ok(()) => ToolExecResult::ok_with_spec(json!(spec), spec),
            Err(e) => ToolExecResult::err(e),
        }
    }

    fn update_spec(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let spec_id = match parse_id::<SpecId>(input, "spec_id") {
            Ok(id) => id,
            Err(e) => return e,
        };
        let mut spec = match self.store.get_spec(project_id, &spec_id) {
            Ok(s) => s,
            Err(e) => return ToolExecResult::err(e),
        };
        if let Some(t) = str_field(input, "title") {
            spec.title = t;
        }
        if let Some(m) = str_field(input, "markdown_contents") {
            spec.markdown_contents = m;
        }
        spec.updated_at = Utc::now();
        match self.store.put_spec(&spec) {
            Ok(()) => ToolExecResult::ok_with_spec(json!(spec), spec),
            Err(e) => ToolExecResult::err(e),
        }
    }

    fn delete_spec(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let spec_id = match parse_id::<SpecId>(input, "spec_id") {
            Ok(id) => id,
            Err(e) => return e,
        };
        if let Ok(tasks) = self.store.list_tasks_by_spec(project_id, &spec_id) {
            for t in &tasks {
                let _ = self.store.delete_task(project_id, &spec_id, &t.task_id);
            }
        }
        match self.store.delete_spec(project_id, &spec_id) {
            Ok(()) => ToolExecResult::ok(json!({ "deleted": spec_id.to_string() })),
            Err(e) => ToolExecResult::err(e),
        }
    }

    // -----------------------------------------------------------------------
    // Task operations
    // -----------------------------------------------------------------------

    fn list_tasks(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let tasks = if let Some(sid) = str_field(input, "spec_id") {
            if let Ok(spec_id) = sid.parse::<SpecId>() {
                self.store.list_tasks_by_spec(project_id, &spec_id)
            } else {
                return ToolExecResult::err("Invalid spec_id");
            }
        } else {
            self.store.list_tasks_by_project(project_id)
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
            Err(e) => ToolExecResult::err(e),
        }
    }

    fn create_task(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let spec_id = match parse_id::<SpecId>(input, "spec_id") {
            Ok(id) => id,
            Err(e) => return e,
        };
        let title = str_field(input, "title").unwrap_or_default();
        let description = str_field(input, "description").unwrap_or_default();

        let existing = self.store.list_tasks_by_spec(project_id, &spec_id).unwrap_or_default();
        let order = existing.iter().map(|t| t.order_index).max().unwrap_or(0) + 1;

        let now = Utc::now();
        let task = Task {
            task_id: TaskId::new(),
            project_id: *project_id,
            spec_id,
            title,
            description,
            status: TaskStatus::Ready,
            order_index: order,
            dependency_ids: vec![],
            parent_task_id: None,
            assigned_agent_instance_id: None,
            session_id: None,
            execution_notes: String::new(),
            files_changed: vec![],
            live_output: String::new(),
            build_steps: vec![],
            test_steps: vec![],
            user_id: None,
            model: None,
            total_input_tokens: 0,
            total_output_tokens: 0,
            created_at: now,
            updated_at: now,
        };
        match self.store.put_task(&task) {
            Ok(()) => ToolExecResult::ok_with_task(json!(task), task),
            Err(e) => ToolExecResult::err(e),
        }
    }

    fn update_task(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let task_id = match parse_id::<TaskId>(input, "task_id") {
            Ok(id) => id,
            Err(e) => return e,
        };
        let tasks = self.store.list_tasks_by_project(project_id).unwrap_or_default();
        let mut task = match tasks.into_iter().find(|t| t.task_id == task_id) {
            Some(t) => t,
            None => return ToolExecResult::err("Task not found"),
        };
        if let Some(t) = str_field(input, "title") {
            task.title = t;
        }
        if let Some(d) = str_field(input, "description") {
            task.description = d;
        }
        if let Some(s) = str_field(input, "status") {
            if let Ok(new_status) = serde_json::from_value::<TaskStatus>(json!(s)) {
                task.status = new_status;
            }
        }
        task.updated_at = Utc::now();
        match self.store.put_task(&task) {
            Ok(()) => ToolExecResult::ok_with_task(json!(task), task),
            Err(e) => ToolExecResult::err(e),
        }
    }

    fn delete_task(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let task_id = match parse_id::<TaskId>(input, "task_id") {
            Ok(id) => id,
            Err(e) => return e,
        };
        let spec_id = match parse_id::<SpecId>(input, "spec_id") {
            Ok(id) => id,
            Err(e) => return e,
        };
        match self.store.delete_task(project_id, &spec_id, &task_id) {
            Ok(()) => ToolExecResult::ok(json!({ "deleted": task_id.to_string() })),
            Err(e) => ToolExecResult::err(e),
        }
    }

    fn transition_task(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let task_id = match parse_id::<TaskId>(input, "task_id") {
            Ok(id) => id,
            Err(e) => return e,
        };
        let status_str = str_field(input, "status").unwrap_or_default();
        let new_status: TaskStatus = match serde_json::from_value(json!(status_str)) {
            Ok(s) => s,
            Err(_) => return ToolExecResult::err(format!("Invalid status: {status_str}")),
        };

        let tasks = self.store.list_tasks_by_project(project_id).unwrap_or_default();
        let task = match tasks.iter().find(|t| t.task_id == task_id) {
            Some(t) => t,
            None => return ToolExecResult::err("Task not found"),
        };

        match self.task_service.transition_task(project_id, &task.spec_id, &task_id, new_status) {
            Ok(t) => ToolExecResult::ok(json!(t)),
            Err(e) => ToolExecResult::err(format!("{e:?}")),
        }
    }

    // -----------------------------------------------------------------------
    // Sprint operations
    // -----------------------------------------------------------------------

    fn list_sprints(&self, project_id: &ProjectId) -> ToolExecResult {
        match self.store.list_sprints_by_project(project_id) {
            Ok(sprints) => {
                let summaries: Vec<Value> = sprints
                    .iter()
                    .map(|s| {
                        json!({
                            "sprint_id": s.sprint_id.to_string(),
                            "title": s.title,
                            "prompt": s.prompt,
                            "order_index": s.order_index,
                        })
                    })
                    .collect();
                ToolExecResult::ok(json!({ "sprints": summaries }))
            }
            Err(e) => ToolExecResult::err(e),
        }
    }

    fn create_sprint(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let title = str_field(input, "title").unwrap_or_default();
        let prompt = str_field(input, "prompt").unwrap_or_default();

        let existing = self.store.list_sprints_by_project(project_id).unwrap_or_default();
        let order = existing.iter().map(|s| s.order_index).max().unwrap_or(0) + 1;

        let now = Utc::now();
        let sprint = Sprint {
            sprint_id: SprintId::new(),
            project_id: *project_id,
            title,
            prompt,
            order_index: order,
            generated_at: None,
            created_at: now,
            updated_at: now,
        };
        match self.store.put_sprint(&sprint) {
            Ok(()) => ToolExecResult::ok(json!(sprint)),
            Err(e) => ToolExecResult::err(e),
        }
    }

    fn update_sprint(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let sprint_id = match parse_id::<SprintId>(input, "sprint_id") {
            Ok(id) => id,
            Err(e) => return e,
        };
        let mut sprint = match self.store.get_sprint(project_id, &sprint_id) {
            Ok(s) => s,
            Err(e) => return ToolExecResult::err(e),
        };
        if let Some(t) = str_field(input, "title") {
            sprint.title = t;
        }
        if let Some(p) = str_field(input, "prompt") {
            sprint.prompt = p;
        }
        sprint.updated_at = Utc::now();
        match self.store.put_sprint(&sprint) {
            Ok(()) => ToolExecResult::ok(json!(sprint)),
            Err(e) => ToolExecResult::err(e),
        }
    }

    fn delete_sprint(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let sprint_id = match parse_id::<SprintId>(input, "sprint_id") {
            Ok(id) => id,
            Err(e) => return e,
        };
        match self.store.delete_sprint(project_id, &sprint_id) {
            Ok(()) => ToolExecResult::ok(json!({ "deleted": sprint_id.to_string() })),
            Err(e) => ToolExecResult::err(e),
        }
    }

    // -----------------------------------------------------------------------
    // Project operations
    // -----------------------------------------------------------------------

    fn get_project(&self, project_id: &ProjectId) -> ToolExecResult {
        match self.project_service.get_project(project_id) {
            Ok(p) => ToolExecResult::ok(json!(p)),
            Err(e) => ToolExecResult::err(format!("{e:?}")),
        }
    }

    fn update_project(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let update = UpdateProjectInput {
            name: str_field(input, "name"),
            description: str_field(input, "description"),
            linked_folder_path: None,
            github_integration_id: None,
            github_repo_full_name: None,
            build_command: str_field(input, "build_command"),
            test_command: str_field(input, "test_command"),
        };
        match self.project_service.update_project(project_id, update) {
            Ok(p) => ToolExecResult::ok(json!(p)),
            Err(e) => ToolExecResult::err(format!("{e:?}")),
        }
    }

    // -----------------------------------------------------------------------
    // Filesystem operations (sandboxed to project folder)
    // -----------------------------------------------------------------------

    fn resolve_project_path(&self, project_id: &ProjectId, rel: &str) -> Result<std::path::PathBuf, ToolExecResult> {
        let project = self.project_service.get_project(project_id)
            .map_err(|e| ToolExecResult::err(format!("Project not found: {e:?}")))?;
        let base = Path::new(&project.linked_folder_path);
        let target = base.join(rel);

        let norm_base = lexical_normalize(base);
        let norm_target = lexical_normalize(&target);
        if !norm_target.starts_with(&norm_base) {
            return Err(ToolExecResult::err(format!(
                "Path escape: {rel} resolves outside the project folder"
            )));
        }
        Ok(norm_target)
    }

    fn read_file(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let rel = str_field(input, "path").unwrap_or_default();
        let abs = match self.resolve_project_path(project_id, &rel) {
            Ok(p) => p,
            Err(e) => return e,
        };
        match std::fs::read_to_string(&abs) {
            Ok(content) => ToolExecResult::ok(json!({ "path": rel, "content": content })),
            Err(e) => ToolExecResult::err(format!("Failed to read {rel}: {e}")),
        }
    }

    fn write_file(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let rel = str_field(input, "path").unwrap_or_default();
        let content = str_field(input, "content").unwrap_or_default();
        let abs = match self.resolve_project_path(project_id, &rel) {
            Ok(p) => p,
            Err(e) => return e,
        };
        if let Some(parent) = abs.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                return ToolExecResult::err(format!("Failed to create directories: {e}"));
            }
        }
        match std::fs::write(&abs, &content) {
            Ok(()) => ToolExecResult::ok(json!({ "path": rel, "bytes_written": content.len() })),
            Err(e) => ToolExecResult::err(format!("Failed to write {rel}: {e}")),
        }
    }

    fn delete_file(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let rel = str_field(input, "path").unwrap_or_default();
        let abs = match self.resolve_project_path(project_id, &rel) {
            Ok(p) => p,
            Err(e) => return e,
        };
        match std::fs::remove_file(&abs) {
            Ok(()) => ToolExecResult::ok(json!({ "deleted": rel })),
            Err(e) => ToolExecResult::err(format!("Failed to delete {rel}: {e}")),
        }
    }

    fn list_files(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let rel = str_field(input, "path").unwrap_or_else(|| ".".to_string());
        let abs = match self.resolve_project_path(project_id, &rel) {
            Ok(p) => p,
            Err(e) => return e,
        };
        let entries = match std::fs::read_dir(&abs) {
            Ok(rd) => rd,
            Err(e) => return ToolExecResult::err(format!("Failed to list {rel}: {e}")),
        };
        let mut items: Vec<Value> = Vec::new();
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name == "node_modules" || name == "target" || name == "__pycache__" {
                continue;
            }
            let is_dir = entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
            items.push(json!({ "name": name, "is_dir": is_dir }));
        }
        items.sort_by(|a, b| {
            let a_dir = a["is_dir"].as_bool().unwrap_or(false);
            let b_dir = b["is_dir"].as_bool().unwrap_or(false);
            b_dir.cmp(&a_dir).then_with(|| {
                a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or(""))
            })
        });
        ToolExecResult::ok(json!({ "path": rel, "entries": items }))
    }

    // -----------------------------------------------------------------------
    // Targeted editing
    // -----------------------------------------------------------------------

    fn edit_file(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let rel = str_field(input, "path").unwrap_or_default();
        let old_text = str_field(input, "old_text").unwrap_or_default();
        let new_text = str_field(input, "new_text").unwrap_or_default();
        let replace_all = input
            .get("replace_all")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        if rel.is_empty() {
            return ToolExecResult::err("Missing required field: path");
        }
        if old_text.is_empty() {
            return ToolExecResult::err("Missing required field: old_text");
        }

        let abs = match self.resolve_project_path(project_id, &rel) {
            Ok(p) => p,
            Err(e) => return e,
        };

        let content = match std::fs::read_to_string(&abs) {
            Ok(c) => c,
            Err(e) => return ToolExecResult::err(format!("Failed to read {rel}: {e}")),
        };

        let occurrence_count = content.matches(&old_text).count();
        if occurrence_count == 0 {
            return ToolExecResult::err(format!(
                "old_text not found in {rel}. Make sure it matches the file content exactly, including whitespace."
            ));
        }

        if !replace_all && occurrence_count > 1 {
            return ToolExecResult::err(format!(
                "old_text matches {occurrence_count} locations in {rel}. \
                 Provide more surrounding context to make the match unique, \
                 or set replace_all to true."
            ));
        }

        let new_content = if replace_all {
            content.replace(&old_text, &new_text)
        } else {
            content.replacen(&old_text, &new_text, 1)
        };

        match std::fs::write(&abs, &new_content) {
            Ok(()) => ToolExecResult::ok(json!({
                "path": rel,
                "replacements": if replace_all { occurrence_count } else { 1 },
                "new_size": new_content.len()
            })),
            Err(e) => ToolExecResult::err(format!("Failed to write {rel}: {e}")),
        }
    }

    // -----------------------------------------------------------------------
    // Shell operations
    // -----------------------------------------------------------------------

    async fn run_command(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let command = match str_field(input, "command") {
            Some(c) if !c.trim().is_empty() => c,
            _ => return ToolExecResult::err("Missing required field: command"),
        };

        let working_dir_rel = str_field(input, "working_dir").unwrap_or_else(|| ".".to_string());
        let abs_dir = match self.resolve_project_path(project_id, &working_dir_rel) {
            Ok(p) => p,
            Err(e) => return e,
        };

        let timeout_secs = input
            .get("timeout_secs")
            .and_then(|v| v.as_u64())
            .unwrap_or(60)
            .min(300);

        info!(command = %command, cwd = %abs_dir.display(), timeout_secs, "Running shell command");

        let (shell, flag) = if cfg!(windows) {
            ("cmd", "/C")
        } else {
            ("sh", "-c")
        };

        let result = tokio::time::timeout(
            std::time::Duration::from_secs(timeout_secs),
            tokio::process::Command::new(shell)
                .arg(flag)
                .arg(&command)
                .current_dir(&abs_dir)
                .output(),
        )
        .await;

        match result {
            Ok(Ok(output)) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                let exit_code = output.status.code().unwrap_or(-1);

                let truncated_stdout = truncate_output(&stdout, 8000);
                let truncated_stderr = truncate_output(&stderr, 4000);

                let is_error = !output.status.success();
                ToolExecResult {
                    content: serde_json::to_string_pretty(&json!({
                        "exit_code": exit_code,
                        "stdout": truncated_stdout,
                        "stderr": truncated_stderr,
                        "command": command,
                    }))
                    .unwrap_or_default(),
                    is_error,
                    saved_spec: None,
                    saved_task: None,
                }
            }
            Ok(Err(e)) => ToolExecResult::err(format!("Failed to execute command: {e}")),
            Err(_) => ToolExecResult::err(format!(
                "Command timed out after {timeout_secs} seconds"
            )),
        }
    }

    // -----------------------------------------------------------------------
    // Search operations
    // -----------------------------------------------------------------------

    fn search_code(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let pattern = str_field(input, "pattern").unwrap_or_default();
        if pattern.is_empty() {
            return ToolExecResult::err("Missing required field: pattern");
        }
        let rel = str_field(input, "path").unwrap_or_else(|| ".".to_string());
        let abs = match self.resolve_project_path(project_id, &rel) {
            Ok(p) => p,
            Err(e) => return e,
        };
        let include_glob = str_field(input, "include");
        let max_results = input
            .get("max_results")
            .and_then(|v| v.as_u64())
            .unwrap_or(50) as usize;

        let regex = match regex::Regex::new(&pattern) {
            Ok(r) => r,
            Err(e) => return ToolExecResult::err(format!("Invalid regex: {e}")),
        };

        let mut matches: Vec<Value> = Vec::new();
        search_directory(&abs, &abs, &regex, include_glob.as_deref(), max_results, &mut matches);

        ToolExecResult::ok(json!({
            "pattern": pattern,
            "match_count": matches.len(),
            "truncated": matches.len() >= max_results,
            "matches": matches
        }))
    }

    fn find_files(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let pattern = str_field(input, "pattern").unwrap_or_default();
        if pattern.is_empty() {
            return ToolExecResult::err("Missing required field: pattern");
        }
        let rel = str_field(input, "path").unwrap_or_else(|| ".".to_string());
        let abs = match self.resolve_project_path(project_id, &rel) {
            Ok(p) => p,
            Err(e) => return e,
        };

        let glob_pattern = if pattern.contains('/') || pattern.contains('\\') {
            pattern.clone()
        } else if pattern.starts_with("*.") || pattern.starts_with("**") {
            format!("**/{pattern}")
        } else {
            format!("**/{pattern}")
        };

        let full_glob = format!("{}/{}", abs.display(), glob_pattern);
        let mut found: Vec<String> = Vec::new();
        if let Ok(paths) = glob::glob(&full_glob.replace('\\', "/")) {
            for entry in paths.flatten() {
                if let Ok(rel_path) = entry.strip_prefix(&abs) {
                    let p = rel_path.to_string_lossy().replace('\\', "/");
                    if !should_skip_path(&p) {
                        found.push(p);
                    }
                }
                if found.len() >= 200 {
                    break;
                }
            }
        }

        ToolExecResult::ok(json!({
            "pattern": pattern,
            "file_count": found.len(),
            "files": found
        }))
    }

    // -----------------------------------------------------------------------
    // Progress
    // -----------------------------------------------------------------------

    fn get_progress(&self, project_id: &ProjectId) -> ToolExecResult {
        match self.task_service.get_project_progress(project_id) {
            Ok(p) => ToolExecResult::ok(json!(p)),
            Err(e) => ToolExecResult::err(format!("{e:?}")),
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn str_field(input: &Value, key: &str) -> Option<String> {
    input.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
}

fn parse_id<T: std::str::FromStr>(input: &Value, key: &str) -> Result<T, ToolExecResult>
where
    T::Err: std::fmt::Display,
{
    let s = str_field(input, key)
        .ok_or_else(|| ToolExecResult::err(format!("Missing required field: {key}")))?;
    s.parse::<T>()
        .map_err(|e| ToolExecResult::err(format!("Invalid {key}: {e}")))
}

fn lexical_normalize(path: &Path) -> std::path::PathBuf {
    use std::path::Component;
    let mut out = std::path::PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::ParentDir => { out.pop(); }
            Component::CurDir => {}
            other => out.push(other),
        }
    }
    out
}

fn truncate_output(s: &str, max_chars: usize) -> String {
    if s.len() <= max_chars {
        s.to_string()
    } else {
        let half = max_chars / 2;
        let start: String = s.chars().take(half).collect();
        let end: String = s.chars().rev().take(half).collect::<String>().chars().rev().collect();
        format!("{start}\n\n... [truncated {len} chars] ...\n\n{end}", len = s.len() - max_chars)
    }
}

const SKIP_DIRS: &[&str] = &[
    "node_modules", "target", ".git", "__pycache__", ".next", "dist",
    "build", ".cargo", "vendor", ".venv", "venv",
];

fn should_skip_path(path: &str) -> bool {
    path.split('/').any(|segment| SKIP_DIRS.contains(&segment))
}

fn search_directory(
    root: &Path,
    dir: &Path,
    regex: &regex::Regex,
    include_glob: Option<&str>,
    max_results: usize,
    matches: &mut Vec<Value>,
) {
    let entries = match std::fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        if matches.len() >= max_results {
            return;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if SKIP_DIRS.contains(&name.as_str()) || name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            search_directory(root, &path, regex, include_glob, max_results, matches);
        } else if path.is_file() {
            if let Some(glob_pat) = include_glob {
                if let Ok(matcher) = glob::Pattern::new(glob_pat) {
                    if !matcher.matches(&name) {
                        continue;
                    }
                }
            }
            let rel = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");

            if let Ok(content) = std::fs::read_to_string(&path) {
                for (line_num, line) in content.lines().enumerate() {
                    if matches.len() >= max_results {
                        return;
                    }
                    if regex.is_match(line) {
                        matches.push(json!({
                            "file": rel,
                            "line": line_num + 1,
                            "content": line.chars().take(200).collect::<String>()
                        }));
                    }
                }
            }
        }
    }
}
