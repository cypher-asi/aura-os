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
use crate::error::EngineError;
use crate::events::EngineEvent;
use crate::file_ops::{self, FileOp};

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

impl DevLoopEngine {
    pub(crate) fn persist_build_step(&self, task: &Task, step: BuildStepRecord) {
        let _ = self.store.atomic_update_task(
            &task.project_id, &task.spec_id, &task.task_id,
            |t| { t.build_steps.push(step); },
        );
    }

    /// Returns (fix_ops, build_passed, attempts_used, duplicate_bailouts, fix_input_tokens, fix_output_tokens).
    pub(crate) async fn verify_and_fix_build(
        &self,
        project: &Project,
        task: &Task,
        session: &Session,
        api_key: &str,
        initial_execution: &TaskExecution,
        baseline_test_failures: &HashSet<String>,
    ) -> Result<(Vec<FileOp>, bool, u32, u32, u64, u64), EngineError> {
        let mut build_command = match &project.build_command {
            Some(cmd) if !cmd.trim().is_empty() => cmd.clone(),
            _ => {
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
                return Ok((vec![], true, 0, 0, 0, 0));
            }
        };

        if let Some(corrected) = auto_correct_build_command(&build_command) {
            warn!(
                old = %build_command, new = %corrected,
                "eagerly rewriting server-starting build command"
            );
            let _ = self.project_service.update_project(
                &project.project_id,
                aura_projects::UpdateProjectInput {
                    build_command: Some(corrected.clone()),
                    ..Default::default()
                },
            );
            build_command = corrected;
        }

        let test_command = project.test_command.as_ref()
            .filter(|cmd| !cmd.trim().is_empty())
            .cloned();

        let base_path = Path::new(&project.linked_folder_path);
        let mut all_fix_ops: Vec<FileOp> = Vec::new();
        let mut prior_attempts: Vec<BuildFixAttemptRecord> = Vec::new();
        let mut prior_test_attempts: Vec<BuildFixAttemptRecord> = Vec::new();
        let mut duplicate_bailouts: u32 = 0;
        let mut fix_input_tokens: u64 = 0;
        let mut fix_output_tokens: u64 = 0;

        for attempt in 1..=self.engine_config.max_build_fix_retries {
            let build_step_start = Instant::now();
            self.emit(EngineEvent::BuildVerificationStarted {
                project_id: project.project_id,
                agent_instance_id: session.agent_instance_id,
                task_id: task.task_id,
                command: build_command.clone(),
            });
            self.persist_build_step(task, BuildStepRecord {
                kind: "started".into(),
                command: Some(build_command.clone()),
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
                    let _ = fwd_event_tx.send(EngineEvent::TaskOutputDelta {
                        project_id: fwd_pid,
                        agent_instance_id: fwd_aiid,
                        task_id: fwd_tid,
                        delta: line,
                    });
                }
            });
            let build_result = build_verify::run_build_command(base_path, &build_command, Some(line_tx)).await?;
            let step_duration_ms = build_step_start.elapsed().as_millis() as u64;

            if build_result.timed_out {
                if let Some(corrected) = auto_correct_build_command(&build_command) {
                    warn!(
                        old = %build_command, new = %corrected,
                        "build command timed out, auto-correcting"
                    );
                    let _ = self.project_service.update_project(
                        &project.project_id,
                        aura_projects::UpdateProjectInput {
                            build_command: Some(corrected.clone()),
                            ..Default::default()
                        },
                    );
                    build_command = corrected;
                    continue;
                }
            }

            if build_result.success {
                self.emit(EngineEvent::BuildVerificationPassed {
                    project_id: project.project_id,
                    agent_instance_id: session.agent_instance_id,
                    task_id: task.task_id,
                    command: build_command.clone(),
                    stdout: build_result.stdout.clone(),
                    duration_ms: Some(step_duration_ms),
                });
                self.persist_build_step(task, BuildStepRecord {
                    kind: "passed".into(),
                    command: Some(build_command.clone()),
                    stderr: None,
                    stdout: Some(build_result.stdout),
                    attempt: Some(attempt),
                });

                let test_passed = if let Some(ref test_cmd) = test_command {
                    let (test_result, test_inp, test_out) = self.run_and_handle_tests(
                        project, task, session, api_key, initial_execution,
                        test_cmd, base_path, attempt, &mut all_fix_ops,
                        baseline_test_failures, &mut prior_test_attempts,
                    ).await?;
                    fix_input_tokens += test_inp;
                    fix_output_tokens += test_out;
                    test_result
                } else {
                    true
                };

                if test_passed {
                    return Ok((all_fix_ops, true, attempt, duplicate_bailouts, fix_input_tokens, fix_output_tokens));
                }
                continue;
            }

            let error_hash = Some(format!("{:x}", {
                let mut h = 0u64;
                for b in build_result.stderr.bytes() {
                    h = h.wrapping_mul(31).wrapping_add(b as u64);
                }
                h
            }));

            self.emit(EngineEvent::BuildVerificationFailed {
                project_id: project.project_id,
                agent_instance_id: session.agent_instance_id,
                task_id: task.task_id,
                command: build_command.clone(),
                stdout: build_result.stdout.clone(),
                stderr: build_result.stderr.clone(),
                attempt,
                duration_ms: Some(step_duration_ms),
                error_hash,
            });
            self.persist_build_step(task, BuildStepRecord {
                kind: "failed".into(),
                command: Some(build_command.clone()),
                stderr: Some(build_result.stderr.clone()),
                stdout: Some(build_result.stdout.clone()),
                attempt: Some(attempt),
            });

            if attempt == self.engine_config.max_build_fix_retries {
                info!(task_id = %task.task_id, "build still failing after max retries");
                return Ok((all_fix_ops, false, attempt, duplicate_bailouts, fix_input_tokens, fix_output_tokens));
            }

            let current_signature = normalize_error_signature(&build_result.stderr);
            let consecutive_dupes = prior_attempts
                .iter()
                .rev()
                .take_while(|a| a.error_signature == current_signature)
                .count();
            if consecutive_dupes >= 2 {
                info!(
                    task_id = %task.task_id,
                    attempt,
                    "same error pattern repeated {} times (after normalizing line numbers), aborting fix loop",
                    consecutive_dupes + 1
                );
                duplicate_bailouts += 1;
                return Ok((all_fix_ops, false, attempt, duplicate_bailouts, fix_input_tokens, fix_output_tokens));
            }

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

            let spec = self.store.get_spec(&task.project_id, &task.spec_id)?;
            let codebase_snapshot =
                file_ops::read_relevant_files(&project.linked_folder_path, BUILD_FIX_SNAPSHOT_BUDGET)?;

            let fix_prompt = build_fix_prompt_with_history(
                project,
                &spec,
                task,
                session,
                &codebase_snapshot,
                &build_command,
                &build_result.stderr,
                &build_result.stdout,
                &initial_execution.notes,
                &prior_attempts,
            );

            let (tx, handle) = StreamTokenCapture::sink();
            let response = self
                .llm
                .complete_stream(
                    api_key,
                    &build_fix_system_prompt(),
                    &fix_prompt,
                    self.llm_config.task_execution_max_tokens,
                    tx,
                    "aura_build_fix",
                    None,
                )
                .await?;
            let (cap_inp, cap_out, _, _) = handle.finalize().await;
            fix_input_tokens += cap_inp;
            fix_output_tokens += cap_out;

            let mut attempt_files_changed: Vec<String> = Vec::new();

            let fix_applied = match parse_execution_response(&response) {
                Ok(fix_execution) => {
                    file_ops::apply_file_ops(base_path, &fix_execution.file_ops).await?;

                    let files: Vec<crate::events::FileOpSummary> = fix_execution
                        .file_ops
                        .iter()
                        .map(|op| {
                            let (op_name, path) = match op {
                                FileOp::Create { path, .. } => ("create", path.as_str()),
                                FileOp::Modify { path, .. } => ("modify", path.as_str()),
                                FileOp::Delete { path } => ("delete", path.as_str()),
                                FileOp::SearchReplace { path, .. } => ("search_replace", path.as_str()),
                            };
                            attempt_files_changed.push(format!("{op_name} {path}"));
                            crate::events::FileOpSummary {
                                op: op_name.to_string(),
                                path: path.to_string(),
                            }
                        })
                        .collect();

                    if !fix_execution.file_ops.is_empty() {
                        self.emit(EngineEvent::FileOpsApplied {
                            project_id: project.project_id,
                            agent_instance_id: session.agent_instance_id,
                            task_id: task.task_id,
                            files_written: fix_execution
                                .file_ops
                                .iter()
                                .filter(|op| matches!(op, FileOp::Create { .. } | FileOp::Modify { .. } | FileOp::SearchReplace { .. }))
                                .count(),
                            files_deleted: fix_execution
                                .file_ops
                                .iter()
                                .filter(|op| matches!(op, FileOp::Delete { .. }))
                                .count(),
                            files,
                        });
                    }

                    all_fix_ops.extend(fix_execution.file_ops);
                    true
                }
                Err(e) => {
                    warn!(
                        task_id = %task.task_id,
                        attempt,
                        error = %e,
                        "failed to parse build-fix response, fix not applied"
                    );
                    false
                }
            };

            if fix_applied {
                let sig = normalize_error_signature(&build_result.stderr);
                prior_attempts.push(BuildFixAttemptRecord {
                    stderr: build_result.stderr,
                    error_signature: sig,
                    files_changed: attempt_files_changed,
                });
            }
        }

        Ok((all_fix_ops, false, self.engine_config.max_build_fix_retries, duplicate_bailouts, fix_input_tokens, fix_output_tokens))
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
}
