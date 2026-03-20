use std::collections::HashSet;
use std::path::Path;
use std::time::Instant;

use tracing::{info, warn};

use aura_core::*;
use aura_claude::StreamTokenCapture;

pub(crate) use super::build_fix_types::{
    BuildFixAttemptRecord, ErrorCategory,
    classify_build_errors, error_category_guidance, parse_error_references,
};

use super::orchestrator::DevLoopEngine;
use super::parser::parse_execution_response;
use super::prompts::{build_fix_system_prompt, build_fix_prompt_with_history};
use super::types::*;
use crate::build_verify;
use crate::channel_ext::send_or_log;
use crate::error::EngineError;
use crate::events::EngineEvent;
use crate::file_ops::{self, FileOp, WorkspaceCache};

pub(crate) const BUILD_FIX_SNAPSHOT_BUDGET: usize = 30_000;

/// Produce a normalized "signature" from compiler stderr by stripping line
/// numbers, column numbers, and file paths so that the same class of error
/// across different attempts compares as equal even when line numbers shift.
pub(crate) fn normalize_error_signature(stderr: &str) -> String {
    let mut signature_lines: Vec<String> = Vec::new();
    for line in stderr.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with("For more information") || trimmed.starts_with("help:") {
            continue;
        }
        if trimmed.starts_with("-->") {
            signature_lines.push("-->LOCATION".into());
            continue;
        }
        if trimmed.chars().next().is_some_and(|c| c.is_ascii_digit()) && trimmed.contains('|') {
            continue;
        }
        if trimmed.chars().all(|c| c == '^' || c == '-' || c == ' ' || c == '~' || c == '+') {
            continue;
        }
        let normalized = normalize_line_col_refs(trimmed);
        if !normalized.is_empty() {
            signature_lines.push(normalized);
        }
    }
    signature_lines.sort();
    signature_lines.dedup();
    signature_lines.join("\n")
}

/// Replace patterns like `:52:32` or `line 52` with `:N:N` so that
/// identical errors on different lines produce the same signature.
fn normalize_line_col_refs(line: &str) -> String {
    let mut result = String::with_capacity(line.len());
    let chars: Vec<char> = line.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == ':' && i + 1 < chars.len() && chars[i + 1].is_ascii_digit() {
            result.push(':');
            result.push('N');
            i += 1;
            while i < chars.len() && chars[i].is_ascii_digit() {
                i += 1;
            }
        } else {
            result.push(chars[i]);
            i += 1;
        }
    }
    result
}

/// Split compiler stderr into individual error blocks and normalize each one
/// independently, returning a `HashSet<String>` of unique error signatures.
pub(crate) fn parse_individual_error_signatures(stderr: &str) -> HashSet<String> {
    let mut signatures = HashSet::new();
    let mut current_block = String::new();
    let mut in_error_block = false;
    for line in stderr.lines() {
        if line.starts_with("error[") || line.starts_with("error:") {
            if in_error_block && !current_block.is_empty() {
                let sig = normalize_error_signature(&current_block);
                if !sig.is_empty() {
                    signatures.insert(sig);
                }
                current_block.clear();
            }
            in_error_block = true;
        }
        if in_error_block {
            current_block.push_str(line);
            current_block.push('\n');
        }
    }
    if in_error_block && !current_block.is_empty() {
        let sig = normalize_error_signature(&current_block);
        if !sig.is_empty() {
            signatures.insert(sig);
        }
    }
    signatures
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

impl DevLoopEngine {
    pub(crate) fn persist_build_step(&self, _task: &Task, _step: BuildStepRecord) {
        // build_steps are not stored in aura-storage
    }

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
                    self.persist_build_step(task, BuildStepRecord {
                        kind: "fallback_command".into(),
                        command: Some(fallback.clone()),
                        stderr: None,
                        stdout: Some("build_command missing; inferred fallback command".into()),
                        attempt: None,
                    });
                    return Some(fallback);
                }
                self.emit(EngineEvent::BuildVerificationSkipped {
                    project_id: project.project_id,
                    agent_instance_id: session.agent_instance_id,
                    task_id: task.task_id,
                    reason: "no build_command configured on project".into(),
                });
                self.persist_build_step(task, BuildStepRecord {
                    kind: "skipped".into(),
                    command: None,
                    stderr: None,
                    stdout: Some("no build_command configured on project".into()),
                    attempt: None,
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
            let _ = self.project_service.update_project_async(
                &project.project_id,
                aura_projects::UpdateProjectInput {
                    build_command: Some(corrected.clone()),
                    ..Default::default()
                },
            ).await;
            build_command = corrected;
        }
        Some(build_command)
    }

    async fn run_build_with_streaming(
        &self, project: &Project, session: &Session, task: &Task,
        base_path: &Path, build_command: &str, attempt: u32,
    ) -> Result<(build_verify::BuildResult, u64), EngineError> {
        let build_step_start = Instant::now();
        self.emit(EngineEvent::BuildVerificationStarted {
            project_id: project.project_id,
            agent_instance_id: session.agent_instance_id,
            task_id: task.task_id,
            command: build_command.to_string(),
        });
        self.persist_build_step(task, BuildStepRecord {
            kind: "started".into(),
            command: Some(build_command.to_string()),
            stderr: None,
            stdout: None,
            attempt: Some(attempt),
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
        let _ = self.project_service.update_project_async(
            &project.project_id,
            aura_projects::UpdateProjectInput {
                build_command: Some(corrected.clone()),
                ..Default::default()
            },
        ).await;
        Some(corrected)
    }

    fn record_build_passed(
        &self, project: &Project, session: &Session, task: &Task,
        build_command: &str, stdout: &str, duration_ms: u64, attempt: u32,
    ) {
        self.emit(EngineEvent::BuildVerificationPassed {
            project_id: project.project_id,
            agent_instance_id: session.agent_instance_id,
            task_id: task.task_id,
            command: build_command.to_string(),
            stdout: stdout.to_string(),
            duration_ms: Some(duration_ms),
        });
        self.persist_build_step(task, BuildStepRecord {
            kind: "passed".into(),
            command: Some(build_command.to_string()),
            stderr: None,
            stdout: Some(stdout.to_string()),
            attempt: Some(attempt),
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
        self.persist_build_step(task, BuildStepRecord {
            kind: "failed".into(),
            command: Some(build_command.to_string()),
            stderr: Some(stderr.to_string()),
            stdout: Some(stdout.to_string()),
            attempt: Some(attempt),
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

    #[allow(clippy::too_many_arguments)]
    async fn request_build_fix(
        &self, project: &Project, task: &Task, session: &Session,
        api_key: &str, initial_execution: &TaskExecution,
        build_command: &str, build_stderr: &str, build_stdout: &str,
        prior_attempts: &[BuildFixAttemptRecord], attempt: u32,
        workspace_cache: &WorkspaceCache,
    ) -> Result<(String, u64, u64), EngineError> {
        self.emit(EngineEvent::BuildFixAttempt {
            project_id: project.project_id,
            agent_instance_id: session.agent_instance_id,
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
        let spec = self.load_spec(&task.project_id, &task.spec_id).await?;

        // Read error source files fresh from disk instead of relying on a
        // cached snapshot that may be stale after the initial execution
        // modified files.  This ensures the LLM sees the actual current
        // content of files it needs to fix, preventing hallucinated search
        // strings in search_replace operations.
        let error_refs = parse_error_references(build_stderr);
        let fresh_error_files = file_ops::resolve_error_source_files(
            Path::new(&project.linked_folder_path),
            &error_refs,
            BUILD_FIX_SNAPSHOT_BUDGET,
        );

        let codebase_snapshot = if !fresh_error_files.is_empty() {
            // Use fresh error files as the primary snapshot; fall back to
            // cached files only for remaining budget.
            let remaining_budget = BUILD_FIX_SNAPSHOT_BUDGET.saturating_sub(fresh_error_files.len());
            let supplemental = if remaining_budget > 2_000 {
                match file_ops::retrieve_task_relevant_files_cached(
                    &project.linked_folder_path, &task.title, &task.description,
                    remaining_budget, workspace_cache,
                ).await {
                    Ok(s) => s,
                    Err(_) => String::new(),
                }
            } else {
                String::new()
            };
            if supplemental.is_empty() {
                fresh_error_files
            } else {
                format!("{fresh_error_files}\n{supplemental}")
            }
        } else {
            match file_ops::retrieve_task_relevant_files_cached(
                &project.linked_folder_path, &task.title, &task.description,
                BUILD_FIX_SNAPSHOT_BUDGET, workspace_cache,
            ).await {
                Ok(s) => s,
                Err(_) => file_ops::read_relevant_files(
                    &project.linked_folder_path, BUILD_FIX_SNAPSHOT_BUDGET,
                ).unwrap_or_default(),
            }
        };

        let fix_prompt = build_fix_prompt_with_history(
            project, &spec, task, session, &codebase_snapshot,
            build_command, build_stderr, build_stdout,
            &initial_execution.notes, prior_attempts,
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
        let (cap_inp, cap_out, _, _) = handle.finalize().await;
        Ok((response, cap_inp, cap_out))
    }

    async fn apply_fix_response(
        &self, project: &Project, session: &Session, task: &Task,
        base_path: &Path, response: &str, attempt: u32,
    ) -> Result<(bool, Vec<String>, Vec<FileOp>), EngineError> {
        match parse_execution_response(response) {
            Ok(fix_execution) => {
                if let Err(e) = file_ops::apply_file_ops(base_path, &fix_execution.file_ops).await {
                    warn!(
                        task_id = %task.task_id, attempt, error = %e,
                        "file ops failed during build-fix (likely search-replace mismatch), \
                         treating as failed fix attempt"
                    );
                    return Ok((false, vec![], vec![]));
                }
                let files_changed: Vec<String> = fix_execution.file_ops.iter().map(|op| {
                    let (op_name, path) = match op {
                        FileOp::Create { path, .. } => ("create", path.as_str()),
                        FileOp::Modify { path, .. } => ("modify", path.as_str()),
                        FileOp::Delete { path } => ("delete", path.as_str()),
                        FileOp::SearchReplace { path, .. } => ("search_replace", path.as_str()),
                    };
                    format!("{op_name} {path}")
                }).collect();
                if !fix_execution.file_ops.is_empty() {
                    self.emit_file_ops_applied(
                        project.project_id, session.agent_instance_id,
                        task, &fix_execution.file_ops,
                    );
                }
                Ok((true, files_changed, fix_execution.file_ops))
            }
            Err(e) => {
                warn!(
                    task_id = %task.task_id, attempt, error = %e,
                    "failed to parse build-fix response, fix not applied"
                );
                Ok((false, vec![], vec![]))
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn handle_build_success(
        &self, project: &Project, task: &Task, session: &Session,
        api_key: &str, initial_execution: &TaskExecution,
        build_command: &str, stdout: &str, duration_ms: u64,
        attempt: u32, test_command: &Option<String>,
        base_path: &Path, all_fix_ops: &mut Vec<FileOp>,
        baseline_test_failures: &HashSet<String>,
        prior_test_attempts: &mut Vec<BuildFixAttemptRecord>,
        workspace_cache: &WorkspaceCache,
    ) -> Result<(bool, u64, u64), EngineError> {
        self.record_build_passed(project, session, task, build_command, stdout, duration_ms, attempt);
        match test_command.as_deref() {
            Some(test_cmd) => {
                self.run_and_handle_tests(
                    project, task, session, api_key, initial_execution,
                    test_cmd, base_path, attempt, all_fix_ops,
                    baseline_test_failures, prior_test_attempts, workspace_cache,
                ).await
            }
            None => Ok((true, 0, 0)),
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn attempt_build_fix(
        &self, project: &Project, task: &Task, session: &Session,
        api_key: &str, initial_execution: &TaskExecution,
        build_command: &str, build_result: &build_verify::BuildResult,
        base_path: &Path, prior_attempts: &mut Vec<BuildFixAttemptRecord>,
        all_fix_ops: &mut Vec<FileOp>, attempt: u32,
        workspace_cache: &WorkspaceCache,
    ) -> Result<(u64, u64), EngineError> {
        let (response, inp, out) = self.request_build_fix(
            project, task, session, api_key, initial_execution,
            build_command, &build_result.stderr, &build_result.stdout,
            prior_attempts, attempt, workspace_cache,
        ).await?;
        let (fix_applied, files_changed, ops) = self.apply_fix_response(
            project, session, task, base_path, &response, attempt,
        ).await?;
        all_fix_ops.extend(ops);
        let sig = normalize_error_signature(&build_result.stderr);
        prior_attempts.push(BuildFixAttemptRecord {
            stderr: build_result.stderr.clone(),
            error_signature: sig,
            files_changed: if fix_applied { files_changed } else { vec!["(fix did not apply)".into()] },
        });
        Ok((inp, out))
    }

    /// Returns (fix_ops, build_passed, attempts_used, duplicate_bailouts, fix_input_tokens, fix_output_tokens, last_stderr).
    pub(crate) async fn verify_and_fix_build(
        &self, project: &Project, task: &Task, session: &Session,
        api_key: &str, initial_execution: &TaskExecution,
        baseline_test_failures: &HashSet<String>,
        baseline_build_errors: &HashSet<String>,
        workspace_cache: &WorkspaceCache,
    ) -> Result<(Vec<FileOp>, bool, u32, u32, u64, u64, String), EngineError> {
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
                    project, task, session, api_key, initial_execution, &build_cmd,
                    &br.stdout, dur, attempt, &test_cmd, base_path, &mut fix_ops,
                    baseline_test_failures, &mut test_prior, workspace_cache,
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
            if !baseline_build_errors.is_empty() {
                let current_errors = parse_individual_error_signatures(&br.stderr);
                let new_errors: HashSet<_> = current_errors
                    .difference(baseline_build_errors)
                    .cloned()
                    .collect();
                if new_errors.is_empty() && !current_errors.is_empty() {
                    info!(
                        task_id = %task.task_id,
                        pre_existing = current_errors.len(),
                        "all build errors are pre-existing (baseline), treating as passed"
                    );
                    return Ok((fix_ops, true, attempt, dup_bail, inp_t, out_t, String::new()));
                }
            }
            if attempt == self.engine_config.max_build_fix_retries {
                info!(task_id = %task.task_id, "build still failing after max retries");
                return Ok((fix_ops, false, attempt, dup_bail, inp_t, out_t, last_stderr));
            }
            if self.check_error_stagnation(task, &br.stderr, &prior, attempt) {
                dup_bail += 1;
                return Ok((fix_ops, false, attempt, dup_bail, inp_t, out_t, last_stderr));
            }
            let (i, o) = self.attempt_build_fix(
                project, task, session, api_key, initial_execution, &build_cmd,
                &br, base_path, &mut prior, &mut fix_ops, attempt, workspace_cache,
            ).await?;
            inp_t += i; out_t += o;
        }
        Ok((fix_ops, false, self.engine_config.max_build_fix_retries, dup_bail, inp_t, out_t, last_stderr))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // auto_correct_build_command
    // -----------------------------------------------------------------------

    #[test]
    fn auto_correct_cargo_run() {
        assert_eq!(
            auto_correct_build_command("cargo run"),
            Some("cargo build".into())
        );
    }

    #[test]
    fn auto_correct_cargo_run_with_args() {
        assert_eq!(
            auto_correct_build_command("cargo run --release"),
            Some("cargo build --release".into())
        );
    }

    #[test]
    fn auto_correct_cargo_run_strips_binary_args() {
        assert_eq!(
            auto_correct_build_command("cargo run -p spectra-app -- --help"),
            Some("cargo build -p spectra-app".into())
        );
        assert_eq!(
            auto_correct_build_command("cargo run -- --port 8080"),
            Some("cargo build".into())
        );
    }

    #[test]
    fn auto_correct_cargo_run_trailing_double_dash() {
        assert_eq!(
            auto_correct_build_command("cargo run --"),
            Some("cargo build".into())
        );
    }

    #[test]
    fn auto_correct_npm_start() {
        assert_eq!(
            auto_correct_build_command("npm start"),
            Some("npm run build".into())
        );
    }

    #[test]
    fn auto_correct_django_runserver() {
        assert_eq!(
            auto_correct_build_command("python manage.py runserver"),
            Some("python manage.py check".into())
        );
    }

    #[test]
    fn auto_correct_returns_none_for_normal_build() {
        assert_eq!(auto_correct_build_command("cargo build"), None);
        assert_eq!(auto_correct_build_command("npm run build"), None);
        assert_eq!(auto_correct_build_command("make"), None);
    }

    // -----------------------------------------------------------------------
    // infer_default_build_command
    // -----------------------------------------------------------------------

    #[test]
    fn infer_default_build_command_rust_workspace() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("Cargo.toml"), "[workspace]").unwrap();
        assert_eq!(
            infer_default_build_command(dir.path()),
            Some("cargo check --workspace --tests".into())
        );
    }

    #[test]
    fn infer_default_build_command_node_project() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("package.json"), "{}").unwrap();
        assert_eq!(
            infer_default_build_command(dir.path()),
            Some("npm run build --if-present".into())
        );
    }

    #[test]
    fn infer_default_build_command_none_when_unknown() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(infer_default_build_command(dir.path()), None);
    }

    // -----------------------------------------------------------------------
    // normalize_error_signature
    // -----------------------------------------------------------------------

    #[test]
    fn normalize_strips_line_numbers() {
        let stderr = "error[E0308]: mismatched types\n  --> src/main.rs:52:32\n";
        let sig = normalize_error_signature(stderr);
        assert!(sig.contains("error[E0308]: mismatched types"));
        assert!(sig.contains("-->LOCATION"));
        assert!(!sig.contains(":52:32"));
    }

    #[test]
    fn normalize_deduplicates_same_errors() {
        let stderr = "\
error[E0308]: mismatched types
  --> src/main.rs:10:5
error[E0308]: mismatched types
  --> src/main.rs:20:5
";
        let sig = normalize_error_signature(stderr);
        let lines: Vec<&str> = sig.lines().collect();
        let error_count = lines.iter().filter(|l| l.contains("E0308")).count();
        assert_eq!(error_count, 1, "duplicate errors should be deduped");
    }

    #[test]
    fn normalize_skips_help_lines() {
        let stderr = "\
error: cannot find value `x`
help: consider importing this
For more information about this error, try `rustc --explain E0425`
";
        let sig = normalize_error_signature(stderr);
        assert!(!sig.contains("help:"));
        assert!(!sig.contains("For more information"));
    }

    // -----------------------------------------------------------------------
    // classify_build_errors
    // -----------------------------------------------------------------------

    #[test]
    fn classify_rust_string_literal() {
        let errors = classify_build_errors("error: unknown start of token \\u{201c}");
        assert!(errors.contains(&ErrorCategory::RustStringLiteral));
    }

    #[test]
    fn classify_rust_missing_module() {
        let errors = classify_build_errors("error[E0583]: file not found for module `foo`");
        assert!(errors.contains(&ErrorCategory::RustMissingModule));
    }

    #[test]
    fn classify_rust_borrow_check() {
        let errors = classify_build_errors("error[E0502]: cannot borrow `x` as mutable");
        assert!(errors.contains(&ErrorCategory::RustBorrowCheck));
    }

    #[test]
    fn classify_npm_dependency() {
        let errors = classify_build_errors("Error: Cannot find module 'express'");
        assert!(errors.contains(&ErrorCategory::NpmDependency));
    }

    #[test]
    fn classify_npm_typescript() {
        let errors = classify_build_errors("error TS2304: Cannot find name 'foo'");
        assert!(errors.contains(&ErrorCategory::NpmTypeScript));
    }

    #[test]
    fn classify_generic_syntax() {
        let errors = classify_build_errors("syntax error near unexpected token");
        assert!(errors.contains(&ErrorCategory::GenericSyntax));
    }

    #[test]
    fn classify_unknown_fallback() {
        let errors = classify_build_errors("something completely unknown happened");
        assert!(errors.contains(&ErrorCategory::Unknown));
    }

    #[test]
    fn classify_multiple_categories() {
        let stderr = "error[E0599]: no method named `foo`\nerror[E0502]: cannot borrow `x`";
        let errors = classify_build_errors(stderr);
        assert!(errors.contains(&ErrorCategory::RustMissingMethod));
        assert!(errors.contains(&ErrorCategory::RustBorrowCheck));
    }

    // -----------------------------------------------------------------------
    // normalize_error_signature – stagnation detection
    // -----------------------------------------------------------------------

    #[test]
    fn normalize_same_error_different_lines_produces_same_sig() {
        let stderr_v1 = "\
error[E0308]: mismatched types
  --> src/main.rs:10:5
   |
10 |     let x: i32 = \"hello\";
   |                  ^^^^^^^ expected `i32`, found `&str`
";
        let stderr_v2 = "\
error[E0308]: mismatched types
  --> src/main.rs:42:5
   |
42 |     let x: i32 = \"hello\";
   |                  ^^^^^^^ expected `i32`, found `&str`
";
        assert_eq!(
            normalize_error_signature(stderr_v1),
            normalize_error_signature(stderr_v2),
        );
    }

    #[test]
    fn normalize_different_errors_produce_different_sigs() {
        let sig_a = normalize_error_signature("error[E0308]: mismatched types\n");
        let sig_b = normalize_error_signature("error[E0599]: no method named `foo`\n");
        assert_ne!(sig_a, sig_b);
    }

    #[test]
    fn stagnation_detected_after_three_consecutive_identical_sigs() {
        let sig = normalize_error_signature("error[E0308]: mismatched types\n  --> src/lib.rs:1:1\n");
        let prior = vec![
            BuildFixAttemptRecord { stderr: String::new(), error_signature: sig.clone(), files_changed: vec![] },
            BuildFixAttemptRecord { stderr: String::new(), error_signature: sig.clone(), files_changed: vec![] },
        ];
        let consecutive = prior.iter().rev().take_while(|a| a.error_signature == sig).count();
        assert!(consecutive >= 2, "should detect stagnation (3 total: 2 prior + current)");
    }

    #[test]
    fn stagnation_not_triggered_with_interleaved_different_error() {
        let sig_a = normalize_error_signature("error[E0308]: mismatched types\n");
        let sig_b = normalize_error_signature("error[E0599]: no method named `foo`\n");
        let prior = vec![
            BuildFixAttemptRecord { stderr: String::new(), error_signature: sig_a.clone(), files_changed: vec![] },
            BuildFixAttemptRecord { stderr: String::new(), error_signature: sig_b.clone(), files_changed: vec![] },
        ];
        let consecutive = prior.iter().rev().take_while(|a| a.error_signature == sig_a).count();
        assert_eq!(consecutive, 0, "different last error breaks the streak");
    }

    // -----------------------------------------------------------------------
    // parse_error_references
    // -----------------------------------------------------------------------

    #[test]
    fn parse_refs_extracts_type_names() {
        let stderr = "error[E0599]: no method named `foo` found for struct `MyStruct`";
        let refs = parse_error_references(stderr);
        assert!(refs.types_referenced.contains(&"MyStruct".to_string()));
    }

    #[test]
    fn parse_refs_extracts_missing_fields() {
        let stderr = "error[E0063]: missing field `name` in initializer of `aura_core::Task`";
        let refs = parse_error_references(stderr);
        assert!(refs.missing_fields.iter().any(|(t, f)| t == "Task" && f == "name"));
    }

    #[test]
    fn parse_refs_extracts_methods_not_found() {
        let stderr = "error[E0599]: no method named `do_thing` found for struct `MyService`";
        let refs = parse_error_references(stderr);
        assert!(refs.methods_not_found.iter().any(|(t, m)| t == "MyService" && m == "do_thing"));
    }

    #[test]
    fn parse_refs_extracts_source_locations() {
        let stderr = "\
error[E0308]: mismatched types
  --> src/main.rs:42:5
error[E0308]: mismatched types
  --> src/lib.rs:10:12
";
        let refs = parse_error_references(stderr);
        assert!(refs.source_locations.contains(&("src/main.rs".into(), 42)));
        assert!(refs.source_locations.contains(&("src/lib.rs".into(), 10)));
    }

    #[test]
    fn parse_refs_extracts_wrong_arg_counts() {
        let stderr = "error[E0061]: this function takes 2 arguments but 3 arguments were supplied";
        let refs = parse_error_references(stderr);
        assert!(!refs.wrong_arg_counts.is_empty());
        assert!(refs.wrong_arg_counts[0].contains("expected 2"));
    }

    #[test]
    fn parse_refs_empty_stderr() {
        let refs = parse_error_references("");
        assert!(refs.types_referenced.is_empty());
        assert!(refs.missing_fields.is_empty());
        assert!(refs.methods_not_found.is_empty());
        assert!(refs.source_locations.is_empty());
        assert!(refs.wrong_arg_counts.is_empty());
    }

    // -----------------------------------------------------------------------
    // parse_individual_error_signatures
    // -----------------------------------------------------------------------

    #[test]
    fn parse_individual_splits_multi_error_stderr() {
        let stderr = "\
error[E0308]: mismatched types
  --> src/main.rs:10:5
   |
10 |     let x: i32 = \"hello\";
   |                  ^^^^^^^ expected `i32`, found `&str`

error[E0599]: no method named `foo` found for struct `Bar`
  --> src/lib.rs:42:9
";
        let sigs = parse_individual_error_signatures(stderr);
        assert_eq!(sigs.len(), 2, "should split into two distinct error signatures");
    }

    #[test]
    fn parse_individual_deduplicates_identical_errors() {
        let stderr = "\
error[E0308]: mismatched types
  --> src/main.rs:10:5
error[E0308]: mismatched types
  --> src/main.rs:20:5
";
        let sigs = parse_individual_error_signatures(stderr);
        assert_eq!(sigs.len(), 1, "identical errors on different lines should dedup to one");
    }

    #[test]
    fn parse_individual_empty_stderr() {
        let sigs = parse_individual_error_signatures("");
        assert!(sigs.is_empty());
    }

    #[test]
    fn parse_individual_no_error_prefix() {
        let sigs = parse_individual_error_signatures("warning: unused variable\n");
        assert!(sigs.is_empty() || sigs.iter().all(|s| s.is_empty()),
            "non-error output should produce no meaningful signatures");
    }

    // -----------------------------------------------------------------------
    // build baseline filtering logic
    // -----------------------------------------------------------------------

    #[test]
    fn baseline_filters_all_preexisting_errors() {
        let stderr = "\
error[E0308]: mismatched types
  --> src/main.rs:10:5
error[E0599]: no method named `foo` found for struct `Bar`
  --> src/lib.rs:42:9
";
        let baseline = parse_individual_error_signatures(stderr);
        let current = parse_individual_error_signatures(stderr);
        let new_errors: HashSet<_> = current.difference(&baseline).cloned().collect();
        assert!(new_errors.is_empty(), "all errors are pre-existing, none should be new");
    }

    #[test]
    fn baseline_detects_new_errors_mixed_with_preexisting() {
        let baseline_stderr = "\
error[E0308]: mismatched types
  --> src/main.rs:10:5
";
        let current_stderr = "\
error[E0308]: mismatched types
  --> src/main.rs:10:5
error[E0599]: no method named `foo` found for struct `Bar`
  --> src/lib.rs:42:9
";
        let baseline = parse_individual_error_signatures(baseline_stderr);
        let current = parse_individual_error_signatures(current_stderr);
        let new_errors: HashSet<_> = current.difference(&baseline).cloned().collect();
        assert_eq!(new_errors.len(), 1, "should detect exactly one new error");
    }

    #[test]
    fn empty_baseline_means_no_filtering() {
        let stderr = "\
error[E0308]: mismatched types
  --> src/main.rs:10:5
";
        let baseline: HashSet<String> = HashSet::new();
        let current = parse_individual_error_signatures(stderr);
        let new_errors: HashSet<_> = current.difference(&baseline).cloned().collect();
        assert_eq!(new_errors.len(), current.len(), "with empty baseline, all errors are new");
    }
}
