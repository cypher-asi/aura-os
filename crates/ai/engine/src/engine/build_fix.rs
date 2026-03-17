use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use tokio::sync::{mpsc, Mutex};
use tracing::{info, warn};

use aura_core::*;
use aura_claude::ClaudeStreamEvent;

use super::orchestrator::DevLoopEngine;
use super::parser::parse_execution_response;
use super::prompts::{build_fix_system_prompt, build_fix_prompt_with_history};
use super::types::*;
use crate::build_verify;
use crate::error::EngineError;
use crate::events::EngineEvent;
use crate::file_ops::{self, FileOp};

/// Tracks a single build-fix attempt for the retry history prompt.
pub(crate) struct BuildFixAttemptRecord {
    pub stderr: String,
    pub error_signature: String,
    pub files_changed: Vec<String>,
}

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
        return Some(trimmed.replacen("cargo run", "cargo build", 1));
    }
    if trimmed == "npm start" {
        return Some("npm run build".to_string());
    }
    if trimmed.contains("runserver") {
        return Some(trimmed.replace("runserver", "check"));
    }
    None
}

/// Classify build errors into categories so the fix prompt can include
/// targeted guidance instead of generic "try a different approach."
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ErrorCategory {
    RustStringLiteral,
    RustMissingModule,
    RustMissingMethod,
    RustTypeError,
    RustBorrowCheck,
    RustApiHallucination,
    NpmDependency,
    NpmTypeScript,
    GenericSyntax,
    Unknown,
}

pub(crate) fn classify_build_errors(stderr: &str) -> Vec<ErrorCategory> {
    let mut categories = Vec::new();

    let rust_string_patterns = [
        "unknown start of token",
        "prefix `",
        "unknown prefix",
        "Unicode character",
        "looks like",
        "but it is not",
    ];
    if rust_string_patterns.iter().any(|p| stderr.contains(p)) {
        categories.push(ErrorCategory::RustStringLiteral);
    }

    if stderr.contains("file not found for module") || stderr.contains("E0583") {
        categories.push(ErrorCategory::RustMissingModule);
    }

    if stderr.contains("no method named") || stderr.contains("E0599") {
        categories.push(ErrorCategory::RustMissingMethod);
    }

    if stderr.contains("the trait") && stderr.contains("is not implemented")
        || stderr.contains("E0277")
        || stderr.contains("type annotations needed")
        || stderr.contains("E0283")
    {
        categories.push(ErrorCategory::RustTypeError);
    }

    if stderr.contains("cannot borrow") || stderr.contains("E0502") || stderr.contains("E0505") {
        categories.push(ErrorCategory::RustBorrowCheck);
    }

    if stderr.contains("Cannot find module") || stderr.contains("ENOENT") {
        categories.push(ErrorCategory::NpmDependency);
    }

    if stderr.contains("TS2304") || stderr.contains("TS2345") || stderr.contains("TS2322") {
        categories.push(ErrorCategory::NpmTypeScript);
    }

    if categories.is_empty()
        && (stderr.contains("expected") || stderr.contains("syntax error") || stderr.contains("parse error"))
    {
        categories.push(ErrorCategory::GenericSyntax);
    }

    if categories.is_empty() {
        categories.push(ErrorCategory::Unknown);
    }
    categories
}

pub(crate) fn error_category_guidance(categories: &[ErrorCategory]) -> String {
    let mut guidance = String::new();
    for cat in categories {
        let advice: &str = match cat {
            ErrorCategory::RustStringLiteral => concat!(
                "DIAGNOSIS: Rust string literal / token errors detected.\n",
                "ROOT CAUSE: This almost always means JSON or text with special characters ",
                "was placed directly in Rust source code without proper string escaping.\n",
                "MANDATORY FIX:\n",
                "- For test fixtures or multi-line strings containing JSON, quotes, backslashes, ",
                "or special chars: use Rust RAW STRING LITERALS (r followed by # then quote to open, ",
                "quote then # to close; add more # symbols if the content itself contains that pattern).\n",
                "- For programmatic JSON construction: use serde_json::json!() macro instead of string literals.\n",
                "- NEVER put literal backslash-n (two characters) inside a Rust string to represent a newline; ",
                "use actual newlines inside raw strings, or proper escape sequences inside regular strings.\n",
                "- NEVER use non-ASCII characters (em dashes, smart quotes, etc.) in Rust string literals; ",
                "replace with ASCII equivalents.\n",
                "- Check ALL string literals in the file, not just the ones the compiler flagged -- ",
                "the same mistake is likely repeated.",
            ),
            ErrorCategory::RustMissingModule => concat!(
                "DIAGNOSIS: Missing Rust module file.\n",
                "FIX: If mod.rs or lib.rs declares `pub mod foo;`, the file `foo.rs` ",
                "(or `foo/mod.rs`) MUST exist. Either create the file or remove the module declaration.",
            ),
            ErrorCategory::RustMissingMethod => concat!(
                "DIAGNOSIS: Method not found on type.\n",
                "FIX: Check the actual public API of the type (read its source file). ",
                "Do not invent methods. If the method does not exist, either implement it ",
                "or use an existing method that provides the same functionality.",
            ),
            ErrorCategory::RustTypeError => concat!(
                "DIAGNOSIS: Type mismatch or missing trait implementation.\n",
                "FIX: Read the function signatures carefully. Check generic type parameters. ",
                "Provide explicit type annotations where the compiler asks for them. ",
                "Do not use `[u8]` where `Vec<u8>` or `&[u8]` is needed.",
            ),
            ErrorCategory::RustBorrowCheck => concat!(
                "DIAGNOSIS: Borrow checker violation.\n",
                "FIX: Check ownership and lifetimes. Consider cloning, using references, ",
                "or restructuring to avoid simultaneous mutable/immutable borrows.",
            ),
            ErrorCategory::RustApiHallucination => concat!(
                "DIAGNOSIS: Systematic API hallucination detected -- your code assumes an API ",
                "that does not exist.\n",
                "ROOT CAUSE: You are calling multiple methods or using fields that are not part ",
                "of the actual type's public API.\n",
                "MANDATORY FIX:\n",
                "- The actual API is shown in the \"Actual API Reference\" section below.\n",
                "- Rewrite ALL calls to use ONLY the methods and fields listed there.\n",
                "- Do NOT invent, guess, or assume method names -- use exactly what exists.\n",
                "- If the functionality you need does not exist in the current API, implement it ",
                "or find an alternative approach.",
            ),
            ErrorCategory::NpmDependency => concat!(
                "DIAGNOSIS: Missing npm package or module.\n",
                "FIX: Ensure the dependency exists in package.json and has been installed. ",
                "Check import paths for typos.",
            ),
            ErrorCategory::NpmTypeScript => concat!(
                "DIAGNOSIS: TypeScript type errors.\n",
                "FIX: Check that types align with the library's actual API. ",
                "Read type definitions if needed.",
            ),
            ErrorCategory::GenericSyntax => concat!(
                "DIAGNOSIS: Syntax error.\n",
                "FIX: Look at the exact line/column the compiler indicates. ",
                "Check for missing semicolons, unbalanced braces, or misplaced tokens.",
            ),
            ErrorCategory::Unknown => "",
        };
        if !advice.is_empty() {
            guidance.push_str(advice);
            guidance.push_str("\n\n");
        }
    }
    guidance
}

pub(crate) fn parse_error_references(stderr: &str) -> file_ops::ErrorReferences {
    use regex::Regex;

    let mut refs = file_ops::ErrorReferences::default();

    let type_re = Regex::new(r"found for (?:struct|enum|trait|union) `(\w+)").unwrap();
    for cap in type_re.captures_iter(stderr) {
        let name = cap[1].to_string();
        if !refs.types_referenced.contains(&name) {
            refs.types_referenced.push(name);
        }
    }

    let init_type_re = Regex::new(r"in initializer of `(?:\w+::)*(\w+)`").unwrap();
    for cap in init_type_re.captures_iter(stderr) {
        let name = cap[1].to_string();
        if !refs.types_referenced.contains(&name) {
            refs.types_referenced.push(name);
        }
    }

    let method_re =
        Regex::new(r"no method named `(\w+)` found for (?:\w+ )?`(?:&(?:mut )?)?(\w+)").unwrap();
    for cap in method_re.captures_iter(stderr) {
        let method = cap[1].to_string();
        let type_name = cap[2].to_string();
        refs.methods_not_found
            .push((type_name.clone(), method));
        if !refs.types_referenced.contains(&type_name) {
            refs.types_referenced.push(type_name);
        }
    }

    let field_re =
        Regex::new(r"missing field `(\w+)` in initializer of `(?:\w+::)*(\w+)`").unwrap();
    for cap in field_re.captures_iter(stderr) {
        let field = cap[1].to_string();
        let type_name = cap[2].to_string();
        refs.missing_fields.push((type_name.clone(), field));
        if !refs.types_referenced.contains(&type_name) {
            refs.types_referenced.push(type_name);
        }
    }

    let loc_re = Regex::new(r"-->\s*([\w\\/._-]+):(\d+):\d+").unwrap();
    for cap in loc_re.captures_iter(stderr) {
        let file = cap[1].to_string();
        let line: u32 = cap[2].parse().unwrap_or(0);
        if !refs.source_locations.iter().any(|(f, l)| f == &file && *l == line) {
            refs.source_locations.push((file, line));
        }
    }

    let arg_re = Regex::new(r"takes (\d+) arguments? but (\d+)").unwrap();
    for cap in arg_re.captures_iter(stderr) {
        refs.wrong_arg_counts
            .push(format!("expected {} got {}", &cap[1], &cap[2]));
    }

    refs
}

impl DevLoopEngine {
    pub(crate) fn persist_build_step(&self, task: &Task, step: BuildStepRecord) {
        if let Ok(mut t) = self.store.get_task(&task.project_id, &task.spec_id, &task.task_id) {
            t.build_steps.push(step);
            let _ = self.store.put_task(&t);
        }
    }

    pub(crate) fn persist_test_step(&self, task: &Task, step: TestStepRecord) {
        if let Ok(mut t) = self.store.get_task(&task.project_id, &task.spec_id, &task.task_id) {
            t.test_steps.push(step);
            let _ = self.store.put_task(&t);
        }
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
        let mut duplicate_bailouts: u32 = 0;
        let mut fix_input_tokens: u64 = 0;
        let mut fix_output_tokens: u64 = 0;

        for attempt in 1..=MAX_BUILD_FIX_RETRIES {
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
                        baseline_test_failures,
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

            if attempt == MAX_BUILD_FIX_RETRIES {
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
                file_ops::read_relevant_files(&project.linked_folder_path, 50_000)?;

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

            let fix_tc: Arc<Mutex<(u64, u64)>> = Arc::new(Mutex::new((0, 0)));
            let (stream_tx, mut stream_rx) = mpsc::unbounded_channel::<ClaudeStreamEvent>();
            let fix_tc_clone = fix_tc.clone();
            let forwarder = tokio::spawn(async move {
                while let Some(evt) = stream_rx.recv().await {
                    if let ClaudeStreamEvent::Done { input_tokens, output_tokens, .. } = evt {
                        let mut g = fix_tc_clone.lock().await;
                        g.0 += input_tokens;
                        g.1 += output_tokens;
                    }
                }
            });

            let response = self
                .claude_client
                .complete_stream(
                    api_key,
                    &build_fix_system_prompt(),
                    &fix_prompt,
                    TASK_EXECUTION_MAX_TOKENS,
                    stream_tx,
                )
                .await?;
            let _ = forwarder.await;

            {
                let g = fix_tc.lock().await;
                fix_input_tokens += g.0;
                fix_output_tokens += g.1;
            }

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

        Ok((all_fix_ops, false, MAX_BUILD_FIX_RETRIES, duplicate_bailouts, fix_input_tokens, fix_output_tokens))
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
            stderr: None,
            stdout: None,
            attempt: Some(attempt),
            tests: vec![],
            summary: None,
        });

        let test_start = Instant::now();
        let test_result = build_verify::run_build_command(base_path, test_command, None).await?;
        let test_duration_ms = test_start.elapsed().as_millis() as u64;
        let (tests, summary) = build_verify::parse_test_output(
            &test_result.stdout, &test_result.stderr, test_result.success,
        );

        if test_result.success {
            self.emit(EngineEvent::TestVerificationPassed {
                project_id: project.project_id,
                agent_instance_id: session.agent_instance_id,
                task_id: task.task_id,
                command: test_command.to_string(),
                stdout: test_result.stdout.clone(),
                tests: tests.clone(),
                summary: summary.clone(),
                duration_ms: Some(test_duration_ms),
            });
            self.persist_test_step(task, TestStepRecord {
                kind: "passed".into(),
                command: Some(test_command.to_string()),
                stderr: None,
                stdout: Some(test_result.stdout),
                attempt: Some(attempt),
                tests,
                summary: Some(summary),
            });
            return Ok((true, 0, 0));
        }

        if !baseline_test_failures.is_empty() {
            let current_failures: HashSet<String> = tests
                .iter()
                .filter(|t| t.status == "failed")
                .map(|t| t.name.clone())
                .collect();
            let new_failures: Vec<&String> = current_failures
                .iter()
                .filter(|name| !baseline_test_failures.contains(*name))
                .collect();
            if new_failures.is_empty() {
                info!(
                    task_id = %task.task_id,
                    pre_existing = current_failures.len(),
                    "all test failures are pre-existing (baseline), treating as passed"
                );
                let adjusted_summary = format!(
                    "{summary} ({} pre-existing, ignored)",
                    current_failures.len()
                );
                self.emit(EngineEvent::TestVerificationPassed {
                    project_id: project.project_id,
                    agent_instance_id: session.agent_instance_id,
                    task_id: task.task_id,
                    command: test_command.to_string(),
                    stdout: test_result.stdout.clone(),
                    tests: tests.clone(),
                    summary: adjusted_summary.clone(),
                    duration_ms: Some(test_duration_ms),
                });
                self.persist_test_step(task, TestStepRecord {
                    kind: "passed_with_baseline_failures".into(),
                    command: Some(test_command.to_string()),
                    stderr: Some(test_result.stderr),
                    stdout: Some(test_result.stdout),
                    attempt: Some(attempt),
                    tests,
                    summary: Some(adjusted_summary),
                });
                return Ok((true, 0, 0));
            }
            info!(
                task_id = %task.task_id,
                new_failures = ?new_failures,
                pre_existing = current_failures.len() - new_failures.len(),
                "found {} new test failure(s) beyond baseline",
                new_failures.len()
            );
        }

        self.emit(EngineEvent::TestVerificationFailed {
            project_id: project.project_id,
            agent_instance_id: session.agent_instance_id,
            task_id: task.task_id,
            command: test_command.to_string(),
            stdout: test_result.stdout.clone(),
            stderr: test_result.stderr.clone(),
            attempt,
            tests: tests.clone(),
            summary: summary.clone(),
            duration_ms: Some(test_duration_ms),
        });
        self.persist_test_step(task, TestStepRecord {
            kind: "failed".into(),
            command: Some(test_command.to_string()),
            stderr: Some(test_result.stderr.clone()),
            stdout: Some(test_result.stdout.clone()),
            attempt: Some(attempt),
            tests,
            summary: Some(summary),
        });

        self.emit(EngineEvent::TestFixAttempt {
            project_id: project.project_id,
            agent_instance_id: session.agent_instance_id,
            task_id: task.task_id,
            attempt,
        });
        self.persist_test_step(task, TestStepRecord {
            kind: "fix_attempt".into(),
            command: None,
            stderr: None,
            stdout: None,
            attempt: Some(attempt),
            tests: vec![],
            summary: None,
        });

        let spec = self.store.get_spec(&task.project_id, &task.spec_id)?;
        let codebase_snapshot =
            file_ops::read_relevant_files(&project.linked_folder_path, 50_000)?;

        let fix_prompt = build_fix_prompt_with_history(
            project,
            &spec,
            task,
            session,
            &codebase_snapshot,
            test_command,
            &test_result.stderr,
            &test_result.stdout,
            &initial_execution.notes,
            &[],
        );

        let test_fix_tc: Arc<Mutex<(u64, u64)>> = Arc::new(Mutex::new((0, 0)));
        let (stream_tx, mut stream_rx) = mpsc::unbounded_channel::<ClaudeStreamEvent>();
        let test_fix_tc_clone = test_fix_tc.clone();
        let forwarder = tokio::spawn(async move {
            while let Some(evt) = stream_rx.recv().await {
                if let ClaudeStreamEvent::Done { input_tokens, output_tokens, .. } = evt {
                    let mut g = test_fix_tc_clone.lock().await;
                    g.0 += input_tokens;
                    g.1 += output_tokens;
                }
            }
        });

        let response = self
            .claude_client
            .complete_stream(
                api_key,
                &build_fix_system_prompt(),
                &fix_prompt,
                TASK_EXECUTION_MAX_TOKENS,
                stream_tx,
            )
            .await?;
        let _ = forwarder.await;

        let (test_fix_inp, test_fix_out) = *test_fix_tc.lock().await;

        match parse_execution_response(&response) {
            Ok(fix_execution) => {
                file_ops::apply_file_ops(base_path, &fix_execution.file_ops).await?;
                if !fix_execution.file_ops.is_empty() {
                    self.emit_file_ops_applied(project.project_id, session.agent_instance_id, task, &fix_execution.file_ops);
                }
                all_fix_ops.extend(fix_execution.file_ops);
            }
            Err(e) => {
                warn!(
                    task_id = %task.task_id,
                    attempt,
                    error = %e,
                    "failed to parse test-fix response"
                );
            }
        }

        Ok((false, test_fix_inp, test_fix_out))
    }
}
