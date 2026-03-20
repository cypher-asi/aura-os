use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use tracing::warn;

use aura_core::*;

use super::orchestrator::DevLoopEngine;
use super::shell;
use super::types::*;
use crate::error::EngineError;
use crate::events::EngineEvent;
use crate::file_ops::{self, WorkspaceCache};
use crate::metrics;

impl DevLoopEngine {
    pub async fn run_single_task(
        self: Arc<Self>,
        project_id: ProjectId,
        task_id: TaskId,
        agent_instance_id: Option<AgentInstanceId>,
    ) -> Result<(), EngineError> {
        let api_key = self.settings.get_decrypted_api_key()?;

        let all_tasks = self.task_service.list_tasks(&project_id).await?;
        let mut task = all_tasks
            .into_iter()
            .find(|t| t.task_id == task_id)
            .ok_or_else(|| EngineError::Parse(format!("task {task_id} not found")))?;

        if task.status == TaskStatus::Failed || task.status == TaskStatus::InProgress {
            task = self
                .task_service
                .reset_task_to_ready(&project_id, &task.spec_id, &task.task_id)
                .await?;
        }
        if task.status != TaskStatus::Ready {
            return Err(EngineError::Parse(format!(
                "task must be in ready, failed, or in_progress state, currently: {:?}",
                task.status,
            )));
        }

        let user_id = self.current_user_id();
        let model = Some(self.llm_config.default_model.clone());

        let agent = if let Some(aiid) = agent_instance_id {
            self.agent_instance_service
                .get_instance(&project_id, &aiid)
                .await
                .map_err(|_| EngineError::Parse(format!("agent instance {aiid} not found")))?
        } else {
            let now = chrono::Utc::now();
            let default_agent = aura_core::Agent {
                agent_id: aura_core::AgentId::new(),
                user_id: self.current_user_id().unwrap_or_default(),
                name: "dev-agent".into(),
                role: String::new(),
                personality: String::new(),
                system_prompt: String::new(),
                skills: Vec::new(),
                icon: None,
                network_agent_id: None,
                profile_id: None,
                created_at: now,
                updated_at: now,
            };
            self.agent_instance_service
                .create_instance_from_agent(&project_id, &default_agent)
                .await?
        };
        let session = self.session_service.create_session(
            &agent.agent_instance_id, &project_id, None,
            String::new(), user_id.clone(), model.clone(),
        ).await?;

        self.task_service.assign_task(
            &project_id, &task.spec_id, &task.task_id,
            &agent.agent_instance_id, Some(session.session_id),
        ).await?;
        self.session_service.record_task_worked(
            &project_id, &agent.agent_instance_id, &session.session_id, task.task_id,
        ).await?;
        self.agent_instance_service.start_working(
            &project_id, &agent.agent_instance_id, &task.task_id, &session.session_id,
        ).await?;
        let aiid = agent.agent_instance_id;
        self.emit(EngineEvent::TaskStarted {
            project_id, agent_instance_id: aiid,
            task_id: task.task_id, task_title: task.title.clone(),
            session_id: session.session_id,
            prompt_tokens_estimate: None,
            codebase_snapshot_bytes: None, codebase_file_count: None,
        });

        let task_start = Instant::now();
        let model_name = model.clone();
        let project_root = self.project_service.get_project_async(&project_id).await?
            .linked_folder_path.clone();
        let workspace_cache = WorkspaceCache::build_async(&project_root).await?;
        let fee_schedule = self.pricing_service.get_fee_schedule();

        let (baseline_test_failures, baseline_build_errors) = {
            let project = self.project_service.get_project_async(&project_id).await?;
            let test_bl = self.capture_test_baseline(&project).await;
            let build_bl = self.capture_build_baseline(&project).await;
            (test_bl, build_bl)
        };

        let execution_result = if let Some(cmd) = shell::extract_shell_command(&task) {
            let project = self.project_service.get_project_async(&project_id).await?;
            self.execute_shell_task(&project, &task, &cmd, aiid).await
        } else {
            self.execute_task_agentic(&project_id, &task, &session, &api_key, Some(&agent), &[], &workspace_cache).await
        };

        let outcome = self.finalize_task_execution(
            project_id, aiid, &task, &session, &api_key,
            &user_id, &model, task_start, &baseline_test_failures,
            &baseline_build_errors, execution_result, &workspace_cache,
        ).await?;

        self.record_single_task_metrics(
            &task, &outcome, &project_root, &project_id, &model_name, &fee_schedule,
        );
        self.create_follow_ups_if_completed(&task, &outcome, project_id, aiid).await;

        let end_status = if outcome.is_completed() { SessionStatus::Completed } else { SessionStatus::Failed };
        if let Err(e) = self.session_service.end_session(&project_id, &aiid, &session.session_id, end_status).await {
            warn!(error = %e, "failed to end session after single task");
        }
        if let Err(e) = self.agent_instance_service.finish_working(&project_id, &aiid).await {
            warn!(error = %e, "failed to finish_working after single task");
        }
        Ok(())
    }

    pub(crate) async fn finalize_task_execution(
        &self,
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        task: &Task,
        session: &Session,
        api_key: &str,
        user_id: &Option<String>,
        model: &Option<String>,
        task_start: Instant,
        baseline_test_failures: &HashSet<String>,
        baseline_build_errors: &HashSet<String>,
        execution_result: Result<TaskExecution, EngineError>,
        workspace_cache: &WorkspaceCache,
    ) -> Result<TaskOutcome, EngineError> {
        let execution = match execution_result {
            Ok(exec) => exec,
            Err(e) => {
                return Ok(self.handle_execution_error(
                    project_id, agent_instance_id, task, model, task_start, e,
                ).await);
            }
        };

        let llm_duration_ms = task_start.elapsed().as_millis() as u64;
        let project = self.project_service.get_project_async(&project_id).await?;
        let base_path = Path::new(&project.linked_folder_path);

        let file_changes = if execution.files_already_applied {
            simple_file_changes(&execution.file_ops)
        } else {
            let bp = base_path.to_path_buf();
            let ops = execution.file_ops.clone();
            tokio::task::spawn_blocking(move || {
                file_ops::compute_file_changes(&bp, &ops)
            })
            .await
            .unwrap_or_default()
        };

        self.update_task_tracking(
            &project_id, task, user_id, model,
            execution.input_tokens, execution.output_tokens,
        );

        let _write_guard = self.write_coordinator.acquire(&project_id).await;

        let file_ops_start = Instant::now();
        if !execution.files_already_applied {
            if let Err(e) = file_ops::apply_file_ops(base_path, &execution.file_ops).await {
                return Ok(self.handle_file_ops_failure(
                    project_id, agent_instance_id, task, session, model,
                    task_start, llm_duration_ms, &execution, e,
                ).await);
            }
        }
        let file_ops_duration_ms = file_ops_start.elapsed().as_millis() as u64;
        self.emit_file_ops_applied(project_id, agent_instance_id, task, &execution.file_ops);

        let build_start = Instant::now();
        let (_, build_passed, build_attempts, dup_bailouts, fix_inp, fix_out, last_build_stderr) = self
            .verify_and_fix_build(
                &project, task, session, api_key, &execution, baseline_test_failures,
                baseline_build_errors, workspace_cache,
            ).await?;
        let build_verify_duration_ms = build_start.elapsed().as_millis() as u64;
        let task_duration_ms = task_start.elapsed().as_millis() as u64;

        self.update_task_tracking(&project_id, task, user_id, model, fix_inp, fix_out);

        let total_input = execution.input_tokens + fix_inp;
        let total_output = execution.output_tokens + fix_out;

        let timings = TaskTimings {
            input_tokens: execution.input_tokens,
            output_tokens: execution.output_tokens,
            fix_input_tokens: fix_inp,
            fix_output_tokens: fix_out,
            parse_retries: execution.parse_retries,
            build_fix_attempts: build_attempts,
            duplicate_error_bailouts: dup_bailouts,
            llm_duration_ms, file_ops_duration_ms, build_verify_duration_ms, task_duration_ms,
            files_changed: execution.file_ops.len() as u32,
        };

        self.run_post_build_stub_check(
            project_id, agent_instance_id, task, base_path, &execution, build_passed,
        );

        if !build_passed {
            return Ok(self.handle_build_failure(
                project_id, agent_instance_id, task, session, model,
                &execution, total_input, total_output, timings,
                &last_build_stderr,
            ).await);
        }

        self.emit_completion(
            project_id, agent_instance_id, task, session, model,
            &execution, &file_changes, total_input, total_output,
            task_duration_ms, llm_duration_ms, build_verify_duration_ms, build_attempts,
        ).await;

        Ok(TaskOutcome::Completed {
            notes: execution.notes,
            follow_up_tasks: execution.follow_up_tasks,
            file_ops: execution.file_ops,
            timings,
        })
    }

    async fn handle_execution_error(
        &self,
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        task: &Task,
        model: &Option<String>,
        task_start: Instant,
        e: EngineError,
    ) -> TaskOutcome {
        let credit_failure = matches!(e, EngineError::InsufficientCredits);
        let reason = format!("execution error: {e}");
        let task_dur = task_start.elapsed().as_millis() as u64;
        if let Err(e2) = self.task_service.fail_task(&project_id, &task.spec_id, &task.task_id, &reason).await {
            warn!(task_id = %task.task_id, error = %e2, "failed to mark task as failed");
        }
        let phase = if credit_failure { "insufficient_credits" } else { "execution" };
        self.emit(EngineEvent::TaskFailed {
            project_id, agent_instance_id, task_id: task.task_id,
            reason: e.to_string(), duration_ms: Some(task_dur),
            phase: Some(phase.into()), parse_retries: None,
            build_fix_attempts: None, model: model.clone(),
        });
        TaskOutcome::Failed {
            reason, phase: phase.to_string(), credit_failure,
            timings: TaskTimings { task_duration_ms: task_dur, ..Default::default() },
        }
    }

    async fn handle_file_ops_failure(
        &self,
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        task: &Task,
        session: &Session,
        model: &Option<String>,
        task_start: Instant,
        llm_duration_ms: u64,
        execution: &TaskExecution,
        e: EngineError,
    ) -> TaskOutcome {
        let reason = format!("file operation failed: {e}");
        let task_dur = task_start.elapsed().as_millis() as u64;
        if let Err(e2) = self.task_service.fail_task(&project_id, &task.spec_id, &task.task_id, &reason).await {
            warn!(task_id = %task.task_id, error = %e2, "failed to mark task as failed");
        }
        self.emit(EngineEvent::TaskFailed {
            project_id, agent_instance_id, task_id: task.task_id,
            reason: e.to_string(), duration_ms: Some(task_dur),
            phase: Some("file_ops".into()), parse_retries: Some(execution.parse_retries),
            build_fix_attempts: None, model: model.clone(),
        });
        if let Err(e2) = self.session_service.update_context_usage(
            &project_id, &agent_instance_id, &session.session_id,
            execution.input_tokens, execution.output_tokens,
        ).await { warn!(error = %e2, "failed to update context usage"); }
        TaskOutcome::Failed {
            reason, phase: "file_ops".to_string(), credit_failure: false,
            timings: TaskTimings {
                input_tokens: execution.input_tokens,
                output_tokens: execution.output_tokens,
                parse_retries: execution.parse_retries,
                llm_duration_ms, task_duration_ms: task_dur,
                files_changed: execution.file_ops.len() as u32,
                ..Default::default()
            },
        }
    }

    fn run_post_build_stub_check(
        &self,
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        task: &Task,
        base_path: &Path,
        execution: &TaskExecution,
        build_passed: bool,
    ) {
        if !build_passed { return; }
        let stub_reports = file_ops::detect_stub_patterns(base_path, &execution.file_ops);
        if stub_reports.is_empty() { return; }
        let stub_summary: Vec<String> = stub_reports.iter()
            .map(|r| format!("{}:{} -- {}", r.path, r.line, r.pattern))
            .collect();
        warn!(
            task_id = %task.task_id, stub_count = stub_reports.len(),
            "task completed with {} remaining stub(s): {}", stub_reports.len(), stub_summary.join("; "),
        );
        self.emit(EngineEvent::TaskOutputDelta {
            project_id, agent_instance_id, task_id: task.task_id,
            delta: format!(
                "\n[warning] {} stub/placeholder pattern(s) remain in output:\n{}\n",
                stub_reports.len(), stub_summary.join("\n"),
            ),
        });
    }

    async fn handle_build_failure(
        &self,
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        task: &Task,
        session: &Session,
        model: &Option<String>,
        execution: &TaskExecution,
        total_input: u64,
        total_output: u64,
        timings: TaskTimings,
        last_build_stderr: &str,
    ) -> TaskOutcome {
        // Store the actual build errors in execution_notes so they're visible
        // when the task is retried via "Notes from Prior Attempts".
        let reason = if last_build_stderr.is_empty() {
            "build verification failed after all fix attempts".to_string()
        } else {
            let truncated = if last_build_stderr.len() > 4000 {
                format!(
                    "{}...\n(truncated {} bytes)",
                    &last_build_stderr[..4000],
                    last_build_stderr.len() - 4000
                )
            } else {
                last_build_stderr.to_string()
            };
            format!(
                "build verification failed after all fix attempts\n\n\
                 # Last Build Errors\n```\n{}\n```",
                truncated
            )
        };
        if let Err(e) = self.task_service.fail_task(&project_id, &task.spec_id, &task.task_id, &reason).await {
            warn!(task_id = %task.task_id, error = %e, "failed to mark task as failed");
        }
        self.emit(EngineEvent::TaskFailed {
            project_id, agent_instance_id, task_id: task.task_id,
            reason: reason.clone(), duration_ms: Some(timings.task_duration_ms),
            phase: Some("build_verify".into()),
            parse_retries: Some(execution.parse_retries),
            build_fix_attempts: Some(timings.build_fix_attempts), model: model.clone(),
        });
        if let Err(e) = self.session_service.update_context_usage(
            &project_id, &agent_instance_id, &session.session_id,
            total_input, total_output,
        ).await { warn!(error = %e, "failed to update context usage"); }
        TaskOutcome::Failed {
            reason, phase: "build_verify".to_string(), credit_failure: false, timings,
        }
    }

    async fn emit_completion(
        &self,
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        task: &Task,
        session: &Session,
        model: &Option<String>,
        execution: &TaskExecution,
        file_changes: &[FileChangeSummary],
        total_input: u64,
        total_output: u64,
        task_duration_ms: u64,
        llm_duration_ms: u64,
        build_verify_duration_ms: u64,
        build_attempts: u32,
    ) {
        if let Err(e) = self.task_service.complete_task(
            &project_id, &task.spec_id, &task.task_id,
            &execution.notes, file_changes.to_vec(),
        ).await { warn!(task_id = %task.task_id, error = %e, "failed to mark task as completed"); }

        let cost_usd = {
            Some(self.pricing_service.compute_cost(
                model.as_deref().unwrap_or(aura_claude::DEFAULT_MODEL),
                total_input, total_output,
            ))
        };
        self.emit(EngineEvent::TaskCompleted {
            project_id, agent_instance_id, task_id: task.task_id,
            execution_notes: execution.notes.clone(),
            file_changes: file_changes.to_vec(),
            duration_ms: Some(task_duration_ms),
            input_tokens: Some(total_input), output_tokens: Some(total_output),
            cost_usd, llm_duration_ms: Some(llm_duration_ms),
            build_verify_duration_ms: Some(build_verify_duration_ms),
            files_changed_count: Some(execution.file_ops.len() as u32),
            parse_retries: Some(execution.parse_retries),
            build_fix_attempts: Some(build_attempts), model: model.clone(),
        });

        let newly_ready = self.task_service
            .resolve_dependencies_after_completion(&project_id, &task.task_id)
            .await
            .unwrap_or_default();
        for t in &newly_ready {
            self.emit(EngineEvent::TaskBecameReady {
                project_id, agent_instance_id, task_id: t.task_id,
            });
        }

        if let Err(e) = self.session_service.update_context_usage(
            &project_id, &agent_instance_id, &session.session_id,
            total_input, total_output,
        ).await { warn!(error = %e, "failed to update context usage"); }
    }

    fn record_single_task_metrics(
        &self,
        task: &Task,
        outcome: &TaskOutcome,
        project_root: &str,
        project_id: &ProjectId,
        model_name: &Option<String>,
        fee_schedule: &[aura_core::FeeScheduleEntry],
    ) {
        if project_root.is_empty() { return; }
        let task_metrics = metrics::TaskMetrics::from_outcome(
            task.task_id.to_string(), task.title.clone(), model_name.clone(), outcome,
        );
        metrics::write_single_task_metrics(
            Path::new(project_root), &project_id.to_string(), task_metrics, fee_schedule,
        );
    }

    async fn create_follow_ups_if_completed(
        &self,
        task: &Task,
        outcome: &TaskOutcome,
        project_id: ProjectId,
        aiid: AgentInstanceId,
    ) {
        if let TaskOutcome::Completed { follow_up_tasks, .. } = outcome {
            for follow_up in follow_up_tasks {
                if let Ok(new_task) = self.task_service.create_follow_up_task(
                    task, follow_up.title.clone(), follow_up.description.clone(), vec![],
                ).await {
                    self.emit(EngineEvent::FollowUpTaskCreated {
                        project_id, agent_instance_id: aiid, task_id: new_task.task_id,
                    });
                }
            }
        }
    }
}
