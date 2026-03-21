use std::sync::{Arc, LazyLock};
use aura_claude::ToolDefinition;

static AGENT_TOOLS: LazyLock<Arc<[ToolDefinition]>> = LazyLock::new(|| {
    chat_tool_definitions_inner().into()
});

static ENGINE_TOOLS: LazyLock<Arc<[ToolDefinition]>> = LazyLock::new(|| {
    engine_tool_definitions_inner().into()
});

static MULTI_PROJECT_TOOLS: LazyLock<Arc<[ToolDefinition]>> = LazyLock::new(|| {
    multi_project_tool_definitions_inner().into()
});

/// Return type for lazily cached tool definitions. Callers can use this
/// as `&[ToolDefinition]` (via Deref) or convert to `Vec` cheaply.
pub type ToolDefs = Arc<[ToolDefinition]>;

fn tool(name: &str, description: &str, schema: serde_json::Value) -> ToolDefinition {
    ToolDefinition {
        name: name.into(),
        description: description.into(),
        input_schema: schema,
        cache_control: None,
    }
}

/// Build a tool definition with property-level descriptions stripped from the
/// JSON schema. Keeps property names, types, enums, required, and nested
/// structure — only removes the verbose "description" field on each property.
/// Used for management tools that are invoked less frequently, saving ~5-8K
/// tokens per turn from the tool block.
fn compact_tool(name: &str, description: &str, schema: serde_json::Value) -> ToolDefinition {
    ToolDefinition {
        name: name.into(),
        description: description.into(),
        input_schema: strip_property_descriptions(schema),
        cache_control: None,
    }
}

fn strip_property_descriptions(mut schema: serde_json::Value) -> serde_json::Value {
    if let Some(props) = schema.get_mut("properties").and_then(|p| p.as_object_mut()) {
        for (_key, prop_val) in props.iter_mut() {
            if let Some(obj) = prop_val.as_object_mut() {
                obj.remove("description");
            }
        }
    }
    schema
}

/// Core filesystem, search, and shell tools shared by both chat agent and engine.
pub fn core_tool_definitions() -> Vec<ToolDefinition> {
    let mut tools = filesystem_tools();
    tools.extend(shell_tools());
    tools.extend(search_tools());
    tools
}

fn filesystem_tools() -> Vec<ToolDefinition> {
    vec![
        tool(
            "read_file",
            "Read the contents of a file relative to the project folder. Optionally read a specific line range (1-indexed) to avoid truncation in large files.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Relative path from project root" },
                    "start_line": { "type": "integer", "description": "First line to read (1-indexed, inclusive). Omit to read from the beginning." },
                    "end_line": { "type": "integer", "description": "Last line to read (1-indexed, inclusive). Omit to read to the end." }
                },
                "required": ["path"]
            }),
        ),
        tool(
            "write_file",
            "Write (create or overwrite) a file relative to the project folder. Best for files under ~150 lines. For larger files, write a skeleton first then use edit_file to fill in sections incrementally.",
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
        tool(
            "edit_file",
            "Make targeted edits to a file by replacing specific text. More efficient than write_file for small changes in large files. The old_text must be an exact match of existing content.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Relative path from project root" },
                    "old_text": { "type": "string", "description": "Exact text to find and replace (must be unique in the file)" },
                    "new_text": { "type": "string", "description": "Replacement text" },
                    "replace_all": { "type": "boolean", "description": "If true, replace all occurrences (default: false, first only)" }
                },
                "required": ["path", "old_text", "new_text"]
            }),
        ),
    ]
}

fn shell_tools() -> Vec<ToolDefinition> {
    vec![
        tool(
            "run_command",
            "Execute a shell command in the project directory. Use ONLY for build, test, git, and package manager commands. Do NOT use for searching code (use search_code), reading files (use read_file), or finding files (use find_files). Commands time out after 60 seconds by default.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "The shell command to execute" },
                    "working_dir": { "type": "string", "description": "Optional relative working directory within the project (default: project root)" },
                    "timeout_secs": { "type": "integer", "description": "Timeout in seconds (default: 60, max: 300)" }
                },
                "required": ["command"]
            }),
        ),
    ]
}

fn search_tools() -> Vec<ToolDefinition> {
    vec![
        tool(
            "search_code",
            "Search for a regex pattern across files in the project. Returns matching lines with file paths and line numbers. Use context_lines to include surrounding code (e.g. to see a full struct or function body around a match).",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "pattern": { "type": "string", "description": "Regex pattern to search for" },
                    "path": { "type": "string", "description": "Optional relative directory or file path to scope the search (default: project root)" },
                    "include": { "type": "string", "description": "Optional glob to filter files, e.g. '*.rs' or '*.ts'" },
                    "max_results": { "type": "integer", "description": "Maximum number of matching lines to return (default: 50)" },
                    "context_lines": { "type": "integer", "description": "Number of lines to include before and after each match (default: 0, max: 10)" }
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
    ]
}

fn chat_tool_definitions_inner() -> Vec<ToolDefinition> {
    let mut tools = core_tool_definitions();
    tools.extend(chat_management_tools());
    tools
}

fn engine_tool_definitions_inner() -> Vec<ToolDefinition> {
    let mut tools = core_tool_definitions();
    tools.extend(vec![
        tool(
            "task_done",
            "Signal that the current task is complete. Call this when you have finished all changes and verified they compile. Provide notes summarizing what you did and optionally follow-up task suggestions.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "notes": { "type": "string", "description": "Summary of what was done" },
                    "follow_ups": {
                        "type": "array",
                        "description": "Optional follow-up task suggestions",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": { "type": "string" },
                                "description": { "type": "string" }
                            },
                            "required": ["title", "description"]
                        }
                    }
                },
                "required": ["notes"]
            }),
        ),
        tool(
            "get_task_context",
            "Retrieve the full context for the current task including the spec, task description, and any prior execution notes.",
            serde_json::json!({
                "type": "object",
                "properties": {},
                "required": []
            }),
        ),
        tool(
            "submit_plan",
            "Submit your implementation plan before making any file changes. \
             You MUST call this after exploration and before any write_file/edit_file \
             calls. The plan is validated and becomes your reference during implementation.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "approach": {
                        "type": "string",
                        "description": "Your implementation strategy (2-4 sentences)"
                    },
                    "files_to_modify": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Existing files you will edit"
                    },
                    "files_to_create": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "New files you will create"
                    },
                    "key_decisions": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Key design decisions and why"
                    }
                },
                "required": ["approach", "files_to_modify", "files_to_create"]
            }),
        ),
    ]);
    tools
}

/// Returns the full set of tools the chat agent can invoke (lazily cached).
pub fn agent_tool_definitions() -> ToolDefs {
    Arc::clone(&AGENT_TOOLS)
}

/// Returns engine tool definitions (lazily cached).
pub fn engine_tool_definitions() -> ToolDefs {
    Arc::clone(&ENGINE_TOOLS)
}

/// Returns tool definitions for multi-project agent chat (lazily cached).
pub fn multi_project_tool_definitions() -> ToolDefs {
    Arc::clone(&MULTI_PROJECT_TOOLS)
}

fn multi_project_tool_definitions_inner() -> Vec<ToolDefinition> {
    chat_tool_definitions_inner()
        .into_iter()
        .map(|mut td| {
            if let Some(props) = td.input_schema.get_mut("properties") {
                props.as_object_mut().unwrap().insert(
                    "project_id".to_string(),
                    serde_json::json!({
                        "type": "string",
                        "description": "The project ID to operate on (required for multi-project context)"
                    }),
                );
            }
            if let Some(req) = td.input_schema.get_mut("required") {
                if let Some(arr) = req.as_array_mut() {
                    arr.insert(0, serde_json::json!("project_id"));
                }
            }
            td
        })
        .collect()
}

fn chat_management_tools() -> Vec<ToolDefinition> {
    let mut tools = spec_tool_definitions();
    tools.extend(task_tool_definitions());
    tools.extend(project_tool_definitions());
    tools.extend(dev_loop_tool_definitions());
    tools
}

fn spec_tool_definitions() -> Vec<ToolDefinition> {
    vec![
        compact_tool("list_specs", "List all specs in the current project.", serde_json::json!({"type":"object","properties":{},"required":[]})),
        compact_tool("get_spec", "Get a single spec by its UUID spec_id (from list_specs or create_spec output, NOT the title number).", serde_json::json!({"type":"object","properties":{"spec_id":{"type":"string","description":"The spec ID"}},"required":["spec_id"]})),
        compact_tool("create_spec", "Create a new spec. When creating from a requirements document, create one spec per logical phase (multiple calls); title format '01: Name', '02: Name'; markdown: Purpose, Interfaces, Tasks table (1.0/1.1), Test criteria. Do not create tasks in the same step — task creation is always a separate step after all specs exist.", serde_json::json!({"type":"object","properties":{"title":{"type":"string"},"markdown_contents":{"type":"string"}},"required":["title","markdown_contents"]})),
        compact_tool("update_spec", "Update an existing spec's title or contents. Use the UUID spec_id from list_specs.", serde_json::json!({"type":"object","properties":{"spec_id":{"type":"string"},"title":{"type":"string"},"markdown_contents":{"type":"string"}},"required":["spec_id"]})),
        compact_tool("delete_spec", "Delete a spec and its tasks from the project. Use the UUID spec_id from list_specs.", serde_json::json!({"type":"object","properties":{"spec_id":{"type":"string"}},"required":["spec_id"]})),
    ]
}

fn task_tool_definitions() -> Vec<ToolDefinition> {
    vec![
        compact_tool("list_tasks", "List all tasks in the project, optionally filtered by UUID spec_id from list_specs.", serde_json::json!({"type":"object","properties":{"spec_id":{"type":"string"}},"required":[]})),
        compact_tool("create_task", "Create a new task under a spec. Use the UUID spec_id from list_specs. Only use after specs exist; never create tasks in the same turn as creating specs — spec creation and task creation are two distinct steps.", serde_json::json!({"type":"object","properties":{"spec_id":{"type":"string"},"title":{"type":"string"},"description":{"type":"string"},"dependency_ids":{"type":"array","items":{"type":"string"},"description":"UUIDs of tasks this task depends on (from list_tasks)"}},"required":["spec_id","title","description"]})),
        compact_tool("update_task", "Update a task's title, description, or status.", serde_json::json!({"type":"object","properties":{"task_id":{"type":"string"},"title":{"type":"string"},"description":{"type":"string"},"status":{"type":"string","enum":["pending","ready","in_progress","blocked","done","failed"]}},"required":["task_id"]})),
        compact_tool("delete_task", "Delete a task from the project. Requires UUID task_id and parent UUID spec_id from list_tasks.", serde_json::json!({"type":"object","properties":{"task_id":{"type":"string"},"spec_id":{"type":"string"}},"required":["task_id","spec_id"]})),
        compact_tool("transition_task", "Transition a task to a new status (e.g. pending -> ready, ready -> done).", serde_json::json!({"type":"object","properties":{"task_id":{"type":"string"},"status":{"type":"string","enum":["pending","ready","in_progress","blocked","done","failed"]}},"required":["task_id","status"]})),
        compact_tool("run_task", "Trigger execution of a single task by the dev-loop engine.", serde_json::json!({"type":"object","properties":{"task_id":{"type":"string"}},"required":["task_id"]})),
    ]
}

fn project_tool_definitions() -> Vec<ToolDefinition> {
    vec![
        compact_tool("get_project", "Get the current project's details (name, folder, status, etc.).", serde_json::json!({"type":"object","properties":{},"required":[]})),
        compact_tool("update_project", "Update the current project's name, description, build_command, or test_command. Commands must be valid shell commands with no extra text.", serde_json::json!({"type":"object","properties":{"name":{"type":"string"},"description":{"type":"string"},"build_command":{"type":"string"},"test_command":{"type":"string"}},"required":[]})),
        compact_tool("get_progress", "Get task progress summary for the project (counts by status).", serde_json::json!({"type":"object","properties":{},"required":[]})),
    ]
}

fn dev_loop_tool_definitions() -> Vec<ToolDefinition> {
    vec![
        compact_tool("start_dev_loop", "Start the autonomous dev loop for the project. It will pick up ready tasks and execute them.", serde_json::json!({"type":"object","properties":{},"required":[]})),
        compact_tool("pause_dev_loop", "Pause the currently running dev loop.", serde_json::json!({"type":"object","properties":{},"required":[]})),
        compact_tool("stop_dev_loop", "Stop the currently running dev loop.", serde_json::json!({"type":"object","properties":{},"required":[]})),
    ]
}
