use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;

use aura_core::*;
use aura_claude::{RichMessage, ThinkingConfig};
use aura_chat::{ChatToolExecutor, ToolLoopConfig, ToolLoopEvent, run_tool_loop};
use aura_tools::engine_tool_definitions;

use super::orchestrator::DevLoopEngine;
use super::planning::{TaskPhase, TaskPlan};
use super::prompts::*;
use super::tool_executor::EngineToolLoopExecutor;
use super::types::*;
use crate::channel_ext::send_or_log;
use crate::error::EngineError;
use crate::events::EngineEvent;
use crate::file_ops::{self, FileOp, WorkspaceCache};

struct CodebaseContext {
    codebase_snapshot: String,
    dep_api_context: String,
    type_defs_context: String,
}

async fn fetch_codebase_context(
    project: &Project,
    task: &Task,
    spec: &Spec,
    workspace_cache: &WorkspaceCache,
    workspace_map: &str,
) -> CodebaseContext {
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

    CodebaseContext { codebase_snapshot, dep_api_context, type_defs_context }
}

async fn resolve_completed_deps(
    task_service: &aura_tasks::TaskService,
    project_id: &ProjectId,
    task: &Task,
) -> Vec<Task> {
    if task.dependency_ids.is_empty() {
        return Vec::new();
    }
    let all_project_tasks = task_service.list_tasks(project_id).await.unwrap_or_default();
    task.dependency_ids.iter()
        .filter_map(|dep_id| {
            all_project_tasks.iter()
                .find(|t| t.task_id == *dep_id && t.status == TaskStatus::Done)
                .cloned()
        })
        .collect()
}

fn build_full_task_context(
    mut task_context: String,
    workspace_map: &str,
    type_defs: &str,
    codebase_snapshot: &str,
    dep_api: &str,
) -> String {
    if !workspace_map.is_empty() {
        task_context.push_str(&format!("\n# Workspace Structure\n{}\n", workspace_map));
    }
    if !type_defs.is_empty() {
        task_context.push_str(&format!("\n# Type Definitions Referenced in Task\n{}\n", type_defs));
    }
    if !codebase_snapshot.is_empty() {
        task_context.push_str(&format!("\n# Current Codebase Files\n{}\n", codebase_snapshot));
    }
    if !dep_api.is_empty() {
        task_context.push_str(&format!("\n# Dependency API Surface\n{}\n", dep_api));
    }
    cap_task_context(&mut task_context, MAX_TASK_CONTEXT_CHARS);
    task_context
}

struct ToolLoopParams {
    max_iterations: usize,
    max_tokens: u32,
    thinking: Option<ThinkingConfig>,
    stream_timeout: std::time::Duration,
    max_context_tokens: Option<u64>,
    credit_budget: Option<u64>,
    exploration_allowance: usize,
    model_override: Option<String>,
}

fn configure_llm_params(
    complexity: TaskComplexity,
    llm_config: &LlmConfig,
    engine_config: &EngineConfig,
    exploration_allowance: usize,
    member_count: usize,
) -> ToolLoopParams {
    let thinking_budget = match complexity {
        TaskComplexity::Simple => 2_000.min(llm_config.thinking_budget),
        TaskComplexity::Standard => compute_thinking_budget(
            llm_config.thinking_budget, member_count,
        ),
        TaskComplexity::Complex => compute_thinking_budget(
            llm_config.thinking_budget, member_count,
        ).max(12_000),
    };
    let max_tokens = match complexity {
        TaskComplexity::Simple => llm_config.task_execution_max_tokens.min(8_192),
        _ => llm_config.task_execution_max_tokens,
    };
    let max_iterations = match complexity {
        TaskComplexity::Simple => engine_config.max_agentic_iterations.min(15),
        _ => engine_config.max_agentic_iterations,
    };
    let model_override = match complexity {
        TaskComplexity::Simple => Some(resolve_simple_model()),
        _ => None,
    };

    ToolLoopParams {
        max_iterations,
        max_tokens,
        thinking: Some(ThinkingConfig::enabled(thinking_budget)),
        stream_timeout: std::time::Duration::from_secs(llm_config.stream_timeout_secs),
        max_context_tokens: Some(llm_config.max_context_tokens),
        credit_budget: engine_config.max_task_credits,
        exploration_allowance,
        model_override,
    }
}

fn spawn_delta_forwarder(
    engine_tx: &mpsc::UnboundedSender<EngineEvent>,
    pid: ProjectId,
    aiid: AgentInstanceId,
    task_id: TaskId,
) -> (JoinHandle<()>, mpsc::UnboundedSender<ToolLoopEvent>) {
    let (loop_tx, mut loop_rx) = mpsc::unbounded_channel::<ToolLoopEvent>();
    let engine_tx = engine_tx.clone();
    let forwarder = tokio::spawn(async move {
        while let Some(evt) = loop_rx.recv().await {
            match evt {
                ToolLoopEvent::Delta(text) => {
                    send_or_log(&engine_tx, EngineEvent::TaskOutputDelta {
                        project_id: pid,
                        agent_instance_id: aiid,
                        task_id,
                        delta: text,
                    });
                }
                ToolLoopEvent::Error(msg) => {
                    send_or_log(&engine_tx, EngineEvent::TaskOutputDelta {
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
    (forwarder, loop_tx)
}

async fn finalize_tool_loop_result(
    result: aura_chat::ToolLoopResult,
    tracked_file_ops: Arc<Mutex<Vec<FileOp>>>,
    notes: Arc<Mutex<String>>,
    follow_ups: Arc<Mutex<Vec<FollowUpSuggestion>>>,
) -> Result<TaskExecution, EngineError> {
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
            &task.title, &task.description, workspace_cache.member_count,
        );
        let workspace_map = &workspace_cache.workspace_map_text;
        let workspace_info = if workspace_map.is_empty() { None } else { Some(workspace_map.as_str()) };
        let system_prompt = agentic_execution_system_prompt(&project, agent, workspace_info, exploration_allowance);

        let ctx = fetch_codebase_context(&project, task, &spec, workspace_cache, workspace_map).await;
        let completed_deps = resolve_completed_deps(&self.task_service, project_id, task).await;

        let complexity = classify_task_complexity(&task.title, &task.description);
        if complexity == TaskComplexity::Simple {
            if let Some(skip_reason) = check_already_completed(&project, task, &completed_deps).await {
                tracing::info!(task_id = %task.task_id, reason = %skip_reason, "Skipping redundant simple task");
                return Ok(TaskExecution {
                    notes: format!("Task skipped as redundant: {}", skip_reason),
                    file_ops: Vec::new(),
                    follow_up_tasks: Vec::new(),
                    input_tokens: 0,
                    output_tokens: 0,
                    parse_retries: 0,
                    files_already_applied: true,
                });
            }
        }

        let work_log_summary = build_work_log_summary(work_log);
        let base_context = build_agentic_task_context(
            &project, &spec, task, session, &completed_deps, &work_log_summary, exploration_allowance,
        );
        let task_context = build_full_task_context(
            base_context, workspace_map, &ctx.type_defs_context, &ctx.codebase_snapshot, &ctx.dep_api_context,
        );

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
                self.store.clone(), self.storage_client.clone(),
                self.project_service.clone(), self.task_service.clone(),
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
            task_phase: Arc::new(Mutex::new(
                if complexity == TaskComplexity::Simple {
                    TaskPhase::Implementing { plan: TaskPlan::empty() }
                } else {
                    TaskPhase::Exploring
                }
            )),
            self_review_done: Arc::new(AtomicBool::new(false)),
        };

        let params = configure_llm_params(
            complexity, &self.llm_config, &self.engine_config,
            exploration_allowance, workspace_cache.member_count,
        );
        let config = ToolLoopConfig {
            max_iterations: params.max_iterations,
            max_tokens: params.max_tokens,
            thinking: params.thinking,
            stream_timeout: params.stream_timeout,
            billing_reason: "aura_task",
            max_context_tokens: params.max_context_tokens,
            credit_budget: params.credit_budget,
            exploration_allowance: Some(params.exploration_allowance),
            model_override: params.model_override,
        };

        let (forwarder, loop_tx) = spawn_delta_forwarder(&self.event_tx, pid, aiid, task_id);

        let result = run_tool_loop(
            self.llm.clone(), api_key, &system_prompt, api_messages,
            tools, &config, &executor, &loop_tx,
        ).await;
        drop(loop_tx);
        let _ = forwarder.await;

        finalize_tool_loop_result(result, tracked_file_ops, notes, follow_ups).await
    }
}

const MAX_TASK_CONTEXT_CHARS: usize = 160_000; // ~40K tokens
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

/// Trim `task_context` to at most `budget` characters by progressively removing
/// lower-priority sections (codebase snapshot first, then dep API, then workspace
/// map), preserving the core task description, spec, and work log.
fn cap_task_context(task_context: &mut String, budget: usize) {
    if task_context.len() <= budget {
        return;
    }

    // Priority order for trimming (lowest first):
    const SECTIONS: &[&str] = &[
        "\n# Current Codebase Files\n",
        "\n# Dependency API Surface\n",
        "\n# Workspace Structure\n",
        "\n# Type Definitions Referenced in Task\n",
    ];

    for section_header in SECTIONS {
        if task_context.len() <= budget {
            return;
        }
        if let Some(start) = task_context.find(section_header) {
            let next_section = task_context[start + section_header.len()..]
                .find("\n# ")
                .map(|pos| start + section_header.len() + pos);
            let end = next_section.unwrap_or(task_context.len());

            let section_len = end - start;
            let overshoot = task_context.len().saturating_sub(budget);

            if overshoot >= section_len {
                task_context.replace_range(start..end, "");
            } else {
                let keep = section_len - overshoot;
                let trim_start = start + keep;
                task_context.replace_range(trim_start..end, "\n... (truncated to fit context budget) ...\n");
            }
        }
    }

    if task_context.len() > budget {
        task_context.truncate(budget);
        task_context.push_str("\n... (context truncated) ...\n");
    }
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

    if description.len() > 1000 {
        return TaskComplexity::Complex;
    }
    if description.len() < 200 {
        return TaskComplexity::Simple;
    }

    TaskComplexity::Standard
}

/// Conservative pre-check: skip simple tasks whose deliverables already exist
/// in the workspace (e.g. a struct/module defined by a predecessor task).
async fn check_already_completed(
    project: &Project,
    task: &Task,
    completed_deps: &[Task],
) -> Option<String> {
    if completed_deps.is_empty() {
        return None;
    }

    let desc_lower = format!("{} {}", task.title, task.description).to_lowercase();
    let base = &project.linked_folder_path;

    let define_patterns: &[(&str, &str)] = &[
        ("define struct ", "struct "),
        ("define enum ", "enum "),
        ("define type ", "type "),
        ("create struct ", "struct "),
        ("create enum ", "enum "),
    ];
    for (trigger, code_prefix) in define_patterns {
        if let Some(pos) = desc_lower.find(trigger) {
            let after = &desc_lower[pos + trigger.len()..];
            let name: String = after.chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect();
            if name.is_empty() { continue; }

            let dep_files: Vec<&str> = completed_deps.iter()
                .flat_map(|d| d.files_changed.iter())
                .map(|f| f.path.as_str())
                .collect();

            for file_path in &dep_files {
                let full_path = std::path::Path::new(base).join(file_path);
                if let Ok(content) = tokio::fs::read_to_string(&full_path).await {
                    let needle = format!("{}{}", code_prefix, name);
                    if content.to_lowercase().contains(&needle.to_lowercase()) {
                        return Some(format!(
                            "`{}{}` already exists in {} (created by a predecessor task)",
                            code_prefix, name, file_path
                        ));
                    }
                }
            }
        }
    }

    None
}

fn resolve_simple_model() -> String {
    std::env::var("AURA_SIMPLE_MODEL")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| aura_claude::MID_MODEL.to_string())
}

fn compute_exploration_allowance(
    task_title: &str,
    task_description: &str,
    member_count: usize,
) -> usize {
    let complexity = classify_task_complexity(task_title, task_description);
    let combined = format!("{} {}", task_title, task_description).to_lowercase();

    let is_refactoring = combined.contains("refactor")
        || combined.contains("rename across")
        || combined.contains("migrate")
        || combined.contains("multi-file");

    let base: usize = match complexity {
        TaskComplexity::Simple => 8,
        TaskComplexity::Standard => 12,
        TaskComplexity::Complex => {
            if is_refactoring { 22 } else { 18 }
        }
    };

    if member_count >= 15 {
        base + 4
    } else if member_count >= 8 {
        base + 2
    } else {
        base
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_work_log_summary_empty() {
        assert_eq!(build_work_log_summary(&[]), "");
    }

    #[test]
    fn build_work_log_summary_joins_entries() {
        let log = vec!["Task 1 done".into(), "Task 2 done".into()];
        let summary = build_work_log_summary(&log);
        assert!(summary.contains("Task 1 done"));
        assert!(summary.contains("---"));
        assert!(summary.contains("Task 2 done"));
    }

    #[test]
    fn build_work_log_summary_truncates_long_input() {
        let log: Vec<String> = (0..500).map(|i| format!("Entry {i}: some work done here")).collect();
        let summary = build_work_log_summary(&log);
        assert!(summary.len() <= MAX_WORK_LOG_TASK_CONTEXT + 30);
        assert!(summary.contains("(truncated)"));
    }

    #[test]
    fn cap_task_context_within_budget_unchanged() {
        let mut ctx = "Short context".to_string();
        let original = ctx.clone();
        cap_task_context(&mut ctx, 1000);
        assert_eq!(ctx, original);
    }

    #[test]
    fn cap_task_context_trims_codebase_section_first() {
        let mut ctx = String::new();
        ctx.push_str("# Task\nDo something\n");
        ctx.push_str("\n# Current Codebase Files\n");
        ctx.push_str(&"x".repeat(5000));
        ctx.push_str("\n# Dependency API Surface\n");
        ctx.push_str("dep info here");

        let original_len = ctx.len();
        let budget = 200;
        cap_task_context(&mut ctx, budget);
        assert!(ctx.len() < original_len, "context should be smaller after capping");
        assert!(!ctx.contains(&"x".repeat(4000)), "bulk of codebase section should be trimmed");
        assert!(ctx.contains("truncated"), "should contain truncation marker");
    }

    #[test]
    fn cap_task_context_hard_truncate_last_resort() {
        let mut ctx = "x".repeat(10_000);
        cap_task_context(&mut ctx, 500);
        assert!(ctx.len() <= 550);
        assert!(ctx.contains("(context truncated)"));
    }

    #[test]
    fn classify_task_complexity_simple_patterns() {
        assert_eq!(classify_task_complexity("Add dependency for serde", ""), TaskComplexity::Simple);
        assert_eq!(classify_task_complexity("Define enum Status", ""), TaskComplexity::Simple);
        assert_eq!(classify_task_complexity("Rename the module", "short"), TaskComplexity::Simple);
        assert_eq!(classify_task_complexity("Update Cargo.toml", ""), TaskComplexity::Simple);
    }

    #[test]
    fn classify_task_complexity_complex_patterns() {
        assert_eq!(classify_task_complexity("Refactor auth module", ""), TaskComplexity::Complex);
        assert_eq!(classify_task_complexity("Add integration test for API", ""), TaskComplexity::Complex);
        assert_eq!(classify_task_complexity("Implement service layer", ""), TaskComplexity::Complex);
        assert_eq!(classify_task_complexity("Migrate to new storage", ""), TaskComplexity::Complex);
    }

    #[test]
    fn classify_task_complexity_standard_for_moderate_descriptions() {
        let desc = "a".repeat(500);
        assert_eq!(classify_task_complexity("Add handler", &desc), TaskComplexity::Standard);
    }

    #[test]
    fn classify_task_complexity_long_desc_is_complex() {
        let desc = "a".repeat(1500);
        assert_eq!(classify_task_complexity("Add handler", &desc), TaskComplexity::Complex);
    }

    #[test]
    fn compute_thinking_budget_base_for_small_workspace() {
        assert_eq!(compute_thinking_budget(8000, 3), 8000);
    }

    #[test]
    fn compute_thinking_budget_scales_for_medium_workspace() {
        assert_eq!(compute_thinking_budget(8000, 10), 10_000);
    }

    #[test]
    fn compute_thinking_budget_scales_for_large_workspace() {
        assert_eq!(compute_thinking_budget(8000, 20), 16_000);
    }

    #[test]
    fn compute_exploration_allowance_simple_small_workspace() {
        assert_eq!(compute_exploration_allowance("Add dependency for serde", "", 3), 8);
    }

    #[test]
    fn compute_exploration_allowance_complex_refactoring_large_workspace() {
        assert_eq!(compute_exploration_allowance("Refactor the auth module", "", 20), 26);
    }

    #[test]
    fn compute_exploration_allowance_standard_medium_workspace() {
        let desc = "a".repeat(500);
        assert_eq!(compute_exploration_allowance("Add handler", &desc, 10), 14);
    }
}
