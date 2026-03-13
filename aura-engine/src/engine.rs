use std::path::Path;
use std::sync::Arc;

use tokio::sync::{mpsc, watch};

use aura_core::*;
use aura_services::{AgentService, ClaudeClient, ProjectService, SessionService, TaskService};
use aura_settings::SettingsService;
use aura_store::RocksStore;

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

    pub async fn wait(self) -> Result<LoopOutcome, EngineError> {
        self.join_handle
            .await
            .map_err(|e| EngineError::Join(e.to_string()))?
    }
}

pub(crate) const TASK_EXECUTION_SYSTEM_PROMPT: &str = r#"
You are an expert software engineer. You are given a task to implement as part
of a larger project. You have access to the project specification and the
current state of relevant files.

Respond with a JSON object:
{
  "notes": "Brief summary of what you did",
  "file_ops": [
    { "op": "create", "path": "relative/path.rs", "content": "full file content" },
    { "op": "modify", "path": "relative/path.rs", "content": "full new content" },
    { "op": "delete", "path": "relative/path.rs" }
  ],
  "follow_up_tasks": [
    { "title": "Task title", "description": "What needs to be done" }
  ]
}

Rules:
- Paths are relative to the project root
- For "modify", provide the complete new file content
- Only include follow_up_tasks if you discover missing prerequisites
- If you cannot complete the task, set notes to explain why and leave file_ops empty
"#;

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

    pub async fn start(self: Arc<Self>, project_id: ProjectId) -> Result<LoopHandle, EngineError> {
        let _project = self.project_service.get_project(&project_id)?;

        let agent = self
            .agent_service
            .create_agent(&project_id, "dev-agent".into())?;

        let session = self.session_service.create_session(
            &agent.agent_id,
            &project_id,
            None,
            String::new(),
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
        stop_rx: watch::Receiver<LoopCommand>,
    ) -> Result<LoopOutcome, EngineError> {
        let api_key = self.settings.get_decrypted_api_key()?;
        let mut completed_count: usize = 0;

        loop {
            if *stop_rx.borrow() == LoopCommand::Pause {
                let _ = self.agent_service.finish_working(&project_id, &agent_id);
                self.emit(EngineEvent::LoopPaused { completed_count });
                return Ok(LoopOutcome::Paused { completed_count });
            }
            if *stop_rx.borrow() == LoopCommand::Stop {
                let _ = self.agent_service.finish_working(&project_id, &agent_id);
                self.emit(EngineEvent::LoopStopped { completed_count });
                return Ok(LoopOutcome::Stopped { completed_count });
            }

            let task = match self.task_service.select_next_task(&project_id)? {
                Some(t) => t,
                None => {
                    let progress = self.task_service.get_project_progress(&project_id)?;
                    if progress.blocked_tasks > 0 || progress.failed_tasks > 0 {
                        self.emit(EngineEvent::LoopFinished {
                            outcome: "all_tasks_blocked".into(),
                        });
                        return Ok(LoopOutcome::AllTasksBlocked);
                    }
                    self.emit(EngineEvent::LoopFinished {
                        outcome: "all_tasks_complete".into(),
                    });
                    return Ok(LoopOutcome::AllTasksComplete);
                }
            };

            self.task_service
                .assign_task(&project_id, &task.spec_id, &task.task_id, &agent_id)?;
            self.agent_service.start_working(
                &project_id,
                &agent_id,
                &task.task_id,
                &session.session_id,
            )?;
            self.emit(EngineEvent::TaskStarted {
                task_id: task.task_id,
                task_title: task.title.clone(),
            });

            let result = self
                .execute_task(&project_id, &task, &session, &api_key)
                .await;

            match result {
                Ok(execution) => {
                    let project = self.project_service.get_project(&project_id)?;
                    let base_path = Path::new(&project.linked_folder_path);

                    if let Err(e) = file_ops::apply_file_ops(base_path, &execution.file_ops).await {
                        self.task_service.fail_task(
                            &project_id,
                            &task.spec_id,
                            &task.task_id,
                            &format!("file operation failed: {e}"),
                        )?;
                        self.emit(EngineEvent::TaskFailed {
                            task_id: task.task_id,
                            reason: e.to_string(),
                        });
                    } else {
                        self.task_service.complete_task(
                            &project_id,
                            &task.spec_id,
                            &task.task_id,
                            &execution.notes,
                        )?;
                        completed_count += 1;
                        self.emit(EngineEvent::TaskCompleted {
                            task_id: task.task_id,
                        });

                        let newly_ready = self
                            .task_service
                            .resolve_dependencies_after_completion(&project_id, &task.task_id)?;
                        for t in &newly_ready {
                            self.emit(EngineEvent::TaskBecameReady { task_id: t.task_id });
                        }

                        for follow_up in &execution.follow_up_tasks {
                            let new_task = self.task_service.create_follow_up_task(
                                &task,
                                follow_up.title.clone(),
                                follow_up.description.clone(),
                                vec![],
                            )?;
                            self.emit(EngineEvent::FollowUpTaskCreated {
                                task_id: new_task.task_id,
                            });
                        }
                    }

                    self.session_service.update_context_usage(
                        &project_id,
                        &agent_id,
                        &session.session_id,
                        execution.input_tokens,
                        execution.output_tokens,
                    )?;
                }
                Err(e) => {
                    self.task_service.fail_task(
                        &project_id,
                        &task.spec_id,
                        &task.task_id,
                        &format!("execution error: {e}"),
                    )?;
                    self.emit(EngineEvent::TaskFailed {
                        task_id: task.task_id,
                        reason: e.to_string(),
                    });
                }
            }

            self.agent_service.finish_working(&project_id, &agent_id)?;

            let current_session =
                self.session_service
                    .get_session(&project_id, &agent_id, &session.session_id)?;
            if self.session_service.should_rollover(&current_session) {
                let summary = self
                    .session_service
                    .generate_rollover_summary(
                        &self.claude_client,
                        &api_key,
                        &format!(
                            "Completed {} tasks so far. Session context is full.",
                            completed_count
                        ),
                    )
                    .await?;
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
            }
        }
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

        let response = self
            .claude_client
            .complete(api_key, TASK_EXECUTION_SYSTEM_PROMPT, &user_message, 8192)
            .await?;

        parse_execution_response(&response)
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

    if let Ok(parsed) = serde_json::from_str::<RawExecutionResponse>(trimmed) {
        return Ok(raw_to_execution(parsed));
    }

    if let Some(json_str) = extract_fenced_json(trimmed) {
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

fn extract_fenced_json(text: &str) -> Option<String> {
    let start_markers = ["```json", "```"];
    for marker in &start_markers {
        if let Some(start) = text.find(marker) {
            let after_marker = start + marker.len();
            if let Some(end) = text[after_marker..].find("```") {
                return Some(text[after_marker..after_marker + end].trim().to_string());
            }
        }
    }
    None
}
