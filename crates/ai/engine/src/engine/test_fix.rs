use std::collections::HashSet;
use std::path::Path;
use std::time::Instant;

use tracing::{info, warn};

use aura_core::*;
use aura_claude::StreamTokenCapture;

use super::build_fix::{normalize_error_signature, BuildFixAttemptRecord, BUILD_FIX_SNAPSHOT_BUDGET};
use super::orchestrator::DevLoopEngine;
use super::parser::parse_execution_response;
use super::prompts::{build_fix_system_prompt, build_fix_prompt_with_history};
use super::types::*;
use crate::build_verify;
use crate::error::EngineError;
use crate::events::EngineEvent;
use crate::file_ops::{self, FileOp, WorkspaceCache};

impl DevLoopEngine {
    pub(crate) fn persist_test_step(&self, task: &Task, step: TestStepRecord) {
        let _ = self.store.atomic_update_task(
            &task.project_id, &task.spec_id, &task.task_id,
            |t| { t.test_steps.push(step); },
        );
    }

    /// Run the test suite and return the names of currently-failing tests.
    ///
    /// Used before task execution to establish a baseline so that
    /// `verify_and_fix_build` can distinguish pre-existing failures from
    /// regressions introduced by the current task.
    pub(crate) async fn capture_test_baseline(&self, project: &Project) -> HashSet<String> {
        let test_command = match project.test_command.as_ref().filter(|c| !c.trim().is_empty()) {
            Some(cmd) => cmd,
            None => return HashSet::new(),
        };
        let base_path = Path::new(&project.linked_folder_path);
        match build_verify::run_build_command(base_path, test_command, None).await {
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

    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn run_and_handle_tests(
        &self, project: &Project, task: &Task, session: &Session,
        api_key: &str, initial_execution: &TaskExecution,
        test_command: &str, base_path: &Path, attempt: u32,
        all_fix_ops: &mut Vec<FileOp>,
        baseline_test_failures: &HashSet<String>,
        prior_test_attempts: &mut Vec<BuildFixAttemptRecord>,
        workspace_cache: &WorkspaceCache,
    ) -> Result<(bool, u64, u64), EngineError> {
        self.emit(EngineEvent::TestVerificationStarted {
            project_id: project.project_id,
            agent_instance_id: session.agent_instance_id,
            task_id: task.task_id,
            command: test_command.to_string(),
        });
        self.persist_test_step(task, TestStepRecord {
            kind: "started".into(),
            command: Some(test_command.to_string()),
            stderr: None, stdout: None,
            attempt: Some(attempt),
            tests: vec![], summary: None,
        });
        let test_start = Instant::now();
        let test_result = build_verify::run_build_command(base_path, test_command, None).await?;
        let dur = test_start.elapsed().as_millis() as u64;
        let (tests, summary) = build_verify::parse_test_output(
            &test_result.stdout, &test_result.stderr, test_result.success,
        );
        if test_result.success {
            self.record_test_passed(
                project, session, task, test_command, &test_result, &tests, &summary, dur, attempt);
            return Ok((true, 0, 0));
        }
        if self.check_baseline_failures(
            project, session, task, test_command, &test_result,
            &tests, &summary, dur, attempt, baseline_test_failures,
        ) {
            return Ok((true, 0, 0));
        }
        self.record_test_failed(
            project, session, task, test_command, &test_result, &tests, &summary, dur, attempt);
        let (response, inp, out) = self.request_test_fix(
            project, task, session, api_key, initial_execution,
            test_command, &test_result, prior_test_attempts, workspace_cache,
        ).await?;
        self.apply_test_fix_response(
            task, base_path, project, session, &response,
            attempt, all_fix_ops, &test_result, prior_test_attempts,
        ).await?;
        Ok((false, inp, out))
    }

    #[allow(clippy::too_many_arguments)]
    fn record_test_passed(
        &self, project: &Project, session: &Session, task: &Task,
        test_command: &str, result: &build_verify::BuildResult,
        tests: &[IndividualTestResult], summary: &str, duration_ms: u64, attempt: u32,
    ) {
        self.emit(EngineEvent::TestVerificationPassed {
            project_id: project.project_id,
            agent_instance_id: session.agent_instance_id,
            task_id: task.task_id,
            command: test_command.to_string(),
            stdout: result.stdout.clone(),
            tests: tests.to_vec(),
            summary: summary.to_string(),
            duration_ms: Some(duration_ms),
        });
        self.persist_test_step(task, TestStepRecord {
            kind: "passed".into(),
            command: Some(test_command.to_string()),
            stderr: None,
            stdout: Some(result.stdout.clone()),
            attempt: Some(attempt),
            tests: tests.to_vec(),
            summary: Some(summary.to_string()),
        });
    }

    #[allow(clippy::too_many_arguments)]
    fn check_baseline_failures(
        &self, project: &Project, session: &Session, task: &Task,
        test_command: &str, result: &build_verify::BuildResult,
        tests: &[IndividualTestResult], summary: &str, duration_ms: u64,
        attempt: u32, baseline: &HashSet<String>,
    ) -> bool {
        if baseline.is_empty() { return false; }
        let current_failures: HashSet<String> = tests.iter()
            .filter(|t| t.status == "failed").map(|t| t.name.clone()).collect();
        let new_failures: Vec<&String> = current_failures.iter()
            .filter(|name| !baseline.contains(*name)).collect();
        if !new_failures.is_empty() {
            info!(
                task_id = %task.task_id, new_failures = ?new_failures,
                pre_existing = current_failures.len() - new_failures.len(),
                "found {} new test failure(s) beyond baseline", new_failures.len()
            );
            return false;
        }
        info!(
            task_id = %task.task_id, pre_existing = current_failures.len(),
            "all test failures are pre-existing (baseline), treating as passed"
        );
        let adjusted = format!("{summary} ({} pre-existing, ignored)", current_failures.len());
        self.emit(EngineEvent::TestVerificationPassed {
            project_id: project.project_id,
            agent_instance_id: session.agent_instance_id,
            task_id: task.task_id,
            command: test_command.to_string(),
            stdout: result.stdout.clone(),
            tests: tests.to_vec(),
            summary: adjusted.clone(),
            duration_ms: Some(duration_ms),
        });
        self.persist_test_step(task, TestStepRecord {
            kind: "passed_with_baseline_failures".into(),
            command: Some(test_command.to_string()),
            stderr: Some(result.stderr.clone()),
            stdout: Some(result.stdout.clone()),
            attempt: Some(attempt),
            tests: tests.to_vec(),
            summary: Some(adjusted),
        });
        true
    }

    #[allow(clippy::too_many_arguments)]
    fn record_test_failed(
        &self, project: &Project, session: &Session, task: &Task,
        test_command: &str, result: &build_verify::BuildResult,
        tests: &[IndividualTestResult], summary: &str, duration_ms: u64, attempt: u32,
    ) {
        self.emit(EngineEvent::TestVerificationFailed {
            project_id: project.project_id,
            agent_instance_id: session.agent_instance_id,
            task_id: task.task_id,
            command: test_command.to_string(),
            stdout: result.stdout.clone(),
            stderr: result.stderr.clone(),
            attempt,
            tests: tests.to_vec(),
            summary: summary.to_string(),
            duration_ms: Some(duration_ms),
        });
        self.persist_test_step(task, TestStepRecord {
            kind: "failed".into(),
            command: Some(test_command.to_string()),
            stderr: Some(result.stderr.clone()),
            stdout: Some(result.stdout.clone()),
            attempt: Some(attempt),
            tests: tests.to_vec(),
            summary: Some(summary.to_string()),
        });
        self.emit(EngineEvent::TestFixAttempt {
            project_id: project.project_id,
            agent_instance_id: session.agent_instance_id,
            task_id: task.task_id,
            attempt,
        });
        self.persist_test_step(task, TestStepRecord {
            kind: "fix_attempt".into(),
            command: None, stderr: None, stdout: None,
            attempt: Some(attempt),
            tests: vec![], summary: None,
        });
    }

    async fn request_test_fix(
        &self, project: &Project, task: &Task, session: &Session,
        api_key: &str, initial_execution: &TaskExecution,
        test_command: &str, test_result: &build_verify::BuildResult,
        prior_test_attempts: &[BuildFixAttemptRecord],
        workspace_cache: &WorkspaceCache,
    ) -> Result<(String, u64, u64), EngineError> {
        let spec = self.store.get_spec(&task.project_id, &task.spec_id)?;
        let codebase_snapshot = file_ops::retrieve_task_relevant_files_cached(
            &project.linked_folder_path, &task.title, &task.description,
            BUILD_FIX_SNAPSHOT_BUDGET, workspace_cache,
        ).unwrap_or_else(|_| {
            file_ops::read_relevant_files(&project.linked_folder_path, BUILD_FIX_SNAPSHOT_BUDGET)
                .unwrap_or_default()
        });
        let fix_prompt = build_fix_prompt_with_history(
            project, &spec, task, session, &codebase_snapshot,
            test_command, &test_result.stderr, &test_result.stdout,
            &initial_execution.notes, prior_test_attempts,
        );
        let (tx, handle) = StreamTokenCapture::sink();
        let response = self
            .llm
            .complete_stream(
                api_key, &build_fix_system_prompt(), &fix_prompt,
                self.llm_config.task_execution_max_tokens,
                tx, "aura_build_fix", None,
            )
            .await?;
        let (inp, out, _, _) = handle.finalize().await;
        Ok((response, inp, out))
    }

    #[allow(clippy::too_many_arguments)]
    async fn apply_test_fix_response(
        &self, task: &Task, base_path: &Path,
        project: &Project, session: &Session, response: &str,
        attempt: u32, all_fix_ops: &mut Vec<FileOp>,
        test_result: &build_verify::BuildResult,
        prior_test_attempts: &mut Vec<BuildFixAttemptRecord>,
    ) -> Result<(), EngineError> {
        match parse_execution_response(response) {
            Ok(fix_execution) => {
                file_ops::apply_file_ops(base_path, &fix_execution.file_ops).await?;
                if !fix_execution.file_ops.is_empty() {
                    self.emit_file_ops_applied(
                        project.project_id, session.agent_instance_id,
                        task, &fix_execution.file_ops,
                    );
                }
                let attempt_files: Vec<String> = fix_execution.file_ops.iter().map(|op| {
                    let (op_name, path) = match op {
                        FileOp::Create { path, .. } => ("create", path.as_str()),
                        FileOp::Modify { path, .. } => ("modify", path.as_str()),
                        FileOp::Delete { path } => ("delete", path.as_str()),
                        FileOp::SearchReplace { path, .. } => ("search_replace", path.as_str()),
                    };
                    format!("{op_name} {path}")
                }).collect();
                let sig = normalize_error_signature(&test_result.stderr);
                prior_test_attempts.push(BuildFixAttemptRecord {
                    stderr: test_result.stderr.clone(),
                    error_signature: sig,
                    files_changed: attempt_files,
                });
                all_fix_ops.extend(fix_execution.file_ops);
            }
            Err(e) => {
                warn!(
                    task_id = %task.task_id, attempt, error = %e,
                    "failed to parse test-fix response"
                );
            }
        }
        Ok(())
    }
}
