use std::collections::{HashMap, HashSet};
use std::time::Instant;

use tracing::{info, warn};

use aura_core::*;
use super::orchestrator::DevLoopEngine;
use super::types::*;
use crate::error::EngineError;
use crate::events::EngineEvent;
use crate::file_ops::{FileOp, WorkspaceCache};
use crate::metrics::{LoopRunMetrics, TaskMetrics};

pub(crate) struct LoopRunContext {
    pub project_id: ProjectId,
    pub agent_instance_id: AgentInstanceId,
    pub api_key: String,
    pub session: Session,
    pub sessions_used: usize,
    pub work_log: Vec<String>,
    pub completed_count: usize,
    pub(super) default_model: String,
    pub(crate) project_root: String,
    pub(super) loop_start: Instant,
    pub(super) failed_count: usize,
    follow_up_count: usize,
    task_retry_counts: HashMap<TaskId, u32>,
    credit_failed_tasks: HashSet<TaskId>,
    pub(super) total_input_tokens: u64,
    pub(super) total_output_tokens: u64,
    pub(super) tasks_retried: usize,
    pub(super) total_parse_retries: u32,
    pub(super) total_build_fix_attempts: u32,
    pub(super) duplicate_error_bailouts: u32,
    pub(super) run_metrics: LoopRunMetrics,
    pub(super) fee_schedule: Vec<FeeScheduleEntry>,
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
    // Task lifecycle
    // ------------------------------------------------------------------

    pub async fn begin_task(&self, engine: &DevLoopEngine, task: &Task) -> Result<(), EngineError> {
        info!(
            task_id = %task.task_id,
            title = %task.title,
            session_id = %self.session.session_id,
            "Beginning task execution"
        );
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

    async fn create_follow_up_tasks(
        &mut self,
        engine: &DevLoopEngine,
        task: &Task,
        follow_ups: &[FollowUpSuggestion],
    ) -> Result<(), EngineError> {
        for follow_up in follow_ups {
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
        Ok(())
    }

    async fn auto_commit_if_git(
        &self,
        engine: &DevLoopEngine,
        task: &Task,
        notes: &str,
    ) {
        let project = match engine.project_service.get_project_async(&self.project_id).await {
            Ok(p) => p,
            Err(_) => return,
        };
        if project.git_repo_url.is_none() || !crate::git_ops::is_git_repo(&self.project_root) {
            return;
        }
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

        self.create_follow_up_tasks(engine, task, follow_up_tasks).await?;

        let (touches_tests, touches_build_manifest) = check_baseline_invalidation(file_ops);
        if touches_tests {
            self.baseline_invalidated = true;
        }
        if touches_build_manifest {
            self.cached_build_baseline = None;
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

        self.auto_commit_if_git(engine, task, notes).await;
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
        let tasks = engine.task_service.list_tasks(&self.project_id).await?;
        let has_blocked_or_failed = tasks.iter().any(|t| {
            t.status == aura_core::TaskStatus::Blocked || t.status == aura_core::TaskStatus::Failed
        });
        let outcome_str = if has_blocked_or_failed {
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

}

fn check_baseline_invalidation(file_ops: &[FileOp]) -> (bool, bool) {
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
    let touches_build_manifest = changed_files.iter().any(|f| {
        f.ends_with("Cargo.toml")
            || f.ends_with("package.json")
            || f.ends_with("pyproject.toml")
    });
    (touches_tests, touches_build_manifest)
}

