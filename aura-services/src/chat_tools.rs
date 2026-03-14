use crate::claude::ToolDefinition;

fn tool(name: &str, description: &str, schema: serde_json::Value) -> ToolDefinition {
    ToolDefinition {
        name: name.into(),
        description: description.into(),
        input_schema: schema,
    }
}

/// Returns the full set of tools the chat agent can invoke.
pub fn agent_tool_definitions() -> Vec<ToolDefinition> {
    vec![
        // ── Specs ──────────────────────────────────────────────────────
        tool(
            "list_specs",
            "List all specs in the current project.",
            serde_json::json!({
                "type": "object",
                "properties": {},
                "required": []
            }),
        ),
        tool(
            "get_spec",
            "Get a single spec by ID.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "spec_id": { "type": "string", "description": "The spec ID" }
                },
                "required": ["spec_id"]
            }),
        ),
        tool(
            "create_spec",
            "Create a new spec in the project.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "markdown_contents": { "type": "string", "description": "Full markdown body of the spec" },
                    "sprint_id": { "type": "string", "description": "Optional sprint to attach this spec to" }
                },
                "required": ["title", "markdown_contents"]
            }),
        ),
        tool(
            "update_spec",
            "Update an existing spec's title or contents.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "spec_id": { "type": "string" },
                    "title": { "type": "string" },
                    "markdown_contents": { "type": "string" }
                },
                "required": ["spec_id"]
            }),
        ),
        tool(
            "delete_spec",
            "Delete a spec and its tasks from the project.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "spec_id": { "type": "string" }
                },
                "required": ["spec_id"]
            }),
        ),
        // ── Tasks ──────────────────────────────────────────────────────
        tool(
            "list_tasks",
            "List all tasks in the project, optionally filtered by spec_id.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "spec_id": { "type": "string", "description": "If provided, only list tasks under this spec" }
                },
                "required": []
            }),
        ),
        tool(
            "create_task",
            "Create a new task under a spec.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "spec_id": { "type": "string" },
                    "title": { "type": "string" },
                    "description": { "type": "string" }
                },
                "required": ["spec_id", "title", "description"]
            }),
        ),
        tool(
            "update_task",
            "Update a task's title, description, or status.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "task_id": { "type": "string" },
                    "title": { "type": "string" },
                    "description": { "type": "string" },
                    "status": {
                        "type": "string",
                        "enum": ["pending", "ready", "in_progress", "blocked", "done", "failed"]
                    }
                },
                "required": ["task_id"]
            }),
        ),
        tool(
            "delete_task",
            "Delete a task from the project.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "task_id": { "type": "string" },
                    "spec_id": { "type": "string", "description": "The parent spec ID (required for storage key)" }
                },
                "required": ["task_id", "spec_id"]
            }),
        ),
        tool(
            "transition_task",
            "Transition a task to a new status (e.g. pending -> ready, ready -> done).",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "task_id": { "type": "string" },
                    "status": {
                        "type": "string",
                        "enum": ["pending", "ready", "in_progress", "blocked", "done", "failed"]
                    }
                },
                "required": ["task_id", "status"]
            }),
        ),
        tool(
            "run_task",
            "Trigger execution of a single task by the dev-loop engine.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "task_id": { "type": "string" }
                },
                "required": ["task_id"]
            }),
        ),
        // ── Sprints ────────────────────────────────────────────────────
        tool(
            "list_sprints",
            "List all sprints in the current project.",
            serde_json::json!({
                "type": "object",
                "properties": {},
                "required": []
            }),
        ),
        tool(
            "create_sprint",
            "Create a new sprint.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "prompt": { "type": "string", "description": "The user prompt / description for what this sprint should accomplish" }
                },
                "required": ["title", "prompt"]
            }),
        ),
        tool(
            "update_sprint",
            "Update a sprint's title or prompt.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "sprint_id": { "type": "string" },
                    "title": { "type": "string" },
                    "prompt": { "type": "string" }
                },
                "required": ["sprint_id"]
            }),
        ),
        tool(
            "delete_sprint",
            "Delete a sprint from the project.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "sprint_id": { "type": "string" }
                },
                "required": ["sprint_id"]
            }),
        ),
        // ── Project ────────────────────────────────────────────────────
        tool(
            "get_project",
            "Get the current project's details (name, folder, status, etc.).",
            serde_json::json!({
                "type": "object",
                "properties": {},
                "required": []
            }),
        ),
        tool(
            "update_project",
            "Update the current project's name, description, build_command, or test_command.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "name": { "type": "string" },
                    "description": { "type": "string" },
                    "build_command": {
                        "type": "string",
                        "description": "The exact shell command to run for build verification, e.g. \"cargo build --workspace\" or \"npm run build\". Must be a valid shell command with NO extra text or explanation — only the command itself."
                    },
                    "test_command": {
                        "type": "string",
                        "description": "The exact shell command to run tests, e.g. \"cargo test\" or \"npm test\". Must be a valid shell command with NO extra text or explanation — only the command itself."
                    }
                },
                "required": []
            }),
        ),
        // ── Dev loop ───────────────────────────────────────────────────
        tool(
            "start_dev_loop",
            "Start the autonomous dev loop for the project. It will pick up ready tasks and execute them.",
            serde_json::json!({
                "type": "object",
                "properties": {},
                "required": []
            }),
        ),
        tool(
            "pause_dev_loop",
            "Pause the currently running dev loop.",
            serde_json::json!({
                "type": "object",
                "properties": {},
                "required": []
            }),
        ),
        tool(
            "stop_dev_loop",
            "Stop the currently running dev loop.",
            serde_json::json!({
                "type": "object",
                "properties": {},
                "required": []
            }),
        ),
        // ── Filesystem ─────────────────────────────────────────────────
        tool(
            "read_file",
            "Read the contents of a file relative to the project folder.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Relative path from project root" }
                },
                "required": ["path"]
            }),
        ),
        tool(
            "write_file",
            "Write (create or overwrite) a file relative to the project folder.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Relative path from project root" },
                    "content": { "type": "string", "description": "Full file content" }
                },
                "required": ["path", "content"]
            }),
        ),
        tool(
            "delete_file",
            "Delete a file relative to the project folder.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Relative path from project root" }
                },
                "required": ["path"]
            }),
        ),
        tool(
            "list_files",
            "List files and directories in a path relative to the project folder.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Relative directory path (empty or '.' for project root)" }
                },
                "required": []
            }),
        ),
        // ── Search ─────────────────────────────────────────────────────
        tool(
            "search_code",
            "Search for a regex pattern across files in the project. Returns matching lines with file paths and line numbers. Useful for finding usages, definitions, and references.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "pattern": { "type": "string", "description": "Regex pattern to search for" },
                    "path": { "type": "string", "description": "Optional relative directory or file path to scope the search (default: project root)" },
                    "include": { "type": "string", "description": "Optional glob to filter files, e.g. '*.rs' or '*.ts'" },
                    "max_results": { "type": "integer", "description": "Maximum number of matching lines to return (default: 50)" }
                },
                "required": ["pattern"]
            }),
        ),
        tool(
            "find_files",
            "Find files by name or glob pattern in the project directory. Returns matching file paths.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "pattern": { "type": "string", "description": "Glob pattern to match file names, e.g. '*.rs', 'Cargo.toml', 'src/**/*.ts'" },
                    "path": { "type": "string", "description": "Optional relative directory to scope the search (default: project root)" }
                },
                "required": ["pattern"]
            }),
        ),
        // ── Progress ───────────────────────────────────────────────────
        tool(
            "get_progress",
            "Get task progress summary for the project (counts by status).",
            serde_json::json!({
                "type": "object",
                "properties": {},
                "required": []
            }),
        ),
    ]
}
