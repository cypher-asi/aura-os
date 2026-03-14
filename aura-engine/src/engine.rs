use std::path::Path;
use std::sync::Arc;

use tokio::sync::{mpsc, watch, Mutex};
use tracing::{info, warn};

use aura_core::*;
use aura_services::{AgentService, ClaudeClient, ClaudeStreamEvent, ProjectService, SessionService, TaskService};
use aura_services::claude::DEFAULT_MODEL;
use aura_settings::SettingsService;
use aura_store::RocksStore;

use crate::build_verify;
use crate::error::EngineError;
use crate::events::EngineEvent;
use crate::file_ops::{self, FileOp};

#[derive(Debug, Clone)]
pub struct TaskExecution {
    pub notes: String,
    pub file_ops: Vec<FileOp>,
    pub follow_up_tasks: Vec<FollowUpSuggestion>,
    pub input_tokens: u64,
    pub output_tokens: u64,
}

#[derive(Debug, Clone)]
pub struct FollowUpSuggestion {
    pub title: String,
    pub description: String,
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

pub(crate) const TASK_EXECUTION_SYSTEM_PROMPT: &str = r#"
You are an expert software engineer executing a single implementation task.

CRITICAL: You MUST respond with ONLY a valid JSON object. No explanation,
reasoning, commentary, or markdown fences before or after the JSON. Your
entire response must be parseable as a single JSON value.

Rules:
- "notes": brief summary of what you did (or why you could not)
- "file_ops": array of file operations. Each has "op" ("create", "modify", or "delete"), "path" (relative to project root), and "content" (full file content; omit for delete)
- "follow_up_tasks": optional array of {"title", "description"} if you discover missing prerequisites; otherwise omit or use []
- For "modify", always provide the complete new file content, not a diff
- If you cannot complete the task, set notes to explain why and leave file_ops as []

Response schema:
{"notes":"...","file_ops":[{"op":"create","path":"src/foo.rs","content":"..."}],"follow_up_tasks":[]}
"#;

const RETRY_CORRECTION_PROMPT: &str =
    "Your previous response was not valid JSON. Respond with ONLY a valid JSON object matching the schema above. No prose, no markdown fences.";

const MAX_EXECUTION_RETRIES: u32 = 2;
const MAX_BUILD_FIX_RETRIES: u32 = 10;
const MAX_SHELL_TASK_RETRIES: u32 = 10;
const MAX_LOOP_TASK_RETRIES: u32 = 5;
const MAX_FOLLOW_UPS_PER_LOOP: usize = 20;
const TASK_EXECUTION_MAX_TOKENS: u32 = 32_768;

pub struct DevLoopEngine {
    store: Arc<RocksStore>,
    settings: Arc<SettingsService>,
    claude_client: Arc<ClaudeClient>,
    project_service: Arc<ProjectService>,
    task_service: Arc<TaskService>,
    agent_service: Arc<AgentService>,
    session_service: Arc<SessionService>,
    event_tx: mpsc::UnboundedSender<EngineEvent>,
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
        }
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
        self.emit(EngineEvent::TaskStarted {
            task_id: task.task_id,
            task_title: task.title.clone(),
            session_id: session.session_id,
        });

        let result = if let Some(cmd) = Self::extract_shell_command(&task) {
            let project = self.project_service.get_project(&project_id)?;
            self.execute_shell_task(&project, &task, &cmd).await
        } else {
            self.execute_task(&project_id, &task, &session, &api_key).await
        };

        let end_status = match result {
            Ok(execution) => {
                let project = self.project_service.get_project(&project_id)?;
                let base_path = Path::new(&project.linked_folder_path);

                let file_changes = file_ops::compute_file_changes(base_path, &execution.file_ops);

                self.update_task_tracking(
                    &project_id, &task, &user_id, &model,
                    execution.input_tokens, execution.output_tokens,
                );

                if let Err(e) = file_ops::apply_file_ops(base_path, &execution.file_ops).await {
                    let reason = format!("file operation failed: {e}");
                    let _ = self.task_service.fail_task(
                        &project_id, &task.spec_id, &task.task_id, &reason,
                    );
                    self.emit(EngineEvent::TaskFailed {
                        task_id: task.task_id,
                        reason: e.to_string(),
                    });
                    SessionStatus::Failed
                } else {
                    self.emit_file_ops_applied(&task, &execution.file_ops);

                    let session_ref = self.session_service.get_session(
                        &project_id, &agent.agent_id, &session.session_id,
                    ).unwrap_or_else(|_| session.clone());

                    let (_, build_passed) = self
                        .verify_and_fix_build(
                            &project, &task, &session_ref, &api_key, &execution,
                        )
                        .await?;

                    if build_passed {
                        let _ = self.task_service.complete_task(
                            &project_id, &task.spec_id, &task.task_id,
                            &execution.notes, file_changes,
                        );
                        self.emit(EngineEvent::TaskCompleted {
                            task_id: task.task_id,
                            execution_notes: execution.notes.clone(),
                        });

                        let newly_ready = self
                            .task_service
                            .resolve_dependencies_after_completion(&project_id, &task.task_id)
                            .unwrap_or_default();
                        for t in &newly_ready {
                            self.emit(EngineEvent::TaskBecameReady { task_id: t.task_id });
                        }

                        for follow_up in &execution.follow_up_tasks {
                            if let Ok(new_task) = self.task_service.create_follow_up_task(
                                &task,
                                follow_up.title.clone(),
                                follow_up.description.clone(),
                                vec![],
                            ) {
                                self.emit(EngineEvent::FollowUpTaskCreated {
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
                            task_id: task.task_id,
                            reason,
                        });
                    }
                    SessionStatus::Completed
                }
            }
            Err(e) => {
                let reason = format!("execution error: {e}");
                let _ = self.task_service.fail_task(
                    &project_id, &task.spec_id, &task.task_id, &reason,
                );
                self.emit(EngineEvent::TaskFailed {
                    task_id: task.task_id,
                    reason: e.to_string(),
                });
                SessionStatus::Failed
            }
        };

        let _ = self.session_service.end_session(
            &project_id, &agent.agent_id, &session.session_id, end_status,
        );
        let _ = self.agent_service.finish_working(&project_id, &agent.agent_id);
        Ok(())
    }

    pub async fn start(self: Arc<Self>, project_id: ProjectId) -> Result<LoopHandle, EngineError> {
        let _project = self.project_service.get_project(&project_id)?;

        let stale = self.session_service.close_stale_sessions(&project_id)?;
        if !stale.is_empty() {
            info!("closed {} stale active session(s) from previous run", stale.len());
        }

        let agent = self
            .agent_service
            .create_agent(&project_id, "dev-agent".into())?;

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
        let join_handle = tokio::spawn(async move {
            engine
                .run_loop(project_id, agent.agent_id, session, stop_rx)
                .await
        });

        Ok(LoopHandle {
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
        let mut completed_count: usize = 0;
        let mut follow_up_count: usize = 0;
        let mut task_retry_counts: std::collections::HashMap<TaskId, u32> = std::collections::HashMap::new();
        let mut work_log: Vec<String> = Vec::new();

        let orphaned = self.task_service.reset_in_progress_tasks(&project_id)?;
        for t in &orphaned {
            self.emit(EngineEvent::TaskBecameReady { task_id: t.task_id });
        }

        let promoted = self.task_service.resolve_initial_readiness(&project_id)?;
        for t in &promoted {
            self.emit(EngineEvent::TaskBecameReady { task_id: t.task_id });
        }

        loop {
            if *stop_rx.borrow() == LoopCommand::Pause {
                let _ = self.session_service.end_session(
                    &project_id, &agent_id, &session.session_id, SessionStatus::Completed,
                );
                let _ = self.agent_service.finish_working(&project_id, &agent_id);
                self.emit(EngineEvent::LoopPaused { completed_count });
                return Ok(LoopOutcome::Paused { completed_count });
            }
            if *stop_rx.borrow() == LoopCommand::Stop {
                let _ = self.session_service.end_session(
                    &project_id, &agent_id, &session.session_id, SessionStatus::Completed,
                );
                let _ = self.agent_service.finish_working(&project_id, &agent_id);
                self.emit(EngineEvent::LoopStopped { completed_count });
                return Ok(LoopOutcome::Stopped { completed_count });
            }

            let task = match self.task_service.select_next_task(&project_id)? {
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
                            info!(task_id = %t.task_id, title = %t.title, attempt = *count, "resetting failed task for retry");
                            let _ = self.task_service.retry_task(
                                &project_id, &t.spec_id, &t.task_id,
                            );
                            self.emit(EngineEvent::TaskBecameReady { task_id: t.task_id });
                        }
                        continue;
                    }

                    let progress = self.task_service.get_project_progress(&project_id)?;
                    if progress.blocked_tasks > 0 || progress.failed_tasks > 0 {
                        let _ = self.session_service.end_session(
                            &project_id, &agent_id, &session.session_id, SessionStatus::Completed,
                        );
                        self.emit(EngineEvent::LoopFinished {
                            outcome: "all_tasks_blocked".into(),
                        });
                        return Ok(LoopOutcome::AllTasksBlocked);
                    }
                    let _ = self.session_service.end_session(
                        &project_id, &agent_id, &session.session_id, SessionStatus::Completed,
                    );
                    self.emit(EngineEvent::LoopFinished {
                        outcome: "all_tasks_complete".into(),
                    });
                    return Ok(LoopOutcome::AllTasksComplete);
                }
            };

            self.task_service
                .assign_task(&project_id, &task.spec_id, &task.task_id, &agent_id, Some(session.session_id))?;
            self.session_service
                .record_task_worked(&project_id, &agent_id, &session.session_id, task.task_id)?;
            self.agent_service.start_working(
                &project_id,
                &agent_id,
                &task.task_id,
                &session.session_id,
            )?;
            self.emit(EngineEvent::TaskStarted {
                task_id: task.task_id,
                task_title: task.title.clone(),
                session_id: session.session_id,
            });

            let result = if let Some(cmd) = Self::extract_shell_command(&task) {
                let project = self.project_service.get_project(&project_id)?;
                Some(self.execute_shell_task(&project, &task, &cmd).await)
            } else {
                tokio::select! {
                    res = self.execute_task(&project_id, &task, &session, &api_key) => {
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
                self.emit(EngineEvent::TaskBecameReady { task_id: task.task_id });
                let _ = self.agent_service.finish_working(&project_id, &agent_id);

                let cmd = *stop_rx.borrow();
                if cmd == LoopCommand::Stop {
                    let _ = self.session_service.end_session(
                        &project_id, &agent_id, &session.session_id, SessionStatus::Completed,
                    );
                    self.emit(EngineEvent::LoopStopped { completed_count });
                    return Ok(LoopOutcome::Stopped { completed_count });
                } else {
                    let _ = self.session_service.end_session(
                        &project_id, &agent_id, &session.session_id, SessionStatus::Completed,
                    );
                    self.emit(EngineEvent::LoopPaused { completed_count });
                    return Ok(LoopOutcome::Paused { completed_count });
                }
            }
            let result = result.unwrap();

            let failure_reason = match result {
                Ok(execution) => {
                    let project = self.project_service.get_project(&project_id)?;
                    let base_path = Path::new(&project.linked_folder_path);

                    let file_changes = file_ops::compute_file_changes(base_path, &execution.file_ops);

                    self.update_task_tracking(
                        &project_id, &task, &session.user_id, &session.model,
                        execution.input_tokens, execution.output_tokens,
                    );

                    if let Err(e) = file_ops::apply_file_ops(base_path, &execution.file_ops).await {
                        let reason = format!("file operation failed: {e}");
                        self.task_service.fail_task(
                            &project_id,
                            &task.spec_id,
                            &task.task_id,
                            &reason,
                        )?;
                        self.emit(EngineEvent::TaskFailed {
                            task_id: task.task_id,
                            reason: e.to_string(),
                        });
                        work_log.push(format!("Task (failed): {}\nReason: {}", task.title, reason));
                        Some(reason)
                    } else {
                        self.emit_file_ops_applied(&task, &execution.file_ops);

                        let (_, build_passed) = self
                            .verify_and_fix_build(
                                &project, &task, &session, &api_key, &execution,
                            )
                            .await?;

                        if !build_passed {
                            let reason = "build verification failed after all fix attempts".to_string();
                            self.task_service.fail_task(
                                &project_id,
                                &task.spec_id,
                                &task.task_id,
                                &reason,
                            )?;
                            self.emit(EngineEvent::TaskFailed {
                                task_id: task.task_id,
                                reason: reason.clone(),
                            });
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
                                task_id: task.task_id,
                                execution_notes: execution.notes.clone(),
                            });

                            let newly_ready = self
                                .task_service
                                .resolve_dependencies_after_completion(&project_id, &task.task_id)?;
                            for t in &newly_ready {
                                self.emit(EngineEvent::TaskBecameReady { task_id: t.task_id });
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
                                            task_id: new_task.task_id,
                                        });
                                    }
                                    Err(aura_services::TaskError::DuplicateFollowUp) => {
                                        info!(title = %follow_up.title, "skipping duplicate follow-up task");
                                    }
                                    Err(e) => return Err(EngineError::Parse(format!("follow-up creation failed: {e}"))),
                                }
                            }

                            self.session_service.update_context_usage(
                                &project_id,
                                &agent_id,
                                &session.session_id,
                                execution.input_tokens,
                                execution.output_tokens,
                            )?;

                            let changed_files: Vec<&str> = execution
                                .file_ops
                                .iter()
                                .map(|op| match op {
                                    FileOp::Create { path, .. }
                                    | FileOp::Modify { path, .. }
                                    | FileOp::Delete { path } => path.as_str(),
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
                    self.task_service.fail_task(
                        &project_id,
                        &task.spec_id,
                        &task.task_id,
                        &reason,
                    )?;
                    self.emit(EngineEvent::TaskFailed {
                        task_id: task.task_id,
                        reason: e.to_string(),
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
                            self.emit(EngineEvent::LoopStopped { completed_count });
                            return Ok(LoopOutcome::Stopped { completed_count });
                        } else {
                            let _ = self.session_service.end_session(
                                &project_id, &agent_id, &session.session_id, SessionStatus::Completed,
                            );
                            self.emit(EngineEvent::LoopPaused { completed_count });
                            return Ok(LoopOutcome::Paused { completed_count });
                        }
                    }
                };
                let new_session = self.session_service.rollover_session(
                    &project_id,
                    &agent_id,
                    &session.session_id,
                    summary,
                    None,
                )?;
                self.emit(EngineEvent::SessionRolledOver {
                    old_session_id: session.session_id,
                    new_session_id: new_session.session_id,
                });
                session = new_session;
                work_log.clear();
            }
        }
    }

    fn extract_shell_command(task: &Task) -> Option<String> {
        let title = task.title.trim();
        let desc = task.description.trim();

        let prefixes = ["run ", "execute ", "run: "];
        let shell_indicators = ["npm ", "npx ", "cargo ", "yarn ", "pnpm ", "pip ", "python ",
            "node ", "sh ", "bash ", "powershell ", "cmd ", "make ", "gradle ", "mvn ",
            "dotnet ", "go ", "rustup ", "apt ", "brew "];

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

        if candidate.is_empty() { None } else { Some(candidate) }
    }

    async fn execute_shell_task(
        &self,
        project: &Project,
        task: &Task,
        command: &str,
    ) -> Result<TaskExecution, EngineError> {
        let base_path = Path::new(&project.linked_folder_path);
        let max_attempts: u32 = MAX_SHELL_TASK_RETRIES;
        let mut prior_errors: Vec<String> = Vec::new();

        for attempt in 1..=max_attempts {
            self.emit(EngineEvent::BuildVerificationStarted {
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
                task_id: task.task_id,
                delta: format!("Running: {command} (attempt {attempt}/{max_attempts})\n"),
            });

            let result = build_verify::run_build_command(base_path, command).await?;

            if result.success {
                self.emit(EngineEvent::BuildVerificationPassed {
                    task_id: task.task_id,
                    command: command.to_string(),
                    stdout: result.stdout.clone(),
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
                        };
                        let mut test_fix_ops = Vec::new();
                        let test_passed = self.run_and_handle_tests(
                            project, task, &dummy_session,
                            &self.settings.get_decrypted_api_key().unwrap_or_default(),
                            &dummy_exec, test_cmd, base_path, attempt, &mut test_fix_ops,
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
                    task_id: task.task_id,
                    delta: notes.clone(),
                });

                return Ok(TaskExecution {
                    notes,
                    file_ops: vec![],
                    follow_up_tasks: vec![],
                    input_tokens: 0,
                    output_tokens: 0,
                });
            }

            self.emit(EngineEvent::BuildVerificationFailed {
                task_id: task.task_id,
                command: command.to_string(),
                stdout: result.stdout.clone(),
                stderr: result.stderr.clone(),
                attempt,
            });
            self.persist_build_step(task, BuildStepRecord {
                kind: "failed".into(),
                command: Some(command.to_string()),
                stderr: Some(result.stderr.clone()),
                stdout: Some(result.stdout.clone()),
                attempt: Some(attempt),
            });

            let detail = if !result.stderr.is_empty() { &result.stderr } else { &result.stdout };
            prior_errors.push(detail.clone());
            let _ = self.event_tx.send(EngineEvent::TaskOutputDelta {
                task_id: task.task_id,
                delta: format!("Command failed (attempt {attempt}):\n{detail}\n"),
            });

            if attempt < max_attempts {
                self.emit(EngineEvent::BuildFixAttempt {
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
                    &prior_errors[..prior_errors.len().saturating_sub(1)],
                );

                let api_key = self.settings.get_decrypted_api_key()?;
                let (stream_tx, mut stream_rx) = mpsc::unbounded_channel::<ClaudeStreamEvent>();
                let event_tx = self.event_tx.clone();
                let tid = task.task_id;
                let forwarder = tokio::spawn(async move {
                    while let Some(evt) = stream_rx.recv().await {
                        if let ClaudeStreamEvent::Delta(text) = evt {
                            let _ = event_tx.send(EngineEvent::TaskOutputDelta {
                                task_id: tid,
                                delta: text,
                            });
                        }
                    }
                });

                let response = self.claude_client.complete_stream(
                    &api_key,
                    TASK_EXECUTION_SYSTEM_PROMPT,
                    &fix_prompt,
                    TASK_EXECUTION_MAX_TOKENS,
                    stream_tx,
                ).await?;
                let _ = forwarder.await;

                if let Ok(fix_execution) = parse_execution_response(&response) {
                    if !fix_execution.file_ops.is_empty() {
                        let _ = file_ops::apply_file_ops(base_path, &fix_execution.file_ops).await;
                        self.emit_file_ops_applied(task, &fix_execution.file_ops);
                    }
                }
            }
        }

        let detail = format!("command `{command}` failed after {max_attempts} attempts");
        Err(EngineError::Build(detail))
    }

    async fn execute_task(
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

        let response = {
            let (stream_tx, mut stream_rx) = mpsc::unbounded_channel::<ClaudeStreamEvent>();
            let event_tx = self.event_tx.clone();
            let tid = task_id;
            let tc = token_counts.clone();
            let forwarder = tokio::spawn(async move {
                while let Some(evt) = stream_rx.recv().await {
                    match evt {
                        ClaudeStreamEvent::Delta(text) => {
                            let _ = event_tx.send(EngineEvent::TaskOutputDelta { task_id: tid, delta: text });
                        }
                        ClaudeStreamEvent::Done { input_tokens, output_tokens, .. } => {
                            *tc.lock().await = (input_tokens, output_tokens);
                        }
                        _ => {}
                    }
                }
            });

            let resp = self
                .claude_client
                .complete_stream(
                    api_key,
                    TASK_EXECUTION_SYSTEM_PROMPT,
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
                return Ok(execution);
            }
            Err(first_err) => {
                warn!(task_id = %task_id, error = %first_err, "first execution parse failed, retrying");

                // Retry loop: send the failed response back and ask for valid JSON
                let mut last_response = response;
                for attempt in 1..=MAX_EXECUTION_RETRIES {
                    self.emit(EngineEvent::TaskRetrying {
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
                    let event_tx = self.event_tx.clone();
                    let tid = task_id;
                    let tc = token_counts.clone();
                    let forwarder = tokio::spawn(async move {
                        while let Some(evt) = stream_rx.recv().await {
                            match evt {
                                ClaudeStreamEvent::Delta(text) => {
                                    let _ = event_tx.send(EngineEvent::TaskOutputDelta { task_id: tid, delta: text });
                                }
                                ClaudeStreamEvent::Done { input_tokens, output_tokens, .. } => {
                                    *tc.lock().await = (input_tokens, output_tokens);
                                }
                                _ => {}
                            }
                        }
                    });

                    let retry_resp = self
                        .claude_client
                        .complete_stream_multi(
                            api_key,
                            TASK_EXECUTION_SYSTEM_PROMPT,
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

    async fn verify_and_fix_build(
        &self,
        project: &Project,
        task: &Task,
        session: &Session,
        api_key: &str,
        initial_execution: &TaskExecution,
    ) -> Result<(Vec<FileOp>, bool), EngineError> {
        let build_command = match &project.build_command {
            Some(cmd) if !cmd.trim().is_empty() => cmd.clone(),
            _ => return Ok((vec![], true)),
        };

        let test_command = project.test_command.as_ref()
            .filter(|cmd| !cmd.trim().is_empty())
            .cloned();

        let base_path = Path::new(&project.linked_folder_path);
        let mut all_fix_ops: Vec<FileOp> = Vec::new();
        let mut prior_errors: Vec<String> = Vec::new();

        for attempt in 1..=MAX_BUILD_FIX_RETRIES {
            self.emit(EngineEvent::BuildVerificationStarted {
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

            if build_result.success {
                self.emit(EngineEvent::BuildVerificationPassed {
                    task_id: task.task_id,
                    command: build_command.clone(),
                    stdout: build_result.stdout.clone(),
                });
                self.persist_build_step(task, BuildStepRecord {
                    kind: "passed".into(),
                    command: Some(build_command.clone()),
                    stderr: None,
                    stdout: Some(build_result.stdout),
                    attempt: Some(attempt),
                });

                // Run test command if configured
                let test_passed = if let Some(ref test_cmd) = test_command {
                    let test_result = self.run_and_handle_tests(
                        project, task, session, api_key, initial_execution,
                        test_cmd, base_path, attempt, &mut all_fix_ops,
                    ).await?;
                    test_result
                } else {
                    true
                };

                if test_passed {
                    return Ok((all_fix_ops, true));
                }
                // If tests failed, continue the loop to rebuild + retest
                continue;
            }

            self.emit(EngineEvent::BuildVerificationFailed {
                task_id: task.task_id,
                command: build_command.clone(),
                stdout: build_result.stdout.clone(),
                stderr: build_result.stderr.clone(),
                attempt,
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
                return Ok((all_fix_ops, false));
            }

            self.emit(EngineEvent::BuildFixAttempt {
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

            prior_errors.push(build_result.stderr.clone());

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
                &prior_errors[..prior_errors.len().saturating_sub(1)],
            );

            let (stream_tx, mut stream_rx) = mpsc::unbounded_channel::<ClaudeStreamEvent>();
            let event_tx = self.event_tx.clone();
            let tid = task.task_id;
            let forwarder = tokio::spawn(async move {
                while let Some(evt) = stream_rx.recv().await {
                    if let ClaudeStreamEvent::Delta(text) = evt {
                        let _ = event_tx.send(EngineEvent::TaskOutputDelta {
                            task_id: tid,
                            delta: text,
                        });
                    }
                }
            });

            let response = self
                .claude_client
                .complete_stream(
                    api_key,
                    TASK_EXECUTION_SYSTEM_PROMPT,
                    &fix_prompt,
                    TASK_EXECUTION_MAX_TOKENS,
                    stream_tx,
                )
                .await?;
            let _ = forwarder.await;

            match parse_execution_response(&response) {
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
                            };
                            crate::events::FileOpSummary {
                                op: op_name.to_string(),
                                path: path.to_string(),
                            }
                        })
                        .collect();

                    if !fix_execution.file_ops.is_empty() {
                        self.emit(EngineEvent::FileOpsApplied {
                            task_id: task.task_id,
                            files_written: fix_execution
                                .file_ops
                                .iter()
                                .filter(|op| matches!(op, FileOp::Create { .. } | FileOp::Modify { .. }))
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
                }
                Err(e) => {
                    warn!(
                        task_id = %task.task_id,
                        attempt,
                        error = %e,
                        "failed to parse build-fix response"
                    );
                }
            }
        }

        Ok((all_fix_ops, false))
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
    ) -> Result<bool, EngineError> {
        self.emit(EngineEvent::TestVerificationStarted {
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

        let test_result = build_verify::run_build_command(base_path, test_command).await?;
        let (tests, summary) = build_verify::parse_test_output(
            &test_result.stdout, &test_result.stderr, test_result.success,
        );

        if test_result.success {
            self.emit(EngineEvent::TestVerificationPassed {
                task_id: task.task_id,
                command: test_command.to_string(),
                stdout: test_result.stdout.clone(),
                tests: tests.clone(),
                summary: summary.clone(),
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
            return Ok(true);
        }

        self.emit(EngineEvent::TestVerificationFailed {
            task_id: task.task_id,
            command: test_command.to_string(),
            stdout: test_result.stdout.clone(),
            stderr: test_result.stderr.clone(),
            attempt,
            tests: tests.clone(),
            summary: summary.clone(),
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

        let (stream_tx, mut stream_rx) = mpsc::unbounded_channel::<ClaudeStreamEvent>();
        let event_tx = self.event_tx.clone();
        let tid = task.task_id;
        let forwarder = tokio::spawn(async move {
            while let Some(evt) = stream_rx.recv().await {
                if let ClaudeStreamEvent::Delta(text) = evt {
                    let _ = event_tx.send(EngineEvent::TaskOutputDelta {
                        task_id: tid,
                        delta: text,
                    });
                }
            }
        });

        let response = self
            .claude_client
            .complete_stream(
                api_key,
                TASK_EXECUTION_SYSTEM_PROMPT,
                &fix_prompt,
                TASK_EXECUTION_MAX_TOKENS,
                stream_tx,
            )
            .await?;
        let _ = forwarder.await;

        match parse_execution_response(&response) {
            Ok(fix_execution) => {
                file_ops::apply_file_ops(base_path, &fix_execution.file_ops).await?;
                if !fix_execution.file_ops.is_empty() {
                    self.emit_file_ops_applied(task, &fix_execution.file_ops);
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

        Ok(false)
    }

    fn emit_file_ops_applied(&self, task: &Task, ops: &[FileOp]) {
        let files_written = ops.iter().filter(|op| matches!(op, FileOp::Create { .. } | FileOp::Modify { .. })).count();
        let files_deleted = ops.iter().filter(|op| matches!(op, FileOp::Delete { .. })).count();
        let files: Vec<crate::events::FileOpSummary> = ops.iter().map(|op| {
            let (op_name, path) = match op {
                FileOp::Create { path, .. } => ("create", path.as_str()),
                FileOp::Modify { path, .. } => ("modify", path.as_str()),
                FileOp::Delete { path } => ("delete", path.as_str()),
            };
            crate::events::FileOpSummary { op: op_name.to_string(), path: path.to_string() }
        }).collect();
        self.emit(EngineEvent::FileOpsApplied {
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

#[allow(dead_code)]
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
    build_fix_prompt_with_history(
        project, spec, task, session, codebase_snapshot,
        build_command, stderr, stdout, prior_notes, &[],
    )
}

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
    prior_attempts: &[String],
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
        prompt.push_str("# Previous Fix Attempts (all failed)\nThe following fixes were already attempted and did NOT solve the problem. Do NOT repeat the same approach.\n\n");
        for (i, attempt_err) in prior_attempts.iter().enumerate() {
            prompt.push_str(&format!("## Attempt {}\n```\n{}\n```\n\n", i + 1, attempt_err));
        }
    }

    prompt.push_str(&format!(
        "# Build/Test Verification FAILED\n\
         The command `{}` failed after the previous file operations were applied.\n\
         You MUST fix ALL errors below.\n\n\
         ## stderr\n```\n{}\n```\n\n",
        build_command, stderr
    ));

    if !stdout.is_empty() {
        prompt.push_str(&format!("## stdout\n```\n{}\n```\n\n", stdout));
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
