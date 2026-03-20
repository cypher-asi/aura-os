use std::path::Path;
use std::sync::Arc;

use async_trait::async_trait;
use tokio::sync::Mutex;

use aura_core::*;
use aura_claude::ToolCall;
use aura_chat::{AutoBuildResult, BuildBaseline, ChatToolExecutor, ToolCallResult, ToolExecResult, ToolExecutor};

use super::build_fix::{
    infer_default_build_command,
    classify_build_errors, error_category_guidance, parse_error_references,
};
use super::prompts::build_stub_fix_prompt;
use super::types::{track_file_op, FollowUpSuggestion};
use crate::build_verify;
use crate::channel_ext::send_or_log;
use crate::events::EngineEvent;
use crate::file_ops::{self, FileOp};

use tokio::sync::mpsc;

const MAX_STUB_FIX_ATTEMPTS: u32 = 2;

pub(crate) struct EngineToolLoopExecutor {
    pub inner: ChatToolExecutor,
    pub project_id: ProjectId,
    pub project: Project,
    pub spec: Spec,
    pub task: Task,
    pub session: Session,
    pub engine_event_tx: mpsc::UnboundedSender<EngineEvent>,
    pub agent_instance_id: AgentInstanceId,
    pub task_id: TaskId,
    pub tracked_file_ops: Arc<Mutex<Vec<FileOp>>>,
    pub notes: Arc<Mutex<String>>,
    pub follow_ups: Arc<Mutex<Vec<FollowUpSuggestion>>>,
    pub stub_fix_attempts: Arc<Mutex<u32>>,
    pub completed_deps: Vec<Task>,
    pub work_log_summary: String,
    pub exploration_allowance: usize,
}

#[async_trait]
impl ToolExecutor for EngineToolLoopExecutor {
    async fn auto_build_check(&self) -> Option<AutoBuildResult> {
        let project_root = std::path::Path::new(&self.project.linked_folder_path);
        let cmd = self.project.build_command.as_deref()
            .filter(|s| !s.trim().is_empty())
            .map(String::from)
            .or_else(|| infer_default_build_command(project_root))?;

        send_or_log(&self.engine_event_tx, EngineEvent::TaskOutputDelta {
            project_id: self.project_id,
            agent_instance_id: self.agent_instance_id,
            task_id: self.task_id,
            delta: format!("\n[auto-build: {}]\n", cmd),
        });

        match build_verify::run_build_command(project_root, &cmd, None).await {
            Ok(result) => {
                let mut output = String::new();
                if !result.stdout.is_empty() {
                    output.push_str(&result.stdout);
                }
                if !result.stderr.is_empty() {
                    if !output.is_empty() { output.push('\n'); }
                    output.push_str(&result.stderr);
                }
                let output = if !result.success {
                    self.enrich_compiler_output(&output)
                } else {
                    output
                };
                Some(AutoBuildResult {
                    success: result.success,
                    output,
                })
            }
            Err(e) => {
                tracing::warn!(error = %e, "auto-build check failed to execute");
                None
            }
        }
    }

    async fn capture_build_baseline(&self) -> Option<BuildBaseline> {
        let project_root = std::path::Path::new(&self.project.linked_folder_path);
        let cmd = self.project.build_command.as_deref()
            .filter(|s| !s.trim().is_empty())
            .map(String::from)
            .or_else(|| infer_default_build_command(project_root))?;

        match build_verify::run_build_command(project_root, &cmd, None).await {
            Ok(result) if !result.success => {
                let sigs = BuildBaseline::extract_signatures(&result.stderr);
                tracing::info!(
                    count = sigs.len(),
                    "captured build baseline with pre-existing errors"
                );
                Some(BuildBaseline { error_signatures: sigs })
            }
            Ok(_) => Some(BuildBaseline::default()),
            Err(e) => {
                tracing::warn!(error = %e, "failed to capture build baseline");
                None
            }
        }
    }

    async fn execute(&self, tool_calls: &[ToolCall]) -> Vec<ToolCallResult> {
        let mut executor_indices: Vec<usize> = Vec::new();
        for (i, tc) in tool_calls.iter().enumerate() {
            match tc.name.as_str() {
                "task_done" | "get_task_context" => {}
                _ => {
                    {
                        let mut ops = self.tracked_file_ops.lock().await;
                        track_file_op(&tc.name, &tc.input, &mut ops);
                    }
                    executor_indices.push(i);
                }
            }
        }

        let executor_futures: Vec<_> = executor_indices
            .iter()
            .map(|&i| {
                let tc = &tool_calls[i];
                self.inner.execute(&self.project_id, &tc.name, tc.input.clone())
            })
            .collect();
        let executor_results = futures::future::join_all(executor_futures).await;

        let mut exec_result_iter = executor_results.into_iter();
        let mut results = Vec::with_capacity(tool_calls.len());
        let mut stop = false;

        for tc in tool_calls {
            match tc.name.as_str() {
                "task_done" => {
                    self.handle_task_done(tc, &mut results, &mut stop).await;
                }
                "get_task_context" => {
                    self.handle_get_context(tc, &mut results);
                }
                _ => {
                    self.handle_delegated_tool(tc, &mut exec_result_iter, &mut results);
                }
            }
        }

        if stop {
            for r in &mut results {
                r.stop_loop = true;
            }
        }

        results
    }
}

impl EngineToolLoopExecutor {
    fn enrich_compiler_output(&self, raw_output: &str) -> String {
        if !looks_like_compiler_errors(raw_output) {
            return raw_output.to_string();
        }

        let base_path = Path::new(&self.project.linked_folder_path);

        let categories = classify_build_errors(raw_output);
        let guidance = error_category_guidance(&categories);
        let refs = parse_error_references(raw_output);
        let api_ref = file_ops::resolve_error_context(base_path, &refs);

        let mut enriched = raw_output.to_string();

        if !guidance.is_empty() {
            enriched.push_str("\n\n## Error Diagnosis & Guidance\n\n");
            enriched.push_str(&guidance);
        }

        if !api_ref.is_empty() {
            enriched.push('\n');
            enriched.push_str(&api_ref);
        }

        enriched
    }

    async fn handle_task_done(
        &self,
        tc: &ToolCall,
        results: &mut Vec<ToolCallResult>,
        stop: &mut bool,
    ) {
        let task_notes = tc
            .input
            .get("notes")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        {
            let mut n = self.notes.lock().await;
            *n = task_notes;
        }
        if let Some(arr) = tc.input.get("follow_ups").and_then(|v| v.as_array()) {
            let mut fu_lock = self.follow_ups.lock().await;
            for fu in arr {
                let title = fu.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let desc = fu.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string();
                fu_lock.push(FollowUpSuggestion { title, description: desc });
            }
        }

        let stub_rejected = {
            let mut attempts = self.stub_fix_attempts.lock().await;
            if *attempts < MAX_STUB_FIX_ATTEMPTS {
                let base_path = Path::new(&self.project.linked_folder_path);
                let ops = self.tracked_file_ops.lock().await;
                let stub_reports = file_ops::detect_stub_patterns(base_path, &*ops);
                if !stub_reports.is_empty() {
                    *attempts += 1;
                    let attempt = *attempts;
                    send_or_log(&self.engine_event_tx, EngineEvent::TaskOutputDelta {
                        project_id: self.project_id,
                        agent_instance_id: self.agent_instance_id,
                        task_id: self.task_id,
                        delta: format!(
                            "\n[stub detection] found {} stub(s), requesting fix (attempt {}/{})\n",
                            stub_reports.len(), attempt, MAX_STUB_FIX_ATTEMPTS,
                        ),
                    });
                    Some(build_stub_fix_prompt(&stub_reports))
                } else {
                    None
                }
            } else {
                None
            }
        };

        if let Some(stub_prompt) = stub_rejected {
            results.push(ToolCallResult {
                tool_use_id: tc.id.clone(),
                content: stub_prompt,
                is_error: true,
                stop_loop: false,
            });
        } else {
            results.push(ToolCallResult {
                tool_use_id: tc.id.clone(),
                content: r#"{"status":"completed"}"#.to_string(),
                is_error: false,
                stop_loop: true,
            });
            *stop = true;
        }
    }

    fn handle_get_context(&self, tc: &ToolCall, results: &mut Vec<ToolCallResult>) {
        let ctx = super::prompts::build_agentic_task_context(
            &self.project,
            &self.spec,
            &self.task,
            &self.session,
            &self.completed_deps,
            &self.work_log_summary,
            self.exploration_allowance,
        );
        results.push(ToolCallResult {
            tool_use_id: tc.id.clone(),
            content: ctx,
            is_error: false,
            stop_loop: false,
        });
    }

    fn handle_delegated_tool(
        &self,
        tc: &ToolCall,
        exec_result_iter: &mut impl Iterator<Item = ToolExecResult>,
        results: &mut Vec<ToolCallResult>,
    ) {
        if let Some(result) = exec_result_iter.next() {
            let arg_hint = match tc.name.as_str() {
                "read_file" => {
                    let path = tc.input.get("path").and_then(|v| v.as_str()).unwrap_or("");
                    let start = tc.input.get("start_line").and_then(|v| v.as_u64());
                    let end = tc.input.get("end_line").and_then(|v| v.as_u64());
                    match (start, end) {
                        (Some(s), Some(e)) => format!("{path}:{s}-{e}"),
                        (Some(s), None) => format!("{path}:{s}-end"),
                        (None, Some(e)) => format!("{path}:1-{e}"),
                        (None, None) => path.to_string(),
                    }
                }
                "write_file" | "edit_file" | "delete_file" => {
                    tc.input.get("path").and_then(|v| v.as_str()).unwrap_or("").to_string()
                }
                "list_files" => {
                    tc.input.get("directory").and_then(|v| v.as_str()).unwrap_or("").to_string()
                }
                "search_code" => {
                    let pattern = tc.input.get("pattern").and_then(|v| v.as_str()).unwrap_or("");
                    let ctx = tc.input.get("context_lines").and_then(|v| v.as_u64());
                    if let Some(c) = ctx {
                        format!("{pattern}, context={c}")
                    } else {
                        pattern.to_string()
                    }
                }
                "run_command" => {
                    tc.input.get("command").and_then(|v| v.as_str()).unwrap_or("").to_string()
                }
                _ => String::new(),
            };
            let status_str = if result.is_error { "error" } else { "ok" };
            let marker = if arg_hint.is_empty() {
                format!("\n[tool: {} -> {}]\n", tc.name, status_str)
            } else {
                format!("\n[tool: {}({}) -> {}]\n", tc.name, arg_hint, status_str)
            };
            send_or_log(&self.engine_event_tx, EngineEvent::TaskOutputDelta {
                project_id: self.project_id,
                agent_instance_id: self.agent_instance_id,
                task_id: self.task_id,
                delta: marker,
            });

            let content = if tc.name == "run_command" && result.is_error {
                self.enrich_compiler_output(&result.content)
            } else {
                result.content
            };

            results.push(ToolCallResult {
                tool_use_id: tc.id.clone(),
                content,
                is_error: result.is_error,
                stop_loop: false,
            });
        }
    }
}

fn looks_like_compiler_errors(output: &str) -> bool {
    let has_rust_errors = output.contains("error[E") && output.contains("-->");
    let has_generic_errors = output.contains("error:") && output.contains("-->");
    let has_ts_errors = output.contains("TS2") && output.contains("error TS");
    has_rust_errors || has_generic_errors || has_ts_errors
}

