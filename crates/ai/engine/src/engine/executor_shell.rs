use std::collections::HashSet;
use std::path::Path;
use std::time::Instant;

use aura_billing::MeteredCompletionRequest;
use aura_claude::StreamTokenCapture;
use aura_core::*;

use super::build_fix::{
    auto_correct_build_command, normalize_error_signature, BuildFixAttemptRecord,
};
use super::orchestrator::DevLoopEngine;
use super::parser::parse_execution_response;
use super::prompts::{
    build_fix_prompt_with_history, build_fix_system_prompt, BuildFixPromptParams,
};
use super::types::*;
use crate::build_verify;
use crate::channel_ext::send_or_log;
use crate::error::EngineError;
use crate::events::EngineEvent;
use crate::file_ops::{self, FileOp, WorkspaceCache};

pub(crate) fn check_repeated_error(
    prior: &[BuildFixAttemptRecord],
    current_sig: &str,
    task_id: &TaskId,
    attempt: u32,
    command: &str,
) -> Option<EngineError> {
    let consecutive_dupes = prior
        .iter()
        .rev()
        .take_while(|a| a.error_signature == current_sig)
        .count();
    if consecutive_dupes >= 2 {
        tracing::info!(
            task_id = %task_id, attempt,
            "same shell error pattern repeated {} times, aborting fix loop",
            consecutive_dupes + 1,
        );
        return Some(EngineError::Build(format!(
            "command `{command}` keeps failing with the same error after {} attempts",
            consecutive_dupes + 1,
        )));
    }
    None
}

pub(crate) struct ShellTaskContext<'a> {
    pub project: &'a Project,
    pub task: &'a Task,
    pub command: &'a str,
    pub agent_instance_id: AgentInstanceId,
    pub base_path: &'a Path,
}

impl DevLoopEngine {
    pub(crate) async fn execute_shell_task(
        &self,
        project: &Project,
        task: &Task,
        command: &str,
        agent_instance_id: AgentInstanceId,
    ) -> Result<TaskExecution, EngineError> {
        let command = auto_correct_build_command(command).unwrap_or_else(|| command.to_string());
        let command = command.as_str();
        let base_path = Path::new(&project.linked_folder_path);
        let max_attempts = self.engine_config.max_shell_task_retries;
        let mut prior: Vec<BuildFixAttemptRecord> = Vec::new();
        let ctx = ShellTaskContext {
            project,
            task,
            command,
            agent_instance_id,
            base_path,
        };

        for attempt in 1..=max_attempts {
            let result = self.run_shell_attempt(&ctx, attempt, max_attempts).await?;

            if result.success {
                if let Some(early) = self
                    .handle_shell_success(&ctx, attempt, max_attempts, &result)
                    .await?
                {
                    return Ok(early);
                }
                continue;
            }

            let detail = if !result.stderr.is_empty() {
                &result.stderr
            } else {
                &result.stdout
            };
            self.emit_shell_failure(&ctx, attempt, &result);
            if let Some(e) = check_repeated_error(
                &prior,
                &normalize_error_signature(detail),
                &task.task_id,
                attempt,
                command,
            ) {
                return Err(e);
            }

            if attempt < max_attempts {
                let files = self
                    .attempt_shell_fix(&ctx, attempt, &result.stderr, &result.stdout, &prior)
                    .await?;
                prior.push(BuildFixAttemptRecord {
                    stderr: detail.to_string(),
                    error_signature: normalize_error_signature(detail),
                    files_changed: files,
                    changes_summary: String::new(),
                });
            }
        }
        Err(EngineError::Build(format!(
            "command `{command}` failed after {max_attempts} attempts"
        )))
    }

    async fn run_shell_attempt(
        &self,
        ctx: &ShellTaskContext<'_>,
        attempt: u32,
        max_attempts: u32,
    ) -> Result<build_verify::BuildResult, EngineError> {
        let shell_step_start = Instant::now();
        self.emit(EngineEvent::BuildVerificationStarted {
            project_id: ctx.project.project_id,
            agent_instance_id: ctx.agent_instance_id,
            task_id: ctx.task.task_id,
            command: ctx.command.to_string(),
        });
        send_or_log(
            &self.event_tx,
            EngineEvent::TaskOutputDelta {
                project_id: ctx.project.project_id,
                agent_instance_id: ctx.agent_instance_id,
                task_id: ctx.task.task_id,
                delta: format!(
                    "Running: {} (attempt {attempt}/{max_attempts})\n",
                    ctx.command
                ),
            },
        );

        let (line_tx, mut line_rx) = tokio::sync::mpsc::unbounded_channel();
        let fwd_event_tx = self.event_tx.clone();
        let fwd_pid = ctx.project.project_id;
        let fwd_aiid = ctx.agent_instance_id;
        let fwd_tid = ctx.task.task_id;
        tokio::spawn(async move {
            while let Some(line) = line_rx.recv().await {
                send_or_log(
                    &fwd_event_tx,
                    EngineEvent::TaskOutputDelta {
                        project_id: fwd_pid,
                        agent_instance_id: fwd_aiid,
                        task_id: fwd_tid,
                        delta: line,
                    },
                );
            }
        });

        let result =
            build_verify::run_build_command(ctx.base_path, ctx.command, Some(line_tx)).await?;
        let shell_step_duration_ms = shell_step_start.elapsed().as_millis() as u64;

        if result.success {
            self.emit(EngineEvent::BuildVerificationPassed {
                project_id: ctx.project.project_id,
                agent_instance_id: ctx.agent_instance_id,
                task_id: ctx.task.task_id,
                command: ctx.command.to_string(),
                stdout: result.stdout.clone(),
                duration_ms: Some(shell_step_duration_ms),
            });
        }
        Ok(result)
    }

    async fn handle_shell_success(
        &self,
        ctx: &ShellTaskContext<'_>,
        attempt: u32,
        max_attempts: u32,
        result: &build_verify::BuildResult,
    ) -> Result<Option<TaskExecution>, EngineError> {
        if let Some(ref test_cmd) = ctx.project.test_command {
            if !test_cmd.trim().is_empty() {
                let dummy_session = Session::dummy(ctx.project.project_id);
                let dummy_exec = TaskExecution {
                    notes: format!("Shell command: {}", ctx.command),
                    file_ops: vec![],
                    follow_up_tasks: vec![],
                    input_tokens: 0,
                    output_tokens: 0,
                    parse_retries: 0,
                    files_already_applied: false,
                };
                let mut test_fix_ops = Vec::new();
                let no_baseline = HashSet::new();
                let mut prior_test_attempts = Vec::new();
                let shell_ws_cache =
                    WorkspaceCache::build_async(&ctx.project.linked_folder_path).await?;
                let (test_passed, _test_inp, _test_out) = self
                    .run_and_handle_tests(
                        ctx.project,
                        ctx.task,
                        &dummy_session,
                        &self.settings.get_decrypted_api_key()?,
                        &dummy_exec,
                        test_cmd,
                        ctx.base_path,
                        attempt,
                        &mut test_fix_ops,
                        &no_baseline,
                        &mut prior_test_attempts,
                        &shell_ws_cache,
                    )
                    .await?;
                if !test_passed {
                    if attempt < max_attempts {
                        return Ok(None);
                    }
                    return Err(EngineError::Build(format!(
                        "test command `{test_cmd}` failed after {max_attempts} attempts"
                    )));
                }
            }
        }

        let notes = format!(
            "Command `{}` succeeded on attempt {attempt}.\n{}",
            ctx.command, result.stdout
        );
        send_or_log(
            &self.event_tx,
            EngineEvent::TaskOutputDelta {
                project_id: ctx.project.project_id,
                agent_instance_id: ctx.agent_instance_id,
                task_id: ctx.task.task_id,
                delta: notes.clone(),
            },
        );

        Ok(Some(TaskExecution {
            notes,
            file_ops: vec![],
            follow_up_tasks: vec![],
            input_tokens: 0,
            output_tokens: 0,
            parse_retries: 0,
            files_already_applied: false,
        }))
    }

    fn emit_shell_failure(
        &self,
        ctx: &ShellTaskContext<'_>,
        attempt: u32,
        result: &build_verify::BuildResult,
    ) {
        let shell_error_hash = Some(format!("{:x}", {
            let stderr_ref = if !result.stderr.is_empty() {
                &result.stderr
            } else {
                &result.stdout
            };
            let mut h = 0u64;
            for b in stderr_ref.bytes() {
                h = h.wrapping_mul(31).wrapping_add(b as u64);
            }
            h
        }));
        self.emit(EngineEvent::BuildVerificationFailed {
            project_id: ctx.project.project_id,
            agent_instance_id: ctx.agent_instance_id,
            task_id: ctx.task.task_id,
            command: ctx.command.to_string(),
            stdout: result.stdout.clone(),
            stderr: result.stderr.clone(),
            attempt,
            duration_ms: None,
            error_hash: shell_error_hash,
        });
        let detail = if !result.stderr.is_empty() {
            &result.stderr
        } else {
            &result.stdout
        };
        send_or_log(
            &self.event_tx,
            EngineEvent::TaskOutputDelta {
                project_id: ctx.project.project_id,
                agent_instance_id: ctx.agent_instance_id,
                task_id: ctx.task.task_id,
                delta: format!("Command failed (attempt {attempt}):\n{detail}\n"),
            },
        );
    }

    async fn attempt_shell_fix(
        &self,
        ctx: &ShellTaskContext<'_>,
        attempt: u32,
        stderr: &str,
        stdout: &str,
        prior_attempts: &[BuildFixAttemptRecord],
    ) -> Result<Vec<String>, EngineError> {
        self.emit(EngineEvent::BuildFixAttempt {
            project_id: ctx.project.project_id,
            agent_instance_id: ctx.agent_instance_id,
            task_id: ctx.task.task_id,
            attempt,
        });
        let spec = self
            .load_spec(&ctx.task.project_id, &ctx.task.spec_id)
            .await?;
        let codebase_snapshot =
            file_ops::read_relevant_files(&ctx.project.linked_folder_path, 30_000)?;
        let dummy_session = Session::dummy(ctx.project.project_id);
        let prior_notes = format!("Shell command task: {}", ctx.command);
        let fix_prompt = build_fix_prompt_with_history(&BuildFixPromptParams {
            project: ctx.project,
            spec: &spec,
            task: ctx.task,
            session: &dummy_session,
            codebase_snapshot: &codebase_snapshot,
            build_command: ctx.command,
            stderr,
            stdout,
            prior_notes: &prior_notes,
            prior_attempts,
        });

        let api_key = self.settings.get_decrypted_api_key()?;
        let (stream_tx, sink_handle) = StreamTokenCapture::sink();
        let response = self
            .llm
            .complete_stream(
                MeteredCompletionRequest {
                    model: None,
                    api_key: &api_key,
                    system_prompt: &build_fix_system_prompt(),
                    user_message: &fix_prompt,
                    max_tokens: self.llm_config.task_execution_max_tokens,
                    billing_reason: "aura_build_fix",
                    metadata: None,
                },
                stream_tx,
            )
            .await?;
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
                let _ = file_ops::apply_file_ops(ctx.base_path, &fix_execution.file_ops).await;
                self.emit_file_ops_applied(
                    ctx.project.project_id,
                    ctx.agent_instance_id,
                    ctx.task,
                    &fix_execution.file_ops,
                );
            }
        }
        Ok(attempt_files)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_check_repeated_error_returns_none_on_first() {
        let result = check_repeated_error(&[], "sig1", &TaskId::new(), 1, "cargo build");
        assert!(result.is_none());
    }

    #[test]
    fn test_check_repeated_error_triggers_after_three_dupes() {
        use super::BuildFixAttemptRecord;
        let prior = vec![
            BuildFixAttemptRecord {
                stderr: "err".into(),
                error_signature: "sig1".into(),
                files_changed: vec![],
                changes_summary: String::new(),
            },
            BuildFixAttemptRecord {
                stderr: "err".into(),
                error_signature: "sig1".into(),
                files_changed: vec![],
                changes_summary: String::new(),
            },
        ];
        let result = check_repeated_error(&prior, "sig1", &TaskId::new(), 3, "cargo build");
        assert!(result.is_some());
    }
}
