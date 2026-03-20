use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::Instant;

use tokio::sync::watch;
use tracing::{info, warn};

use aura_core::*;
use super::orchestrator::DevLoopEngine;
use super::types::*;
use crate::error::EngineError;
use crate::events::EngineEvent;
use crate::file_ops::{FileOp, WorkspaceCache};
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
    pub workspace_cache: WorkspaceCache,
    cached_test_baseline: Option<HashSet<String>>,
    cached_build_baseline: Option<HashSet<String>>,
    baseline_invalidated: bool,
}

impl LoopRunContext {
    pub async fn new(
        engine: &DevLoopEngine,
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        session: Session,
    ) -> Result<Self, EngineError> {
        let api_key = engine.settings.get_decrypted_api_key()?;
        let project_root = engine
            .project_service
            .get_project_async(&project_id)
            .await?
            .linked_folder_path
            .clone();
        let workspace_cache = WorkspaceCache::build_async(&project_root).await?;
        let run_metrics = LoopRunMetrics::new(project_id.to_string());
        let fee_schedule = engine.pricing_service.get_fee_schedule();
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
            workspace_cache,
            cached_test_baseline: None,
            cached_build_baseline: None,
            baseline_invalidated: false,
        })
    }

    // ------------------------------------------------------------------
    // Test baseline caching
    // ------------------------------------------------------------------

    pub async fn get_or_capture_test_baseline(
        &mut self,
        engine: &DevLoopEngine,
        project: &Project,
    ) -> HashSet<String> {
        if let Some(ref baseline) = self.cached_test_baseline {
            if !self.baseline_invalidated {
                return baseline.clone();
            }
        }
        let baseline = engine.capture_test_baseline(project).await;
        self.cached_test_baseline = Some(baseline.clone());
        self.baseline_invalidated = false;
        baseline
    }

    // ------------------------------------------------------------------
    // Build baseline caching
    // ------------------------------------------------------------------

    pub async fn get_or_capture_build_baseline(
        &mut self,
        engine: &DevLoopEngine,
        project: &Project,
    ) -> HashSet<String> {
        if let Some(ref baseline) = self.cached_build_baseline {
            if !self.baseline_invalidated {
                return baseline.clone();
            }
        }
        let baseline = engine.capture_build_baseline(project).await;
        self.cached_build_baseline = Some(baseline.clone());
        baseline
    }

    // ------------------------------------------------------------------
    // Bootstrap
    // ------------------------------------------------------------------

    pub async fn reset_and_promote_tasks(&self, engine: &DevLoopEngine) -> Result<(), EngineError> {
        for t in &engine.task_service.reset_in_progress_tasks(&self.project_id).await? {
            engine.emit(EngineEvent::TaskBecameReady {
                project_id: self.project_id,
                agent_instance_id: self.agent_instance_id,
                task_id: t.task_id,
            });
        }
        for t in &engine.task_service.resolve_initial_readiness(&self.project_id).await? {
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

    async fn end_session(&self, engine: &DevLoopEngine) {
        if let Err(e) = engine.session_service.end_session(
            &self.project_id,
            &self.agent_instance_id,
            &self.session.session_id,
            SessionStatus::Completed,
        ).await {
            warn!(error = %e, "failed to end session");
        }
    }

    async fn finish_working(&self, engine: &DevLoopEngine) {
        if let Err(e) = engine
            .agent_instance_service
            .finish_working(&self.project_id, &self.agent_instance_id)
            .await
        {
            warn!(error = %e, "failed to finish_working");
        }
    }

    async fn handle_pause(&mut self, engine: &DevLoopEngine) -> LoopOutcome {
        self.end_session(engine).await;
        engine.emit(EngineEvent::LoopPaused {
            project_id: self.project_id,
            agent_instance_id: self.agent_instance_id,
            completed_count: self.completed_count,
        });
        self.flush_metrics("paused");
        LoopOutcome::Paused { completed_count: self.completed_count }
    }

    async fn handle_stop(&mut self, engine: &DevLoopEngine) -> LoopOutcome {
        self.end_session(engine).await;
        engine.emit(EngineEvent::LoopStopped {
            project_id: self.project_id,
            agent_instance_id: self.agent_instance_id,
            completed_count: self.completed_count,
        });
        self.flush_metrics("stopped");
        LoopOutcome::Stopped { completed_count: self.completed_count }
    }

    async fn stop_or_pause(
        &mut self,
        engine: &DevLoopEngine,
        stop_rx: &watch::Receiver<LoopCommand>,
    ) -> LoopOutcome {
        let cmd = *stop_rx.borrow();
        match cmd {
            LoopCommand::Stop => self.handle_stop(engine).await,
            _ => self.handle_pause(engine).await,
        }
    }

    pub async fn check_command(
        &mut self,
        engine: &DevLoopEngine,
        stop_rx: &watch::Receiver<LoopCommand>,
    ) -> Option<LoopOutcome> {
        let cmd = *stop_rx.borrow();
        match cmd {
            LoopCommand::Pause => {
                self.finish_working(engine).await;
                Some(self.handle_pause(engine).await)
            }
            LoopCommand::Stop => {
                self.finish_working(engine).await;
                Some(self.handle_stop(engine).await)
            }
            LoopCommand::Continue => None,
        }
    }

    pub async fn handle_interruption(
        &mut self,
        engine: &DevLoopEngine,
        task: &Task,
        stop_rx: &watch::Receiver<LoopCommand>,
    ) -> LoopOutcome {
        if let Err(e) =
            engine
                .task_service
                .reset_task_to_ready(&self.project_id, &task.spec_id, &task.task_id)
                .await
        {
            warn!(error = %e, "failed to reset task to ready after interruption");
        }
        engine.emit(EngineEvent::TaskBecameReady {
            project_id: self.project_id,
            agent_instance_id: self.agent_instance_id,
            task_id: task.task_id,
        });
        self.finish_working(engine).await;
        self.stop_or_pause(engine, stop_rx).await
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
        let total_cost_usd = Some(engine.pricing_service.compute_cost(
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

    pub async fn begin_task(&self, engine: &DevLoopEngine, task: &Task) -> Result<(), EngineError> {
        engine.session_service.record_task_worked(
            &self.project_id,
            &self.agent_instance_id,
            &self.session.session_id,
            task.task_id,
        ).await?;
        engine.agent_instance_service.start_working(
            &self.project_id,
            &self.agent_instance_id,
            &task.task_id,
            &self.session.session_id,
        ).await?;
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

    pub async fn process_outcome(
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
        let task_metrics = TaskMetrics::from_outcome(
            task.task_id.to_string(), task.title.clone(),
            self.session.model.clone(), &outcome,
        );
        match outcome {
            TaskOutcome::Completed { notes, follow_up_tasks, file_ops, .. } => {
                self.process_completed(engine, task, &notes, &follow_up_tasks, &file_ops, task_metrics).await?;
                Ok(false)
            }
            TaskOutcome::Failed { reason, credit_failure, .. } => {
                self.process_failed(task, &reason, credit_failure, task_metrics);
                Ok(true)
            }
        }
    }

    async fn process_completed(
        &mut self,
        engine: &DevLoopEngine,
        task: &Task,
        notes: &str,
        follow_up_tasks: &[FollowUpSuggestion],
        file_ops: &[FileOp],
        task_metrics: TaskMetrics,
    ) -> Result<(), EngineError> {
        self.completed_count += 1;
        engine.emit(EngineEvent::LoopIterationSummary {
            project_id: self.project_id,
            agent_instance_id: self.agent_instance_id,
            task_id: task.task_id,
            phase_timings: task_metrics.phase_timings.clone(),
        });
        self.record_task(task_metrics);
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
            ).await {
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
        let touches_tests = changed_files.iter().any(|f| {
            f.contains("_test.rs")
                || f.contains("_spec.ts")
                || f.contains("test_")
                || f.contains("tests/")
                || f.contains("tests\\")
        });
        if touches_tests {
            self.baseline_invalidated = true;
        }
        let touches_build_manifest = changed_files.iter().any(|f| {
            f.ends_with("Cargo.toml")
                || f.ends_with("package.json")
                || f.ends_with("pyproject.toml")
        });
        if touches_build_manifest {
            self.cached_build_baseline = None;
        }
        self.work_log.push(format!(
            "Task (completed): {}\nNotes: {}\nFiles changed: {}",
            task.title,
            notes,
            changed_files.join(", "),
        ));

        if let Ok(project) = engine.project_service.get_project_async(&self.project_id).await {
            if project.git_repo_url.is_some() && crate::git_ops::is_git_repo(&self.project_root) {
                let commit_msg = format!("Task: {}\n\n{}", task.title, notes);
                match crate::git_ops::git_commit(&self.project_root, &commit_msg).await {
                    Ok(Some(sha)) => {
                        engine.emit(EngineEvent::GitCommitted {
                            project_id: self.project_id,
                            agent_instance_id: self.agent_instance_id,
                            task_id: task.task_id,
                            commit_sha: sha,
                            message: commit_msg,
                        });
                    }
                    Ok(None) => {
                        info!("no changes to commit after task completion");
                    }
                    Err(e) => {
                        warn!(error = %e, "git commit after task completion failed");
                    }
                }
            }
        }

        Ok(())
    }

    fn process_failed(
        &mut self,
        task: &Task,
        reason: &str,
        credit_failure: bool,
        task_metrics: TaskMetrics,
    ) {
        self.failed_count += 1;
        if credit_failure {
            self.credit_failed_tasks.insert(task.task_id);
        }
        self.record_task(task_metrics);
        self.work_log.push(format!("Task (failed): {}\nReason: {}", task.title, reason));
    }

    // ------------------------------------------------------------------
    // No-more-tasks / retry / credits-exhausted
    // ------------------------------------------------------------------

    pub async fn try_retry_failed(&mut self, engine: &DevLoopEngine) -> Result<bool, EngineError> {
        let all_tasks = engine.task_service.list_tasks(&self.project_id).await?;
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
                    .await
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

    pub async fn handle_no_more_tasks(
        &mut self,
        engine: &DevLoopEngine,
    ) -> Result<LoopOutcome, EngineError> {
        let progress = engine.task_service.get_project_progress(&self.project_id).await?;
        let outcome_str = if progress.blocked_tasks > 0 || progress.failed_tasks > 0 {
            "all_tasks_blocked"
        } else {
            "all_tasks_complete"
        };
        self.end_session(engine).await;
        engine.emit(self.build_finished_event(engine, outcome_str));
        self.flush_metrics(outcome_str);
        if outcome_str == "all_tasks_blocked" {
            Ok(LoopOutcome::AllTasksBlocked)
        } else {
            Ok(LoopOutcome::AllTasksComplete)
        }
    }

    pub async fn handle_credits_exhausted(&mut self, engine: &DevLoopEngine) -> LoopOutcome {
        warn!("Credits exhausted, stopping engine loop");
        self.end_session(engine).await;
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
        ).await?;
        if !engine.session_service.should_rollover(&current_session) {
            return Ok(None);
        }
        let project = engine.project_service.get_project_async(&self.project_id).await?;
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
                self.finish_working(engine).await;
                return Ok(Some(self.stop_or_pause(engine, stop_rx).await));
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
        ).await?;
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
