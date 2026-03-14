use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use tokio::sync::{mpsc, watch, Mutex};
use tracing::{error, info, warn};

use aura_core::*;
use aura_agents::AgentService;
use aura_claude::{
    ClaudeClient, ClaudeStreamEvent, ContentBlock, RichMessage, ThinkingConfig, DEFAULT_MODEL,
};
use aura_projects::ProjectService;
use aura_sessions::SessionService;
use aura_tasks::TaskService;
use aura_chat::ChatToolExecutor;
use aura_tools::engine_tool_definitions;
use aura_settings::SettingsService;
use aura_store::RocksStore;

use crate::build_verify;
use crate::error::EngineError;
use crate::events::{EngineEvent, PhaseTimingEntry};
use crate::file_ops::{self, FileOp};
use crate::metrics::{self, LoopRunMetrics, TaskMetrics};

#[derive(Debug, Clone)]
pub struct TaskExecution {
    pub notes: String,
    pub file_ops: Vec<FileOp>,
    pub follow_up_tasks: Vec<FollowUpSuggestion>,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub parse_retries: u32,
    pub files_already_applied: bool,
}

#[derive(Debug, Clone)]
pub struct FollowUpSuggestion {
    pub title: String,
    pub description: String,
}

/// Tracks a single build-fix attempt for the retry history prompt.
struct BuildFixAttemptRecord {
    stderr: String,
    error_signature: String,
    files_changed: Vec<String>,
}

/// Produce a normalized "signature" from compiler stderr by stripping line
/// numbers, column numbers, and file paths so that the same class of error
/// across different attempts compares as equal even when line numbers shift.
fn normalize_error_signature(stderr: &str) -> String {
    let mut signature_lines: Vec<String> = Vec::new();
    for line in stderr.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with("For more information") || trimmed.starts_with("help:") {
            continue;
        }
        // Strip Rust-style location prefixes like "  --> crates/foo/src/bar.rs:52:32"
        // and "52 |  ..." gutter lines, normalizing to just the error message
        if trimmed.starts_with("-->") {
            signature_lines.push("-->LOCATION".into());
            continue;
        }
        // Gutter lines: "52 |    code here"
        if trimmed.chars().next().is_some_and(|c| c.is_ascii_digit()) && trimmed.contains('|') {
            continue;
        }
        // Caret lines: "   ^^^^^"
        if trimmed.chars().all(|c| c == '^' || c == '-' || c == ' ' || c == '~' || c == '+') {
            continue;
        }
        // Keep error/warning message lines but strip line:col references
        let normalized = normalize_line_col_refs(trimmed);
        if !normalized.is_empty() {
            signature_lines.push(normalized);
        }
    }
    signature_lines.sort();
    signature_lines.dedup();
    signature_lines.join("\n")
}

/// Replace patterns like `:52:32` or `line 52` with `:N:N` so that
/// identical errors on different lines produce the same signature.
fn normalize_line_col_refs(line: &str) -> String {
    let mut result = String::with_capacity(line.len());
    let chars: Vec<char> = line.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == ':' && i + 1 < chars.len() && chars[i + 1].is_ascii_digit() {
            result.push(':');
            result.push('N');
            i += 1;
            while i < chars.len() && chars[i].is_ascii_digit() {
                i += 1;
            }
        } else {
            result.push(chars[i]);
            i += 1;
        }
    }
    result
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoopCommand {
    Continue,
    Pause,
    Stop,
}

#[derive(Debug, Clone)]
pub enum LoopOutcome {
    AllTasksComplete,
    Paused { completed_count: usize },
    Stopped { completed_count: usize },
    AllTasksBlocked,
    TaskFailed {
        completed_count: usize,
        task_id: TaskId,
        reason: String,
    },
    Error(String),
}

pub struct LoopHandle {
    pub project_id: ProjectId,
    pub agent_id: AgentId,
    stop_tx: watch::Sender<LoopCommand>,
    join_handle: tokio::task::JoinHandle<Result<LoopOutcome, EngineError>>,
}

impl LoopHandle {
    pub fn pause(&self) {
        let _ = self.stop_tx.send(LoopCommand::Pause);
    }

    pub fn stop(&self) {
        let _ = self.stop_tx.send(LoopCommand::Stop);
    }

    pub fn is_finished(&self) -> bool {
        self.join_handle.is_finished()
    }

    pub async fn wait(self) -> Result<LoopOutcome, EngineError> {
        self.join_handle
            .await
            .map_err(|e| EngineError::Join(e.to_string()))?
    }
}

pub(crate) fn task_execution_system_prompt() -> String {
    format!(r#"
You are an expert software engineer executing a single implementation task.

CRITICAL: You MUST respond with ONLY a valid JSON object. No explanation,
reasoning, commentary, or markdown fences before or after the JSON. Your
entire response must be parseable as a single JSON value.

Rules:
- "notes": brief summary of what you did (or why you could not)
- "file_ops": array of file operations. Each has "op" ("create", "modify", or "delete"), "path" (relative to project root), and "content" (full file content; omit for delete)
- "follow_up_tasks": optional array of {{"title", "description"}} if you discover missing prerequisites; otherwise omit or use []
- For "modify", always provide the complete new file content, not a diff
- If you cannot complete the task, set notes to explain why and leave file_ops as []

## Language-Specific Rules (MUST FOLLOW)

### Rust (.rs files)
- NEVER use non-ASCII characters (em dashes, smart quotes, ellipsis, etc.) anywhere in source code. Use ASCII equivalents only.
- For test fixtures, multi-line strings, or any string containing quotes/backslashes/special characters: use Rust raw string literals (r followed by one or more {hash} then a quote to open, and a quote followed by the same number of {hash} to close).
- For constructing JSON in tests: prefer serde_json::json!() macro over string literals.
- Remember that \n inside a JSON string value (in your response) becomes a literal newline in the Rust source file. If you want the Rust string to contain a newline escape, you need \\n in your JSON.
- If you declare `pub mod foo;` in mod.rs or lib.rs, the file foo.rs (or foo/mod.rs) MUST exist. Create it in the same response.
- Do NOT call methods that don't exist on a type. Read the codebase snapshot to check actual APIs.

### TypeScript/JavaScript (.ts/.tsx/.js/.jsx files)
- Use forward slashes in import paths, never backslashes.
- Ensure all imported modules exist or are declared as dependencies.

Response schema:
{{"notes":"...","file_ops":[{{"op":"create","path":"src/foo.rs","content":"..."}}],"follow_up_tasks":[]}}
"#, hash = "#")
}

pub(crate) fn build_fix_system_prompt() -> String {
    format!(r#"
You are an expert software engineer fixing build/test errors in existing code.

CRITICAL: You MUST respond with ONLY a valid JSON object. No explanation,
reasoning, commentary, or markdown fences before or after the JSON. Your
entire response must be parseable as a single JSON value.

Rules:
- "notes": brief summary of what you fixed
- "file_ops": array of file operations
- "follow_up_tasks": optional array of {{"title", "description"}}; omit or use []

## File Operation Types

You have FOUR operation types. **Prefer "search_replace" for fixes.**

### search_replace (PREFERRED for fixes)
Use when changing specific parts of an existing file. Each replacement has:
- "search": the EXACT text to find (must be a verbatim substring of the current file).
  Include enough surrounding context (3-5 lines) to ensure a unique match.
- "replace": the text to substitute in place of "search".

The "search" string MUST match exactly ONE location in the file. If it matches
zero or more than one location, the operation fails. Include sufficient context
lines to disambiguate.

Example:
{{"op":"search_replace","path":"src/foo.rs","replacements":[
  {{"search":"fn old_name(x: i32) {{\n    x + 1\n}}","replace":"fn new_name(x: i32) {{\n    x + 2\n}}"}}
]}}

### modify (use sparingly)
Use ONLY when rewriting more than ~50% of a file. Provides complete new file content.
{{"op":"modify","path":"src/foo.rs","content":"...entire file..."}}

### create
Use for new files. {{"op":"create","path":"src/bar.rs","content":"...entire file..."}}

### delete
Use to remove files. {{"op":"delete","path":"src/old.rs"}}

## Language-Specific Rules (MUST FOLLOW)

### Rust (.rs files)
- NEVER use non-ASCII characters (em dashes, smart quotes, ellipsis, etc.) anywhere in source code. Use ASCII equivalents only.
- For test fixtures and multi-line strings: use Rust raw string literals (r followed by one or more {hash} then a quote).
- For constructing JSON in tests: prefer serde_json::json!() macro over string literals.
- Remember that \n inside a JSON string value (in your response) becomes a literal newline in the Rust source file. If you want the Rust string to contain a newline escape, you need \\n in your JSON.
- Do NOT call methods that don't exist on a type. Check the codebase snapshot for actual APIs.

### TypeScript/JavaScript (.ts/.tsx/.js/.jsx files)
- Use forward slashes in import paths, never backslashes.
- Ensure all imported modules exist or are declared as dependencies.

Response schema:
{{"notes":"...","file_ops":[{{"op":"search_replace","path":"src/foo.rs","replacements":[{{"search":"old code","replace":"new code"}}]}}],"follow_up_tasks":[]}}
"#, hash = "#")
}

fn agentic_execution_system_prompt(project: &Project) -> String {
    let build_cmd = project.build_command.as_deref().unwrap_or("(not configured)");
    let test_cmd = project.test_command.as_deref().unwrap_or("(not configured)");
    format!(
        r#"You are an expert software engineer executing a single implementation task.
You have tools to explore the codebase, make changes, and verify your work.

Workflow:
1. Use get_task_context if you need to review the task details
2. Explore relevant files using read_file, search_code, find_files, list_files
3. Make changes using write_file (new files) or edit_file (targeted edits)
4. Verify your changes compile: run_command with the build command
5. Fix any errors iteratively
6. When done, call task_done with your notes

Build command: {build_cmd}
Test command: {test_cmd}

Rules:
- Always verify your changes compile before calling task_done
- Use edit_file for targeted changes to existing files, write_file for new files or full rewrites
- Search before writing to understand existing code patterns
- Never use non-ASCII characters (em dashes, smart quotes, ellipsis) in source code
- For Rust: use raw string literals for multi-line strings, prefer serde_json::json!() for JSON in tests
- For TypeScript: use forward slashes in import paths
- If a build fails, read the errors carefully and fix them before calling task_done
- Do NOT call task_done until the build passes

SCOPE: Stay strictly on-task.
- ONLY implement what the task description asks for. Do NOT fix pre-existing bugs, failing tests, or code issues that are unrelated to your task.
- If `cargo test --workspace` or the test command shows failures in test files you did NOT modify, IGNORE them. Only fix tests that directly test the feature you are implementing.
- Once your task-specific changes compile and any directly-related tests pass, call task_done immediately. Do NOT keep exploring or "improving" unrelated code.
- When verifying, prefer scoped commands (e.g. `cargo test -p <crate> --lib <module>`) over workspace-wide commands to avoid noise from pre-existing failures.
- NEVER output raw JSON with file_ops in your text response. Always use the provided tools (write_file, edit_file, task_done, etc.) to make changes and signal completion.
"#
    )
}

fn build_agentic_task_context(
    project: &Project,
    spec: &Spec,
    task: &Task,
    session: &Session,
) -> String {
    let mut ctx = String::new();
    ctx.push_str(&format!("# Project: {}\n{}\n\n", project.name, project.description));
    ctx.push_str(&format!("# Spec: {}\n{}\n\n", spec.title, spec.markdown_contents));
    ctx.push_str(&format!("# Task: {}\n{}\n\n", task.title, task.description));

    if !session.summary_of_previous_context.is_empty() {
        ctx.push_str(&format!(
            "# Previous Context Summary\n{}\n\n",
            session.summary_of_previous_context
        ));
    }
    if !task.execution_notes.is_empty() {
        ctx.push_str(&format!(
            "# Notes from Prior Attempts\n{}\n\n",
            task.execution_notes
        ));
    }
    ctx.push_str("Start by exploring the codebase to understand the current state, then implement the task.\n");
    ctx
}

fn track_file_op(tool_name: &str, input: &serde_json::Value, ops: &mut Vec<FileOp>) {
    let path = input.get("path").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if path.is_empty() {
        return;
    }
    match tool_name {
        "write_file" => {
            let content = input.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string();
            ops.push(FileOp::Create { path, content });
        }
        "edit_file" => {
            let old_text = input.get("old_text").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let new_text = input.get("new_text").and_then(|v| v.as_str()).unwrap_or("").to_string();
            ops.push(FileOp::SearchReplace {
                path,
                replacements: vec![crate::file_ops::Replacement { search: old_text, replace: new_text }],
            });
        }
        "delete_file" => {
            ops.push(FileOp::Delete { path });
        }
        _ => {}
    }
}

fn simple_file_changes(ops: &[FileOp]) -> Vec<aura_core::FileChangeSummary> {
    ops.iter().map(|op| match op {
        FileOp::Create { path, content } => aura_core::FileChangeSummary {
            op: "create".to_string(),
            path: path.clone(),
            lines_added: content.lines().count() as u32,
            lines_removed: 0,
        },
        FileOp::Modify { path, content } => aura_core::FileChangeSummary {
            op: "modify".to_string(),
            path: path.clone(),
            lines_added: content.lines().count() as u32,
            lines_removed: 0,
        },
        FileOp::Delete { path } => aura_core::FileChangeSummary {
            op: "delete".to_string(),
            path: path.clone(),
            lines_added: 0,
            lines_removed: 0,
        },
        FileOp::SearchReplace { path, replacements } => aura_core::FileChangeSummary {
            op: "modify".to_string(),
            path: path.clone(),
            lines_added: replacements.iter().map(|r| r.replace.lines().count() as u32).sum(),
            lines_removed: replacements.iter().map(|r| r.search.lines().count() as u32).sum(),
        },
    }).collect()
}

const RETRY_CORRECTION_PROMPT: &str =
    "Your previous response was not valid JSON. Respond with ONLY a valid JSON object matching the schema above. No prose, no markdown fences.";

const MAX_EXECUTION_RETRIES: u32 = 2;
const MAX_BUILD_FIX_RETRIES: u32 = 5;
const MAX_SHELL_TASK_RETRIES: u32 = 20;
const MAX_LOOP_TASK_RETRIES: u32 = 5;
const MAX_FOLLOW_UPS_PER_LOOP: usize = 20;
const TASK_EXECUTION_MAX_TOKENS: u32 = 32_768;

/// Serializes filesystem writes and build/test verification per project,
/// so parallel agents don't step on each other's file edits.
#[derive(Debug, Clone, Default)]
pub struct ProjectWriteCoordinator {
    locks: Arc<Mutex<HashMap<ProjectId, Arc<Mutex<()>>>>>,
}

impl ProjectWriteCoordinator {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn acquire(&self, project_id: &ProjectId) -> tokio::sync::OwnedMutexGuard<()> {
        let lock = {
            let mut map = self.locks.lock().await;
            map.entry(*project_id)
                .or_insert_with(|| Arc::new(Mutex::new(())))
                .clone()
        };
        lock.lock_owned().await
    }
}

pub struct DevLoopEngine {
    store: Arc<RocksStore>,
    settings: Arc<SettingsService>,
    claude_client: Arc<ClaudeClient>,
    project_service: Arc<ProjectService>,
    task_service: Arc<TaskService>,
    agent_service: Arc<AgentService>,
    session_service: Arc<SessionService>,
    event_tx: mpsc::UnboundedSender<EngineEvent>,
    write_coordinator: ProjectWriteCoordinator,
}

impl DevLoopEngine {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        store: Arc<RocksStore>,
        settings: Arc<SettingsService>,
        claude_client: Arc<ClaudeClient>,
        project_service: Arc<ProjectService>,
        task_service: Arc<TaskService>,
        agent_service: Arc<AgentService>,
        session_service: Arc<SessionService>,
        event_tx: mpsc::UnboundedSender<EngineEvent>,
    ) -> Self {
        Self {
            store,
            settings,
            claude_client,
            project_service,
            task_service,
            agent_service,
            session_service,
            event_tx,
            write_coordinator: ProjectWriteCoordinator::new(),
        }
    }

    pub fn with_write_coordinator(mut self, coordinator: ProjectWriteCoordinator) -> Self {
        self.write_coordinator = coordinator;
        self
    }

    /// Execute a single task by ID without starting the full loop.
    /// Spawns execution as a background tokio task; progress is emitted
    /// through the normal engine event channel.
    pub async fn run_single_task(
        self: Arc<Self>,
        project_id: ProjectId,
        task_id: TaskId,
    ) -> Result<(), EngineError> {
        let api_key = self.settings.get_decrypted_api_key()?;

        let all_tasks = self.store.list_tasks_by_project(&project_id)?;
        let mut task = all_tasks
            .into_iter()
            .find(|t| t.task_id == task_id)
            .ok_or_else(|| EngineError::Parse(format!("task {task_id} not found")))?;

        if task.status == TaskStatus::Failed {
            task = self
                .task_service
                .retry_task(&project_id, &task.spec_id, &task.task_id)?;
        }
        if task.status != TaskStatus::Ready {
            return Err(EngineError::Parse(format!(
                "task must be in ready or failed state, currently: {:?}",
                task.status
            )));
        }

        let user_id = self.current_user_id();
        let model = Some(DEFAULT_MODEL.to_string());

        let agent = self
            .agent_service
            .create_agent(&project_id, "dev-agent".into())?;
        let session = self.session_service.create_session(
            &agent.agent_id,
            &project_id,
            None,
            String::new(),
            user_id.clone(),
            model.clone(),
        )?;

        self.task_service
            .assign_task(&project_id, &task.spec_id, &task.task_id, &agent.agent_id, Some(session.session_id))?;
        self.session_service
            .record_task_worked(&project_id, &agent.agent_id, &session.session_id, task.task_id)?;
        self.agent_service.start_working(
            &project_id,
            &agent.agent_id,
            &task.task_id,
            &session.session_id,
        )?;
        let aid = agent.agent_id;
        self.emit(EngineEvent::TaskStarted {
            project_id,
            agent_id: aid,
            task_id: task.task_id,
            task_title: task.title.clone(),
            session_id: session.session_id,
            prompt_tokens_estimate: None,
            codebase_snapshot_bytes: None,
            codebase_file_count: None,
        });

        let task_start = Instant::now();
        let model_name = model.clone();

        let project_root = self.project_service.get_project(&project_id)
            .map(|p| p.linked_folder_path.clone())
            .unwrap_or_default();
        let fee_schedule = aura_pricing::PricingService::new(self.store.clone())
            .get_fee_schedule();

        let baseline_test_failures = {
            let project = self.project_service.get_project(&project_id)?;
            self.capture_test_baseline(&project).await
        };

        let result = if let Some(cmd) = Self::extract_shell_command(&task) {
            let project = self.project_service.get_project(&project_id)?;
            self.execute_shell_task(&project, &task, &cmd, aid).await
        } else {
            self.execute_task_agentic(&project_id, &task, &session, &api_key).await
        };

        let end_status = match result {
            Ok(execution) => {
                let llm_duration_ms = task_start.elapsed().as_millis() as u64;
                let project = self.project_service.get_project(&project_id)?;
                let base_path = Path::new(&project.linked_folder_path);

                let file_changes = if execution.files_already_applied {
                    simple_file_changes(&execution.file_ops)
                } else {
                    file_ops::compute_file_changes(base_path, &execution.file_ops)
                };

                self.update_task_tracking(
                    &project_id, &task, &user_id, &model,
                    execution.input_tokens, execution.output_tokens,
                );

                let _write_guard = self.write_coordinator.acquire(&project_id).await;

                let file_ops_start = Instant::now();
                let apply_result = if execution.files_already_applied {
                    Ok(())
                } else {
                    file_ops::apply_file_ops(base_path, &execution.file_ops).await
                };
                if let Err(e) = apply_result {
                    let reason = format!("file operation failed: {e}");
                    let task_dur = task_start.elapsed().as_millis() as u64;
                    let _ = self.task_service.fail_task(
                        &project_id, &task.spec_id, &task.task_id, &reason,
                    );
                    self.emit(EngineEvent::TaskFailed {
                        project_id,
                        agent_id: aid,
                        task_id: task.task_id,
                        reason: e.to_string(),
                        duration_ms: Some(task_dur),
                        phase: Some("file_ops".into()),
                        parse_retries: Some(execution.parse_retries),
                        build_fix_attempts: None,
                        model: model_name.clone(),
                    });
                    if !project_root.is_empty() {
                        metrics::write_single_task_metrics(
                            Path::new(&project_root),
                            &project_id.to_string(),
                            metrics::TaskMetrics {
                                task_id: task.task_id.to_string(),
                                title: task.title.clone(),
                                outcome: "failed".into(),
                                duration_ms: task_dur,
                                llm_duration_ms: Some(llm_duration_ms),
                                build_verify_duration_ms: None,
                                file_ops_duration_ms: None,
                                input_tokens: execution.input_tokens,
                                output_tokens: execution.output_tokens,
                                files_changed: execution.file_ops.len() as u32,
                                parse_retries: execution.parse_retries,
                                build_fix_attempts: 0,
                                model: model_name.clone(),
                                failure_phase: Some("file_ops".into()),
                                failure_reason: Some(reason),
                                phase_timings: vec![],
                            },
                            &fee_schedule,
                        );
                    }
                    let _ = self.session_service.update_context_usage(
                        &project_id, &agent.agent_id, &session.session_id,
                        execution.input_tokens, execution.output_tokens,
                    );
                    SessionStatus::Failed
                } else {
                    let file_ops_duration_ms = file_ops_start.elapsed().as_millis() as u64;
                    self.emit_file_ops_applied(project_id, aid, &task, &execution.file_ops);

                    let session_ref = self.session_service.get_session(
                        &project_id, &agent.agent_id, &session.session_id,
                    ).unwrap_or_else(|_| session.clone());

                    let build_start = Instant::now();
                    let (_, build_passed, build_attempts, _dup_bailouts, fix_inp, fix_out) = self
                        .verify_and_fix_build(
                            &project, &task, &session_ref, &api_key, &execution,
                            &baseline_test_failures,
                        )
                        .await?;
                    let build_verify_duration_ms = build_start.elapsed().as_millis() as u64;
                    let task_duration_ms = task_start.elapsed().as_millis() as u64;

                    let total_input = execution.input_tokens + fix_inp;
                    let total_output = execution.output_tokens + fix_out;

                    self.update_task_tracking(
                        &project_id, &task, &user_id, &model, fix_inp, fix_out,
                    );

                    if build_passed {
                        let _ = self.task_service.complete_task(
                            &project_id, &task.spec_id, &task.task_id,
                            &execution.notes, file_changes,
                        );
                        self.emit(EngineEvent::TaskCompleted {
                            project_id,
                            agent_id: aid,
                            task_id: task.task_id,
                            execution_notes: execution.notes.clone(),
                            duration_ms: Some(task_duration_ms),
                            input_tokens: Some(total_input),
                            output_tokens: Some(total_output),
                            llm_duration_ms: Some(llm_duration_ms),
                            build_verify_duration_ms: Some(build_verify_duration_ms),
                            files_changed_count: Some(execution.file_ops.len() as u32),
                            parse_retries: Some(execution.parse_retries),
                            build_fix_attempts: Some(build_attempts),
                            model: model_name.clone(),
                        });

                        if !project_root.is_empty() {
                            metrics::write_single_task_metrics(
                                Path::new(&project_root),
                                &project_id.to_string(),
                                metrics::TaskMetrics {
                                    task_id: task.task_id.to_string(),
                                    title: task.title.clone(),
                                    outcome: "completed".into(),
                                    duration_ms: task_duration_ms,
                                    llm_duration_ms: Some(llm_duration_ms),
                                    build_verify_duration_ms: Some(build_verify_duration_ms),
                                    file_ops_duration_ms: Some(file_ops_duration_ms),
                                    input_tokens: total_input,
                                    output_tokens: total_output,
                                    files_changed: execution.file_ops.len() as u32,
                                    parse_retries: execution.parse_retries,
                                    build_fix_attempts: build_attempts,
                                    model: model_name.clone(),
                                    failure_phase: None,
                                    failure_reason: None,
                                    phase_timings: vec![
                                        PhaseTimingEntry { phase: "llm_call".into(), duration_ms: llm_duration_ms },
                                        PhaseTimingEntry { phase: "file_ops".into(), duration_ms: file_ops_duration_ms },
                                        PhaseTimingEntry { phase: "build_verify".into(), duration_ms: build_verify_duration_ms },
                                    ],
                                },
                                &fee_schedule,
                            );
                        }

                        let newly_ready = self
                            .task_service
                            .resolve_dependencies_after_completion(&project_id, &task.task_id)
                            .unwrap_or_default();
                        for t in &newly_ready {
                            self.emit(EngineEvent::TaskBecameReady { project_id, agent_id: aid, task_id: t.task_id });
                        }

                        for follow_up in &execution.follow_up_tasks {
                            if let Ok(new_task) = self.task_service.create_follow_up_task(
                                &task,
                                follow_up.title.clone(),
                                follow_up.description.clone(),
                                vec![],
                            ) {
                                self.emit(EngineEvent::FollowUpTaskCreated {
                                    project_id,
                                    agent_id: aid,
                                    task_id: new_task.task_id,
                                });
                            }
                        }
                    } else {
                        let reason = "build verification failed after all fix attempts".to_string();
                        let _ = self.task_service.fail_task(
                            &project_id, &task.spec_id, &task.task_id, &reason,
                        );
                        self.emit(EngineEvent::TaskFailed {
                            project_id,
                            agent_id: aid,
                            task_id: task.task_id,
                            reason: reason.clone(),
                            duration_ms: Some(task_duration_ms),
                            phase: Some("build_verify".into()),
                            parse_retries: Some(execution.parse_retries),
                            build_fix_attempts: Some(build_attempts),
                            model: model_name.clone(),
                        });
                        if !project_root.is_empty() {
                            metrics::write_single_task_metrics(
                                Path::new(&project_root),
                                &project_id.to_string(),
                                metrics::TaskMetrics {
                                    task_id: task.task_id.to_string(),
                                    title: task.title.clone(),
                                    outcome: "failed".into(),
                                    duration_ms: task_duration_ms,
                                    llm_duration_ms: Some(llm_duration_ms),
                                    build_verify_duration_ms: Some(build_verify_duration_ms),
                                    file_ops_duration_ms: Some(file_ops_duration_ms),
                                    input_tokens: total_input,
                                    output_tokens: total_output,
                                    files_changed: execution.file_ops.len() as u32,
                                    parse_retries: execution.parse_retries,
                                    build_fix_attempts: build_attempts,
                                    model: model_name.clone(),
                                    failure_phase: Some("build_verify".into()),
                                    failure_reason: Some(reason),
                                    phase_timings: vec![
                                        PhaseTimingEntry { phase: "llm_call".into(), duration_ms: llm_duration_ms },
                                        PhaseTimingEntry { phase: "file_ops".into(), duration_ms: file_ops_duration_ms },
                                        PhaseTimingEntry { phase: "build_verify".into(), duration_ms: build_verify_duration_ms },
                                    ],
                                },
                                &fee_schedule,
                            );
                        }
                    }
                    let _ = self.session_service.update_context_usage(
                        &project_id, &agent.agent_id, &session.session_id,
                        total_input, total_output,
                    );
                    SessionStatus::Completed
                }
            }
            Err(e) => {
                let reason = format!("execution error: {e}");
                let task_dur = task_start.elapsed().as_millis() as u64;
                let _ = self.task_service.fail_task(
                    &project_id, &task.spec_id, &task.task_id, &reason,
                );
                self.emit(EngineEvent::TaskFailed {
                    project_id,
                    agent_id: aid,
                    task_id: task.task_id,
                    reason: e.to_string(),
                    duration_ms: Some(task_dur),
                    phase: Some("execution".into()),
                    parse_retries: None,
                    build_fix_attempts: None,
                    model: model_name.clone(),
                });
                if !project_root.is_empty() {
                    metrics::write_single_task_metrics(
                        Path::new(&project_root),
                        &project_id.to_string(),
                        metrics::TaskMetrics {
                            task_id: task.task_id.to_string(),
                            title: task.title.clone(),
                            outcome: "failed".into(),
                            duration_ms: task_dur,
                            llm_duration_ms: None,
                            build_verify_duration_ms: None,
                            file_ops_duration_ms: None,
                            input_tokens: 0,
                            output_tokens: 0,
                            files_changed: 0,
                            parse_retries: 0,
                            build_fix_attempts: 0,
                            model: model_name.clone(),
                            failure_phase: Some("execution".into()),
                            failure_reason: Some(reason),
                            phase_timings: vec![],
                        },
                        &fee_schedule,
                    );
                }
                SessionStatus::Failed
            }
        };

        let _ = self.session_service.end_session(
            &project_id, &agent.agent_id, &session.session_id, end_status,
        );
        let _ = self.agent_service.finish_working(&project_id, &agent.agent_id);
        Ok(())
    }

    pub async fn start(
        self: Arc<Self>,
        project_id: ProjectId,
        agent_name: Option<String>,
    ) -> Result<LoopHandle, EngineError> {
        let _project = self.project_service.get_project(&project_id)?;

        let stale = self.session_service.close_stale_sessions(&project_id)?;
        if !stale.is_empty() {
            info!("closed {} stale active session(s) from previous run", stale.len());
        }

        let name = agent_name.unwrap_or_else(|| "dev-agent".into());
        let agent = self
            .agent_service
            .create_agent(&project_id, name)?;

        let session = self.session_service.create_session(
            &agent.agent_id,
            &project_id,
            None,
            String::new(),
            self.current_user_id(),
            Some(DEFAULT_MODEL.to_string()),
        )?;

        let (stop_tx, stop_rx) = watch::channel(LoopCommand::Continue);

        self.emit(EngineEvent::LoopStarted {
            project_id,
            agent_id: agent.agent_id,
        });

        let engine = self.clone();
        let aid = agent.agent_id;
        let join_handle = tokio::spawn(async move {
            let result = engine
                .run_loop(project_id, aid, session, stop_rx)
                .await;
            if let Err(ref e) = result {
                error!(error = %e, "run_loop exited with error, emitting LoopFinished");
                engine.emit(EngineEvent::LoopFinished {
                    project_id,
                    agent_id: aid,
                    outcome: format!("error: {e}"),
                    total_duration_ms: None,
                    tasks_completed: None,
                    tasks_failed: None,
                    tasks_retried: None,
                    total_input_tokens: None,
                    total_output_tokens: None,
                    sessions_used: None,
                    total_parse_retries: None,
                    total_build_fix_attempts: None,
                    duplicate_error_bailouts: None,
                });
                let _ = engine.agent_service.finish_working(&project_id, &aid);
            }
            result
        });

        Ok(LoopHandle {
            project_id,
            agent_id: agent.agent_id,
            stop_tx,
            join_handle,
        })
    }

    async fn run_loop(
        &self,
        project_id: ProjectId,
        agent_id: AgentId,
        mut session: Session,
        mut stop_rx: watch::Receiver<LoopCommand>,
    ) -> Result<LoopOutcome, EngineError> {
        let api_key = self.settings.get_decrypted_api_key()?;
        let loop_start = Instant::now();
        let mut completed_count: usize = 0;
        let mut failed_count: usize = 0;
        let mut follow_up_count: usize = 0;
        let mut task_retry_counts: std::collections::HashMap<TaskId, u32> = std::collections::HashMap::new();
        let mut work_log: Vec<String> = Vec::new();
        let mut total_input_tokens: u64 = 0;
        let mut total_output_tokens: u64 = 0;
        let mut tasks_retried: usize = 0;
        let mut sessions_used: usize = 1;
        let mut total_parse_retries: u32 = 0;
        let mut total_build_fix_attempts: u32 = 0;
        let mut duplicate_error_bailouts: u32 = 0;

        let project_root = self.project_service.get_project(&project_id)
            .map(|p| p.linked_folder_path.clone())
            .unwrap_or_default();
        let mut run_metrics = LoopRunMetrics::new(project_id.to_string());
        let fee_schedule = aura_pricing::PricingService::new(self.store.clone())
            .get_fee_schedule();

        macro_rules! flush_metrics {
            ($outcome:expr) => {{
                run_metrics.finalize(
                    $outcome,
                    loop_start.elapsed().as_millis() as u64,
                    sessions_used, tasks_retried, duplicate_error_bailouts,
                    &fee_schedule,
                );
                if !project_root.is_empty() {
                    metrics::write_run_metrics(Path::new(&project_root), &run_metrics);
                }
            }};
        }

        macro_rules! record_task {
            ($task_metrics:expr) => {{
                let tm: metrics::TaskMetrics = $task_metrics;
                run_metrics.tasks.push(tm.clone());
                if !project_root.is_empty() {
                    run_metrics.snapshot(
                        loop_start.elapsed().as_millis() as u64,
                        sessions_used, tasks_retried, duplicate_error_bailouts,
                        &fee_schedule,
                    );
                    metrics::write_live_snapshot(
                        Path::new(&project_root), &run_metrics, &tm,
                    );
                }
            }};
        }

        let orphaned = self.task_service.reset_in_progress_tasks(&project_id)?;
        for t in &orphaned {
            self.emit(EngineEvent::TaskBecameReady { project_id, agent_id, task_id: t.task_id });
        }

        let promoted = self.task_service.resolve_initial_readiness(&project_id)?;
        for t in &promoted {
            self.emit(EngineEvent::TaskBecameReady { project_id, agent_id, task_id: t.task_id });
        }

        loop {
            if *stop_rx.borrow() == LoopCommand::Pause {
                let _ = self.session_service.end_session(
                    &project_id, &agent_id, &session.session_id, SessionStatus::Completed,
                );
                let _ = self.agent_service.finish_working(&project_id, &agent_id);
                self.emit(EngineEvent::LoopPaused { project_id, agent_id, completed_count });
                flush_metrics!("paused");
                return Ok(LoopOutcome::Paused { completed_count });
            }
            if *stop_rx.borrow() == LoopCommand::Stop {
                let _ = self.session_service.end_session(
                    &project_id, &agent_id, &session.session_id, SessionStatus::Completed,
                );
                let _ = self.agent_service.finish_working(&project_id, &agent_id);
                self.emit(EngineEvent::LoopStopped { project_id, agent_id, completed_count });
                flush_metrics!("stopped");
                return Ok(LoopOutcome::Stopped { completed_count });
            }

            let task = match self.task_service.claim_next_task(&project_id, &agent_id, Some(session.session_id))? {
                Some(t) => t,
                None => {
                    let all_tasks = self.store.list_tasks_by_project(&project_id)?;
                    let retryable: Vec<&Task> = all_tasks.iter()
                        .filter(|t| t.status == TaskStatus::Failed
                            && *task_retry_counts.get(&t.task_id).unwrap_or(&0) < MAX_LOOP_TASK_RETRIES)
                        .collect();

                    if !retryable.is_empty() {
                        for t in &retryable {
                            let count = task_retry_counts.entry(t.task_id).or_insert(0);
                            *count += 1;
                            tasks_retried += 1;
                            info!(task_id = %t.task_id, title = %t.title, attempt = *count, "resetting failed task for retry");
                            let _ = self.task_service.retry_task(
                                &project_id, &t.spec_id, &t.task_id,
                            );
                            self.emit(EngineEvent::TaskBecameReady { project_id, agent_id, task_id: t.task_id });
                        }
                        continue;
                    }

                    let progress = self.task_service.get_project_progress(&project_id)?;
                    let loop_metrics = |outcome: &str| EngineEvent::LoopFinished {
                        project_id,
                        agent_id,
                        outcome: outcome.into(),
                        total_duration_ms: Some(loop_start.elapsed().as_millis() as u64),
                        tasks_completed: Some(completed_count),
                        tasks_failed: Some(failed_count),
                        tasks_retried: Some(tasks_retried),
                        total_input_tokens: Some(total_input_tokens),
                        total_output_tokens: Some(total_output_tokens),
                        sessions_used: Some(sessions_used),
                        total_parse_retries: Some(total_parse_retries),
                        total_build_fix_attempts: Some(total_build_fix_attempts),
                        duplicate_error_bailouts: Some(duplicate_error_bailouts),
                    };
                    if progress.blocked_tasks > 0 || progress.failed_tasks > 0 {
                        let _ = self.session_service.end_session(
                            &project_id, &agent_id, &session.session_id, SessionStatus::Completed,
                        );
                        self.emit(loop_metrics("all_tasks_blocked"));
                        flush_metrics!("all_tasks_blocked");
                        return Ok(LoopOutcome::AllTasksBlocked);
                    }
                    let _ = self.session_service.end_session(
                        &project_id, &agent_id, &session.session_id, SessionStatus::Completed,
                    );
                    self.emit(loop_metrics("all_tasks_complete"));
                    flush_metrics!("all_tasks_complete");
                    return Ok(LoopOutcome::AllTasksComplete);
                }
            };

            self.session_service
                .record_task_worked(&project_id, &agent_id, &session.session_id, task.task_id)?;
            self.agent_service.start_working(
                &project_id,
                &agent_id,
                &task.task_id,
                &session.session_id,
            )?;
            self.emit(EngineEvent::TaskStarted {
                project_id,
                agent_id,
                task_id: task.task_id,
                task_title: task.title.clone(),
                session_id: session.session_id,
                prompt_tokens_estimate: None,
                codebase_snapshot_bytes: None,
                codebase_file_count: None,
            });

            let baseline_test_failures = {
                let project = self.project_service.get_project(&project_id)?;
                self.capture_test_baseline(&project).await
            };

            let task_start = Instant::now();
            let result = if let Some(cmd) = Self::extract_shell_command(&task) {
                let project = self.project_service.get_project(&project_id)?;
                Some(self.execute_shell_task(&project, &task, &cmd, agent_id).await)
            } else {
                tokio::select! {
                    res = self.execute_task_agentic(&project_id, &task, &session, &api_key) => {
                        Some(res)
                    }
                    _ = stop_rx.changed() => {
                        None
                    }
                }
            };

            if result.is_none() {
                let _ = self.task_service.reset_task_to_ready(
                    &project_id, &task.spec_id, &task.task_id,
                );
                self.emit(EngineEvent::TaskBecameReady { project_id, agent_id, task_id: task.task_id });
                let _ = self.agent_service.finish_working(&project_id, &agent_id);

                let cmd = *stop_rx.borrow();
                if cmd == LoopCommand::Stop {
                    let _ = self.session_service.end_session(
                        &project_id, &agent_id, &session.session_id, SessionStatus::Completed,
                    );
                    self.emit(EngineEvent::LoopStopped { project_id, agent_id, completed_count });
                    flush_metrics!("stopped");
                    return Ok(LoopOutcome::Stopped { completed_count });
                } else {
                    let _ = self.session_service.end_session(
                        &project_id, &agent_id, &session.session_id, SessionStatus::Completed,
                    );
                    self.emit(EngineEvent::LoopPaused { project_id, agent_id, completed_count });
                    flush_metrics!("paused");
                    return Ok(LoopOutcome::Paused { completed_count });
                }
            }
            let result = result.unwrap();

            let failure_reason = match result {
                Ok(execution) => {
                    let llm_duration_ms = task_start.elapsed().as_millis() as u64;
                    let project = self.project_service.get_project(&project_id)?;
                    let base_path = Path::new(&project.linked_folder_path);

                    let file_changes = if execution.files_already_applied {
                        simple_file_changes(&execution.file_ops)
                    } else {
                        file_ops::compute_file_changes(base_path, &execution.file_ops)
                    };

                    self.update_task_tracking(
                        &project_id, &task, &session.user_id, &session.model,
                        execution.input_tokens, execution.output_tokens,
                    );

                    total_input_tokens += execution.input_tokens;
                    total_output_tokens += execution.output_tokens;
                    total_parse_retries += execution.parse_retries;

                    let _write_guard = self.write_coordinator.acquire(&project_id).await;

                    let file_ops_start = Instant::now();
                    let apply_result = if execution.files_already_applied {
                        Ok(())
                    } else {
                        file_ops::apply_file_ops(base_path, &execution.file_ops).await
                    };
                    if let Err(e) = apply_result {
                        let reason = format!("file operation failed: {e}");
                        let task_dur = task_start.elapsed().as_millis() as u64;
                        self.task_service.fail_task(
                            &project_id,
                            &task.spec_id,
                            &task.task_id,
                            &reason,
                        )?;
                        failed_count += 1;
                        self.emit(EngineEvent::TaskFailed {
                            project_id,
                            agent_id,
                            task_id: task.task_id,
                            reason: e.to_string(),
                            duration_ms: Some(task_dur),
                            phase: Some("file_ops".into()),
                            parse_retries: Some(execution.parse_retries),
                            build_fix_attempts: None,
                            model: session.model.clone(),
                        });
                        record_task!(TaskMetrics {
                            task_id: task.task_id.to_string(),
                            title: task.title.clone(),
                            outcome: "failed".into(),
                            duration_ms: task_dur,
                            llm_duration_ms: Some(llm_duration_ms),
                            build_verify_duration_ms: None,
                            file_ops_duration_ms: None,
                            input_tokens: execution.input_tokens,
                            output_tokens: execution.output_tokens,
                            files_changed: execution.file_ops.len() as u32,
                            parse_retries: execution.parse_retries,
                            build_fix_attempts: 0,
                            model: session.model.clone(),
                            failure_phase: Some("file_ops".into()),
                            failure_reason: Some(reason.clone()),
                            phase_timings: vec![],
                        });
                        let _ = self.session_service.update_context_usage(
                            &project_id, &agent_id, &session.session_id,
                            execution.input_tokens, execution.output_tokens,
                        );
                        work_log.push(format!("Task (failed): {}\nReason: {}", task.title, reason));
                        Some(reason)
                    } else {
                        let file_ops_duration_ms = file_ops_start.elapsed().as_millis() as u64;
                        self.emit_file_ops_applied(project_id, agent_id, &task, &execution.file_ops);

                        let build_start = Instant::now();
                        let (_, build_passed, build_attempts, dup_bailouts, fix_inp, fix_out) = self
                            .verify_and_fix_build(
                                &project, &task, &session, &api_key, &execution,
                                &baseline_test_failures,
                            )
                            .await?;
                        let build_verify_duration_ms = build_start.elapsed().as_millis() as u64;
                        let task_duration_ms = task_start.elapsed().as_millis() as u64;

                        total_build_fix_attempts += build_attempts;
                        duplicate_error_bailouts += dup_bailouts;
                        total_input_tokens += fix_inp;
                        total_output_tokens += fix_out;

                        self.update_task_tracking(
                            &project_id, &task, &session.user_id, &session.model,
                            fix_inp, fix_out,
                        );

                        if !build_passed {
                            let reason = "build verification failed after all fix attempts".to_string();
                            self.task_service.fail_task(
                                &project_id,
                                &task.spec_id,
                                &task.task_id,
                                &reason,
                            )?;
                            failed_count += 1;
                            self.emit(EngineEvent::TaskFailed {
                                project_id,
                                agent_id,
                                task_id: task.task_id,
                                reason: reason.clone(),
                                duration_ms: Some(task_duration_ms),
                                phase: Some("build_verify".into()),
                                parse_retries: Some(execution.parse_retries),
                                build_fix_attempts: Some(build_attempts),
                                model: session.model.clone(),
                            });
                            record_task!(TaskMetrics {
                                task_id: task.task_id.to_string(),
                                title: task.title.clone(),
                                outcome: "failed".into(),
                                duration_ms: task_duration_ms,
                                llm_duration_ms: Some(llm_duration_ms),
                                build_verify_duration_ms: Some(build_verify_duration_ms),
                                file_ops_duration_ms: Some(file_ops_duration_ms),
                                input_tokens: execution.input_tokens + fix_inp,
                                output_tokens: execution.output_tokens + fix_out,
                                files_changed: execution.file_ops.len() as u32,
                                parse_retries: execution.parse_retries,
                                build_fix_attempts: build_attempts,
                                model: session.model.clone(),
                                failure_phase: Some("build_verify".into()),
                                failure_reason: Some(reason.clone()),
                                phase_timings: vec![
                                    PhaseTimingEntry { phase: "llm_call".into(), duration_ms: llm_duration_ms },
                                    PhaseTimingEntry { phase: "file_ops".into(), duration_ms: file_ops_duration_ms },
                                    PhaseTimingEntry { phase: "build_verify".into(), duration_ms: build_verify_duration_ms },
                                ],
                            });
                            let _ = self.session_service.update_context_usage(
                                &project_id, &agent_id, &session.session_id,
                                execution.input_tokens + fix_inp, execution.output_tokens + fix_out,
                            );
                            work_log.push(format!("Task (failed): {}\nReason: {}", task.title, reason));
                            Some(reason)
                        } else {
                            self.task_service.complete_task(
                                &project_id,
                                &task.spec_id,
                                &task.task_id,
                                &execution.notes,
                                file_changes,
                            )?;
                            completed_count += 1;
                            self.emit(EngineEvent::TaskCompleted {
                                project_id,
                                agent_id,
                                task_id: task.task_id,
                                execution_notes: execution.notes.clone(),
                                duration_ms: Some(task_duration_ms),
                                input_tokens: Some(execution.input_tokens + fix_inp),
                                output_tokens: Some(execution.output_tokens + fix_out),
                                llm_duration_ms: Some(llm_duration_ms),
                                build_verify_duration_ms: Some(build_verify_duration_ms),
                                files_changed_count: Some(execution.file_ops.len() as u32),
                                parse_retries: Some(execution.parse_retries),
                                build_fix_attempts: Some(build_attempts),
                                model: session.model.clone(),
                            });

                            let task_phase_timings = vec![
                                PhaseTimingEntry { phase: "llm_call".into(), duration_ms: llm_duration_ms },
                                PhaseTimingEntry { phase: "file_ops".into(), duration_ms: file_ops_duration_ms },
                                PhaseTimingEntry { phase: "build_verify".into(), duration_ms: build_verify_duration_ms },
                            ];
                            self.emit(EngineEvent::LoopIterationSummary {
                                project_id,
                                agent_id,
                                task_id: task.task_id,
                                phase_timings: task_phase_timings.clone(),
                            });

                            record_task!(TaskMetrics {
                                task_id: task.task_id.to_string(),
                                title: task.title.clone(),
                                outcome: "completed".into(),
                                duration_ms: task_duration_ms,
                                llm_duration_ms: Some(llm_duration_ms),
                                build_verify_duration_ms: Some(build_verify_duration_ms),
                                file_ops_duration_ms: Some(file_ops_duration_ms),
                                input_tokens: execution.input_tokens + fix_inp,
                                output_tokens: execution.output_tokens + fix_out,
                                files_changed: execution.file_ops.len() as u32,
                                parse_retries: execution.parse_retries,
                                build_fix_attempts: build_attempts,
                                model: session.model.clone(),
                                failure_phase: None,
                                failure_reason: None,
                                phase_timings: task_phase_timings,
                            });

                            let newly_ready = self
                                .task_service
                                .resolve_dependencies_after_completion(&project_id, &task.task_id)?;
                            for t in &newly_ready {
                                self.emit(EngineEvent::TaskBecameReady { project_id, agent_id, task_id: t.task_id });
                            }

                            for follow_up in &execution.follow_up_tasks {
                                if follow_up_count >= MAX_FOLLOW_UPS_PER_LOOP {
                                    warn!("follow-up task cap ({MAX_FOLLOW_UPS_PER_LOOP}) reached, skipping remaining");
                                    break;
                                }
                                match self.task_service.create_follow_up_task(
                                    &task,
                                    follow_up.title.clone(),
                                    follow_up.description.clone(),
                                    vec![],
                                ) {
                                    Ok(new_task) => {
                                        follow_up_count += 1;
                                        self.emit(EngineEvent::FollowUpTaskCreated {
                                            project_id,
                                            agent_id,
                                            task_id: new_task.task_id,
                                        });
                                    }
                                    Err(aura_tasks::TaskError::DuplicateFollowUp) => {
                                        info!(title = %follow_up.title, "skipping duplicate follow-up task");
                                    }
                                    Err(e) => return Err(EngineError::Parse(format!("follow-up creation failed: {e}"))),
                                }
                            }

                            self.session_service.update_context_usage(
                                &project_id,
                                &agent_id,
                                &session.session_id,
                                execution.input_tokens + fix_inp,
                                execution.output_tokens + fix_out,
                            )?;

                            let changed_files: Vec<&str> = execution
                                .file_ops
                                .iter()
                                .map(|op| match op {
                                    FileOp::Create { path, .. }
                                    | FileOp::Modify { path, .. }
                                    | FileOp::Delete { path }
                                    | FileOp::SearchReplace { path, .. } => path.as_str(),
                                })
                                .collect();
                            work_log.push(format!(
                                "Task (completed): {}\nNotes: {}\nFiles changed: {}",
                                task.title,
                                execution.notes,
                                changed_files.join(", "),
                            ));

                            None
                        }
                    }
                }
                Err(e) => {
                    let reason = format!("execution error: {e}");
                    let task_dur = task_start.elapsed().as_millis() as u64;
                    self.task_service.fail_task(
                        &project_id,
                        &task.spec_id,
                        &task.task_id,
                        &reason,
                    )?;
                    failed_count += 1;
                    self.emit(EngineEvent::TaskFailed {
                        project_id,
                        agent_id,
                        task_id: task.task_id,
                        reason: e.to_string(),
                        duration_ms: Some(task_dur),
                        phase: Some("execution".into()),
                        parse_retries: None,
                        build_fix_attempts: None,
                        model: session.model.clone(),
                    });
                    record_task!(TaskMetrics {
                        task_id: task.task_id.to_string(),
                        title: task.title.clone(),
                        outcome: "failed".into(),
                        duration_ms: task_dur,
                        llm_duration_ms: None,
                        build_verify_duration_ms: None,
                        file_ops_duration_ms: None,
                        input_tokens: 0,
                        output_tokens: 0,
                        files_changed: 0,
                        parse_retries: 0,
                        build_fix_attempts: 0,
                        model: session.model.clone(),
                        failure_phase: Some("execution".into()),
                        failure_reason: Some(reason.clone()),
                        phase_timings: vec![],
                    });
                    work_log.push(format!("Task (failed): {}\nReason: {}", task.title, reason));
                    Some(reason)
                }
            };

            self.agent_service.finish_working(&project_id, &agent_id)?;

            if failure_reason.is_some() {
                continue;
            }

            let current_session =
                self.session_service
                    .get_session(&project_id, &agent_id, &session.session_id)?;
            if self.session_service.should_rollover(&current_session) {
                let project = self.project_service.get_project(&project_id)?;
                let history = format!(
                    "Project: {}\nDescription: {}\n\nSession work log ({} tasks completed):\n\n{}",
                    project.name,
                    project.description,
                    completed_count,
                    work_log.join("\n\n---\n\n"),
                );
                let summary_start = Instant::now();
                let summary = tokio::select! {
                    res = self.session_service.generate_rollover_summary(
                        &self.claude_client,
                        &api_key,
                        &history,
                    ) => { res? }
                    _ = stop_rx.changed() => {
                        let _ = self.agent_service.finish_working(&project_id, &agent_id);
                        let cmd = *stop_rx.borrow();
                        if cmd == LoopCommand::Stop {
                            let _ = self.session_service.end_session(
                                &project_id, &agent_id, &session.session_id, SessionStatus::Completed,
                            );
                            self.emit(EngineEvent::LoopStopped { project_id, agent_id, completed_count });
                            flush_metrics!("stopped");
                            return Ok(LoopOutcome::Stopped { completed_count });
                        } else {
                            let _ = self.session_service.end_session(
                                &project_id, &agent_id, &session.session_id, SessionStatus::Completed,
                            );
                            self.emit(EngineEvent::LoopPaused { project_id, agent_id, completed_count });
                            flush_metrics!("paused");
                            return Ok(LoopOutcome::Paused { completed_count });
                        }
                    }
                };
                let summary_duration_ms = summary_start.elapsed().as_millis() as u64;
                let context_usage_pct = current_session.context_usage_estimate * 100.0;
                let new_session = self.session_service.rollover_session(
                    &project_id,
                    &agent_id,
                    &session.session_id,
                    summary,
                    None,
                )?;
                self.emit(EngineEvent::SessionRolledOver {
                    project_id,
                    agent_id,
                    old_session_id: session.session_id,
                    new_session_id: new_session.session_id,
                    summary_duration_ms: Some(summary_duration_ms),
                    context_usage_pct: Some(context_usage_pct),
                });
                sessions_used += 1;
                session = new_session;
                work_log.clear();
            }
        }
    }

    fn extract_shell_command(task: &Task) -> Option<String> {
        let title = task.title.trim();
        let desc = task.description.trim();

        let prefixes = ["run ", "execute ", "run: "];
        let shell_indicators = ["cd ", "npm ", "npx ", "cargo ", "yarn ", "pnpm ", "pip ", "python ",
            "node ", "sh ", "bash ", "powershell ", "cmd ", "make ", "gradle ", "mvn ",
            "dotnet ", "go ", "rustup ", "apt ", "brew "];

        // 1) Check for backtick-wrapped commands in the description (most reliable)
        if let Some(cmd) = extract_backtick_command(desc, &shell_indicators) {
            return Some(cmd);
        }

        // 2) Try extracting a command from a prose description line like
        //    "Execute cd ui && npm install in a shell with ..."
        if let Some(cmd) = extract_prose_command(desc, &prefixes, &shell_indicators) {
            return Some(cmd);
        }

        // 3) Extract from the title
        let candidate = if prefixes.iter().any(|p| title.to_lowercase().starts_with(p)) {
            let lower = title.to_lowercase();
            let cmd_start = prefixes.iter()
                .filter_map(|p| if lower.starts_with(p) { Some(p.len()) } else { None })
                .next()
                .unwrap_or(0);
            title[cmd_start..].trim().to_string()
        } else if shell_indicators.iter().any(|ind| title.to_lowercase().starts_with(ind)) {
            title.to_string()
        } else if !desc.is_empty() && desc.lines().count() <= 2 {
            let first_line = desc.lines().next().unwrap_or("").trim();
            if shell_indicators.iter().any(|ind| first_line.to_lowercase().starts_with(ind)) {
                first_line.to_string()
            } else {
                return None;
            }
        } else {
            return None;
        };

        if candidate.is_empty() { None } else { Some(trim_prose_suffix(&candidate)) }
    }

    async fn execute_shell_task(
        &self,
        project: &Project,
        task: &Task,
        command: &str,
        agent_id: AgentId,
    ) -> Result<TaskExecution, EngineError> {
        let base_path = Path::new(&project.linked_folder_path);
        let max_attempts: u32 = MAX_SHELL_TASK_RETRIES;
        let mut prior_attempts_shell: Vec<BuildFixAttemptRecord> = Vec::new();

        for attempt in 1..=max_attempts {
            let shell_step_start = Instant::now();
            self.emit(EngineEvent::BuildVerificationStarted {
                project_id: project.project_id,
                agent_id,
                task_id: task.task_id,
                command: command.to_string(),
            });
            self.persist_build_step(task, BuildStepRecord {
                kind: "started".into(),
                command: Some(command.to_string()),
                stderr: None,
                stdout: None,
                attempt: Some(attempt),
            });

            let _ = self.event_tx.send(EngineEvent::TaskOutputDelta {
                project_id: project.project_id,
                agent_id,
                task_id: task.task_id,
                delta: format!("Running: {command} (attempt {attempt}/{max_attempts})\n"),
            });

            let result = build_verify::run_build_command(base_path, command).await?;
            let shell_step_duration_ms = shell_step_start.elapsed().as_millis() as u64;

            if result.success {
                self.emit(EngineEvent::BuildVerificationPassed {
                    project_id: project.project_id,
                    agent_id,
                    task_id: task.task_id,
                    command: command.to_string(),
                    stdout: result.stdout.clone(),
                    duration_ms: Some(shell_step_duration_ms),
                });
                self.persist_build_step(task, BuildStepRecord {
                    kind: "passed".into(),
                    command: Some(command.to_string()),
                    stderr: None,
                    stdout: Some(result.stdout.clone()),
                    attempt: Some(attempt),
                });

                // Run test_command if configured
                if let Some(ref test_cmd) = project.test_command {
                    if !test_cmd.trim().is_empty() {
                        let dummy_session = Session {
                            session_id: SessionId::new(),
                            agent_id: AgentId::new(),
                            project_id: project.project_id,
                            active_task_id: None,
                            tasks_worked: vec![],
                            context_usage_estimate: 0.0,
                            total_input_tokens: 0,
                            total_output_tokens: 0,
                            summary_of_previous_context: String::new(),
                            status: SessionStatus::Active,
                            user_id: None,
                            model: None,
                            started_at: chrono::Utc::now(),
                            ended_at: None,
                        };
                        let dummy_exec = TaskExecution {
                            notes: format!("Shell command: {command}"),
                            file_ops: vec![],
                            follow_up_tasks: vec![],
                            input_tokens: 0,
                            output_tokens: 0,
                            parse_retries: 0,
                            files_already_applied: false,
                        };
                        let mut test_fix_ops = Vec::new();
                        let no_baseline = HashSet::new();
                        let (test_passed, _test_inp, _test_out) = self.run_and_handle_tests(
                            project, task, &dummy_session,
                            &self.settings.get_decrypted_api_key().unwrap_or_default(),
                            &dummy_exec, test_cmd, base_path, attempt, &mut test_fix_ops,
                            &no_baseline,
                        ).await?;
                        if !test_passed {
                            if attempt < max_attempts {
                                continue;
                            }
                            return Err(EngineError::Build(
                                format!("test command `{test_cmd}` failed after {max_attempts} attempts"),
                            ));
                        }
                    }
                }

                let notes = format!("Command `{command}` succeeded on attempt {attempt}.\n{}", result.stdout);
                let _ = self.event_tx.send(EngineEvent::TaskOutputDelta {
                    project_id: project.project_id,
                    agent_id,
                    task_id: task.task_id,
                    delta: notes.clone(),
                });

                return Ok(TaskExecution {
                    notes,
                    file_ops: vec![],
                    follow_up_tasks: vec![],
                    input_tokens: 0,
                    output_tokens: 0,
                    parse_retries: 0,
                    files_already_applied: false,
                });
            }

            let shell_error_hash = Some(format!("{:x}", {
                let stderr_ref = if !result.stderr.is_empty() { &result.stderr } else { &result.stdout };
                let mut h = 0u64;
                for b in stderr_ref.bytes() {
                    h = h.wrapping_mul(31).wrapping_add(b as u64);
                }
                h
            }));
            self.emit(EngineEvent::BuildVerificationFailed {
                project_id: project.project_id,
                agent_id,
                task_id: task.task_id,
                command: command.to_string(),
                stdout: result.stdout.clone(),
                stderr: result.stderr.clone(),
                attempt,
                duration_ms: Some(shell_step_duration_ms),
                error_hash: shell_error_hash,
            });
            self.persist_build_step(task, BuildStepRecord {
                kind: "failed".into(),
                command: Some(command.to_string()),
                stderr: Some(result.stderr.clone()),
                stdout: Some(result.stdout.clone()),
                attempt: Some(attempt),
            });

            let detail = if !result.stderr.is_empty() { &result.stderr } else { &result.stdout };
            let _ = self.event_tx.send(EngineEvent::TaskOutputDelta {
                project_id: project.project_id,
                agent_id,
                task_id: task.task_id,
                delta: format!("Command failed (attempt {attempt}):\n{detail}\n"),
            });

            // Bail early on repeated identical error patterns (normalized to ignore line numbers)
            let current_sig = normalize_error_signature(detail);
            let consecutive_dupes = prior_attempts_shell
                .iter()
                .rev()
                .take_while(|a| a.error_signature == current_sig)
                .count();
            if consecutive_dupes >= 2 {
                info!(
                    task_id = %task.task_id,
                    attempt,
                    "same shell error pattern repeated {} times, aborting fix loop",
                    consecutive_dupes + 1
                );
                return Err(EngineError::Build(
                    format!("command `{command}` keeps failing with the same error after {} attempts", consecutive_dupes + 1),
                ));
            }

            if attempt < max_attempts {
                self.emit(EngineEvent::BuildFixAttempt {
                    project_id: project.project_id,
                    agent_id,
                    task_id: task.task_id,
                    attempt,
                });
                self.persist_build_step(task, BuildStepRecord {
                    kind: "fix_attempt".into(),
                    command: None,
                    stderr: None,
                    stdout: None,
                    attempt: Some(attempt),
                });

                let spec = self.store.get_spec(&task.project_id, &task.spec_id)?;
                let codebase_snapshot =
                    file_ops::read_relevant_files(&project.linked_folder_path, 50_000)?;
                let fix_prompt = build_fix_prompt_with_history(
                    project, &spec, task,
                    &Session {
                        session_id: aura_core::SessionId::new(),
                        agent_id: aura_core::AgentId::new(),
                        project_id: project.project_id,
                        active_task_id: None,
                        tasks_worked: vec![],
                        context_usage_estimate: 0.0,
                        total_input_tokens: 0,
                        total_output_tokens: 0,
                        summary_of_previous_context: String::new(),
                        status: aura_core::SessionStatus::Active,
                        user_id: None,
                        model: None,
                        started_at: chrono::Utc::now(),
                        ended_at: None,
                    },
                    &codebase_snapshot,
                    command,
                    &result.stderr,
                    &result.stdout,
                    &format!("Shell command task: {command}"),
                    &prior_attempts_shell,
                );

                let api_key = self.settings.get_decrypted_api_key()?;
                let (stream_tx, mut stream_rx) = mpsc::unbounded_channel::<ClaudeStreamEvent>();
                // Don't forward deltas from shell-fix calls: the response is
                // structured JSON that shouldn't appear in user-facing output.
                let forwarder = tokio::spawn(async move {
                    while let Some(evt) = stream_rx.recv().await {
                        drop(evt);
                    }
                });

                let response = self.claude_client.complete_stream(
                    &api_key,
                    &build_fix_system_prompt(),
                    &fix_prompt,
                    TASK_EXECUTION_MAX_TOKENS,
                    stream_tx,
                ).await?;
                let _ = forwarder.await;

                let mut attempt_files: Vec<String> = Vec::new();
                if let Ok(fix_execution) = parse_execution_response(&response) {
                    if !fix_execution.file_ops.is_empty() {
                        for op in &fix_execution.file_ops {
                            let (op_name, path) = match op {
                                FileOp::Create { path, .. } => ("create", path.as_str()),
                                FileOp::Modify { path, .. } => ("modify", path.as_str()),
                                FileOp::Delete { path } => ("delete", path.as_str()),
                                FileOp::SearchReplace { path, .. } => ("search_replace", path.as_str()),
                            };
                            attempt_files.push(format!("{op_name} {path}"));
                        }
                        let _ = file_ops::apply_file_ops(base_path, &fix_execution.file_ops).await;
                        self.emit_file_ops_applied(project.project_id, agent_id, task, &fix_execution.file_ops);
                    }
                }
                prior_attempts_shell.push(BuildFixAttemptRecord {
                    stderr: detail.clone(),
                    error_signature: normalize_error_signature(detail),
                    files_changed: attempt_files,
                });
            }
        }

        let detail = format!("command `{command}` failed after {max_attempts} attempts");
        Err(EngineError::Build(detail))
    }

    async fn execute_task_agentic(
        &self,
        project_id: &ProjectId,
        task: &Task,
        session: &Session,
        api_key: &str,
    ) -> Result<TaskExecution, EngineError> {
        let project = self.project_service.get_project(project_id)?;
        let spec = self.store.get_spec(project_id, &task.spec_id)?;

        let system_prompt = agentic_execution_system_prompt(&project);
        let task_context = build_agentic_task_context(&project, &spec, task, session);
        let tools = engine_tool_definitions();
        let executor = ChatToolExecutor::new(
            self.store.clone(),
            self.project_service.clone(),
            self.task_service.clone(),
        );

        let task_id = task.task_id;
        let mut api_messages: Vec<RichMessage> = vec![RichMessage::user(&task_context)];
        let mut total_input_tokens: u64 = 0;
        let mut total_output_tokens: u64 = 0;
        let mut tracked_file_ops: Vec<FileOp> = Vec::new();
        let mut notes = String::new();
        let mut follow_ups: Vec<FollowUpSuggestion> = Vec::new();
        let mut task_done_called = false;

        let pid = *project_id;
        let aid = session.agent_id;
        const MAX_AGENTIC_ITERATIONS: usize = 50;

        for iteration in 0..MAX_AGENTIC_ITERATIONS {
            let (claude_tx, mut claude_rx) = mpsc::unbounded_channel::<ClaudeStreamEvent>();
            let event_tx = self.event_tx.clone();
            let tid = task_id;
            let fwd_pid = pid;
            let fwd_aid = aid;
            let forwarder = tokio::spawn(async move {
                while let Some(evt) = claude_rx.recv().await {
                    if let ClaudeStreamEvent::Delta(text) = evt {
                        let _ = event_tx.send(EngineEvent::TaskOutputDelta {
                            project_id: fwd_pid,
                            agent_id: fwd_aid,
                            task_id: tid,
                            delta: text,
                        });
                    }
                }
            });

            let thinking = ThinkingConfig::enabled(10_000);
            let stream_result = self
                .claude_client
                .complete_stream_with_tools_thinking(
                    api_key,
                    &system_prompt,
                    api_messages.clone(),
                    tools.clone(),
                    TASK_EXECUTION_MAX_TOKENS,
                    thinking,
                    claude_tx,
                )
                .await?;
            let _ = forwarder.await;

            total_input_tokens += stream_result.input_tokens;
            total_output_tokens += stream_result.output_tokens;

            if stream_result.stop_reason != "tool_use" || stream_result.tool_calls.is_empty() {
                if notes.is_empty() && !stream_result.text.is_empty() {
                    notes = stream_result.text.clone();
                }
                break;
            }

            let mut assistant_blocks: Vec<ContentBlock> = Vec::new();
            if !stream_result.text.is_empty() {
                assistant_blocks.push(ContentBlock::Text {
                    text: stream_result.text.clone(),
                });
            }
            for tc in &stream_result.tool_calls {
                assistant_blocks.push(ContentBlock::ToolUse {
                    id: tc.id.clone(),
                    name: tc.name.clone(),
                    input: tc.input.clone(),
                });
            }
            api_messages.push(RichMessage::assistant_blocks(assistant_blocks));

            // Separate engine-handled tools from executor tools for parallel execution
            let mut executor_indices: Vec<usize> = Vec::new();
            for (i, tc) in stream_result.tool_calls.iter().enumerate() {
                match tc.name.as_str() {
                    "task_done" | "get_task_context" => {}
                    _ => {
                        track_file_op(&tc.name, &tc.input, &mut tracked_file_ops);
                        executor_indices.push(i);
                    }
                }
            }

            // Execute regular tools in parallel
            let executor_futures: Vec<_> = executor_indices.iter().map(|&i| {
                let tc = &stream_result.tool_calls[i];
                executor.execute(project_id, &tc.name, tc.input.clone())
            }).collect();
            let executor_results = futures::future::join_all(executor_futures).await;

            // Build result blocks in order, merging parallel results
            let mut result_blocks: Vec<ContentBlock> = Vec::new();
            let mut exec_result_iter = executor_results.into_iter();
            for tc in &stream_result.tool_calls {
                match tc.name.as_str() {
                    "task_done" => {
                        notes = tc.input.get("notes")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        if let Some(arr) = tc.input.get("follow_ups").and_then(|v| v.as_array()) {
                            for fu in arr {
                                let title = fu.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                let desc = fu.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                follow_ups.push(FollowUpSuggestion { title, description: desc });
                            }
                        }
                        result_blocks.push(ContentBlock::ToolResult {
                            tool_use_id: tc.id.clone(),
                            content: r#"{"status":"completed"}"#.to_string(),
                            is_error: None,
                        });
                        task_done_called = true;
                    }
                    "get_task_context" => {
                        let ctx = build_agentic_task_context(&project, &spec, task, session);
                        result_blocks.push(ContentBlock::ToolResult {
                            tool_use_id: tc.id.clone(),
                            content: ctx,
                            is_error: None,
                        });
                    }
                    _ => {
                        if let Some(result) = exec_result_iter.next() {
                            let _ = self.event_tx.send(EngineEvent::TaskOutputDelta {
                                project_id: pid,
                                agent_id: aid,
                                task_id,
                                delta: format!("\n[tool: {} -> {}]\n", tc.name,
                                    if result.is_error { "error" } else { "ok" }),
                            });
                            result_blocks.push(ContentBlock::ToolResult {
                                tool_use_id: tc.id.clone(),
                                content: result.content,
                                is_error: if result.is_error { Some(true) } else { None },
                            });
                        }
                    }
                }
            }
            api_messages.push(RichMessage::tool_results(result_blocks));

            if task_done_called {
                break;
            }

            if iteration + 1 >= MAX_AGENTIC_ITERATIONS {
                warn!(
                    task_id = %task_id,
                    "agentic tool-use loop hit max iterations ({}), stopping",
                    MAX_AGENTIC_ITERATIONS
                );
            }
        }

        if notes.is_empty() {
            notes = "Task completed via agentic tool-use loop".to_string();
        }

        Ok(TaskExecution {
            notes,
            file_ops: tracked_file_ops,
            follow_up_tasks: follow_ups,
            input_tokens: total_input_tokens,
            output_tokens: total_output_tokens,
            parse_retries: 0,
            files_already_applied: true,
        })
    }

    #[allow(dead_code)]
    async fn execute_task_single_shot(
        &self,
        project_id: &ProjectId,
        task: &Task,
        session: &Session,
        api_key: &str,
    ) -> Result<TaskExecution, EngineError> {
        let project = self.project_service.get_project(project_id)?;
        let spec = self.store.get_spec(project_id, &task.spec_id)?;

        let codebase_snapshot = file_ops::read_relevant_files(&project.linked_folder_path, 50_000)?;
        let user_message =
            build_execution_prompt(&project, &spec, task, session, &codebase_snapshot);

        let task_id = task.task_id;

        let token_counts: Arc<Mutex<(u64, u64)>> = Arc::new(Mutex::new((0, 0)));

        let pid = *project_id;
        let aid = session.agent_id;

        let response = {
            let (stream_tx, mut stream_rx) = mpsc::unbounded_channel::<ClaudeStreamEvent>();
            let event_tx = self.event_tx.clone();
            let tid = task_id;
            let fwd_pid = pid;
            let fwd_aid = aid;
            let tc = token_counts.clone();
            let forwarder = tokio::spawn(async move {
                while let Some(evt) = stream_rx.recv().await {
                    match evt {
                        ClaudeStreamEvent::Delta(text) => {
                            let _ = event_tx.send(EngineEvent::TaskOutputDelta { project_id: fwd_pid, agent_id: fwd_aid, task_id: tid, delta: text });
                        }
                        ClaudeStreamEvent::Done { input_tokens, output_tokens, .. } => {
                            let mut g = tc.lock().await;
                            g.0 += input_tokens;
                            g.1 += output_tokens;
                        }
                        _ => {}
                    }
                }
            });

            let resp = self
                .claude_client
                .complete_stream(
                    api_key,
                    &task_execution_system_prompt(),
                    &user_message,
                    TASK_EXECUTION_MAX_TOKENS,
                    stream_tx,
                )
                .await?;
            let _ = forwarder.await;
            resp
        };

        match parse_execution_response(&response) {
            Ok(mut execution) => {
                let (inp, out) = *token_counts.lock().await;
                execution.input_tokens = inp;
                execution.output_tokens = out;
                execution.parse_retries = 0;

                // Pre-write validation: catch obvious content issues before a full build cycle
                let validation_report = file_ops::validate_all_file_ops(&execution.file_ops);
                if !validation_report.is_empty() {
                    warn!(task_id = %task_id, "pre-write validation found issues, requesting correction");
                    self.emit(EngineEvent::TaskRetrying {
                        project_id: pid,
                        agent_id: aid,
                        task_id,
                        attempt: 1,
                        reason: format!("pre-write validation: {}", &validation_report[..validation_report.len().min(200)]),
                    });

                    let correction_prompt = format!(
                        "STOP: Your file_ops contain content that will cause build errors. \
                         Fix these issues in your response:\n\n{}\n\n\
                         Respond with the corrected JSON (same schema).",
                        validation_report
                    );
                    let messages = vec![
                        ("user".to_string(), user_message.clone()),
                        ("assistant".to_string(), response.clone()),
                        ("user".to_string(), correction_prompt),
                    ];

                    let (stream_tx2, mut stream_rx2) = mpsc::unbounded_channel::<ClaudeStreamEvent>();
                    let tc2 = token_counts.clone();
                    let forwarder2 = tokio::spawn(async move {
                        while let Some(evt) = stream_rx2.recv().await {
                            if let ClaudeStreamEvent::Done { input_tokens, output_tokens, .. } = evt {
                                let mut g = tc2.lock().await;
                                g.0 += input_tokens;
                                g.1 += output_tokens;
                            }
                        }
                    });

                    let corrected = self
                        .claude_client
                        .complete_stream_multi(
                            api_key,
                            &task_execution_system_prompt(),
                            messages,
                            TASK_EXECUTION_MAX_TOKENS,
                            stream_tx2,
                        )
                        .await?;
                    let _ = forwarder2.await;

                    if let Ok(mut corrected_exec) = parse_execution_response(&corrected) {
                        let (inp, out) = *token_counts.lock().await;
                        corrected_exec.input_tokens = inp;
                        corrected_exec.output_tokens = out;
                        corrected_exec.parse_retries = 1;
                        return Ok(corrected_exec);
                    }
                }

                Ok(execution)
            }
            Err(first_err) => {
                warn!(task_id = %task_id, error = %first_err, "first execution parse failed, retrying");

                let mut last_response = response;
                for attempt in 1..=MAX_EXECUTION_RETRIES {
                    self.emit(EngineEvent::TaskRetrying {
                        project_id: pid,
                        agent_id: aid,
                        task_id,
                        attempt,
                        reason: format!("response was not valid JSON (attempt {attempt})"),
                    });

                    let messages = vec![
                        ("user".to_string(), user_message.clone()),
                        ("assistant".to_string(), last_response.clone()),
                        ("user".to_string(), RETRY_CORRECTION_PROMPT.to_string()),
                    ];

                    let (stream_tx, mut stream_rx) = mpsc::unbounded_channel::<ClaudeStreamEvent>();
                    let tc = token_counts.clone();
                    let forwarder = tokio::spawn(async move {
                        while let Some(evt) = stream_rx.recv().await {
                            if let ClaudeStreamEvent::Done { input_tokens, output_tokens, .. } = evt {
                                let mut g = tc.lock().await;
                                g.0 += input_tokens;
                                g.1 += output_tokens;
                            }
                        }
                    });

                    let retry_resp = self
                        .claude_client
                        .complete_stream_multi(
                            api_key,
                            &task_execution_system_prompt(),
                            messages,
                            TASK_EXECUTION_MAX_TOKENS,
                            stream_tx,
                        )
                        .await?;
                    let _ = forwarder.await;

                    match parse_execution_response(&retry_resp) {
                        Ok(mut execution) => {
                            let (inp, out) = *token_counts.lock().await;
                            execution.input_tokens = inp;
                            execution.output_tokens = out;
                            execution.parse_retries = attempt;
                            return Ok(execution);
                        }
                        Err(e) => {
                            warn!(task_id = %task_id, attempt, error = %e, "retry parse failed");
                            last_response = retry_resp;
                        }
                    }
                }

                Err(first_err)
            }
        }
    }

    /// Run the project's build command and, if it fails, ask Claude to fix the
    /// errors up to `MAX_BUILD_FIX_RETRIES` times. Returns the final
    /// `TaskExecution` (which may contain additional file ops from fix rounds)
    /// and whether the build ultimately passed.
    fn persist_build_step(&self, task: &Task, step: BuildStepRecord) {
        if let Ok(mut t) = self.store.get_task(&task.project_id, &task.spec_id, &task.task_id) {
            t.build_steps.push(step);
            let _ = self.store.put_task(&t);
        }
    }

    fn persist_test_step(&self, task: &Task, step: TestStepRecord) {
        if let Ok(mut t) = self.store.get_task(&task.project_id, &task.spec_id, &task.task_id) {
            t.test_steps.push(step);
            let _ = self.store.put_task(&t);
        }
    }

    /// Run the test suite and return the names of currently-failing tests.
    ///
    /// Used before task execution to establish a baseline so that
    /// `verify_and_fix_build` can distinguish pre-existing failures from
    /// regressions introduced by the current task.
    async fn capture_test_baseline(&self, project: &Project) -> HashSet<String> {
        let test_command = match project.test_command.as_ref().filter(|c| !c.trim().is_empty()) {
            Some(cmd) => cmd,
            None => return HashSet::new(),
        };
        let base_path = Path::new(&project.linked_folder_path);
        match build_verify::run_build_command(base_path, test_command).await {
            Ok(result) => {
                let (tests, _) = build_verify::parse_test_output(
                    &result.stdout, &result.stderr, result.success,
                );
                let failures: HashSet<String> = tests
                    .into_iter()
                    .filter(|t| t.status == "failed")
                    .map(|t| t.name)
                    .collect();
                if !failures.is_empty() {
                    info!(
                        count = failures.len(),
                        tests = ?failures,
                        "captured {} pre-existing test failure(s) as baseline",
                        failures.len(),
                    );
                }
                failures
            }
            Err(e) => {
                warn!(error = %e, "baseline test capture failed, assuming no baseline");
                HashSet::new()
            }
        }
    }

    /// Returns (fix_ops, build_passed, attempts_used, duplicate_bailouts, fix_input_tokens, fix_output_tokens).
    async fn verify_and_fix_build(
        &self,
        project: &Project,
        task: &Task,
        session: &Session,
        api_key: &str,
        initial_execution: &TaskExecution,
        baseline_test_failures: &HashSet<String>,
    ) -> Result<(Vec<FileOp>, bool, u32, u32, u64, u64), EngineError> {
        let build_command = match &project.build_command {
            Some(cmd) if !cmd.trim().is_empty() => cmd.clone(),
            _ => {
                self.emit(EngineEvent::BuildVerificationSkipped {
                    project_id: project.project_id,
                    agent_id: session.agent_id,
                    task_id: task.task_id,
                    reason: "no build_command configured on project".into(),
                });
                self.persist_build_step(task, BuildStepRecord {
                    kind: "skipped".into(),
                    command: None,
                    stderr: None,
                    stdout: Some("no build_command configured on project".into()),
                    attempt: None,
                });
                return Ok((vec![], true, 0, 0, 0, 0));
            }
        };

        let test_command = project.test_command.as_ref()
            .filter(|cmd| !cmd.trim().is_empty())
            .cloned();

        let base_path = Path::new(&project.linked_folder_path);
        let mut all_fix_ops: Vec<FileOp> = Vec::new();
        let mut prior_attempts: Vec<BuildFixAttemptRecord> = Vec::new();
        let mut duplicate_bailouts: u32 = 0;
        let mut fix_input_tokens: u64 = 0;
        let mut fix_output_tokens: u64 = 0;

        for attempt in 1..=MAX_BUILD_FIX_RETRIES {
            let build_step_start = Instant::now();
            self.emit(EngineEvent::BuildVerificationStarted {
                project_id: project.project_id,
                agent_id: session.agent_id,
                task_id: task.task_id,
                command: build_command.clone(),
            });
            self.persist_build_step(task, BuildStepRecord {
                kind: "started".into(),
                command: Some(build_command.clone()),
                stderr: None,
                stdout: None,
                attempt: Some(attempt),
            });

            let build_result = build_verify::run_build_command(base_path, &build_command).await?;
            let step_duration_ms = build_step_start.elapsed().as_millis() as u64;

            if build_result.success {
                self.emit(EngineEvent::BuildVerificationPassed {
                    project_id: project.project_id,
                    agent_id: session.agent_id,
                    task_id: task.task_id,
                    command: build_command.clone(),
                    stdout: build_result.stdout.clone(),
                    duration_ms: Some(step_duration_ms),
                });
                self.persist_build_step(task, BuildStepRecord {
                    kind: "passed".into(),
                    command: Some(build_command.clone()),
                    stderr: None,
                    stdout: Some(build_result.stdout),
                    attempt: Some(attempt),
                });

                let test_passed = if let Some(ref test_cmd) = test_command {
                    let (test_result, test_inp, test_out) = self.run_and_handle_tests(
                        project, task, session, api_key, initial_execution,
                        test_cmd, base_path, attempt, &mut all_fix_ops,
                        baseline_test_failures,
                    ).await?;
                    fix_input_tokens += test_inp;
                    fix_output_tokens += test_out;
                    test_result
                } else {
                    true
                };

                if test_passed {
                    return Ok((all_fix_ops, true, attempt, duplicate_bailouts, fix_input_tokens, fix_output_tokens));
                }
                continue;
            }

            let error_hash = Some(format!("{:x}", {
                let mut h = 0u64;
                for b in build_result.stderr.bytes() {
                    h = h.wrapping_mul(31).wrapping_add(b as u64);
                }
                h
            }));

            self.emit(EngineEvent::BuildVerificationFailed {
                project_id: project.project_id,
                agent_id: session.agent_id,
                task_id: task.task_id,
                command: build_command.clone(),
                stdout: build_result.stdout.clone(),
                stderr: build_result.stderr.clone(),
                attempt,
                duration_ms: Some(step_duration_ms),
                error_hash,
            });
            self.persist_build_step(task, BuildStepRecord {
                kind: "failed".into(),
                command: Some(build_command.clone()),
                stderr: Some(build_result.stderr.clone()),
                stdout: Some(build_result.stdout.clone()),
                attempt: Some(attempt),
            });

            if attempt == MAX_BUILD_FIX_RETRIES {
                info!(task_id = %task.task_id, "build still failing after max retries");
                return Ok((all_fix_ops, false, attempt, duplicate_bailouts, fix_input_tokens, fix_output_tokens));
            }

            let current_signature = normalize_error_signature(&build_result.stderr);
            let consecutive_dupes = prior_attempts
                .iter()
                .rev()
                .take_while(|a| a.error_signature == current_signature)
                .count();
            if consecutive_dupes >= 2 {
                info!(
                    task_id = %task.task_id,
                    attempt,
                    "same error pattern repeated {} times (after normalizing line numbers), aborting fix loop",
                    consecutive_dupes + 1
                );
                duplicate_bailouts += 1;
                return Ok((all_fix_ops, false, attempt, duplicate_bailouts, fix_input_tokens, fix_output_tokens));
            }

            self.emit(EngineEvent::BuildFixAttempt {
                project_id: project.project_id,
                agent_id: session.agent_id,
                task_id: task.task_id,
                attempt,
            });
            self.persist_build_step(task, BuildStepRecord {
                kind: "fix_attempt".into(),
                command: None,
                stderr: None,
                stdout: None,
                attempt: Some(attempt),
            });

            let spec = self.store.get_spec(&task.project_id, &task.spec_id)?;
            let codebase_snapshot =
                file_ops::read_relevant_files(&project.linked_folder_path, 50_000)?;

            let fix_prompt = build_fix_prompt_with_history(
                project,
                &spec,
                task,
                session,
                &codebase_snapshot,
                &build_command,
                &build_result.stderr,
                &build_result.stdout,
                &initial_execution.notes,
                &prior_attempts,
            );

            let fix_tc: Arc<Mutex<(u64, u64)>> = Arc::new(Mutex::new((0, 0)));
            let (stream_tx, mut stream_rx) = mpsc::unbounded_channel::<ClaudeStreamEvent>();
            let fix_tc_clone = fix_tc.clone();
            // Don't forward deltas from build-fix calls: the response is
            // structured JSON that shouldn't appear in user-facing output.
            let forwarder = tokio::spawn(async move {
                while let Some(evt) = stream_rx.recv().await {
                    if let ClaudeStreamEvent::Done { input_tokens, output_tokens, .. } = evt {
                        let mut g = fix_tc_clone.lock().await;
                        g.0 += input_tokens;
                        g.1 += output_tokens;
                    }
                }
            });

            let response = self
                .claude_client
                .complete_stream(
                    api_key,
                    &build_fix_system_prompt(),
                    &fix_prompt,
                    TASK_EXECUTION_MAX_TOKENS,
                    stream_tx,
                )
                .await?;
            let _ = forwarder.await;

            {
                let g = fix_tc.lock().await;
                fix_input_tokens += g.0;
                fix_output_tokens += g.1;
            }

            // Summarize what files this attempt changed for the history
            let mut attempt_files_changed: Vec<String> = Vec::new();

            let fix_applied = match parse_execution_response(&response) {
                Ok(fix_execution) => {
                    file_ops::apply_file_ops(base_path, &fix_execution.file_ops).await?;

                    let files: Vec<crate::events::FileOpSummary> = fix_execution
                        .file_ops
                        .iter()
                        .map(|op| {
                            let (op_name, path) = match op {
                                FileOp::Create { path, .. } => ("create", path.as_str()),
                                FileOp::Modify { path, .. } => ("modify", path.as_str()),
                                FileOp::Delete { path } => ("delete", path.as_str()),
                                FileOp::SearchReplace { path, .. } => ("search_replace", path.as_str()),
                            };
                            attempt_files_changed.push(format!("{op_name} {path}"));
                            crate::events::FileOpSummary {
                                op: op_name.to_string(),
                                path: path.to_string(),
                            }
                        })
                        .collect();

                    if !fix_execution.file_ops.is_empty() {
                        self.emit(EngineEvent::FileOpsApplied {
                            project_id: project.project_id,
                            agent_id: session.agent_id,
                            task_id: task.task_id,
                            files_written: fix_execution
                                .file_ops
                                .iter()
                                .filter(|op| matches!(op, FileOp::Create { .. } | FileOp::Modify { .. } | FileOp::SearchReplace { .. }))
                                .count(),
                            files_deleted: fix_execution
                                .file_ops
                                .iter()
                                .filter(|op| matches!(op, FileOp::Delete { .. }))
                                .count(),
                            files,
                        });
                    }

                    all_fix_ops.extend(fix_execution.file_ops);
                    true
                }
                Err(e) => {
                    warn!(
                        task_id = %task.task_id,
                        attempt,
                        error = %e,
                        "failed to parse build-fix response, fix not applied"
                    );
                    false
                }
            };

            if fix_applied {
                let sig = normalize_error_signature(&build_result.stderr);
                prior_attempts.push(BuildFixAttemptRecord {
                    stderr: build_result.stderr,
                    error_signature: sig,
                    files_changed: attempt_files_changed,
                });
            }
        }

        Ok((all_fix_ops, false, MAX_BUILD_FIX_RETRIES, duplicate_bailouts, fix_input_tokens, fix_output_tokens))
    }

    #[allow(clippy::too_many_arguments)]
    async fn run_and_handle_tests(
        &self,
        project: &Project,
        task: &Task,
        session: &Session,
        api_key: &str,
        initial_execution: &TaskExecution,
        test_command: &str,
        base_path: &Path,
        attempt: u32,
        all_fix_ops: &mut Vec<FileOp>,
        baseline_test_failures: &HashSet<String>,
    ) -> Result<(bool, u64, u64), EngineError> {
        self.emit(EngineEvent::TestVerificationStarted {
            project_id: project.project_id,
            agent_id: session.agent_id,
            task_id: task.task_id,
            command: test_command.to_string(),
        });
        self.persist_test_step(task, TestStepRecord {
            kind: "started".into(),
            command: Some(test_command.to_string()),
            stderr: None,
            stdout: None,
            attempt: Some(attempt),
            tests: vec![],
            summary: None,
        });

        let test_start = Instant::now();
        let test_result = build_verify::run_build_command(base_path, test_command).await?;
        let test_duration_ms = test_start.elapsed().as_millis() as u64;
        let (tests, summary) = build_verify::parse_test_output(
            &test_result.stdout, &test_result.stderr, test_result.success,
        );

        if test_result.success {
            self.emit(EngineEvent::TestVerificationPassed {
                project_id: project.project_id,
                agent_id: session.agent_id,
                task_id: task.task_id,
                command: test_command.to_string(),
                stdout: test_result.stdout.clone(),
                tests: tests.clone(),
                summary: summary.clone(),
                duration_ms: Some(test_duration_ms),
            });
            self.persist_test_step(task, TestStepRecord {
                kind: "passed".into(),
                command: Some(test_command.to_string()),
                stderr: None,
                stdout: Some(test_result.stdout),
                attempt: Some(attempt),
                tests,
                summary: Some(summary),
            });
            return Ok((true, 0, 0));
        }

        if !baseline_test_failures.is_empty() {
            let current_failures: HashSet<String> = tests
                .iter()
                .filter(|t| t.status == "failed")
                .map(|t| t.name.clone())
                .collect();
            let new_failures: Vec<&String> = current_failures
                .iter()
                .filter(|name| !baseline_test_failures.contains(*name))
                .collect();
            if new_failures.is_empty() {
                info!(
                    task_id = %task.task_id,
                    pre_existing = current_failures.len(),
                    "all test failures are pre-existing (baseline), treating as passed"
                );
                let adjusted_summary = format!(
                    "{summary} ({} pre-existing, ignored)",
                    current_failures.len()
                );
                self.emit(EngineEvent::TestVerificationPassed {
                    project_id: project.project_id,
                    agent_id: session.agent_id,
                    task_id: task.task_id,
                    command: test_command.to_string(),
                    stdout: test_result.stdout.clone(),
                    tests: tests.clone(),
                    summary: adjusted_summary.clone(),
                    duration_ms: Some(test_duration_ms),
                });
                self.persist_test_step(task, TestStepRecord {
                    kind: "passed_with_baseline_failures".into(),
                    command: Some(test_command.to_string()),
                    stderr: Some(test_result.stderr),
                    stdout: Some(test_result.stdout),
                    attempt: Some(attempt),
                    tests,
                    summary: Some(adjusted_summary),
                });
                return Ok((true, 0, 0));
            }
            info!(
                task_id = %task.task_id,
                new_failures = ?new_failures,
                pre_existing = current_failures.len() - new_failures.len(),
                "found {} new test failure(s) beyond baseline",
                new_failures.len()
            );
        }

        self.emit(EngineEvent::TestVerificationFailed {
            project_id: project.project_id,
            agent_id: session.agent_id,
            task_id: task.task_id,
            command: test_command.to_string(),
            stdout: test_result.stdout.clone(),
            stderr: test_result.stderr.clone(),
            attempt,
            tests: tests.clone(),
            summary: summary.clone(),
            duration_ms: Some(test_duration_ms),
        });
        self.persist_test_step(task, TestStepRecord {
            kind: "failed".into(),
            command: Some(test_command.to_string()),
            stderr: Some(test_result.stderr.clone()),
            stdout: Some(test_result.stdout.clone()),
            attempt: Some(attempt),
            tests,
            summary: Some(summary),
        });

        // Ask Claude to fix the test failures
        self.emit(EngineEvent::TestFixAttempt {
            project_id: project.project_id,
            agent_id: session.agent_id,
            task_id: task.task_id,
            attempt,
        });
        self.persist_test_step(task, TestStepRecord {
            kind: "fix_attempt".into(),
            command: None,
            stderr: None,
            stdout: None,
            attempt: Some(attempt),
            tests: vec![],
            summary: None,
        });

        let spec = self.store.get_spec(&task.project_id, &task.spec_id)?;
        let codebase_snapshot =
            file_ops::read_relevant_files(&project.linked_folder_path, 50_000)?;

        let fix_prompt = build_fix_prompt_with_history(
            project,
            &spec,
            task,
            session,
            &codebase_snapshot,
            test_command,
            &test_result.stderr,
            &test_result.stdout,
            &initial_execution.notes,
            &[],
        );

        let test_fix_tc: Arc<Mutex<(u64, u64)>> = Arc::new(Mutex::new((0, 0)));
        let (stream_tx, mut stream_rx) = mpsc::unbounded_channel::<ClaudeStreamEvent>();
        let test_fix_tc_clone = test_fix_tc.clone();
        // Don't forward deltas from test-fix calls: the response is
        // structured JSON that shouldn't appear in user-facing output.
        let forwarder = tokio::spawn(async move {
            while let Some(evt) = stream_rx.recv().await {
                if let ClaudeStreamEvent::Done { input_tokens, output_tokens, .. } = evt {
                    let mut g = test_fix_tc_clone.lock().await;
                    g.0 += input_tokens;
                    g.1 += output_tokens;
                }
            }
        });

        let response = self
            .claude_client
            .complete_stream(
                api_key,
                &build_fix_system_prompt(),
                &fix_prompt,
                TASK_EXECUTION_MAX_TOKENS,
                stream_tx,
            )
            .await?;
        let _ = forwarder.await;

        let (test_fix_inp, test_fix_out) = *test_fix_tc.lock().await;

        match parse_execution_response(&response) {
            Ok(fix_execution) => {
                file_ops::apply_file_ops(base_path, &fix_execution.file_ops).await?;
                if !fix_execution.file_ops.is_empty() {
                    self.emit_file_ops_applied(project.project_id, session.agent_id, task, &fix_execution.file_ops);
                }
                all_fix_ops.extend(fix_execution.file_ops);
            }
            Err(e) => {
                warn!(
                    task_id = %task.task_id,
                    attempt,
                    error = %e,
                    "failed to parse test-fix response"
                );
            }
        }

        Ok((false, test_fix_inp, test_fix_out))
    }

    fn emit_file_ops_applied(&self, project_id: ProjectId, agent_id: AgentId, task: &Task, ops: &[FileOp]) {
        let files_written = ops.iter().filter(|op| matches!(op, FileOp::Create { .. } | FileOp::Modify { .. } | FileOp::SearchReplace { .. })).count();
        let files_deleted = ops.iter().filter(|op| matches!(op, FileOp::Delete { .. })).count();
        let files: Vec<crate::events::FileOpSummary> = ops.iter().map(|op| {
            let (op_name, path) = match op {
                FileOp::Create { path, .. } => ("create", path.as_str()),
                FileOp::Modify { path, .. } => ("modify", path.as_str()),
                FileOp::Delete { path } => ("delete", path.as_str()),
                FileOp::SearchReplace { path, .. } => ("search_replace", path.as_str()),
            };
            crate::events::FileOpSummary { op: op_name.to_string(), path: path.to_string() }
        }).collect();
        self.emit(EngineEvent::FileOpsApplied {
            project_id,
            agent_id,
            task_id: task.task_id,
            files_written,
            files_deleted,
            files,
        });
    }

    fn update_task_tracking(
        &self,
        project_id: &ProjectId,
        task: &Task,
        user_id: &Option<String>,
        model: &Option<String>,
        input_tokens: u64,
        output_tokens: u64,
    ) {
        if let Ok(mut t) = self.store.get_task(project_id, &task.spec_id, &task.task_id) {
            t.user_id = user_id.clone();
            t.model = model.clone();
            t.total_input_tokens += input_tokens;
            t.total_output_tokens += output_tokens;
            let _ = self.store.put_task(&t);
        }
    }

    fn current_user_id(&self) -> Option<String> {
        self.store
            .get_setting("zero_auth_session")
            .ok()
            .and_then(|bytes| serde_json::from_slice::<ZeroAuthSession>(&bytes).ok())
            .map(|s| s.user_id)
    }

    fn emit(&self, event: EngineEvent) {
        let _ = self.event_tx.send(event);
    }
}

/// Remove trailing natural-language prose from an extracted shell command.
/// e.g. "cargo build --workspace to confirm compilation" → "cargo build --workspace"
fn trim_prose_suffix(cmd: &str) -> String {
    let lower = cmd.to_lowercase();
    // Boundaries where a shell command ends and prose begins.
    // Ordered longest-first so we match the most specific boundary.
    let boundaries = [
        " in order to ",
        " and verify ",
        " and confirm ",
        " and check ",
        " so that ",
        " to confirm ",
        " to verify ",
        " to check ",
        " to ensure ",
        " to produce ",
        " to install ",
        " to run ",
        " to test ",
        " to build ",
        " to see ",
        " to make ",
        " for verification",
        " for testing",
        " in a shell",
        " in the shell",
        " in the project",
        " in order ",
        " to ",
        " which ",
        " that ",
        " after ",
        " before ",
        " since ",
        " because ",
        " if ",
    ];

    let mut best_cut = cmd.len();
    for boundary in &boundaries {
        if let Some(pos) = lower.find(boundary) {
            if pos > 0 && pos < best_cut {
                // Make sure the text before the boundary looks like a command
                // (has at least one flag or known program name)
                let before = cmd[..pos].trim();
                if !before.is_empty() {
                    best_cut = pos;
                    break; // boundaries are priority-ordered; first match wins
                }
            }
        }
    }

    cmd[..best_cut].trim().to_string()
}

/// Extract a shell command from backtick-delimited text in the description.
/// Looks for `command` patterns where the command starts with a known indicator.
fn extract_backtick_command(text: &str, shell_indicators: &[&str]) -> Option<String> {
    let mut search_from = 0;
    while let Some(start) = text[search_from..].find('`') {
        let abs_start = search_from + start + 1;
        if abs_start >= text.len() {
            break;
        }
        if let Some(end) = text[abs_start..].find('`') {
            let candidate = text[abs_start..abs_start + end].trim();
            if !candidate.is_empty()
                && shell_indicators
                    .iter()
                    .any(|ind| candidate.to_lowercase().starts_with(ind))
            {
                return Some(candidate.to_string());
            }
            search_from = abs_start + end + 1;
        } else {
            break;
        }
    }
    None
}

/// Extract a command from prose like "Execute cd ui && npm install in a shell with..."
/// Looks for a prefix ("execute ", "run ") followed by a shell indicator, and cuts
/// the command at natural language boundaries (" in a shell", " in a ", " to ", " with ").
fn extract_prose_command(text: &str, prefixes: &[&str], shell_indicators: &[&str]) -> Option<String> {
    for line in text.lines() {
        let trimmed = line.trim().to_lowercase();
        for prefix in prefixes {
            if !trimmed.starts_with(prefix) {
                continue;
            }
            let after_prefix = &line.trim()[prefix.len()..];
            if !shell_indicators
                .iter()
                .any(|ind| after_prefix.to_lowercase().starts_with(ind))
            {
                continue;
            }
            // Cut at the first natural-language boundary
            let boundaries = [" in a shell", " in a ", " to ", " with "];
            let mut end = after_prefix.len();
            for boundary in &boundaries {
                if let Some(pos) = after_prefix.to_lowercase().find(boundary) {
                    if pos < end && pos > 0 {
                        end = pos;
                    }
                }
            }
            let cmd = after_prefix[..end].trim();
            if !cmd.is_empty() {
                return Some(cmd.to_string());
            }
        }
    }
    None
}

fn build_execution_prompt(
    project: &Project,
    spec: &Spec,
    task: &Task,
    session: &Session,
    codebase_snapshot: &str,
) -> String {
    let mut prompt = String::new();

    prompt.push_str(&format!(
        "# Project: {}\n{}\n\n",
        project.name, project.description
    ));

    prompt.push_str(&format!(
        "# Spec: {}\n{}\n\n",
        spec.title, spec.markdown_contents
    ));

    prompt.push_str(&format!("# Task: {}\n{}\n\n", task.title, task.description));

    if !session.summary_of_previous_context.is_empty() {
        prompt.push_str(&format!(
            "# Previous Context Summary\n{}\n\n",
            session.summary_of_previous_context
        ));
    }

    if !task.execution_notes.is_empty() {
        prompt.push_str(&format!(
            "# Notes from Prior Attempts\n{}\n\n",
            task.execution_notes
        ));
    }

    if !codebase_snapshot.is_empty() {
        prompt.push_str(&format!(
            "# Current Codebase Files\n{}\n",
            codebase_snapshot
        ));
    }

    prompt
}

#[derive(serde::Deserialize)]
struct RawExecutionResponse {
    notes: String,
    file_ops: Vec<FileOp>,
    #[serde(default)]
    follow_up_tasks: Vec<RawFollowUp>,
}

#[derive(serde::Deserialize)]
struct RawFollowUp {
    title: String,
    description: String,
}

pub fn parse_execution_response(response: &str) -> Result<TaskExecution, EngineError> {
    let trimmed = response.trim();

    // 1) Try parsing the entire response as JSON
    if let Ok(parsed) = serde_json::from_str::<RawExecutionResponse>(trimmed) {
        return Ok(raw_to_execution(parsed));
    }

    // 2) Try extracting from the last fenced JSON block (models sometimes wrap JSON in markdown)
    if let Some(json_str) = extract_last_fenced_json(trimmed) {
        if let Ok(parsed) = serde_json::from_str::<RawExecutionResponse>(&json_str) {
            return Ok(raw_to_execution(parsed));
        }
    }

    // 3) Scan for an embedded JSON object by finding balanced braces.
    //    Handles the common case where the model emits thinking/reasoning
    //    text before (or after) the actual JSON payload.
    if let Some(json_str) = extract_balanced_json(trimmed) {
        if let Ok(parsed) = serde_json::from_str::<RawExecutionResponse>(&json_str) {
            return Ok(raw_to_execution(parsed));
        }
    }

    Err(EngineError::Parse(format!(
        "failed to parse execution response: {}",
        &trimmed[..trimmed.len().min(500)]
    )))
}

fn raw_to_execution(raw: RawExecutionResponse) -> TaskExecution {
    TaskExecution {
        notes: raw.notes,
        file_ops: raw.file_ops,
        follow_up_tasks: raw
            .follow_up_tasks
            .into_iter()
            .map(|f| FollowUpSuggestion {
                title: f.title,
                description: f.description,
            })
            .collect(),
        input_tokens: 0,
        output_tokens: 0,
        parse_retries: 0,
        files_already_applied: false,
    }
}

/// Extract JSON from the *last* fenced code block, which is more likely to
/// contain the final structured output when the model thinks out loud first.
fn extract_last_fenced_json(text: &str) -> Option<String> {
    let mut result = None;
    let start_markers = ["```json", "```"];

    for marker in &start_markers {
        let mut search_from = 0;
        while let Some(start) = text[search_from..].find(marker) {
            let abs_start = search_from + start;
            let after_marker = abs_start + marker.len();
            if let Some(end) = text[after_marker..].find("```") {
                result = Some(text[after_marker..after_marker + end].trim().to_string());
                search_from = after_marker + end + 3;
            } else {
                break;
            }
        }
        if result.is_some() {
            return result;
        }
    }
    None
}

#[allow(dead_code, clippy::too_many_arguments)]
fn build_fix_prompt(
    project: &Project,
    spec: &Spec,
    task: &Task,
    session: &Session,
    codebase_snapshot: &str,
    build_command: &str,
    stderr: &str,
    stdout: &str,
    prior_notes: &str,
) -> String {
    let empty: Vec<BuildFixAttemptRecord> = vec![];
    build_fix_prompt_with_history(
        project, spec, task, session, codebase_snapshot,
        build_command, stderr, stdout, prior_notes, &empty,
    )
}

/// Classify build errors into categories so the fix prompt can include
/// targeted guidance instead of generic "try a different approach."
#[derive(Debug, Clone, PartialEq, Eq)]
enum ErrorCategory {
    RustStringLiteral,
    RustMissingModule,
    RustMissingMethod,
    RustTypeError,
    RustBorrowCheck,
    RustApiHallucination,
    NpmDependency,
    NpmTypeScript,
    GenericSyntax,
    Unknown,
}

fn classify_build_errors(stderr: &str) -> Vec<ErrorCategory> {
    let mut categories = Vec::new();

    let rust_string_patterns = [
        "unknown start of token",
        "prefix `",
        "unknown prefix",
        "Unicode character",
        "looks like",
        "but it is not",
    ];
    if rust_string_patterns.iter().any(|p| stderr.contains(p)) {
        categories.push(ErrorCategory::RustStringLiteral);
    }

    if stderr.contains("file not found for module") || stderr.contains("E0583") {
        categories.push(ErrorCategory::RustMissingModule);
    }

    if stderr.contains("no method named") || stderr.contains("E0599") {
        categories.push(ErrorCategory::RustMissingMethod);
    }

    if stderr.contains("the trait") && stderr.contains("is not implemented")
        || stderr.contains("E0277")
        || stderr.contains("type annotations needed")
        || stderr.contains("E0283")
    {
        categories.push(ErrorCategory::RustTypeError);
    }

    if stderr.contains("cannot borrow") || stderr.contains("E0502") || stderr.contains("E0505") {
        categories.push(ErrorCategory::RustBorrowCheck);
    }

    if stderr.contains("Cannot find module") || stderr.contains("ENOENT") {
        categories.push(ErrorCategory::NpmDependency);
    }

    if stderr.contains("TS2304") || stderr.contains("TS2345") || stderr.contains("TS2322") {
        categories.push(ErrorCategory::NpmTypeScript);
    }

    if categories.is_empty()
        && (stderr.contains("expected") || stderr.contains("syntax error") || stderr.contains("parse error"))
    {
        categories.push(ErrorCategory::GenericSyntax);
    }

    if categories.is_empty() {
        categories.push(ErrorCategory::Unknown);
    }
    categories
}

fn error_category_guidance(categories: &[ErrorCategory]) -> String {
    let mut guidance = String::new();
    for cat in categories {
        let advice: &str = match cat {
            ErrorCategory::RustStringLiteral => concat!(
                "DIAGNOSIS: Rust string literal / token errors detected.\n",
                "ROOT CAUSE: This almost always means JSON or text with special characters ",
                "was placed directly in Rust source code without proper string escaping.\n",
                "MANDATORY FIX:\n",
                "- For test fixtures or multi-line strings containing JSON, quotes, backslashes, ",
                "or special chars: use Rust RAW STRING LITERALS (r followed by # then quote to open, ",
                "quote then # to close; add more # symbols if the content itself contains that pattern).\n",
                "- For programmatic JSON construction: use serde_json::json!() macro instead of string literals.\n",
                "- NEVER put literal backslash-n (two characters) inside a Rust string to represent a newline; ",
                "use actual newlines inside raw strings, or proper escape sequences inside regular strings.\n",
                "- NEVER use non-ASCII characters (em dashes, smart quotes, etc.) in Rust string literals; ",
                "replace with ASCII equivalents.\n",
                "- Check ALL string literals in the file, not just the ones the compiler flagged -- ",
                "the same mistake is likely repeated.",
            ),
            ErrorCategory::RustMissingModule => concat!(
                "DIAGNOSIS: Missing Rust module file.\n",
                "FIX: If mod.rs or lib.rs declares `pub mod foo;`, the file `foo.rs` ",
                "(or `foo/mod.rs`) MUST exist. Either create the file or remove the module declaration.",
            ),
            ErrorCategory::RustMissingMethod => concat!(
                "DIAGNOSIS: Method not found on type.\n",
                "FIX: Check the actual public API of the type (read its source file). ",
                "Do not invent methods. If the method does not exist, either implement it ",
                "or use an existing method that provides the same functionality.",
            ),
            ErrorCategory::RustTypeError => concat!(
                "DIAGNOSIS: Type mismatch or missing trait implementation.\n",
                "FIX: Read the function signatures carefully. Check generic type parameters. ",
                "Provide explicit type annotations where the compiler asks for them. ",
                "Do not use `[u8]` where `Vec<u8>` or `&[u8]` is needed.",
            ),
            ErrorCategory::RustBorrowCheck => concat!(
                "DIAGNOSIS: Borrow checker violation.\n",
                "FIX: Check ownership and lifetimes. Consider cloning, using references, ",
                "or restructuring to avoid simultaneous mutable/immutable borrows.",
            ),
            ErrorCategory::RustApiHallucination => concat!(
                "DIAGNOSIS: Systematic API hallucination detected — your code assumes an API ",
                "that does not exist.\n",
                "ROOT CAUSE: You are calling multiple methods or using fields that are not part ",
                "of the actual type's public API.\n",
                "MANDATORY FIX:\n",
                "- The actual API is shown in the \"Actual API Reference\" section below.\n",
                "- Rewrite ALL calls to use ONLY the methods and fields listed there.\n",
                "- Do NOT invent, guess, or assume method names — use exactly what exists.\n",
                "- If the functionality you need does not exist in the current API, implement it ",
                "or find an alternative approach.",
            ),
            ErrorCategory::NpmDependency => concat!(
                "DIAGNOSIS: Missing npm package or module.\n",
                "FIX: Ensure the dependency exists in package.json and has been installed. ",
                "Check import paths for typos.",
            ),
            ErrorCategory::NpmTypeScript => concat!(
                "DIAGNOSIS: TypeScript type errors.\n",
                "FIX: Check that types align with the library's actual API. ",
                "Read type definitions if needed.",
            ),
            ErrorCategory::GenericSyntax => concat!(
                "DIAGNOSIS: Syntax error.\n",
                "FIX: Look at the exact line/column the compiler indicates. ",
                "Check for missing semicolons, unbalanced braces, or misplaced tokens.",
            ),
            ErrorCategory::Unknown => "",
        };
        if !advice.is_empty() {
            guidance.push_str(advice);
            guidance.push_str("\n\n");
        }
    }
    guidance
}

fn parse_error_references(stderr: &str) -> file_ops::ErrorReferences {
    use regex::Regex;

    let mut refs = file_ops::ErrorReferences::default();

    let type_re = Regex::new(r"found for (?:struct|enum|trait|union) `(\w+)").unwrap();
    for cap in type_re.captures_iter(stderr) {
        let name = cap[1].to_string();
        if !refs.types_referenced.contains(&name) {
            refs.types_referenced.push(name);
        }
    }

    let init_type_re = Regex::new(r"in initializer of `(?:\w+::)*(\w+)`").unwrap();
    for cap in init_type_re.captures_iter(stderr) {
        let name = cap[1].to_string();
        if !refs.types_referenced.contains(&name) {
            refs.types_referenced.push(name);
        }
    }

    let method_re =
        Regex::new(r"no method named `(\w+)` found for (?:\w+ )?`(?:&(?:mut )?)?(\w+)").unwrap();
    for cap in method_re.captures_iter(stderr) {
        let method = cap[1].to_string();
        let type_name = cap[2].to_string();
        refs.methods_not_found
            .push((type_name.clone(), method));
        if !refs.types_referenced.contains(&type_name) {
            refs.types_referenced.push(type_name);
        }
    }

    let field_re =
        Regex::new(r"missing field `(\w+)` in initializer of `(?:\w+::)*(\w+)`").unwrap();
    for cap in field_re.captures_iter(stderr) {
        let field = cap[1].to_string();
        let type_name = cap[2].to_string();
        refs.missing_fields.push((type_name.clone(), field));
        if !refs.types_referenced.contains(&type_name) {
            refs.types_referenced.push(type_name);
        }
    }

    let loc_re = Regex::new(r"-->\s*([\w\\/._-]+):(\d+):\d+").unwrap();
    for cap in loc_re.captures_iter(stderr) {
        let file = cap[1].to_string();
        let line: u32 = cap[2].parse().unwrap_or(0);
        if !refs.source_locations.iter().any(|(f, l)| f == &file && *l == line) {
            refs.source_locations.push((file, line));
        }
    }

    let arg_re = Regex::new(r"takes (\d+) arguments? but (\d+)").unwrap();
    for cap in arg_re.captures_iter(stderr) {
        refs.wrong_arg_counts
            .push(format!("expected {} got {}", &cap[1], &cap[2]));
    }

    refs
}

#[allow(clippy::too_many_arguments)]
fn build_fix_prompt_with_history(
    project: &Project,
    spec: &Spec,
    task: &Task,
    session: &Session,
    codebase_snapshot: &str,
    build_command: &str,
    stderr: &str,
    stdout: &str,
    prior_notes: &str,
    prior_attempts: &[BuildFixAttemptRecord],
) -> String {
    let mut prompt = String::new();

    prompt.push_str(&format!(
        "# Project: {}\n{}\n\n",
        project.name, project.description
    ));
    prompt.push_str(&format!(
        "# Spec: {}\n{}\n\n",
        spec.title, spec.markdown_contents
    ));
    prompt.push_str(&format!("# Task: {}\n{}\n\n", task.title, task.description));

    if !session.summary_of_previous_context.is_empty() {
        prompt.push_str(&format!(
            "# Previous Context Summary\n{}\n\n",
            session.summary_of_previous_context
        ));
    }

    if !prior_notes.is_empty() {
        prompt.push_str(&format!(
            "# Notes from Initial Implementation\n{}\n\n",
            prior_notes
        ));
    }

    if !prior_attempts.is_empty() {
        prompt.push_str("# Previous Fix Attempts (all failed)\nThe following fixes were already attempted and did NOT solve the problem. You MUST try a fundamentally different approach.\n\n");
        for (i, attempt) in prior_attempts.iter().enumerate() {
            prompt.push_str(&format!("## Attempt {}\n", i + 1));
            if !attempt.files_changed.is_empty() {
                prompt.push_str("Files changed:\n");
                for f in &attempt.files_changed {
                    prompt.push_str(&format!("- {f}\n"));
                }
            }
            prompt.push_str(&format!("Error:\n```\n{}\n```\n\n", attempt.stderr));
        }
    }

    let mut categories = classify_build_errors(stderr);
    let error_refs = parse_error_references(stderr);
    let resolved_context = file_ops::resolve_error_context(
        Path::new(&project.linked_folder_path),
        &error_refs,
    );

    {
        let mut type_counts: std::collections::HashMap<&str, usize> =
            std::collections::HashMap::new();
        for (t, _) in &error_refs.methods_not_found {
            *type_counts.entry(t.as_str()).or_insert(0) += 1;
        }
        if type_counts.values().any(|&c| c >= 5) || error_refs.wrong_arg_counts.len() >= 3 {
            categories.push(ErrorCategory::RustApiHallucination);
        }
    }

    let guidance = error_category_guidance(&categories);

    prompt.push_str(&format!(
        "# Build/Test Verification FAILED\n\
         The command `{}` failed after the previous file operations were applied.\n\
         You MUST fix ALL errors below.\n\n",
        build_command
    ));

    if !guidance.is_empty() {
        prompt.push_str(&format!(
            "## Error Analysis & Required Fix Strategy\n{}\n",
            guidance
        ));
    }

    prompt.push_str(&format!("## stderr\n```\n{}\n```\n\n", stderr));

    if !stdout.is_empty() {
        prompt.push_str(&format!("## stdout\n```\n{}\n```\n\n", stdout));
    }

    if error_refs.methods_not_found.len() > 5 {
        prompt.push_str(
            "WARNING: You are calling 5+ methods that do not exist. You MUST use ONLY \
             the methods listed in the \"Actual API Reference\" section below. Do NOT \
             invent or guess method names.\n\n",
        );
    }

    if !resolved_context.is_empty() {
        prompt.push_str(&resolved_context);
        prompt.push('\n');
    }

    if !codebase_snapshot.is_empty() {
        prompt.push_str(&format!(
            "# Current Codebase Files (after previous changes)\n{}\n",
            codebase_snapshot
        ));
    }

    prompt
}

/// Walk through the text looking for `{` and track brace depth to find a
/// complete top-level JSON object. Tries each `{` as a potential start so
/// it can skip over braces that appear inside prose.
fn extract_balanced_json(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    while i < len {
        if bytes[i] == b'{' {
            let mut depth: i32 = 0;
            let mut in_string = false;
            let mut escape_next = false;
            let start = i;
            let mut j = i;

            while j < len {
                let ch = bytes[j];
                if escape_next {
                    escape_next = false;
                    j += 1;
                    continue;
                }
                if ch == b'\\' && in_string {
                    escape_next = true;
                    j += 1;
                    continue;
                }
                if ch == b'"' {
                    in_string = !in_string;
                } else if !in_string {
                    if ch == b'{' {
                        depth += 1;
                    } else if ch == b'}' {
                        depth -= 1;
                        if depth == 0 {
                            let candidate = &text[start..=j];
                            if serde_json::from_str::<serde_json::Value>(candidate).is_ok() {
                                return Some(candidate.to_string());
                            }
                            break;
                        }
                    }
                }
                j += 1;
            }
        }
        i += 1;
    }
    None
}
