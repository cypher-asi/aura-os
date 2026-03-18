use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::Instant;

use tokio::sync::watch;
use tracing::{info, warn};

use aura_core::*;
use aura_billing::PricingService;

use super::orchestrator::DevLoopEngine;
use super::types::*;
use crate::error::EngineError;
use crate::events::{EngineEvent, PhaseTimingEntry};
use crate::file_ops::FileOp;
use crate::metrics::{self, LoopRunMetrics, TaskMetrics};

pub(crate) struct LoopRunContext {
    pub project_id: ProjectId,
    pub agent_instance_id: AgentInstanceId,
    pub api_key: String,
    pub session: Session,
    pub sessions_used: usize,
    pub work_log: Vec<String>,
    pub completed_count: usize,
    default_model: String,
    project_root: String,
    loop_start: Instant,
    failed_count: usize,
    follow_up_count: usize,
    task_retry_counts: HashMap<TaskId, u32>,
    credit_failed_tasks: HashSet<TaskId>,
    total_input_tokens: u64,
    total_output_tokens: u64,
    tasks_retried: usize,
    total_parse_retries: u32,
    total_build_fix_attempts: u32,
    duplicate_error_bailouts: u32,
    run_metrics: LoopRunMetrics,
    fee_schedule: Vec<FeeScheduleEntry>,
}

impl LoopRunContext {
    pub fn new(
        engine: &DevLoopEngine,
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        session: Session,
    ) -> Result<Self, EngineError> {
        let api_key = engine.settings.get_decrypted_api_key()?;
        let project_root = engine
            .project_service
            .get_project(&project_id)?
            .linked_folder_path
            .clone();
        let run_metrics = LoopRunMetrics::new(project_id.to_string());
        let fee_schedule = PricingService::new(engine.store.clone()).get_fee_schedule();
        let default_model = engine.llm_config.default_model.clone();
        Ok(Self {
            project_id,
            agent_instance_id,
            api_key,
            session,
            sessions_used: 1,
            work_log: Vec::new(),
            completed_count: 0,
            default_model,
            project_root,
            loop_start: Instant::now(),
            failed_count: 0,
            follow_up_count: 0,
            task_retry_counts: HashMap::new(),
            credit_failed_tasks: HashSet::new(),
            total_input_tokens: 0,
            total_output_tokens: 0,
            tasks_retried: 0,
            total_parse_retries: 0,
            total_build_fix_attempts: 0,
            duplicate_error_bailouts: 0,
            run_metrics,
            fee_schedule,
        })
    }

    // ------------------------------------------------------------------
    // Bootstrap
    // ------------------------------------------------------------------

    pub fn reset_and_promote_tasks(&self, engine: &DevLoopEngine) -> Result<(), EngineError> {
        for t in &engine.task_service.reset_in_progress_tasks(&self.project_id)? {
            engine.emit(EngineEvent::TaskBecameReady {
                project_id: self.project_id,
                agent_instance_id: self.agent_instance_id,
                task_id: t.task_id,
            });
        }
        for t in &engine.task_service.resolve_initial_readiness(&self.project_id)? {
            engine.emit(EngineEvent::TaskBecameReady {
                project_id: self.project_id,
                agent_instance_id: self.agent_instance_id,
                task_id: t.task_id,
            });
        }
        Ok(())
    }

    // ------------------------------------------------------------------
    // Stop / pause plumbing
    // ------------------------------------------------------------------

    fn end_session(&self, engine: &DevLoopEngine) {
        if let Err(e) = engine.session_service.end_session(
            &self.project_id,
            &self.agent_instance_id,
            &self.session.session_id,
            SessionStatus::Completed,
        ) {
            warn!(error = %e, "failed to end session");
        }
    }

    fn finish_working(&self, engine: &DevLoopEngine) {
        if let Err(e) = engine
            .agent_instance_service
            .finish_working(&self.project_id, &self.agent_instance_id)
        {
            warn!(error = %e, "failed to finish_working");
        }
    }

    fn handle_pause(&mut self, engine: &DevLoopEngine) -> LoopOutcome {
        self.end_session(engine);
        engine.emit(EngineEvent::LoopPaused {
            project_id: self.project_id,
            agent_instance_id: self.agent_instance_id,
            completed_count: self.completed_count,
        });
        self.flush_metrics("paused");
        LoopOutcome::Paused { completed_count: self.completed_count }
    }

    fn handle_stop(&mut self, engine: &DevLoopEngine) -> LoopOutcome {
        self.end_session(engine);
        engine.emit(EngineEvent::LoopStopped {
            project_id: self.project_id,
            agent_instance_id: self.agent_instance_id,
            completed_count: self.completed_count,
        });
        self.flush_metrics("stopped");
        LoopOutcome::Stopped { completed_count: self.completed_count }
    }

    fn stop_or_pause(
        &mut self,
        engine: &DevLoopEngine,
        stop_rx: &watch::Receiver<LoopCommand>,
    ) -> LoopOutcome {
        match *stop_rx.borrow() {
            LoopCommand::Stop => self.handle_stop(engine),
            _ => self.handle_pause(engine),
        }
    }

    pub fn check_command(
        &mut self,
        engine: &DevLoopEngine,
        stop_rx: &watch::Receiver<LoopCommand>,
    ) -> Option<LoopOutcome> {
        match *stop_rx.borrow() {
            LoopCommand::Pause => {
                self.finish_working(engine);
                Some(self.handle_pause(engine))
            }
            LoopCommand::Stop => {
                self.finish_working(engine);
                Some(self.handle_stop(engine))
            }
            LoopCommand::Continue => None,
        }
    }

    pub fn handle_interruption(
        &mut self,
        engine: &DevLoopEngine,
        task: &Task,
        stop_rx: &watch::Receiver<LoopCommand>,
    ) -> LoopOutcome {
        if let Err(e) =
            engine
                .task_service
                .reset_task_to_ready(&self.project_id, &task.spec_id, &task.task_id)
        {
            warn!(error = %e, "failed to reset task to ready after interruption");
        }
        engine.emit(EngineEvent::TaskBecameReady {
            project_id: self.project_id,
            agent_instance_id: self.agent_instance_id,
            task_id: task.task_id,
        });
        self.finish_working(engine);
        self.stop_or_pause(engine, stop_rx)
    }

    // ------------------------------------------------------------------
    // Metrics helpers
    // ------------------------------------------------------------------

    fn flush_metrics(&mut self, outcome: &str) {
        self.run_metrics.finalize(
            outcome,
            self.loop_start.elapsed().as_millis() as u64,
            self.sessions_used,
            self.tasks_retried,
            self.duplicate_error_bailouts,
            &self.fee_schedule,
        );
        if !self.project_root.is_empty() {
            metrics::write_run_metrics(Path::new(&self.project_root), &self.run_metrics);
        }
    }

    fn record_task(&mut self, tm: TaskMetrics) {
        self.run_metrics.tasks.push(tm.clone());
        if !self.project_root.is_empty() {
            self.run_metrics.snapshot(
                self.loop_start.elapsed().as_millis() as u64,
                self.sessions_used,
                self.tasks_retried,
                self.duplicate_error_bailouts,
                &self.fee_schedule,
            );
            metrics::write_live_snapshot(Path::new(&self.project_root), &self.run_metrics, &tm);
        }
    }

    fn build_finished_event(&self, engine: &DevLoopEngine, outcome: &str) -> EngineEvent {
        let pricing = PricingService::new(engine.store.clone());
        let total_cost_usd = Some(pricing.compute_cost(
            self.default_model.as_str(),
            self.total_input_tokens,
            self.total_output_tokens,
        ));
        EngineEvent::LoopFinished {
            project_id: self.project_id,
            agent_instance_id: self.agent_instance_id,
            outcome: outcome.into(),
            total_duration_ms: Some(self.loop_start.elapsed().as_millis() as u64),
            tasks_completed: Some(self.completed_count),
            tasks_failed: Some(self.failed_count),
            tasks_retried: Some(self.tasks_retried),
            total_input_tokens: Some(self.total_input_tokens),
            total_output_tokens: Some(self.total_output_tokens),
            total_cost_usd,
            sessions_used: Some(self.sessions_used),
            total_parse_retries: Some(self.total_parse_retries),
            total_build_fix_attempts: Some(self.total_build_fix_attempts),
            duplicate_error_bailouts: Some(self.duplicate_error_bailouts),
        }
    }

    // ------------------------------------------------------------------
    // Task lifecycle
    // ------------------------------------------------------------------

    pub fn begin_task(&self, engine: &DevLoopEngine, task: &Task) -> Result<(), EngineError> {
        engine.session_service.record_task_worked(
            &self.project_id,
            &self.agent_instance_id,
            &self.session.session_id,
            task.task_id,
        )?;
        engine.agent_instance_service.start_working(
            &self.project_id,
            &self.agent_instance_id,
            &task.task_id,
            &self.session.session_id,
        )?;
        engine.emit(EngineEvent::TaskStarted {
            project_id: self.project_id,
            agent_instance_id: self.agent_instance_id,
            task_id: task.task_id,
            task_title: task.title.clone(),
            session_id: self.session.session_id,
            prompt_tokens_estimate: None,
            codebase_snapshot_bytes: None,
            codebase_file_count: None,
        });
        Ok(())
    }

    pub fn process_outcome(
        &mut self,
        engine: &DevLoopEngine,
        task: &Task,
        outcome: TaskOutcome,
    ) -> Result<bool, EngineError> {
        {
            let t = outcome.timings();
            self.total_input_tokens += t.total_input();
            self.total_output_tokens += t.total_output();
            self.total_parse_retries += t.parse_retries;
            self.total_build_fix_attempts += t.build_fix_attempts;
            self.duplicate_error_bailouts += t.duplicate_error_bailouts;
        }
        match outcome {
            TaskOutcome::Completed { notes, follow_up_tasks, file_ops, timings } => {
                self.process_completed(engine, task, &notes, &follow_up_tasks, &file_ops, &timings)?;
                Ok(false)
            }
            TaskOutcome::Failed { reason, phase, credit_failure, timings } => {
                self.process_failed(task, &reason, &phase, credit_failure, &timings);
                Ok(true)
            }
        }
    }

    fn process_completed(
        &mut self,
        engine: &DevLoopEngine,
        task: &Task,
        notes: &str,
        follow_up_tasks: &[FollowUpSuggestion],
        file_ops: &[FileOp],
        timings: &TaskTimings,
    ) -> Result<(), EngineError> {
        self.completed_count += 1;
        let phase_timings = vec![
            PhaseTimingEntry { phase: "llm_call".into(), duration_ms: timings.llm_duration_ms },
            PhaseTimingEntry { phase: "file_ops".into(), duration_ms: timings.file_ops_duration_ms },
            PhaseTimingEntry { phase: "build_verify".into(), duration_ms: timings.build_verify_duration_ms },
        ];
        engine.emit(EngineEvent::LoopIterationSummary {
            project_id: self.project_id,
            agent_instance_id: self.agent_instance_id,
            task_id: task.task_id,
            phase_timings: phase_timings.clone(),
        });
        self.record_task(
            TaskMetrics::completed(
                task.task_id.to_string(),
                task.title.clone(),
                timings.task_duration_ms,
                self.session.model.clone(),
            )
            .with_tokens(timings.total_input(), timings.total_output())
            .with_llm_duration(timings.llm_duration_ms)
            .with_file_ops_duration(timings.file_ops_duration_ms)
            .with_build_verify_duration(timings.build_verify_duration_ms)
            .with_files_changed(timings.files_changed)
            .with_parse_retries(timings.parse_retries)
            .with_build_fix_attempts(timings.build_fix_attempts)
            .with_phase_timings(phase_timings),
        );
        for follow_up in follow_up_tasks {
            if self.follow_up_count >= engine.engine_config.max_follow_ups_per_loop {
                warn!(
                    cap = engine.engine_config.max_follow_ups_per_loop,
                    "follow-up task cap reached, skipping remaining"
                );
                break;
            }
            match engine.task_service.create_follow_up_task(
                task,
                follow_up.title.clone(),
                follow_up.description.clone(),
                vec![],
            ) {
                Ok(new_task) => {
                    self.follow_up_count += 1;
                    engine.emit(EngineEvent::FollowUpTaskCreated {
                        project_id: self.project_id,
                        agent_instance_id: self.agent_instance_id,
                        task_id: new_task.task_id,
                    });
                }
                Err(aura_tasks::TaskError::DuplicateFollowUp) => {
                    info!(title = %follow_up.title, "skipping duplicate follow-up task");
                }
                Err(e) => {
                    return Err(EngineError::Parse(format!(
                        "follow-up creation failed: {e}"
                    )));
                }
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
        self.work_log.push(format!(
            "Task (completed): {}\nNotes: {}\nFiles changed: {}",
            task.title,
            notes,
            changed_files.join(", "),
        ));
        Ok(())
    }

    fn process_failed(
        &mut self,
        task: &Task,
        reason: &str,
        phase: &str,
        credit_failure: bool,
        timings: &TaskTimings,
    ) {
        self.failed_count += 1;
        if credit_failure {
            self.credit_failed_tasks.insert(task.task_id);
        }
        self.record_task(
            TaskMetrics::failed(
                task.task_id.to_string(),
                task.title.clone(),
                timings.task_duration_ms,
                self.session.model.clone(),
                phase,
                reason.to_string(),
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
            ]),
        );
        self.work_log.push(format!("Task (failed): {}\nReason: {}", task.title, reason));
    }

    // ------------------------------------------------------------------
    // No-more-tasks / retry / credits-exhausted
    // ------------------------------------------------------------------

    pub fn try_retry_failed(&mut self, engine: &DevLoopEngine) -> Result<bool, EngineError> {
        let all_tasks = engine.store.list_tasks_by_project(&self.project_id)?;
        let retryable: Vec<&Task> = all_tasks
            .iter()
            .filter(|t| {
                t.status == TaskStatus::Failed
                    && !self.credit_failed_tasks.contains(&t.task_id)
                    && *self.task_retry_counts.get(&t.task_id).unwrap_or(&0)
                        < engine.engine_config.max_loop_task_retries
            })
            .collect();
        if retryable.is_empty() {
            return Ok(false);
        }
        for t in &retryable {
            let count = self.task_retry_counts.entry(t.task_id).or_insert(0);
            *count += 1;
            self.tasks_retried += 1;
            info!(task_id = %t.task_id, title = %t.title, attempt = *count, "resetting failed task for retry");
            if let Err(e) =
                engine
                    .task_service
                    .retry_task(&self.project_id, &t.spec_id, &t.task_id)
            {
                warn!(task_id = %t.task_id, error = %e, "retry_task failed, skipping");
                continue;
            }
            engine.emit(EngineEvent::TaskBecameReady {
                project_id: self.project_id,
                agent_instance_id: self.agent_instance_id,
                task_id: t.task_id,
            });
        }
        Ok(true)
    }

    pub fn handle_no_more_tasks(
        &mut self,
        engine: &DevLoopEngine,
    ) -> Result<LoopOutcome, EngineError> {
        let progress = engine.task_service.get_project_progress(&self.project_id)?;
        let outcome_str = if progress.blocked_tasks > 0 || progress.failed_tasks > 0 {
            "all_tasks_blocked"
        } else {
            "all_tasks_complete"
        };
        self.end_session(engine);
        engine.emit(self.build_finished_event(engine, outcome_str));
        self.flush_metrics(outcome_str);
        if outcome_str == "all_tasks_blocked" {
            Ok(LoopOutcome::AllTasksBlocked)
        } else {
            Ok(LoopOutcome::AllTasksComplete)
        }
    }

    pub fn handle_credits_exhausted(&mut self, engine: &DevLoopEngine) -> LoopOutcome {
        warn!("Credits exhausted, stopping engine loop");
        self.end_session(engine);
        engine.emit(self.build_finished_event(engine, "insufficient_credits"));
        self.flush_metrics("insufficient_credits");
        LoopOutcome::AllTasksBlocked
    }

    // ------------------------------------------------------------------
    // Session rollover
    // ------------------------------------------------------------------

    pub async fn try_session_rollover(
        &mut self,
        engine: &DevLoopEngine,
        stop_rx: &mut watch::Receiver<LoopCommand>,
    ) -> Result<Option<LoopOutcome>, EngineError> {
        let current_session = engine.session_service.get_session(
            &self.project_id,
            &self.agent_instance_id,
            &self.session.session_id,
        )?;
        if !engine.session_service.should_rollover(&current_session) {
            return Ok(None);
        }
        let project = engine.project_service.get_project(&self.project_id)?;
        let mut raw_log = self.work_log.join("\n\n---\n\n");
        const MAX_WORK_LOG_CHARS: usize = 20_000;
        if raw_log.len() > MAX_WORK_LOG_CHARS {
            raw_log.truncate(MAX_WORK_LOG_CHARS);
            raw_log.push_str("\n\n... (work log truncated) ...");
        }
        let history = format!(
            "Project: {}\nDescription: {}\n\nSession work log ({} tasks completed):\n\n{}",
            project.name, project.description, self.completed_count, raw_log,
        );
        let summary_start = Instant::now();
        let summary = tokio::select! {
            res = engine.session_service.generate_rollover_summary(
                &engine.llm, &self.api_key, &history,
            ) => { res? }
            _ = stop_rx.changed() => {
                self.finish_working(engine);
                return Ok(Some(self.stop_or_pause(engine, stop_rx)));
            }
        };
        let summary_duration_ms = summary_start.elapsed().as_millis() as u64;
        let context_usage_pct = current_session.context_usage_estimate * 100.0;
        let new_session = engine.session_service.rollover_session(
            &self.project_id,
            &self.agent_instance_id,
            &self.session.session_id,
            summary,
            None,
        )?;
        engine.emit(EngineEvent::SessionRolledOver {
            project_id: self.project_id,
            agent_instance_id: self.agent_instance_id,
            old_session_id: self.session.session_id,
            new_session_id: new_session.session_id,
            summary_duration_ms: Some(summary_duration_ms),
            context_usage_pct: Some(context_usage_pct),
        });
        self.sessions_used += 1;
        self.session = new_session;
        self.work_log.clear();
        Ok(None)
    }
}
