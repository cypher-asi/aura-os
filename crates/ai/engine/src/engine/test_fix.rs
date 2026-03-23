use std::collections::HashSet;
use std::path::Path;
use std::time::Instant;

use tracing::{info, warn};

use aura_core::*;

use super::build_fix::{BuildFixAttemptRecord, BUILD_FIX_SNAPSHOT_BUDGET};
use super::orchestrator::DevLoopEngine;
use super::types::*;
use super::verify_fix_common::build_codebase_snapshot;
use crate::build_verify;
use crate::error::EngineError;
use crate::events::EngineEvent;
use crate::file_ops::{FileOp, WorkspaceCache};

impl DevLoopEngine {
    /// Run the test suite and return the names of currently-failing tests.
    ///
    /// Used before task execution to establish a baseline so that
    /// `verify_and_fix_build` can distinguish pre-existing failures from
    /// regressions introduced by the current task.
    pub(crate) async fn capture_test_baseline(&self, project: &Project) -> HashSet<String> {
        let test_command = match project
            .test_command
            .as_ref()
            .filter(|c| !c.trim().is_empty())
        {
            Some(cmd) => cmd,
            None => return HashSet::new(),
        };
        let base_path = Path::new(&project.linked_folder_path);
        match build_verify::run_build_command(base_path, test_command, None).await {
            Ok(result) => {
                let (tests, _) =
                    build_verify::parse_test_output(&result.stdout, &result.stderr, result.success);
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
        prior_test_attempts: &mut Vec<BuildFixAttemptRecord>,
        workspace_cache: &WorkspaceCache,
    ) -> Result<(bool, u64, u64), EngineError> {
        self.emit(EngineEvent::TestVerificationStarted {
            project_id: project.project_id,
            agent_instance_id: session.agent_instance_id,
            task_id: task.task_id,
            command: test_command.to_string(),
        });
        let test_start = Instant::now();
        let test_result = build_verify::run_build_command(base_path, test_command, None).await?;
        let dur = test_start.elapsed().as_millis() as u64;
        let (tests, summary) = build_verify::parse_test_output(
            &test_result.stdout,
            &test_result.stderr,
            test_result.success,
        );
        if test_result.success {
            self.record_test_passed(
                project,
                session,
                task,
                test_command,
                &test_result,
                &tests,
                &summary,
                dur,
                attempt,
            );
            return Ok((true, 0, 0));
        }
        if self.check_baseline_failures(
            project,
            session,
            task,
            test_command,
            &test_result,
            &tests,
            &summary,
            dur,
            attempt,
            baseline_test_failures,
        ) {
            return Ok((true, 0, 0));
        }
        self.record_test_failed(
            project,
            session,
            task,
            test_command,
            &test_result,
            &tests,
            &summary,
            dur,
            attempt,
        );
        let (response, inp, out) = self
            .request_test_fix(
                project,
                task,
                session,
                api_key,
                initial_execution,
                test_command,
                &test_result,
                prior_test_attempts,
                workspace_cache,
            )
            .await?;
        self.apply_fix_and_record(
            project,
            session,
            task,
            base_path,
            &response,
            attempt,
            &test_result.stderr,
            prior_test_attempts,
            all_fix_ops,
            "test-fix",
        )
        .await?;
        Ok((false, inp, out))
    }

    #[allow(clippy::too_many_arguments)]
    fn record_test_passed(
        &self,
        project: &Project,
        session: &Session,
        task: &Task,
        test_command: &str,
        result: &build_verify::BuildResult,
        tests: &[IndividualTestResult],
        summary: &str,
        duration_ms: u64,
        _attempt: u32,
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
    }

    #[allow(clippy::too_many_arguments)]
    fn check_baseline_failures(
        &self,
        project: &Project,
        session: &Session,
        task: &Task,
        test_command: &str,
        result: &build_verify::BuildResult,
        tests: &[IndividualTestResult],
        summary: &str,
        duration_ms: u64,
        _attempt: u32,
        baseline: &HashSet<String>,
    ) -> bool {
        if baseline.is_empty() {
            return false;
        }
        let current_failures: HashSet<String> = tests
            .iter()
            .filter(|t| t.status == "failed")
            .map(|t| t.name.clone())
            .collect();
        let new_failures: Vec<&String> = current_failures
            .iter()
            .filter(|name| !baseline.contains(*name))
            .collect();
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
        let adjusted = format!(
            "{summary} ({} pre-existing, ignored)",
            current_failures.len()
        );
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
        true
    }

    #[allow(clippy::too_many_arguments)]
    fn record_test_failed(
        &self,
        project: &Project,
        session: &Session,
        task: &Task,
        test_command: &str,
        result: &build_verify::BuildResult,
        tests: &[IndividualTestResult],
        summary: &str,
        duration_ms: u64,
        attempt: u32,
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
        self.emit(EngineEvent::TestFixAttempt {
            project_id: project.project_id,
            agent_instance_id: session.agent_instance_id,
            task_id: task.task_id,
            attempt,
        });
    }

    #[allow(clippy::too_many_arguments)]
    async fn request_test_fix(
        &self,
        project: &Project,
        task: &Task,
        session: &Session,
        api_key: &str,
        initial_execution: &TaskExecution,
        test_command: &str,
        test_result: &build_verify::BuildResult,
        prior_test_attempts: &[BuildFixAttemptRecord],
        workspace_cache: &WorkspaceCache,
    ) -> Result<(String, u64, u64), EngineError> {
        let codebase_snapshot = build_codebase_snapshot(
            &project.linked_folder_path,
            &task.title,
            &task.description,
            BUILD_FIX_SNAPSHOT_BUDGET,
            workspace_cache,
        )
        .await;

        self.request_fix(
            project,
            task,
            session,
            api_key,
            initial_execution,
            test_command,
            &test_result.stderr,
            &test_result.stdout,
            &codebase_snapshot,
            prior_test_attempts,
        )
        .await
    }
}
