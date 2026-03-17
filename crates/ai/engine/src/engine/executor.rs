use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use tokio::sync::{mpsc, Mutex};
use tracing::warn;

use aura_core::*;
use aura_claude::{
    ClaudeStreamEvent, ContentBlock, RichMessage, ThinkingConfig, DEFAULT_MODEL,
};
use aura_chat::ChatToolExecutor;
use aura_tools::engine_tool_definitions;

use super::build_fix::{normalize_error_signature, BuildFixAttemptRecord};
use super::orchestrator::DevLoopEngine;
use super::parser::parse_execution_response;
use super::prompts::*;
use super::shell;
use super::types::*;
use crate::build_verify;
use crate::error::EngineError;
use crate::events::{EngineEvent, PhaseTimingEntry};
use crate::file_ops::{self, FileOp};
use crate::metrics;

impl DevLoopEngine {
    /// Execute a single task by ID without starting the full loop.
    /// Spawns execution as a background tokio task; progress is emitted
    /// through the normal engine event channel.
    pub async fn run_single_task(
        self: Arc<Self>,
        project_id: ProjectId,
        task_id: TaskId,
        agent_instance_id: Option<AgentInstanceId>,
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

        let agent = if let Some(aiid) = agent_instance_id {
            self.agent_instance_service
                .get_instance(&project_id, &aiid)
                .map_err(|_| EngineError::Parse(format!("agent instance {aiid} not found")))?
        } else {
            self.agent_instance_service
                .create_instance(&project_id, "dev-agent".into())?
        };
        let session = self.session_service.create_session(
            &agent.agent_instance_id,
            &project_id,
            None,
            String::new(),
            user_id.clone(),
            model.clone(),
        )?;

        self.task_service
            .assign_task(&project_id, &task.spec_id, &task.task_id, &agent.agent_instance_id, Some(session.session_id))?;
        self.session_service
            .record_task_worked(&project_id, &agent.agent_instance_id, &session.session_id, task.task_id)?;
        self.agent_instance_service.start_working(
            &project_id,
            &agent.agent_instance_id,
            &task.task_id,
            &session.session_id,
        )?;
        let aiid = agent.agent_instance_id;
        self.emit(EngineEvent::TaskStarted {
            project_id,
            agent_instance_id: aiid,
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
        let fee_schedule = aura_billing::PricingService::new(self.store.clone())
            .get_fee_schedule();

        let baseline_test_failures = {
            let project = self.project_service.get_project(&project_id)?;
            self.capture_test_baseline(&project).await
        };

        let result = if let Some(cmd) = shell::extract_shell_command(&task) {
            let project = self.project_service.get_project(&project_id)?;
            self.execute_shell_task(&project, &task, &cmd, aiid).await
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
                        agent_instance_id: aiid,
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
                        &project_id, &agent.agent_instance_id, &session.session_id,
                        execution.input_tokens, execution.output_tokens,
                    );
                    SessionStatus::Failed
                } else {
                    let file_ops_duration_ms = file_ops_start.elapsed().as_millis() as u64;
                    self.emit_file_ops_applied(project_id, aiid, &task, &execution.file_ops);

                    let session_ref = self.session_service.get_session(
                        &project_id, &agent.agent_instance_id, &session.session_id,
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
                            agent_instance_id: aiid,
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
                            self.emit(EngineEvent::TaskBecameReady { project_id, agent_instance_id: aiid, task_id: t.task_id });
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
                                    agent_instance_id: aiid,
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
                            agent_instance_id: aiid,
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
                        &project_id, &agent.agent_instance_id, &session.session_id,
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
                    agent_instance_id: aiid,
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
            &project_id, &agent.agent_instance_id, &session.session_id, end_status,
        );
        let _ = self.agent_instance_service.finish_working(&project_id, &agent.agent_instance_id);
        Ok(())
    }

    pub(crate) async fn execute_shell_task(
        &self,
        project: &Project,
        task: &Task,
        command: &str,
        agent_instance_id: AgentInstanceId,
    ) -> Result<TaskExecution, EngineError> {
        let base_path = Path::new(&project.linked_folder_path);
        let max_attempts: u32 = MAX_SHELL_TASK_RETRIES;
        let mut prior_attempts_shell: Vec<BuildFixAttemptRecord> = Vec::new();

        for attempt in 1..=max_attempts {
            let shell_step_start = Instant::now();
            self.emit(EngineEvent::BuildVerificationStarted {
                project_id: project.project_id,
                agent_instance_id,
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
                agent_instance_id,
                task_id: task.task_id,
                delta: format!("Running: {command} (attempt {attempt}/{max_attempts})\n"),
            });

            let (line_tx, mut line_rx) = tokio::sync::mpsc::unbounded_channel();
            let fwd_event_tx = self.event_tx.clone();
            let fwd_pid = project.project_id;
            let fwd_aiid = agent_instance_id;
            let fwd_tid = task.task_id;
            tokio::spawn(async move {
                while let Some(line) = line_rx.recv().await {
                    let _ = fwd_event_tx.send(EngineEvent::TaskOutputDelta {
                        project_id: fwd_pid,
                        agent_instance_id: fwd_aiid,
                        task_id: fwd_tid,
                        delta: line,
                    });
                }
            });

            let result = build_verify::run_build_command(base_path, command, Some(line_tx)).await?;
            let shell_step_duration_ms = shell_step_start.elapsed().as_millis() as u64;

            if result.success {
                self.emit(EngineEvent::BuildVerificationPassed {
                    project_id: project.project_id,
                    agent_instance_id,
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

                if let Some(ref test_cmd) = project.test_command {
                    if !test_cmd.trim().is_empty() {
                        let dummy_session = Session {
                            session_id: SessionId::new(),
                            agent_instance_id: AgentInstanceId::new(),
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
                    agent_instance_id,
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
                agent_instance_id,
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
                agent_instance_id,
                task_id: task.task_id,
                delta: format!("Command failed (attempt {attempt}):\n{detail}\n"),
            });

            let current_sig = normalize_error_signature(detail);
            let consecutive_dupes = prior_attempts_shell
                .iter()
                .rev()
                .take_while(|a| a.error_signature == current_sig)
                .count();
            if consecutive_dupes >= 2 {
                tracing::info!(
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
                    agent_instance_id,
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
                        agent_instance_id: AgentInstanceId::new(),
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
                        self.emit_file_ops_applied(project.project_id, agent_instance_id, task, &fix_execution.file_ops);
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

    pub(crate) async fn execute_task_agentic(
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
        let aiid = session.agent_instance_id;
        const MAX_AGENTIC_ITERATIONS: usize = 50;

        for iteration in 0..MAX_AGENTIC_ITERATIONS {
            let (claude_tx, mut claude_rx) = mpsc::unbounded_channel::<ClaudeStreamEvent>();
            let event_tx = self.event_tx.clone();
            let tid = task_id;
            let fwd_pid = pid;
            let fwd_aiid = aiid;
            let forwarder = tokio::spawn(async move {
                while let Some(evt) = claude_rx.recv().await {
                    if let ClaudeStreamEvent::Delta(text) = evt {
                        let _ = event_tx.send(EngineEvent::TaskOutputDelta {
                            project_id: fwd_pid,
                            agent_instance_id: fwd_aiid,
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

            let executor_futures: Vec<_> = executor_indices.iter().map(|&i| {
                let tc = &stream_result.tool_calls[i];
                executor.execute(project_id, &tc.name, tc.input.clone())
            }).collect();
            let executor_results = futures::future::join_all(executor_futures).await;

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
                            let arg_hint = match tc.name.as_str() {
                                "read_file" | "write_file" | "edit_file" | "delete_file" =>
                                    tc.input.get("path").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                                "list_files" =>
                                    tc.input.get("directory").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                                "search_code" =>
                                    tc.input.get("pattern").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                                "run_command" =>
                                    tc.input.get("command").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                                _ => String::new(),
                            };
                            let status_str = if result.is_error { "error" } else { "ok" };
                            let marker = if arg_hint.is_empty() {
                                format!("\n[tool: {} -> {}]\n", tc.name, status_str)
                            } else {
                                format!("\n[tool: {}({}) -> {}]\n", tc.name, arg_hint, status_str)
                            };
                            let _ = self.event_tx.send(EngineEvent::TaskOutputDelta {
                                project_id: pid,
                                agent_instance_id: aiid,
                                task_id,
                                delta: marker,
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
    pub(crate) async fn execute_task_single_shot(
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
        let aiid = session.agent_instance_id;

        let response = {
            let (stream_tx, mut stream_rx) = mpsc::unbounded_channel::<ClaudeStreamEvent>();
            let event_tx = self.event_tx.clone();
            let tid = task_id;
            let fwd_pid = pid;
            let fwd_aiid = aiid;
            let tc = token_counts.clone();
            let forwarder = tokio::spawn(async move {
                while let Some(evt) = stream_rx.recv().await {
                    match evt {
                        ClaudeStreamEvent::Delta(text) => {
                            let _ = event_tx.send(EngineEvent::TaskOutputDelta { project_id: fwd_pid, agent_instance_id: fwd_aiid, task_id: tid, delta: text });
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

                let validation_report = file_ops::validate_all_file_ops(&execution.file_ops);
                if !validation_report.is_empty() {
                    warn!(task_id = %task_id, "pre-write validation found issues, requesting correction");
                    self.emit(EngineEvent::TaskRetrying {
                        project_id: pid,
                        agent_instance_id: aiid,
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
                        agent_instance_id: aiid,
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
}
