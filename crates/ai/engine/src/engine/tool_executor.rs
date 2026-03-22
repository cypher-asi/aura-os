use std::path::Path;
use std::sync::Arc;

use async_trait::async_trait;
use tokio::sync::Mutex;

use aura_chat::{ChatToolExecutor, ToolExecResult};
use aura_core::*;
use aura_link::self_review::SelfReviewGuard;
use aura_link::{AutoBuildResult, BuildBaseline, ToolCall, ToolCallResult, ToolExecutor};

use super::build_fix::{
    classify_build_errors, error_category_guidance, infer_default_build_command,
    parse_error_references,
};
use super::planning::{TaskPhase, TaskPlan};
use super::prompts::build_stub_fix_prompt;
use super::tool_executor_helpers::{format_tool_arg_hint, looks_like_compiler_errors};
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
    pub task_phase: Arc<Mutex<TaskPhase>>,
    pub self_review: Arc<Mutex<SelfReviewGuard>>,
}

#[async_trait]
impl ToolExecutor for EngineToolLoopExecutor {
    async fn auto_build_check(&self) -> Option<AutoBuildResult> {
        let project_root = std::path::Path::new(&self.project.linked_folder_path);
        let cmd = self
            .project
            .build_command
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .map(String::from)
            .or_else(|| infer_default_build_command(project_root))?;

        send_or_log(
            &self.engine_event_tx,
            EngineEvent::TaskOutputDelta {
                project_id: self.project_id,
                agent_instance_id: self.agent_instance_id,
                task_id: self.task_id,
                delta: format!("\n[auto-build: {}]\n", cmd),
            },
        );

        match build_verify::run_build_command(project_root, &cmd, None).await {
            Ok(result) => {
                let mut output = String::new();
                if !result.stdout.is_empty() {
                    output.push_str(&result.stdout);
                }
                if !result.stderr.is_empty() {
                    if !output.is_empty() {
                        output.push('\n');
                    }
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
                    error_count: 0,
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
        let cmd = self
            .project
            .build_command
            .as_deref()
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
                Some(BuildBaseline {
                    error_signatures: sigs,
                })
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
        let mut gated_indices: Vec<usize> = Vec::new();

        for (i, tc) in tool_calls.iter().enumerate() {
            match tc.name.as_str() {
                "task_done" | "get_task_context" | "submit_plan" => {}
                "write_file" | "edit_file" | "delete_file" => {
                    let phase = self.task_phase.lock().await;
                    if matches!(*phase, TaskPhase::Exploring) {
                        gated_indices.push(i);
                    } else {
                        {
                            let mut ops = self.tracked_file_ops.lock().await;
                            track_file_op(&tc.name, &tc.input, &mut ops);
                        }
                        if let Some(path) = tc.input.get("path").and_then(|v| v.as_str()) {
                            self.self_review.lock().await.record_write(path);
                        }
                        executor_indices.push(i);
                    }
                }
                _ => {
                    {
                        let mut ops = self.tracked_file_ops.lock().await;
                        track_file_op(&tc.name, &tc.input, &mut ops);
                    }
                    if tc.name == "read_file" {
                        if let Some(path) = tc.input.get("path").and_then(|v| v.as_str()) {
                            self.self_review.lock().await.record_read(path);
                        }
                    }
                    executor_indices.push(i);
                }
            }
        }

        let executor_futures: Vec<_> = executor_indices
            .iter()
            .map(|&i| {
                let tc = &tool_calls[i];
                self.inner
                    .execute(&self.project_id, &tc.name, tc.input.clone())
            })
            .collect();
        let executor_results = futures::future::join_all(executor_futures).await;

        let mut exec_result_iter = executor_results.into_iter();
        let mut results = Vec::with_capacity(tool_calls.len());
        let mut stop = false;

        for (i, tc) in tool_calls.iter().enumerate() {
            if gated_indices.contains(&i) {
                results.push(ToolCallResult {
                    tool_use_id: tc.id.clone(),
                    content: "ERROR: You must call submit_plan before making file changes. \
                              Explore the codebase, form your approach, then submit your plan."
                        .to_string(),
                    is_error: true,
                    stop_loop: false,
                });
                continue;
            }
            match tc.name.as_str() {
                "task_done" => {
                    self.handle_task_done(tc, &mut results, &mut stop).await;
                }
                "get_task_context" => {
                    self.handle_get_context(tc, &mut results);
                }
                "submit_plan" => {
                    self.handle_submit_plan(tc, &mut results).await;
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
        self.extract_notes_and_follow_ups(tc).await;

        if let Some(review_prompt) = self.check_self_review().await {
            results.push(ToolCallResult {
                tool_use_id: tc.id.clone(),
                content: review_prompt,
                is_error: true,
                stop_loop: false,
            });
            return;
        }

        let stub_rejected = self.check_stubs_and_reject().await;

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

    async fn extract_notes_and_follow_ups(&self, tc: &ToolCall) {
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
                let title = fu
                    .get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let desc = fu
                    .get("description")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                fu_lock.push(FollowUpSuggestion {
                    title,
                    description: desc,
                });
            }
        }
        if let Some(reasoning) = tc.input.get("reasoning").and_then(|v| v.as_array()) {
            let reasoning_text: Vec<String> = reasoning
                .iter()
                .filter_map(|r| r.as_str().map(String::from))
                .collect();
            if !reasoning_text.is_empty() {
                let mut n = self.notes.lock().await;
                n.push_str("\n\nReasoning:\n");
                for r in &reasoning_text {
                    n.push_str(&format!("- {r}\n"));
                }
            }
        }
    }

    async fn check_self_review(&self) -> Option<String> {
        let unreviewed = self.self_review.lock().await.check_review_needed()?;
        Some(format!(
            "SELF-REVIEW REQUIRED: Before completing, re-read the files you modified \
             to verify correctness:\n{}\n\nCheck: (a) changes match task requirements, \
             (b) no placeholder/stub code remains, (c) no debug code left behind.\n\
             Then call task_done again.",
            unreviewed.join("\n")
        ))
    }

    async fn check_stubs_and_reject(&self) -> Option<String> {
        let mut attempts = self.stub_fix_attempts.lock().await;
        if *attempts >= MAX_STUB_FIX_ATTEMPTS {
            return None;
        }
        let base_path = Path::new(&self.project.linked_folder_path);
        let ops = self.tracked_file_ops.lock().await;
        let stub_reports = file_ops::detect_stub_patterns(base_path, &ops);
        if stub_reports.is_empty() {
            return None;
        }
        *attempts += 1;
        let attempt = *attempts;
        send_or_log(
            &self.engine_event_tx,
            EngineEvent::TaskOutputDelta {
                project_id: self.project_id,
                agent_instance_id: self.agent_instance_id,
                task_id: self.task_id,
                delta: format!(
                    "\n[stub detection] found {} stub(s), requesting fix (attempt {}/{})\n",
                    stub_reports.len(),
                    attempt,
                    MAX_STUB_FIX_ATTEMPTS,
                ),
            },
        );
        Some(build_stub_fix_prompt(&stub_reports))
    }

    async fn handle_submit_plan(&self, tc: &ToolCall, results: &mut Vec<ToolCallResult>) {
        let plan = TaskPlan::from_tool_input(&tc.input);
        match plan.validate() {
            Ok(()) => {
                let context_string = plan.as_context_string();
                {
                    let mut phase = self.task_phase.lock().await;
                    *phase = TaskPhase::Implementing { plan: plan.clone() };
                }
                send_or_log(
                    &self.engine_event_tx,
                    EngineEvent::PlanSubmitted {
                        project_id: self.project_id,
                        agent_instance_id: self.agent_instance_id,
                        task_id: self.task_id,
                        approach: plan.approach.clone(),
                        files_to_modify: plan.files_to_modify.clone(),
                        files_to_create: plan.files_to_create.clone(),
                        key_decisions: plan.key_decisions.clone(),
                    },
                );
                results.push(ToolCallResult {
                    tool_use_id: tc.id.clone(),
                    content: format!(
                        "Plan accepted. Proceeding to implementation.\n\n\
                         YOUR PLAN (reference during implementation):\n{}\n\n\
                         Now implement according to this plan. Start with the most \
                         foundational changes first.",
                        context_string
                    ),
                    is_error: false,
                    stop_loop: false,
                });
            }
            Err(reason) => {
                results.push(ToolCallResult {
                    tool_use_id: tc.id.clone(),
                    content: format!("Plan rejected: {reason}. Revise and resubmit."),
                    is_error: true,
                    stop_loop: false,
                });
            }
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
            let arg_hint = format_tool_arg_hint(tc);
            let status_str = if result.is_error { "error" } else { "ok" };
            let marker = if arg_hint.is_empty() {
                format!("\n[tool: {} -> {}]\n", tc.name, status_str)
            } else {
                format!("\n[tool: {}({}) -> {}]\n", tc.name, arg_hint, status_str)
            };
            send_or_log(
                &self.engine_event_tx,
                EngineEvent::TaskOutputDelta {
                    project_id: self.project_id,
                    agent_instance_id: self.agent_instance_id,
                    task_id: self.task_id,
                    delta: marker,
                },
            );

            let mut call_result = result.into_call_result(tc.id.clone());
            if tc.name == "run_command" && call_result.is_error {
                call_result.content = self.enrich_compiler_output(&call_result.content);
            }
            results.push(call_result);
        }
    }
}

#[cfg(test)]
#[path = "tool_executor_tests.rs"]
mod tests;
