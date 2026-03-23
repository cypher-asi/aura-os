use std::path::Path;

use tracing::warn;

use aura_billing::MeteredCompletionRequest;
use aura_claude::StreamTokenCapture;
use aura_core::*;

use super::build_fix::{normalize_error_signature, BuildFixAttemptRecord};
use super::orchestrator::DevLoopEngine;
use super::parser::parse_execution_response;
use super::prompts::{
    build_fix_prompt_with_history, build_fix_system_prompt, BuildFixPromptParams,
};
use super::types::*;
use crate::error::EngineError;
use crate::file_ops::{self, FileOp, WorkspaceCache};

/// Describe each file op as a human-readable "op_name path" string.
pub(crate) fn describe_file_ops(ops: &[FileOp]) -> Vec<String> {
    ops.iter()
        .map(|op| {
            let (op_name, path) = match op {
                FileOp::Create { path, .. } => ("create", path.as_str()),
                FileOp::Modify { path, .. } => ("modify", path.as_str()),
                FileOp::Delete { path } => ("delete", path.as_str()),
                FileOp::SearchReplace { path, .. } => ("search_replace", path.as_str()),
            };
            format!("{op_name} {path}")
        })
        .collect()
}

fn truncate_str(s: &str, max: usize) -> &str {
    if s.len() <= max {
        s
    } else {
        &s[..max]
    }
}

pub(crate) fn summarize_file_ops(ops: &[FileOp]) -> String {
    ops.iter()
        .map(|op| match op {
            FileOp::SearchReplace {
                path, replacements, ..
            } => {
                let changes: Vec<String> = replacements
                    .iter()
                    .map(|r| {
                        format!(
                            "  - replaced: {:?} -> {:?}",
                            truncate_str(&r.search, 80),
                            truncate_str(&r.replace, 80),
                        )
                    })
                    .collect();
                format!("{}:\n{}", path, changes.join("\n"))
            }
            FileOp::Modify { path, .. } => format!("{}: full rewrite", path),
            FileOp::Create { path, .. } => format!("{}: created", path),
            FileOp::Delete { path } => format!("{}: deleted", path),
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Build a codebase snapshot for fix prompts using the workspace cache.
/// Falls back to `read_relevant_files` if the cache lookup fails.
pub(crate) async fn build_codebase_snapshot(
    project_folder: &str,
    task_title: &str,
    task_description: &str,
    budget: usize,
    workspace_cache: &WorkspaceCache,
) -> String {
    match file_ops::retrieve_task_relevant_files_cached(
        project_folder,
        task_title,
        task_description,
        budget,
        workspace_cache,
    )
    .await
    {
        Ok(s) => s,
        Err(_) => file_ops::read_relevant_files(project_folder, budget).unwrap_or_default(),
    }
}

impl DevLoopEngine {
    /// Shared LLM call for both build and test fix requests.
    ///
    /// Loads the spec, builds the fix prompt from the given context, and
    /// streams the response from the LLM. Returns the response text and
    /// token counts.
    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn request_fix(
        &self,
        project: &Project,
        task: &Task,
        session: &Session,
        api_key: &str,
        initial_execution: &TaskExecution,
        command: &str,
        stderr: &str,
        stdout: &str,
        codebase_snapshot: &str,
        prior_attempts: &[BuildFixAttemptRecord],
    ) -> Result<(String, u64, u64), EngineError> {
        let spec = self.load_spec(&task.project_id, &task.spec_id).await?;
        let fix_prompt = build_fix_prompt_with_history(&BuildFixPromptParams {
            project,
            spec: &spec,
            task,
            session,
            codebase_snapshot,
            build_command: command,
            stderr,
            stdout,
            prior_notes: &initial_execution.notes,
            prior_attempts,
        });
        let (tx, handle) = StreamTokenCapture::sink();
        let response = self
            .llm
            .complete_stream(
                MeteredCompletionRequest {
                    model: None,
                    api_key,
                    system_prompt: &build_fix_system_prompt(),
                    user_message: &fix_prompt,
                    max_tokens: self.llm_config.task_execution_max_tokens,
                    billing_reason: "aura_build_fix",
                    metadata: None,
                },
                tx,
            )
            .await?;
        let (inp, out, _, _) = handle.finalize().await;
        Ok((response, inp, out))
    }

    /// Shared logic for applying a fix response: parse the execution
    /// response, apply file ops, emit events, and record the attempt.
    ///
    /// Returns `(fix_applied, file_ops)` where `fix_applied` is `false`
    /// when parsing or file-ops application fails.
    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn apply_fix_and_record(
        &self,
        project: &Project,
        session: &Session,
        task: &Task,
        base_path: &Path,
        response: &str,
        attempt: u32,
        stderr: &str,
        prior_attempts: &mut Vec<BuildFixAttemptRecord>,
        all_fix_ops: &mut Vec<FileOp>,
        fix_kind: &str,
    ) -> Result<bool, EngineError> {
        match parse_execution_response(response) {
            Ok(fix_execution) => {
                if let Err(e) = file_ops::apply_file_ops(base_path, &fix_execution.file_ops).await {
                    warn!(
                        task_id = %task.task_id, attempt, error = %e,
                        "file ops failed during {fix_kind} (likely search-replace mismatch), \
                         treating as failed fix attempt"
                    );
                    let sig = normalize_error_signature(stderr);
                    prior_attempts.push(BuildFixAttemptRecord {
                        stderr: stderr.to_string(),
                        error_signature: sig,
                        files_changed: vec!["(fix did not apply)".into()],
                        changes_summary: String::new(),
                    });
                    return Ok(false);
                }
                if !fix_execution.file_ops.is_empty() {
                    self.emit_file_ops_applied(
                        project.project_id,
                        session.agent_instance_id,
                        task,
                        &fix_execution.file_ops,
                    );
                }
                let files_changed = describe_file_ops(&fix_execution.file_ops);
                let changes_summary = summarize_file_ops(&fix_execution.file_ops);
                let sig = normalize_error_signature(stderr);
                prior_attempts.push(BuildFixAttemptRecord {
                    stderr: stderr.to_string(),
                    error_signature: sig,
                    files_changed,
                    changes_summary,
                });
                all_fix_ops.extend(fix_execution.file_ops);
                Ok(true)
            }
            Err(e) => {
                warn!(
                    task_id = %task.task_id, attempt, error = %e,
                    "failed to parse {fix_kind} response, fix not applied"
                );
                Ok(false)
            }
        }
    }
}
