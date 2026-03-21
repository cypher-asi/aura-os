use std::collections::HashSet;
use std::path::Path;
use std::time::Instant;

use tracing::{info, warn};

use aura_core::*;

pub(crate) use super::build_fix_types::{
    BuildFixAttemptRecord, ErrorCategory,
    classify_build_errors, error_category_guidance, parse_error_references,
};
pub(crate) use super::error_signatures::{
    normalize_error_signature, parse_individual_error_signatures,
};

use super::orchestrator::DevLoopEngine;
use super::types::*;
use super::verify_fix_common::build_codebase_snapshot;
use crate::build_verify;
use crate::channel_ext::send_or_log;
use crate::error::EngineError;
use crate::events::EngineEvent;
use crate::file_ops::{self, FileOp, WorkspaceCache};

pub(crate) const BUILD_FIX_SNAPSHOT_BUDGET: usize = 30_000;

pub(crate) struct BuildVerifyParams<'a> {
    pub project: &'a Project,
    pub task: &'a Task,
    pub session: &'a Session,
    pub api_key: &'a str,
    pub initial_execution: &'a TaskExecution,
    pub baseline_test_failures: &'a HashSet<String>,
    pub baseline_build_errors: &'a HashSet<String>,
    pub workspace_cache: &'a WorkspaceCache,
}

pub(crate) struct FileSnapshot {
    pub path: String,
    pub content: Option<String>,
}

pub(crate) fn snapshot_modified_files(
    project_root: &Path,
    file_ops: &[FileOp],
) -> Vec<FileSnapshot> {
    let mut seen = std::collections::HashSet::new();
    let mut snapshots = Vec::new();
    for op in file_ops {
        let path = match op {
            FileOp::Create { path, .. } => path,
            FileOp::Modify { path, .. } => path,
            FileOp::SearchReplace { path, .. } => path,
            FileOp::Delete { path } => path,
        };
        if !seen.insert(path.clone()) {
            continue;
        }
        let full_path = project_root.join(path);
        let content = std::fs::read_to_string(&full_path).ok();
        snapshots.push(FileSnapshot {
            path: path.clone(),
            content,
        });
    }
    snapshots
}

pub(crate) async fn rollback_to_snapshot(
    project_root: &Path,
    snapshots: &[FileSnapshot],
) {
    for snap in snapshots {
        let full_path = project_root.join(&snap.path);
        match &snap.content {
            Some(content) => {
                if let Err(e) = tokio::fs::write(&full_path, content).await {
                    warn!(path = %snap.path, error = %e, "failed to rollback file");
                }
            }
            None => {
                if let Err(e) = tokio::fs::remove_file(&full_path).await {
                    if e.kind() != std::io::ErrorKind::NotFound {
                        warn!(path = %snap.path, error = %e, "failed to delete file during rollback");
                    }
                }
            }
        }
    }
}

/// Rewrite known server-starting commands to their build/check equivalents.
///
/// When a build command times out, it's usually because the command starts a
/// long-running process. This function maps common run commands to their
/// compile-only counterparts.
pub(crate) fn auto_correct_build_command(cmd: &str) -> Option<String> {
    let trimmed = cmd.trim();
    if trimmed == "cargo run" || trimmed.starts_with("cargo run ") {
        let mut corrected = trimmed.replacen("cargo run", "cargo build", 1);
        if let Some(idx) = corrected.find(" -- ") {
            corrected.truncate(idx);
        } else if corrected.ends_with(" --") {
            corrected.truncate(corrected.len() - 3);
        }
        return Some(corrected);
    }
    if trimmed == "npm start" {
        return Some("npm run build".to_string());
    }
    if trimmed.contains("runserver") {
        return Some(trimmed.replace("runserver", "check"));
    }
    None
}

pub(crate) fn infer_default_build_command(project_root: &Path) -> Option<String> {
    if project_root.join("Cargo.toml").is_file() {
        return Some("cargo check --workspace --tests".to_string());
    }
    if project_root.join("package.json").is_file() {
        return Some("npm run build --if-present".to_string());
    }
    if project_root.join("pyproject.toml").is_file() || project_root.join("requirements.txt").is_file() {
        return Some("python -m compileall .".to_string());
    }
    None
}

/// Build a codebase snapshot for a build-fix prompt by reading error source
/// files fresh from disk and optionally supplementing with workspace context.
async fn build_fix_snapshot(
    project: &Project, build_stderr: &str, task: &Task,
    workspace_cache: &WorkspaceCache,
) -> String {
    let error_refs = parse_error_references(build_stderr);
    let fresh_error_files = file_ops::resolve_error_source_files(
        Path::new(&project.linked_folder_path),
        &error_refs,
        BUILD_FIX_SNAPSHOT_BUDGET,
    );

    if !fresh_error_files.is_empty() {
        let remaining_budget = BUILD_FIX_SNAPSHOT_BUDGET.saturating_sub(fresh_error_files.len());
        let supplemental = if remaining_budget > 2_000 {
            build_codebase_snapshot(
                &project.linked_folder_path, &task.title, &task.description,
                remaining_budget, workspace_cache,
            ).await
        } else {
            String::new()
        };
        if supplemental.is_empty() {
            fresh_error_files
        } else {
            format!("{fresh_error_files}\n{supplemental}")
        }
    } else {
        build_codebase_snapshot(
            &project.linked_folder_path, &task.title, &task.description,
            BUILD_FIX_SNAPSHOT_BUDGET, workspace_cache,
        ).await
    }
}

/// Returns true if all current errors are pre-existing (present in baseline).
fn all_errors_in_baseline(baseline: &HashSet<String>, stderr: &str) -> bool {
    if baseline.is_empty() {
        return false;
    }
    let current_errors = parse_individual_error_signatures(stderr);
    if current_errors.is_empty() {
        return false;
    }
    let new_errors: HashSet<_> = current_errors.difference(baseline).cloned().collect();
    if new_errors.is_empty() {
        info!(
            pre_existing = current_errors.len(),
            "all build errors are pre-existing (baseline), treating as passed"
        );
        return true;
    }
    false
}

impl DevLoopEngine {
    /// Run the build command once and return the set of pre-existing error
    /// signatures. Mirrors `capture_test_baseline` for build errors.
    pub(crate) async fn capture_build_baseline(&self, project: &Project) -> HashSet<String> {
        let project_root = Path::new(&project.linked_folder_path);
        let build_cmd = match &project.build_command {
            Some(cmd) if !cmd.trim().is_empty() => cmd.clone(),
            _ => match infer_default_build_command(project_root) {
                Some(cmd) => cmd,
                None => return HashSet::new(),
            },
        };
        match build_verify::run_build_command(project_root, &build_cmd, None).await {
            Ok(result) if !result.success => {
                let errors = parse_individual_error_signatures(&result.stderr);
                if !errors.is_empty() {
                    info!(
                        count = errors.len(),
                        "captured {} pre-existing build error(s) as baseline",
                        errors.len()
                    );
                }
                errors
            }
            _ => HashSet::new(),
        }
    }

    async fn resolve_build_command(
        &self, project: &Project, session: &Session, task: &Task,
    ) -> Option<String> {
        let project_root = Path::new(&project.linked_folder_path);
        let cmd = match &project.build_command {
            Some(cmd) if !cmd.trim().is_empty() => cmd.clone(),
            _ => {
                if let Some(fallback) = infer_default_build_command(project_root) {
                    info!(
                        command = %fallback,
                        "build_command missing; using inferred safe default for verification"
                    );
                    return Some(fallback);
                }
                self.emit(EngineEvent::BuildVerificationSkipped {
                    project_id: project.project_id,
                    agent_instance_id: session.agent_instance_id,
                    task_id: task.task_id,
                    reason: "no build_command configured on project".into(),
                });
                return None;
            }
        };
        let mut build_command = cmd;
        if let Some(corrected) = auto_correct_build_command(&build_command) {
            warn!(
                old = %build_command, new = %corrected,
                "eagerly rewriting server-starting build command"
            );
            if let Err(e) = self.project_service.update_project_async(
                &project.project_id,
                aura_projects::UpdateProjectInput {
                    build_command: Some(corrected.clone()),
                    ..Default::default()
                },
            ).await {
                warn!(project_id = %project.project_id, error = %e, "failed to persist auto-corrected build command");
            }
            build_command = corrected;
        }
        Some(build_command)
    }

    async fn run_build_with_streaming(
        &self, project: &Project, session: &Session, task: &Task,
        base_path: &Path, build_command: &str, _attempt: u32,
    ) -> Result<(build_verify::BuildResult, u64), EngineError> {
        let build_step_start = Instant::now();
        self.emit(EngineEvent::BuildVerificationStarted {
            project_id: project.project_id,
            agent_instance_id: session.agent_instance_id,
            task_id: task.task_id,
            command: build_command.to_string(),
        });
        let (line_tx, mut line_rx) = tokio::sync::mpsc::unbounded_channel();
        let fwd_event_tx = self.event_tx.clone();
        let fwd_pid = project.project_id;
        let fwd_aiid = session.agent_instance_id;
        let fwd_tid = task.task_id;
        tokio::spawn(async move {
            while let Some(line) = line_rx.recv().await {
                send_or_log(&fwd_event_tx, EngineEvent::TaskOutputDelta {
                    project_id: fwd_pid,
                    agent_instance_id: fwd_aiid,
                    task_id: fwd_tid,
                    delta: line,
                });
            }
        });
        let build_result = build_verify::run_build_command(
            base_path, build_command, Some(line_tx),
        ).await?;
        let step_duration_ms = build_step_start.elapsed().as_millis() as u64;
        Ok((build_result, step_duration_ms))
    }

    async fn try_auto_correct_timeout(
        &self, project: &Project, build_command: &str,
    ) -> Option<String> {
        let corrected = auto_correct_build_command(build_command)?;
        warn!(
            old = %build_command, new = %corrected,
            "build command timed out, auto-correcting"
        );
        if let Err(e) = self.project_service.update_project_async(
            &project.project_id,
            aura_projects::UpdateProjectInput {
                build_command: Some(corrected.clone()),
                ..Default::default()
            },
        ).await {
            warn!(project_id = %project.project_id, error = %e, "failed to persist timeout-corrected build command");
        }
        Some(corrected)
    }

    fn record_build_passed(
        &self, project: &Project, session: &Session, task: &Task,
        build_command: &str, stdout: &str, duration_ms: u64, _attempt: u32,
    ) {
        self.emit(EngineEvent::BuildVerificationPassed {
            project_id: project.project_id,
            agent_instance_id: session.agent_instance_id,
            task_id: task.task_id,
            command: build_command.to_string(),
            stdout: stdout.to_string(),
            duration_ms: Some(duration_ms),
        });
    }

    #[allow(clippy::too_many_arguments)]
    fn record_build_failed(
        &self, project: &Project, session: &Session, task: &Task,
        build_command: &str, stdout: &str, stderr: &str,
        duration_ms: u64, attempt: u32,
    ) {
        let error_hash = Some(format!("{:x}", {
            let mut h = 0u64;
            for b in stderr.bytes() { h = h.wrapping_mul(31).wrapping_add(b as u64); }
            h
        }));
        self.emit(EngineEvent::BuildVerificationFailed {
            project_id: project.project_id,
            agent_instance_id: session.agent_instance_id,
            task_id: task.task_id,
            command: build_command.to_string(),
            stdout: stdout.to_string(),
            stderr: stderr.to_string(),
            attempt,
            duration_ms: Some(duration_ms),
            error_hash,
        });
    }

    fn check_error_stagnation(
        &self, task: &Task, stderr: &str,
        prior_attempts: &[BuildFixAttemptRecord], attempt: u32,
    ) -> bool {
        let current_signature = normalize_error_signature(stderr);
        let consecutive_dupes = prior_attempts
            .iter()
            .rev()
            .take_while(|a| a.error_signature == current_signature)
            .count();
        if consecutive_dupes >= 2 {
            info!(
                task_id = %task.task_id, attempt,
                "same error pattern repeated {} times (after normalizing line numbers), aborting fix loop",
                consecutive_dupes + 1
            );
            return true;
        }
        false
    }

    async fn request_build_fix(
        &self, params: &BuildVerifyParams<'_>,
        build_command: &str, build_stderr: &str, build_stdout: &str,
        prior_attempts: &[BuildFixAttemptRecord], attempt: u32,
    ) -> Result<(String, u64, u64), EngineError> {
        self.emit(EngineEvent::BuildFixAttempt {
            project_id: params.project.project_id,
            agent_instance_id: params.session.agent_instance_id,
            task_id: params.task.task_id,
            attempt,
        });

        let codebase_snapshot = build_fix_snapshot(
            params.project, build_stderr, params.task, params.workspace_cache,
        ).await;

        self.request_fix(
            params.project, params.task, params.session, params.api_key,
            params.initial_execution, build_command, build_stderr, build_stdout,
            &codebase_snapshot, prior_attempts,
        ).await
    }

    async fn handle_build_success(
        &self, params: &BuildVerifyParams<'_>,
        build_command: &str, stdout: &str, duration_ms: u64,
        attempt: u32, test_command: &Option<String>,
        base_path: &Path, all_fix_ops: &mut Vec<FileOp>,
        prior_test_attempts: &mut Vec<BuildFixAttemptRecord>,
    ) -> Result<(bool, u64, u64), EngineError> {
        self.record_build_passed(
            params.project, params.session, params.task,
            build_command, stdout, duration_ms, attempt,
        );
        match test_command.as_deref() {
            Some(test_cmd) => {
                self.run_and_handle_tests(
                    params.project, params.task, params.session, params.api_key,
                    params.initial_execution, test_cmd, base_path, attempt,
                    all_fix_ops, params.baseline_test_failures,
                    prior_test_attempts, params.workspace_cache,
                ).await
            }
            None => Ok((true, 0, 0)),
        }
    }

    async fn attempt_build_fix(
        &self, params: &BuildVerifyParams<'_>,
        build_command: &str, build_result: &build_verify::BuildResult,
        base_path: &Path, prior_attempts: &mut Vec<BuildFixAttemptRecord>,
        all_fix_ops: &mut Vec<FileOp>, attempt: u32,
    ) -> Result<(u64, u64), EngineError> {
        let (response, inp, out) = self.request_build_fix(
            params, build_command, &build_result.stderr, &build_result.stdout,
            prior_attempts, attempt,
        ).await?;
        self.apply_fix_and_record(
            params.project, params.session, params.task, base_path, &response,
            attempt, &build_result.stderr, prior_attempts, all_fix_ops, "build-fix",
        ).await?;
        Ok((inp, out))
    }

    /// Returns (fix_ops, build_passed, attempts_used, duplicate_bailouts, fix_input_tokens, fix_output_tokens, last_stderr).
    pub(crate) async fn verify_and_fix_build(
        &self, params: &BuildVerifyParams<'_>,
    ) -> Result<(Vec<FileOp>, bool, u32, u32, u64, u64, String), EngineError> {
        let BuildVerifyParams {
            project, task, session, api_key, initial_execution,
            baseline_test_failures, baseline_build_errors, workspace_cache,
        } = params;
        let mut build_cmd = match self.resolve_build_command(project, session, task).await {
            Some(cmd) => cmd,
            None => return Ok((vec![], true, 0, 0, 0, 0, String::new())),
        };
        let test_cmd = project.test_command.as_ref().filter(|c| !c.trim().is_empty()).cloned();
        let base_path = Path::new(&project.linked_folder_path);
        let mut fix_ops: Vec<FileOp> = Vec::new();
        let mut prior: Vec<BuildFixAttemptRecord> = Vec::new();
        let mut test_prior: Vec<BuildFixAttemptRecord> = Vec::new();
        let (mut dup_bail, mut inp_t, mut out_t) = (0u32, 0u64, 0u64);
        let mut last_stderr = String::new();
        let pre_fix_snapshots = snapshot_modified_files(base_path, &initial_execution.file_ops);

        for attempt in 1..=self.engine_config.max_build_fix_retries {
            let (br, dur) = self.run_build_with_streaming(
                project, session, task, base_path, &build_cmd, attempt,
            ).await?;
            if br.timed_out {
                if let Some(c) = self.try_auto_correct_timeout(project, &build_cmd).await {
                    build_cmd = c;
                    continue;
                }
            }
            if br.success {
                let (tp, i, o) = self.handle_build_success(
                    params, &build_cmd, &br.stdout, dur, attempt, &test_cmd,
                    base_path, &mut fix_ops, &mut test_prior,
                ).await?;
                inp_t += i; out_t += o;
                if tp { return Ok((fix_ops, true, attempt, dup_bail, inp_t, out_t, String::new())); }
                continue;
            }
            last_stderr = br.stderr.clone();
            self.record_build_failed(
                project, session, task, &build_cmd,
                &br.stdout, &br.stderr, dur, attempt,
            );
            if all_errors_in_baseline(baseline_build_errors, &br.stderr) {
                return Ok((fix_ops, true, attempt, dup_bail, inp_t, out_t, String::new()));
            }
            if attempt == self.engine_config.max_build_fix_retries {
                info!(task_id = %task.task_id, "build still failing after max retries");
                return Ok((fix_ops, false, attempt, dup_bail, inp_t, out_t, last_stderr));
            }
            if self.check_error_stagnation(task, &br.stderr, &prior, attempt) {
                dup_bail += 1;
                rollback_to_snapshot(base_path, &pre_fix_snapshots).await;
                info!(task_id = %task.task_id, "rolled back files after stagnated fix loop");
                return Ok((fix_ops, false, attempt, dup_bail, inp_t, out_t, last_stderr));
            }
            let (i, o) = self.attempt_build_fix(
                params, &build_cmd, &br, base_path, &mut prior,
                &mut fix_ops, attempt,
            ).await?;
            inp_t += i; out_t += o;
        }
        Ok((fix_ops, false, self.engine_config.max_build_fix_retries, dup_bail, inp_t, out_t, last_stderr))
    }
}

#[cfg(test)]
#[path = "build_fix_tests.rs"]
mod tests;
