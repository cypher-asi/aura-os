use std::collections::HashSet;
use std::path::Path;
use std::time::Instant;

use tracing::warn;

use aura_core::*;
use aura_claude::StreamTokenCapture;

use super::build_fix::{auto_correct_build_command, normalize_error_signature, BuildFixAttemptRecord};
use super::orchestrator::DevLoopEngine;
use super::parser::parse_execution_response;
use super::prompts::*;
use super::types::*;
use crate::build_verify;
use crate::error::EngineError;
use crate::events::EngineEvent;
use crate::file_ops::{self, FileOp, WorkspaceCache};

impl DevLoopEngine {
    pub(crate) async fn execute_shell_task(
        &self,
        project: &Project,
        task: &Task,
        command: &str,
        agent_instance_id: AgentInstanceId,
    ) -> Result<TaskExecution, EngineError> {
        let command = if let Some(corrected) = auto_correct_build_command(command) {
            warn!(old = %command, new = %corrected, "eagerly rewriting server-starting shell command");
            corrected
        } else {
            command.to_string()
        };
        let command = command.as_str();

        let base_path = Path::new(&project.linked_folder_path);
        let max_attempts: u32 = self.engine_config.max_shell_task_retries;
        let mut prior_attempts_shell: Vec<BuildFixAttemptRecord> = Vec::new();

        for attempt in 1..=max_attempts {
            let result = self.run_shell_attempt(
                project, task, command, agent_instance_id, attempt, max_attempts, base_path,
            ).await?;

            if result.success {
                if let Some(early) = self.handle_shell_success(
                    project, task, command, agent_instance_id, attempt, max_attempts,
                    base_path, &result,
                ).await? {
                    return Ok(early);
                }
                continue;
            }

            let detail = if !result.stderr.is_empty() { &result.stderr } else { &result.stdout };
            self.emit_shell_failure(project, task, command, agent_instance_id, attempt, &result);

            let current_sig = normalize_error_signature(detail);
            let consecutive_dupes = prior_attempts_shell
                .iter()
                .rev()
                .take_while(|a| a.error_signature == current_sig)
                .count();
            if consecutive_dupes >= 2 {
                tracing::info!(
                    task_id = %task.task_id, attempt,
                    "same shell error pattern repeated {} times, aborting fix loop",
                    consecutive_dupes + 1,
                );
                return Err(EngineError::Build(format!(
                    "command `{command}` keeps failing with the same error after {} attempts",
                    consecutive_dupes + 1,
                )));
            }

            if attempt < max_attempts {
                let attempt_files = self
                    .attempt_shell_fix(
                        project, task, command, agent_instance_id, attempt,
                        base_path, &result.stderr, &result.stdout, &prior_attempts_shell,
                    ).await?;
                prior_attempts_shell.push(BuildFixAttemptRecord {
                    stderr: detail.to_string(),
                    error_signature: normalize_error_signature(detail),
                    files_changed: attempt_files,
                });
            }
        }

        Err(EngineError::Build(format!(
            "command `{command}` failed after {max_attempts} attempts"
        )))
    }

    async fn run_shell_attempt(
        &self,
        project: &Project,
        task: &Task,
        command: &str,
        agent_instance_id: AgentInstanceId,
        attempt: u32,
        max_attempts: u32,
        base_path: &Path,
    ) -> Result<build_verify::BuildResult, EngineError> {
        let shell_step_start = Instant::now();
        self.emit(EngineEvent::BuildVerificationStarted {
            project_id: project.project_id,
            agent_instance_id,
            task_id: task.task_id,
            command: command.to_string(),
        });
        self.persist_build_step(task, BuildStepRecord {
            kind: "started".into(),
            command: Some(command.to_string()),
            stderr: None, stdout: None,
            attempt: Some(attempt),
        });
        let _ = self.event_tx.send(EngineEvent::TaskOutputDelta {
            project_id: project.project_id,
            agent_instance_id,
            task_id: task.task_id,
            delta: format!("Running: {command} (attempt {attempt}/{max_attempts})\n"),
        });

        let (line_tx, mut line_rx) = tokio::sync::mpsc::unbounded_channel();
        let fwd_event_tx = self.event_tx.clone();
        let fwd_pid = project.project_id;
        let fwd_aiid = agent_instance_id;
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

        let result = build_verify::run_build_command(base_path, command, Some(line_tx)).await?;
        let shell_step_duration_ms = shell_step_start.elapsed().as_millis() as u64;

        if result.success {
            self.emit(EngineEvent::BuildVerificationPassed {
                project_id: project.project_id,
                agent_instance_id,
                task_id: task.task_id,
                command: command.to_string(),
                stdout: result.stdout.clone(),
                duration_ms: Some(shell_step_duration_ms),
            });
            self.persist_build_step(task, BuildStepRecord {
                kind: "passed".into(),
                command: Some(command.to_string()),
                stderr: None,
                stdout: Some(result.stdout.clone()),
                attempt: Some(attempt),
            });
        }
        Ok(result)
    }

    async fn handle_shell_success(
        &self,
        project: &Project,
        task: &Task,
        command: &str,
        agent_instance_id: AgentInstanceId,
        attempt: u32,
        max_attempts: u32,
        base_path: &Path,
        result: &build_verify::BuildResult,
    ) -> Result<Option<TaskExecution>, EngineError> {
        if let Some(ref test_cmd) = project.test_command {
            if !test_cmd.trim().is_empty() {
                let dummy_session = Session::dummy(project.project_id);
                let dummy_exec = TaskExecution {
                    notes: format!("Shell command: {command}"),
                    file_ops: vec![], follow_up_tasks: vec![],
                    input_tokens: 0, output_tokens: 0,
                    parse_retries: 0, files_already_applied: false,
                };
                let mut test_fix_ops = Vec::new();
                let no_baseline = HashSet::new();
                let mut prior_test_attempts = Vec::new();
                let shell_ws_cache = WorkspaceCache::build_async(&project.linked_folder_path).await?;
                let (test_passed, _test_inp, _test_out) = self.run_and_handle_tests(
                    project, task, &dummy_session,
                    &self.settings.get_decrypted_api_key()?,
                    &dummy_exec, test_cmd, base_path, attempt, &mut test_fix_ops,
                    &no_baseline, &mut prior_test_attempts, &shell_ws_cache,
                ).await?;
                if !test_passed {
                    if attempt < max_attempts {
                        return Ok(None);
                    }
                    return Err(EngineError::Build(
                        format!("test command `{test_cmd}` failed after {max_attempts} attempts"),
                    ));
                }
            }
        }

        let notes = format!("Command `{command}` succeeded on attempt {attempt}.\n{}", result.stdout);
        let _ = self.event_tx.send(EngineEvent::TaskOutputDelta {
            project_id: project.project_id,
            agent_instance_id,
            task_id: task.task_id,
            delta: notes.clone(),
        });

        Ok(Some(TaskExecution {
            notes,
            file_ops: vec![], follow_up_tasks: vec![],
            input_tokens: 0, output_tokens: 0,
            parse_retries: 0, files_already_applied: false,
        }))
    }

    fn emit_shell_failure(
        &self,
        project: &Project,
        task: &Task,
        command: &str,
        agent_instance_id: AgentInstanceId,
        attempt: u32,
        result: &build_verify::BuildResult,
    ) {
        let shell_error_hash = Some(format!("{:x}", {
            let stderr_ref = if !result.stderr.is_empty() { &result.stderr } else { &result.stdout };
            let mut h = 0u64;
            for b in stderr_ref.bytes() {
                h = h.wrapping_mul(31).wrapping_add(b as u64);
            }
            h
        }));
        self.emit(EngineEvent::BuildVerificationFailed {
            project_id: project.project_id,
            agent_instance_id,
            task_id: task.task_id,
            command: command.to_string(),
            stdout: result.stdout.clone(),
            stderr: result.stderr.clone(),
            attempt,
            duration_ms: None,
            error_hash: shell_error_hash,
        });
        self.persist_build_step(task, BuildStepRecord {
            kind: "failed".into(),
            command: Some(command.to_string()),
            stderr: Some(result.stderr.clone()),
            stdout: Some(result.stdout.clone()),
            attempt: Some(attempt),
        });
        let detail = if !result.stderr.is_empty() { &result.stderr } else { &result.stdout };
        let _ = self.event_tx.send(EngineEvent::TaskOutputDelta {
            project_id: project.project_id,
            agent_instance_id,
            task_id: task.task_id,
            delta: format!("Command failed (attempt {attempt}):\n{detail}\n"),
        });
    }

    async fn attempt_shell_fix(
        &self,
        project: &Project,
        task: &Task,
        command: &str,
        agent_instance_id: AgentInstanceId,
        attempt: u32,
        base_path: &Path,
        stderr: &str,
        stdout: &str,
        prior_attempts: &[BuildFixAttemptRecord],
    ) -> Result<Vec<String>, EngineError> {
        self.emit(EngineEvent::BuildFixAttempt {
            project_id: project.project_id,
            agent_instance_id,
            task_id: task.task_id,
            attempt,
        });
        self.persist_build_step(task, BuildStepRecord {
            kind: "fix_attempt".into(),
            command: None, stderr: None, stdout: None,
            attempt: Some(attempt),
        });

        let spec = self.store.get_spec(&task.project_id, &task.spec_id)?;
        let codebase_snapshot = file_ops::read_relevant_files(&project.linked_folder_path, 30_000)?;
        let dummy_session = Session::dummy(project.project_id);
        let fix_prompt = build_fix_prompt_with_history(
            project, &spec, task, &dummy_session,
            &codebase_snapshot, command,
            stderr, stdout, &format!("Shell command task: {command}"),
            prior_attempts,
        );

        let api_key = self.settings.get_decrypted_api_key()?;
        let (stream_tx, sink_handle) = StreamTokenCapture::sink();
        let response = self.llm.complete_stream(
            &api_key, &build_fix_system_prompt(), &fix_prompt,
            self.llm_config.task_execution_max_tokens,
            stream_tx, "aura_build_fix", None,
        ).await?;
        let _ = sink_handle.finalize().await;

        let mut attempt_files: Vec<String> = Vec::new();
        if let Ok(fix_execution) = parse_execution_response(&response) {
            if !fix_execution.file_ops.is_empty() {
                for op in &fix_execution.file_ops {
                    let (op_name, path) = match op {
                        FileOp::Create { path, .. } => ("create", path.as_str()),
                        FileOp::Modify { path, .. } => ("modify", path.as_str()),
                        FileOp::Delete { path } => ("delete", path.as_str()),
                        FileOp::SearchReplace { path, .. } => ("search_replace", path.as_str()),
                    };
                    attempt_files.push(format!("{op_name} {path}"));
                }
                let _ = file_ops::apply_file_ops(base_path, &fix_execution.file_ops).await;
                self.emit_file_ops_applied(project.project_id, agent_instance_id, task, &fix_execution.file_ops);
            }
        }
        Ok(attempt_files)
    }
}
