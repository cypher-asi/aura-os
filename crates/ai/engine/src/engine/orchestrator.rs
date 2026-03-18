use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use tokio::sync::{mpsc, watch};
use tracing::{error, info, warn};

use aura_core::*;
use aura_agents::AgentInstanceService;
use aura_billing::MeteredLlm;
use aura_projects::ProjectService;
use aura_sessions::SessionService;
use aura_tasks::TaskService;
use aura_settings::SettingsService;
use aura_store::RocksStore;

use super::shell;
use super::types::*;
use super::write_coordinator::ProjectWriteCoordinator;
use crate::error::EngineError;
use crate::events::{EngineEvent, PhaseTimingEntry};
use crate::file_ops::FileOp;
use crate::metrics::{self, LoopRunMetrics, TaskMetrics};

pub struct LoopHandle {
    pub project_id: ProjectId,
    pub agent_instance_id: AgentInstanceId,
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

pub struct DevLoopEngine {
    pub(crate) store: Arc<RocksStore>,
    pub(crate) settings: Arc<SettingsService>,
    pub(crate) llm: Arc<MeteredLlm>,
    pub(crate) project_service: Arc<ProjectService>,
    pub(crate) task_service: Arc<TaskService>,
    pub(crate) agent_instance_service: Arc<AgentInstanceService>,
    pub(crate) session_service: Arc<SessionService>,
    pub(crate) event_tx: mpsc::UnboundedSender<EngineEvent>,
    pub(crate) write_coordinator: ProjectWriteCoordinator,
    pub(crate) engine_config: EngineConfig,
    pub(crate) llm_config: LlmConfig,
}

impl DevLoopEngine {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        store: Arc<RocksStore>,
        settings: Arc<SettingsService>,
        llm: Arc<MeteredLlm>,
        project_service: Arc<ProjectService>,
        task_service: Arc<TaskService>,
        agent_instance_service: Arc<AgentInstanceService>,
        session_service: Arc<SessionService>,
        event_tx: mpsc::UnboundedSender<EngineEvent>,
    ) -> Self {
        Self {
            store,
            settings,
            llm,
            project_service,
            task_service,
            agent_instance_service,
            session_service,
            event_tx,
            write_coordinator: ProjectWriteCoordinator::new(),
            engine_config: EngineConfig::from_env(),
            llm_config: LlmConfig::from_env(),
        }
    }

    pub fn with_write_coordinator(mut self, coordinator: ProjectWriteCoordinator) -> Self {
        self.write_coordinator = coordinator;
        self
    }

    pub async fn start(
        self: Arc<Self>,
        project_id: ProjectId,
        agent_instance_id: Option<AgentInstanceId>,
    ) -> Result<LoopHandle, EngineError> {
        let _project = self.project_service.get_project(&project_id)?;

        let stale = self.session_service.close_stale_sessions(&project_id)?;
        if !stale.is_empty() {
            info!("closed {} stale active session(s) from previous run", stale.len());
        }

        let agent = if let Some(aiid) = agent_instance_id {
            self.agent_instance_service
                .get_instance(&project_id, &aiid)
                .map_err(|_| EngineError::Parse(format!("agent instance {aiid} not found")))?
        } else {
            self.agent_instance_service
                .create_instance(&project_id, "dev-agent".into())?
        };

        let agent = if agent.status == AgentStatus::Working {
            info!(
                agent_instance_id = %agent.agent_instance_id,
                "resetting stale Working agent to Idle before starting loop"
            );
            self.agent_instance_service
                .finish_working(&project_id, &agent.agent_instance_id)?;
            self.agent_instance_service
                .get_instance(&project_id, &agent.agent_instance_id)
                .map_err(|_| EngineError::Parse(format!("agent instance {} not found", agent.agent_instance_id)))?
        } else {
            agent
        };

        let session = self.session_service.create_session(
            &agent.agent_instance_id,
            &project_id,
            None,
            String::new(),
            self.current_user_id(),
            Some(self.llm_config.default_model.clone()),
        )?;

        let (stop_tx, stop_rx) = watch::channel(LoopCommand::Continue);

        self.emit(EngineEvent::LoopStarted {
            project_id,
            agent_instance_id: agent.agent_instance_id,
        });

        let engine = self.clone();
        let aiid = agent.agent_instance_id;
        let join_handle = tokio::spawn(async move {
            let result = engine
                .run_loop(project_id, aiid, session, stop_rx)
                .await;
            if let Err(ref e) = result {
                error!(error = %e, "run_loop exited with error, emitting LoopFinished");

                // Reset any tasks stuck in InProgress so the UI doesn't show stale spinners
                if let Ok(orphaned) = engine.task_service.reset_in_progress_tasks(&project_id) {
                    for t in &orphaned {
                        engine.emit(EngineEvent::TaskBecameReady {
                            project_id,
                            agent_instance_id: aiid,
                            task_id: t.task_id,
                        });
                    }
                }

                engine.emit(EngineEvent::LoopFinished {
                    project_id,
                    agent_instance_id: aiid,
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
                let _ = engine.agent_instance_service.finish_working(&project_id, &aiid);
            }
            result
        });

        Ok(LoopHandle {
            project_id,
            agent_instance_id: agent.agent_instance_id,
            stop_tx,
            join_handle,
        })
    }

    async fn run_loop(
        &self,
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        mut session: Session,
        mut stop_rx: watch::Receiver<LoopCommand>,
    ) -> Result<LoopOutcome, EngineError> {
        let api_key = self.settings.get_decrypted_api_key()?;
        let loop_start = Instant::now();
        let mut completed_count: usize = 0;
        let mut failed_count: usize = 0;
        let mut follow_up_count: usize = 0;
        let mut task_retry_counts: std::collections::HashMap<TaskId, u32> = std::collections::HashMap::new();
        let mut credit_failed_tasks: std::collections::HashSet<TaskId> = std::collections::HashSet::new();
        let mut work_log: Vec<String> = Vec::new();
        let mut total_input_tokens: u64 = 0;
        let mut total_output_tokens: u64 = 0;
        let mut tasks_retried: usize = 0;
        let mut sessions_used: usize = 1;
        let mut total_parse_retries: u32 = 0;
        let mut total_build_fix_attempts: u32 = 0;
        let mut duplicate_error_bailouts: u32 = 0;

        let project_root = self.project_service.get_project(&project_id)?
            .linked_folder_path.clone();
        let mut run_metrics = LoopRunMetrics::new(project_id.to_string());
        let fee_schedule = aura_billing::PricingService::new(self.store.clone())
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
            self.emit(EngineEvent::TaskBecameReady { project_id, agent_instance_id, task_id: t.task_id });
        }

        let promoted = self.task_service.resolve_initial_readiness(&project_id)?;
        for t in &promoted {
            self.emit(EngineEvent::TaskBecameReady { project_id, agent_instance_id, task_id: t.task_id });
        }

        loop {
            if *stop_rx.borrow() == LoopCommand::Pause {
                if let Err(e) = self.session_service.end_session(
                    &project_id, &agent_instance_id, &session.session_id, SessionStatus::Completed,
                ) { warn!(error = %e, "failed to end session on pause"); }
                if let Err(e) = self.agent_instance_service.finish_working(&project_id, &agent_instance_id) {
                    warn!(error = %e, "failed to finish_working on pause");
                }
                self.emit(EngineEvent::LoopPaused { project_id, agent_instance_id, completed_count });
                flush_metrics!("paused");
                return Ok(LoopOutcome::Paused { completed_count });
            }
            if *stop_rx.borrow() == LoopCommand::Stop {
                if let Err(e) = self.session_service.end_session(
                    &project_id, &agent_instance_id, &session.session_id, SessionStatus::Completed,
                ) { warn!(error = %e, "failed to end session on stop"); }
                if let Err(e) = self.agent_instance_service.finish_working(&project_id, &agent_instance_id) {
                    warn!(error = %e, "failed to finish_working on stop");
                }
                self.emit(EngineEvent::LoopStopped { project_id, agent_instance_id, completed_count });
                flush_metrics!("stopped");
                return Ok(LoopOutcome::Stopped { completed_count });
            }

            let task = match self.task_service.claim_next_task(&project_id, &agent_instance_id, Some(session.session_id))? {
                Some(t) => t,
                None => {
                    let all_tasks = self.store.list_tasks_by_project(&project_id)?;
                    let retryable: Vec<&Task> = all_tasks.iter()
                        .filter(|t| t.status == TaskStatus::Failed
                            && !credit_failed_tasks.contains(&t.task_id)
                            && *task_retry_counts.get(&t.task_id).unwrap_or(&0) < self.engine_config.max_loop_task_retries)
                        .collect();

                    if !retryable.is_empty() {
                        for t in &retryable {
                            let count = task_retry_counts.entry(t.task_id).or_insert(0);
                            *count += 1;
                            tasks_retried += 1;
                            info!(task_id = %t.task_id, title = %t.title, attempt = *count, "resetting failed task for retry");
                            if let Err(e) = self.task_service.retry_task(
                                &project_id, &t.spec_id, &t.task_id,
                            ) {
                                warn!(task_id = %t.task_id, error = %e, "retry_task failed, skipping");
                                continue;
                            }
                            self.emit(EngineEvent::TaskBecameReady { project_id, agent_instance_id, task_id: t.task_id });
                        }
                        continue;
                    }

                    let progress = self.task_service.get_project_progress(&project_id)?;
                    let loop_metrics = |outcome: &str| EngineEvent::LoopFinished {
                        project_id,
                        agent_instance_id,
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
                        if let Err(e) = self.session_service.end_session(
                            &project_id, &agent_instance_id, &session.session_id, SessionStatus::Completed,
                        ) { warn!(error = %e, "failed to end session on all_tasks_blocked"); }
                        self.emit(loop_metrics("all_tasks_blocked"));
                        flush_metrics!("all_tasks_blocked");
                        return Ok(LoopOutcome::AllTasksBlocked);
                    }
                    if let Err(e) = self.session_service.end_session(
                        &project_id, &agent_instance_id, &session.session_id, SessionStatus::Completed,
                    ) { warn!(error = %e, "failed to end session on all_tasks_complete"); }
                    self.emit(loop_metrics("all_tasks_complete"));
                    flush_metrics!("all_tasks_complete");
                    return Ok(LoopOutcome::AllTasksComplete);
                }
            };

            self.session_service
                .record_task_worked(&project_id, &agent_instance_id, &session.session_id, task.task_id)?;
            self.agent_instance_service.start_working(
                &project_id,
                &agent_instance_id,
                &task.task_id,
                &session.session_id,
            )?;
            self.emit(EngineEvent::TaskStarted {
                project_id,
                agent_instance_id,
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
            let loop_agent = self.agent_instance_service
                .get_instance(&project_id, &agent_instance_id)
                .ok();
            let result = if let Some(cmd) = shell::extract_shell_command(&task) {
                let project = self.project_service.get_project(&project_id)?;
                Some(self.execute_shell_task(&project, &task, &cmd, agent_instance_id).await)
            } else {
                tokio::select! {
                    res = self.execute_task_agentic(&project_id, &task, &session, &api_key, loop_agent.as_ref(), &work_log) => {
                        Some(res)
                    }
                    _ = stop_rx.changed() => {
                        None
                    }
                }
            };

            if result.is_none() {
                if let Err(e) = self.task_service.reset_task_to_ready(
                    &project_id, &task.spec_id, &task.task_id,
                ) { warn!(error = %e, "failed to reset task to ready after interruption"); }
                self.emit(EngineEvent::TaskBecameReady { project_id, agent_instance_id, task_id: task.task_id });
                if let Err(e) = self.agent_instance_service.finish_working(&project_id, &agent_instance_id) {
                    warn!(error = %e, "failed to finish_working after interruption");
                }

                let cmd = *stop_rx.borrow();
                if cmd == LoopCommand::Stop {
                    if let Err(e) = self.session_service.end_session(
                        &project_id, &agent_instance_id, &session.session_id, SessionStatus::Completed,
                    ) { warn!(error = %e, "failed to end session on stop"); }
                    self.emit(EngineEvent::LoopStopped { project_id, agent_instance_id, completed_count });
                    flush_metrics!("stopped");
                    return Ok(LoopOutcome::Stopped { completed_count });
                } else {
                    if let Err(e) = self.session_service.end_session(
                        &project_id, &agent_instance_id, &session.session_id, SessionStatus::Completed,
                    ) { warn!(error = %e, "failed to end session on pause"); }
                    self.emit(EngineEvent::LoopPaused { project_id, agent_instance_id, completed_count });
                    flush_metrics!("paused");
                    return Ok(LoopOutcome::Paused { completed_count });
                }
            }
            let execution_result = result.unwrap();

            let outcome = self.finalize_task_execution(
                project_id, agent_instance_id, &task, &session, &api_key,
                &session.user_id, &session.model, task_start, &baseline_test_failures,
                execution_result,
            ).await?;

            let t = outcome.timings();
            total_input_tokens += t.total_input();
            total_output_tokens += t.total_output();
            total_parse_retries += t.parse_retries;
            total_build_fix_attempts += t.build_fix_attempts;
            duplicate_error_bailouts += t.duplicate_error_bailouts;

            let failure_reason = match &outcome {
                TaskOutcome::Completed { notes, follow_up_tasks, file_ops, timings } => {
                    completed_count += 1;

                    self.emit(EngineEvent::LoopIterationSummary {
                        project_id,
                        agent_instance_id,
                        task_id: task.task_id,
                        phase_timings: vec![
                            PhaseTimingEntry { phase: "llm_call".into(), duration_ms: timings.llm_duration_ms },
                            PhaseTimingEntry { phase: "file_ops".into(), duration_ms: timings.file_ops_duration_ms },
                            PhaseTimingEntry { phase: "build_verify".into(), duration_ms: timings.build_verify_duration_ms },
                        ],
                    });

                    let task_phase_timings = vec![
                        PhaseTimingEntry { phase: "llm_call".into(), duration_ms: timings.llm_duration_ms },
                        PhaseTimingEntry { phase: "file_ops".into(), duration_ms: timings.file_ops_duration_ms },
                        PhaseTimingEntry { phase: "build_verify".into(), duration_ms: timings.build_verify_duration_ms },
                    ];
                    record_task!(TaskMetrics::completed(
                        task.task_id.to_string(), task.title.clone(),
                        timings.task_duration_ms, session.model.clone(),
                    )
                    .with_tokens(timings.total_input(), timings.total_output())
                    .with_llm_duration(timings.llm_duration_ms)
                    .with_file_ops_duration(timings.file_ops_duration_ms)
                    .with_build_verify_duration(timings.build_verify_duration_ms)
                    .with_files_changed(timings.files_changed)
                    .with_parse_retries(timings.parse_retries)
                    .with_build_fix_attempts(timings.build_fix_attempts)
                    .with_phase_timings(task_phase_timings));

                    for follow_up in follow_up_tasks {
                        if follow_up_count >= self.engine_config.max_follow_ups_per_loop {
                            warn!(cap = self.engine_config.max_follow_ups_per_loop, "follow-up task cap reached, skipping remaining");
                            break;
                        }
                        match self.task_service.create_follow_up_task(
                            &task, follow_up.title.clone(), follow_up.description.clone(), vec![],
                        ) {
                            Ok(new_task) => {
                                follow_up_count += 1;
                                self.emit(EngineEvent::FollowUpTaskCreated {
                                    project_id, agent_instance_id, task_id: new_task.task_id,
                                });
                            }
                            Err(aura_tasks::TaskError::DuplicateFollowUp) => {
                                info!(title = %follow_up.title, "skipping duplicate follow-up task");
                            }
                            Err(e) => return Err(EngineError::Parse(format!("follow-up creation failed: {e}"))),
                        }
                    }

                    let changed_files: Vec<&str> = file_ops
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
                        task.title, notes, changed_files.join(", "),
                    ));

                    None
                }
                TaskOutcome::Failed { reason, phase, credit_failure, timings } => {
                    failed_count += 1;
                    if *credit_failure {
                        credit_failed_tasks.insert(task.task_id);
                    }
                    record_task!(TaskMetrics::failed(
                        task.task_id.to_string(), task.title.clone(),
                        timings.task_duration_ms, session.model.clone(), phase, reason.clone(),
                    )
                    .with_tokens(timings.total_input(), timings.total_output())
                    .with_llm_duration(timings.llm_duration_ms)
                    .with_file_ops_duration(timings.file_ops_duration_ms)
                    .with_build_verify_duration(timings.build_verify_duration_ms)
                    .with_files_changed(timings.files_changed)
                    .with_parse_retries(timings.parse_retries)
                    .with_build_fix_attempts(timings.build_fix_attempts)
                    .with_phase_timings(vec![
                        PhaseTimingEntry { phase: "llm_call".into(), duration_ms: timings.llm_duration_ms },
                        PhaseTimingEntry { phase: "file_ops".into(), duration_ms: timings.file_ops_duration_ms },
                        PhaseTimingEntry { phase: "build_verify".into(), duration_ms: timings.build_verify_duration_ms },
                    ]));
                    work_log.push(format!("Task (failed): {}\nReason: {}", task.title, reason));
                    Some(reason.clone())
                }
            };

            self.agent_instance_service.finish_working(&project_id, &agent_instance_id)?;

            if self.llm.is_credits_exhausted() {
                warn!("Credits exhausted, stopping engine loop");
                if let Err(e) = self.session_service.end_session(
                    &project_id, &agent_instance_id, &session.session_id, SessionStatus::Completed,
                ) { warn!(error = %e, "failed to end session on credits exhausted"); }
                self.emit(EngineEvent::LoopFinished {
                    project_id,
                    agent_instance_id,
                    outcome: "insufficient_credits".into(),
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
                });
                flush_metrics!("insufficient_credits");
                return Ok(LoopOutcome::AllTasksBlocked);
            }

            if failure_reason.is_some() {
                continue;
            }

            let current_session =
                self.session_service
                    .get_session(&project_id, &agent_instance_id, &session.session_id)?;
            if self.session_service.should_rollover(&current_session) {
                let project = self.project_service.get_project(&project_id)?;
                let mut raw_log = work_log.join("\n\n---\n\n");
                const MAX_WORK_LOG_CHARS: usize = 20_000;
                if raw_log.len() > MAX_WORK_LOG_CHARS {
                    raw_log.truncate(MAX_WORK_LOG_CHARS);
                    raw_log.push_str("\n\n... (work log truncated) ...");
                }
                let history = format!(
                    "Project: {}\nDescription: {}\n\nSession work log ({} tasks completed):\n\n{}",
                    project.name,
                    project.description,
                    completed_count,
                    raw_log,
                );
                let summary_start = Instant::now();
                let summary = tokio::select! {
                    res = self.session_service.generate_rollover_summary(
                        &self.llm,
                        &api_key,
                        &history,
                    ) => { res? }
                    _ = stop_rx.changed() => {
                        if let Err(e) = self.agent_instance_service.finish_working(&project_id, &agent_instance_id) {
                            warn!(error = %e, "failed to finish_working during rollover interruption");
                        }
                        let cmd = *stop_rx.borrow();
                        if cmd == LoopCommand::Stop {
                            if let Err(e) = self.session_service.end_session(
                                &project_id, &agent_instance_id, &session.session_id, SessionStatus::Completed,
                            ) { warn!(error = %e, "failed to end session on stop"); }
                            self.emit(EngineEvent::LoopStopped { project_id, agent_instance_id, completed_count });
                            flush_metrics!("stopped");
                            return Ok(LoopOutcome::Stopped { completed_count });
                        } else {
                            if let Err(e) = self.session_service.end_session(
                                &project_id, &agent_instance_id, &session.session_id, SessionStatus::Completed,
                            ) { warn!(error = %e, "failed to end session on pause"); }
                            self.emit(EngineEvent::LoopPaused { project_id, agent_instance_id, completed_count });
                            flush_metrics!("paused");
                            return Ok(LoopOutcome::Paused { completed_count });
                        }
                    }
                };
                let summary_duration_ms = summary_start.elapsed().as_millis() as u64;
                let context_usage_pct = current_session.context_usage_estimate * 100.0;
                let new_session = self.session_service.rollover_session(
                    &project_id,
                    &agent_instance_id,
                    &session.session_id,
                    summary,
                    None,
                )?;
                self.emit(EngineEvent::SessionRolledOver {
                    project_id,
                    agent_instance_id,
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

    pub(crate) fn emit_file_ops_applied(&self, project_id: ProjectId, agent_instance_id: AgentInstanceId, task: &Task, ops: &[FileOp]) {
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
            agent_instance_id,
            task_id: task.task_id,
            files_written,
            files_deleted,
            files,
        });
    }

    pub(crate) fn update_task_tracking(
        &self,
        project_id: &ProjectId,
        task: &Task,
        user_id: &Option<String>,
        model: &Option<String>,
        input_tokens: u64,
        output_tokens: u64,
    ) {
        let uid = user_id.clone();
        let m = model.clone();
        if let Err(e) = self.store.atomic_update_task(
            project_id, &task.spec_id, &task.task_id,
            |t| {
                t.user_id = uid;
                t.model = m;
                t.total_input_tokens += input_tokens;
                t.total_output_tokens += output_tokens;
            },
        ) {
            warn!(task_id = %task.task_id, error = %e, "failed to update task tracking metadata");
        }
    }

    pub(crate) fn current_user_id(&self) -> Option<String> {
        self.store
            .get_setting("zero_auth_session")
            .ok()
            .and_then(|bytes| serde_json::from_slice::<ZeroAuthSession>(&bytes).ok())
            .map(|s| s.user_id)
    }

    pub(crate) fn emit(&self, event: EngineEvent) {
        let _ = self.event_tx.send(event);
    }
}
