use std::path::Path;

use chrono::Utc;
use serde_json::{json, Value};
use tracing::info;

use aura_core::*;
use aura_projects::UpdateProjectInput;

use crate::chat_tool_executor::{ChatToolExecutor, ToolExecResult};

impl ChatToolExecutor {
    /// Resolve a `spec_id` field that may be a UUID, a title prefix like "01",
    /// or a numeric order index. Falls back to matching against existing specs
    /// when UUID parsing fails so the LLM doesn't need to get the format right.
    fn resolve_spec_id(
        &self,
        project_id: &ProjectId,
        input: &Value,
    ) -> Result<SpecId, ToolExecResult> {
        let raw = str_field(input, "spec_id")
            .ok_or_else(|| ToolExecResult::err("Missing required field: spec_id"))?;

        if let Ok(id) = raw.parse::<SpecId>() {
            return Ok(id);
        }

        let specs = self
            .store
            .list_specs_by_project(project_id)
            .map_err(|e| ToolExecResult::err(format!("Failed to list specs: {e}")))?;

        if let Some(spec) = specs.iter().find(|s| s.title.starts_with(&format!("{raw}:"))) {
            return Ok(spec.spec_id);
        }

        if let Ok(n) = raw.parse::<u32>() {
            let idx = if n > 0 { n - 1 } else { n };
            if let Some(spec) = specs.iter().find(|s| s.order_index == idx) {
                return Ok(spec.spec_id);
            }
            if let Some(spec) = specs.iter().find(|s| s.order_index == n) {
                return Ok(spec.spec_id);
            }
        }

        Err(ToolExecResult::err(format!(
            "Could not resolve spec_id '{raw}'. Use the UUID returned by list_specs or create_spec."
        )))
    }

    // -----------------------------------------------------------------------
    // Spec operations
    // -----------------------------------------------------------------------

    pub(crate) fn list_specs(&self, project_id: &ProjectId) -> ToolExecResult {
        match self.store.list_specs_by_project(project_id) {
            Ok(specs) => {
                let summaries: Vec<Value> = specs
                    .iter()
                    .map(|s| {
                        json!({
                            "spec_id": s.spec_id.to_string(),
                            "title": s.title,
                            "order_index": s.order_index,
                        })
                    })
                    .collect();
                ToolExecResult::ok(json!({ "specs": summaries }))
            }
            Err(e) => ToolExecResult::err(e),
        }
    }

    pub(crate) fn get_spec(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let spec_id = match self.resolve_spec_id(project_id, input) {
            Ok(id) => id,
            Err(e) => return e,
        };
        match self.store.get_spec(project_id, &spec_id) {
            Ok(s) => ToolExecResult::ok(json!(s)),
            Err(e) => ToolExecResult::err(e),
        }
    }

    pub(crate) fn create_spec(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let title = str_field(input, "title").unwrap_or_default();
        let markdown = str_field(input, "markdown_contents").unwrap_or_default();

        let existing = self.store.list_specs_by_project(project_id).unwrap_or_default();
        let order = existing.iter().map(|s| s.order_index).max().unwrap_or(0) + 1;

        let now = Utc::now();
        let spec = Spec {
            spec_id: SpecId::new(),
            project_id: *project_id,
            title,
            order_index: order,
            markdown_contents: markdown,
            created_at: now,
            updated_at: now,
        };
        match self.store.put_spec(&spec) {
            Ok(()) => ToolExecResult::ok_with_spec(json!(spec), spec),
            Err(e) => ToolExecResult::err(e),
        }
    }

    pub(crate) fn update_spec(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let spec_id = match self.resolve_spec_id(project_id, input) {
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

    pub(crate) fn delete_spec(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let spec_id = match self.resolve_spec_id(project_id, input) {
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

    pub(crate) fn list_tasks(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let tasks = if str_field(input, "spec_id").is_some() {
            match self.resolve_spec_id(project_id, input) {
                Ok(spec_id) => self.store.list_tasks_by_spec(project_id, &spec_id),
                Err(e) => return e,
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

    pub(crate) fn create_task(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let spec_id = match self.resolve_spec_id(project_id, input) {
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
            completed_by_agent_instance_id: None,
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

    pub(crate) fn update_task(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
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

    pub(crate) fn delete_task(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let task_id = match parse_id::<TaskId>(input, "task_id") {
            Ok(id) => id,
            Err(e) => return e,
        };
        let spec_id = match self.resolve_spec_id(project_id, input) {
            Ok(id) => id,
            Err(e) => return e,
        };
        match self.store.delete_task(project_id, &spec_id, &task_id) {
            Ok(()) => ToolExecResult::ok(json!({ "deleted": task_id.to_string() })),
            Err(e) => ToolExecResult::err(e),
        }
    }

    pub(crate) fn transition_task(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
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
    // Project operations
    // -----------------------------------------------------------------------

    pub(crate) fn get_project(&self, project_id: &ProjectId) -> ToolExecResult {
        match self.project_service.get_project(project_id) {
            Ok(p) => ToolExecResult::ok(json!(p)),
            Err(e) => ToolExecResult::err(format!("{e:?}")),
        }
    }

    pub(crate) fn update_project(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let update = UpdateProjectInput {
            name: str_field(input, "name"),
            description: str_field(input, "description"),
            linked_folder_path: None,
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

    pub(crate) fn read_file(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
        let rel = str_field(input, "path").unwrap_or_default();
        let abs = match self.resolve_project_path(project_id, &rel) {
            Ok(p) => p,
            Err(e) => return e,
        };
        let start_line = input.get("start_line").and_then(|v| v.as_u64()).map(|n| n as usize);
        let end_line = input.get("end_line").and_then(|v| v.as_u64()).map(|n| n as usize);

        match std::fs::read_to_string(&abs) {
            Ok(content) => {
                if start_line.is_some() || end_line.is_some() {
                    let lines: Vec<&str> = content.lines().collect();
                    let total = lines.len();
                    let start = start_line.unwrap_or(1).max(1) - 1;
                    let end = end_line.unwrap_or(total).min(total);
                    if start >= total {
                        return ToolExecResult::err(format!(
                            "start_line {} is beyond end of file ({} lines)",
                            start + 1, total,
                        ));
                    }
                    let selected: Vec<String> = lines[start..end]
                        .iter()
                        .enumerate()
                        .map(|(i, line)| format!("{:>5}| {}", start + i + 1, line))
                        .collect();
                    ToolExecResult::ok(json!({
                        "path": rel,
                        "start_line": start + 1,
                        "end_line": end,
                        "total_lines": total,
                        "content": selected.join("\n"),
                    }))
                } else {
                    ToolExecResult::ok(json!({ "path": rel, "content": content }))
                }
            }
            Err(e) => ToolExecResult::err(format!("Failed to read {rel}: {e}")),
        }
    }

    pub(crate) fn write_file(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
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
            Ok(()) => {
                let line_count = content.lines().count();
                ToolExecResult::ok(json!({
                    "status": "ok",
                    "path": rel,
                    "bytes_written": content.len(),
                    "line_count": line_count,
                    "message": format!(
                        "Successfully wrote {} lines ({} bytes) to {}. \
                         The file is complete and correct -- do NOT re-read to verify. \
                         Proceed to compilation to catch any issues.",
                        line_count, content.len(), rel,
                    ),
                }))
            }
            Err(e) => ToolExecResult::err(format!("Failed to write {rel}: {e}")),
        }
    }

    pub(crate) fn delete_file(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
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

    pub(crate) fn list_files(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
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

    pub(crate) fn edit_file(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
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
                "status": "ok",
                "path": rel,
                "replacements": if replace_all { occurrence_count } else { 1 },
                "new_size": new_content.len(),
                "message": format!(
                    "Edit applied successfully ({} replacement{}). Do NOT re-read to verify.",
                    if replace_all { occurrence_count } else { 1 },
                    if replace_all && occurrence_count != 1 { "s" } else { "" },
                ),
            })),
            Err(e) => ToolExecResult::err(format!("Failed to write {rel}: {e}")),
        }
    }

    // -----------------------------------------------------------------------
    // Shell operations
    // -----------------------------------------------------------------------

    pub(crate) async fn run_command(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
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

    pub(crate) fn search_code(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
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
        let context_lines = input
            .get("context_lines")
            .and_then(|v| v.as_u64())
            .unwrap_or(0)
            .min(10) as usize;

        let regex = match regex::Regex::new(&pattern) {
            Ok(r) => r,
            Err(e) => return ToolExecResult::err(format!("Invalid regex: {e}")),
        };

        let mut matches: Vec<Value> = Vec::new();
        search_directory(&abs, &abs, &regex, include_glob.as_deref(), max_results, context_lines, &mut matches);

        ToolExecResult::ok(json!({
            "pattern": pattern,
            "match_count": matches.len(),
            "truncated": matches.len() >= max_results,
            "matches": matches
        }))
    }

    pub(crate) fn find_files(&self, project_id: &ProjectId, input: &Value) -> ToolExecResult {
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

    pub(crate) fn get_progress(&self, project_id: &ProjectId) -> ToolExecResult {
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
    context_lines: usize,
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
            search_directory(root, &path, regex, include_glob, max_results, context_lines, matches);
        } else if path.is_file() {
            let rel = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            if let Some(glob_pat) = include_glob {
                if let Ok(matcher) = glob::Pattern::new(glob_pat) {
                    if !matcher.matches(&rel) && !matcher.matches(&name) {
                        continue;
                    }
                }
            }

            if let Ok(content) = std::fs::read_to_string(&path) {
                let all_lines: Vec<&str> = content.lines().collect();
                for (line_num, line) in all_lines.iter().enumerate() {
                    if matches.len() >= max_results {
                        return;
                    }
                    if regex.is_match(line) {
                        if context_lines > 0 {
                            let start = line_num.saturating_sub(context_lines);
                            let end = (line_num + context_lines + 1).min(all_lines.len());
                            let context: Vec<String> = all_lines[start..end]
                                .iter()
                                .enumerate()
                                .map(|(i, l)| {
                                    let ln = start + i + 1;
                                    let marker = if start + i == line_num { ">" } else { " " };
                                    format!("{marker}{ln:>5}| {}", l.chars().take(200).collect::<String>())
                                })
                                .collect();
                            matches.push(json!({
                                "file": rel,
                                "line": line_num + 1,
                                "content": context.join("\n"),
                            }));
                        } else {
                            matches.push(json!({
                                "file": rel,
                                "line": line_num + 1,
                                "content": line.chars().take(200).collect::<String>(),
                            }));
                        }
                    }
                }
            }
        }
    }
}
