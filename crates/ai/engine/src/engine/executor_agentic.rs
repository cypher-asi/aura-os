use std::sync::Arc;

use tokio::sync::{mpsc, Mutex};

use aura_core::*;
use aura_claude::{RichMessage, ThinkingConfig};
use aura_chat::{ChatToolExecutor, ToolLoopConfig, ToolLoopEvent, run_tool_loop};
use aura_tools::engine_tool_definitions;

use super::orchestrator::DevLoopEngine;
use super::prompts::*;
use super::tool_executor::EngineToolLoopExecutor;
use super::types::*;
use crate::error::EngineError;
use crate::events::EngineEvent;
use crate::file_ops::{self, FileOp, WorkspaceCache};

impl DevLoopEngine {
    pub(crate) async fn execute_task_agentic(
        &self,
        project_id: &ProjectId,
        task: &Task,
        session: &Session,
        api_key: &str,
        agent: Option<&AgentInstance>,
        work_log: &[String],
        workspace_cache: &WorkspaceCache,
    ) -> Result<TaskExecution, EngineError> {
        let project = self.project_service.get_project_async(project_id).await?;
        let spec = self.load_spec(project_id, &task.spec_id).await?;

        let exploration_allowance = compute_exploration_allowance(
            &task.title,
            &task.description,
            workspace_cache.member_count,
        );

        let workspace_map = &workspace_cache.workspace_map_text;
        let workspace_info = if workspace_map.is_empty() { None } else { Some(workspace_map.as_str()) };
        let system_prompt = agentic_execution_system_prompt(&project, agent, workspace_info, exploration_allowance);

        let codebase_snapshot = match file_ops::retrieve_task_relevant_files_cached(
            &project.linked_folder_path,
            &task.title,
            &task.description,
            50_000,
            workspace_cache,
        ).await {
            Ok(s) => s,
            Err(_) => file_ops::read_relevant_files(&project.linked_folder_path, 50_000)
                .unwrap_or_default(),
        };

        let dep_api_context = if !workspace_map.is_empty() {
            file_ops::resolve_task_dep_api_context_cached(
                &project.linked_folder_path,
                &task.title,
                &task.description,
                15_000,
                workspace_cache,
            ).await.unwrap_or_default()
        } else {
            String::new()
        };

        let type_defs_context = file_ops::resolve_type_definitions_for_task_async(
            &project.linked_folder_path,
            &task.title,
            &task.description,
            &spec.markdown_contents,
            10_000,
        ).await;

        let completed_deps: Vec<Task> = if task.dependency_ids.is_empty() {
            Vec::new()
        } else {
            let all_project_tasks = self.task_service.list_tasks(project_id).await.unwrap_or_default();
            task.dependency_ids.iter()
                .filter_map(|dep_id| {
                    all_project_tasks.iter()
                        .find(|t| t.task_id == *dep_id && t.status == TaskStatus::Done)
                        .cloned()
                })
                .collect()
        };

        let work_log_summary = build_work_log_summary(work_log);

        let mut task_context = build_agentic_task_context(
            &project, &spec, task, session, &completed_deps, &work_log_summary, exploration_allowance,
        );
        if !workspace_map.is_empty() {
            task_context.push_str(&format!("\n# Workspace Structure\n{}\n", workspace_map));
        }
        if !type_defs_context.is_empty() {
            task_context.push_str(&format!("\n# Type Definitions Referenced in Task\n{}\n", type_defs_context));
        }
        if !codebase_snapshot.is_empty() {
            task_context.push_str(&format!("\n# Current Codebase Files\n{}\n", codebase_snapshot));
        }
        if !dep_api_context.is_empty() {
            task_context.push_str(&format!("\n# Dependency API Surface\n{}\n", dep_api_context));
        }

        let tools = engine_tool_definitions();
        let api_messages: Vec<RichMessage> = vec![RichMessage::user(&task_context)];

        let pid = *project_id;
        let aiid = session.agent_instance_id;
        let task_id = task.task_id;

        let tracked_file_ops: Arc<Mutex<Vec<FileOp>>> = Arc::new(Mutex::new(Vec::new()));
        let notes: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
        let follow_ups: Arc<Mutex<Vec<FollowUpSuggestion>>> = Arc::new(Mutex::new(Vec::new()));

        let executor = EngineToolLoopExecutor {
            inner: ChatToolExecutor::new(
                self.store.clone(),
                self.storage_client.clone(),
                self.project_service.clone(),
                self.task_service.clone(),
            ),
            project_id: pid,
            project: project.clone(),
            spec: spec.clone(),
            task: task.clone(),
            session: session.clone(),
            engine_event_tx: self.event_tx.clone(),
            agent_instance_id: aiid,
            task_id,
            tracked_file_ops: tracked_file_ops.clone(),
            notes: notes.clone(),
            follow_ups: follow_ups.clone(),
            stub_fix_attempts: Arc::new(Mutex::new(0)),
            completed_deps,
            work_log_summary,
            exploration_allowance,
        };

        let complexity = classify_task_complexity(&task.title, &task.description);
        let thinking_budget = match complexity {
            TaskComplexity::Simple => 2_000.min(self.llm_config.thinking_budget),
            TaskComplexity::Standard => compute_thinking_budget(
                self.llm_config.thinking_budget,
                workspace_cache.member_count,
            ),
            TaskComplexity::Complex => compute_thinking_budget(
                self.llm_config.thinking_budget,
                workspace_cache.member_count,
            ).max(12_000),
        };
        let max_tokens = match complexity {
            TaskComplexity::Simple => self.llm_config.task_execution_max_tokens.min(8_192),
            _ => self.llm_config.task_execution_max_tokens,
        };
        let max_iterations = match complexity {
            TaskComplexity::Simple => self.engine_config.max_agentic_iterations.min(15),
            _ => self.engine_config.max_agentic_iterations,
        };

        let config = ToolLoopConfig {
            max_iterations,
            max_tokens,
            thinking: Some(ThinkingConfig::enabled(thinking_budget)),
            stream_timeout: std::time::Duration::from_secs(self.llm_config.stream_timeout_secs),
            billing_reason: "aura_task",
            max_context_tokens: Some(self.llm_config.max_context_tokens),
            credit_budget: self.engine_config.max_task_credits,
            exploration_allowance: Some(exploration_allowance),
        };

        let (loop_tx, mut loop_rx) = mpsc::unbounded_channel::<ToolLoopEvent>();
        let engine_tx = self.event_tx.clone();
        let forwarder = tokio::spawn(async move {
            while let Some(evt) = loop_rx.recv().await {
                match evt {
                    ToolLoopEvent::Delta(text) => {
                        let _ = engine_tx.send(EngineEvent::TaskOutputDelta {
                            project_id: pid,
                            agent_instance_id: aiid,
                            task_id,
                            delta: text,
                        });
                    }
                    ToolLoopEvent::Error(msg) => {
                        let _ = engine_tx.send(EngineEvent::TaskOutputDelta {
                            project_id: pid,
                            agent_instance_id: aiid,
                            task_id,
                            delta: format!("\n[error] {msg}\n"),
                        });
                    }
                    _ => {}
                }
            }
        });

        let result = run_tool_loop(
            self.llm.clone(),
            api_key,
            &system_prompt,
            api_messages,
            tools,
            &config,
            &executor,
            &loop_tx,
        )
        .await;
        drop(loop_tx);
        let _ = forwarder.await;

        if result.insufficient_credits {
            return Err(EngineError::InsufficientCredits);
        }
        if let Some(ref err) = result.llm_error {
            return Err(EngineError::LlmError(err.clone()));
        }
        if result.timed_out {
            return Err(EngineError::LlmError("LLM streaming timed out".into()));
        }

        let tracked_file_ops = tracked_file_ops.lock().await.clone();
        let mut notes = notes.lock().await.clone();
        let follow_ups = follow_ups.lock().await.clone();

        if notes.is_empty() {
            if !result.text.is_empty() {
                notes = result.text;
            } else {
                notes = "Task completed via agentic tool-use loop".to_string();
            }
        }

        Ok(TaskExecution {
            notes,
            file_ops: tracked_file_ops,
            follow_up_tasks: follow_ups,
            input_tokens: result.total_input_tokens,
            output_tokens: result.total_output_tokens,
            parse_retries: 0,
            files_already_applied: true,
        })
    }
}

const MAX_WORK_LOG_TASK_CONTEXT: usize = 4_000;

fn build_work_log_summary(work_log: &[String]) -> String {
    if work_log.is_empty() {
        return String::new();
    }
    let mut summary = work_log.join("\n---\n");
    if summary.len() > MAX_WORK_LOG_TASK_CONTEXT {
        summary.truncate(MAX_WORK_LOG_TASK_CONTEXT);
        summary.push_str("\n... (truncated) ...");
    }
    summary
}

fn compute_thinking_budget(base: u32, member_count: usize) -> u32 {
    if member_count >= 15 {
        base.max(16_000)
    } else if member_count >= 8 {
        base.max(10_000)
    } else {
        base
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TaskComplexity {
    Simple,
    Standard,
    Complex,
}

fn classify_task_complexity(title: &str, description: &str) -> TaskComplexity {
    let combined = format!("{} {}", title, description).to_lowercase();

    let simple_patterns = [
        "add dependency", "add dep ", "set up dependency",
        "define enum", "define struct", "define type",
        "add import", "update cargo.toml", "update package.json",
        "rename ", "move file",
    ];
    if simple_patterns.iter().any(|p| combined.contains(p)) {
        return TaskComplexity::Simple;
    }

    let complex_patterns = [
        "integration test", "end-to-end", "e2e test",
        "refactor", "migrate", "rewrite",
        "multi-file", "cross-crate",
        "implement service", "implement api",
    ];
    if complex_patterns.iter().any(|p| combined.contains(p)) {
        return TaskComplexity::Complex;
    }

    // Longer descriptions generally indicate more complex tasks
    if description.len() > 1000 {
        return TaskComplexity::Complex;
    }
    if description.len() < 200 {
        return TaskComplexity::Simple;
    }

    TaskComplexity::Standard
}

fn compute_exploration_allowance(
    task_title: &str,
    task_description: &str,
    member_count: usize,
) -> usize {
    let combined = format!("{} {}", task_title, task_description).to_lowercase();
    let is_test_task = combined.contains("integration test")
        || combined.contains("end-to-end")
        || combined.contains("e2e test")
        || (combined.contains("test") && combined.contains("pipeline"));

    let base: usize = if is_test_task { 18 } else { 12 };

    if member_count >= 15 {
        base + 4
    } else if member_count >= 8 {
        base + 2
    } else {
        base
    }
}
