use std::collections::HashSet;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use tokio::sync::{mpsc, Mutex};

use aura_chat::{rich_messages_to_link, tool_defs_to_link, ChatToolExecutor};
use aura_claude::RichMessage;
use aura_core::*;
use aura_link::{RuntimeEvent, TurnConfig, TurnResult};
use aura_tools::engine_tool_definitions;

use super::agentic_context::{
    build_full_task_context, build_work_log_summary, check_already_completed,
    classify_task_complexity, compute_exploration_allowance, compute_thinking_budget,
    fetch_codebase_context, resolve_completed_deps, resolve_simple_model, TaskComplexity,
};
use super::orchestrator::DevLoopEngine;
use super::planning::{TaskPhase, TaskPlan};
use super::prompts::*;
use super::tool_executor::EngineToolLoopExecutor;
use super::types::*;
use crate::channel_ext::send_or_log;
use crate::error::EngineError;
use crate::events::EngineEvent;
use crate::file_ops::{FileOp, WorkspaceCache};

pub(crate) fn configure_turn_config(
    complexity: TaskComplexity,
    llm_config: &LlmConfig,
    engine_config: &EngineConfig,
    exploration_allowance: usize,
    member_count: usize,
) -> TurnConfig {
    let thinking_budget = match complexity {
        TaskComplexity::Simple => 2_000.min(llm_config.thinking_budget),
        TaskComplexity::Standard => {
            compute_thinking_budget(llm_config.thinking_budget, member_count)
        }
        TaskComplexity::Complex => {
            compute_thinking_budget(llm_config.thinking_budget, member_count).max(12_000)
        }
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

    TurnConfig {
        max_iterations,
        max_tokens,
        thinking: Some(aura_link::ThinkingConfig {
            thinking_type: "enabled".to_string(),
            budget_tokens: thinking_budget,
        }),
        stream_timeout: std::time::Duration::from_secs(llm_config.stream_timeout_secs),
        billing_reason: Some("aura_task".to_string()),
        max_context_tokens: Some(llm_config.max_context_tokens),
        credit_budget: engine_config.max_task_credits,
        exploration_allowance: Some(exploration_allowance),
        model_override,
        auto_build_cooldown: Some(1),
    }
}

fn spawn_runtime_event_forwarder(
    engine_tx: &mpsc::UnboundedSender<EngineEvent>,
    pid: ProjectId,
    aiid: AgentInstanceId,
    task_id: TaskId,
) -> (
    tokio::task::JoinHandle<()>,
    mpsc::UnboundedSender<RuntimeEvent>,
) {
    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<RuntimeEvent>();
    let engine_tx = engine_tx.clone();
    let forwarder = tokio::spawn(async move {
        while let Some(evt) = event_rx.recv().await {
            let delta = match evt {
                RuntimeEvent::Delta(text) => Some(text),
                RuntimeEvent::ThinkingDelta(_) => None,
                RuntimeEvent::ToolUseStarted { name, .. } => {
                    Some(format!("\n[tool] {name}\n"))
                }
                RuntimeEvent::ToolResult {
                    tool_name,
                    is_error,
                    ..
                } => {
                    if is_error {
                        Some(format!("\n[tool error] {tool_name}\n"))
                    } else {
                        None
                    }
                }
                RuntimeEvent::Warning(msg) => Some(format!("\n[warning] {msg}\n")),
                RuntimeEvent::Error(msg) => Some(format!("\n[error] {msg}\n")),
                _ => None,
            };
            if let Some(text) = delta {
                send_or_log(
                    &engine_tx,
                    EngineEvent::TaskOutputDelta {
                        project_id: pid,
                        agent_instance_id: aiid,
                        task_id,
                        delta: text,
                    },
                );
            }
        }
    });
    (forwarder, event_tx)
}

async fn finalize_turn_result(
    result: TurnResult,
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
        input_tokens: result.usage.input_tokens,
        output_tokens: result.usage.output_tokens,
        parse_retries: 0,
        files_already_applied: true,
    })
}

struct AgenticTaskSetup {
    project: Project,
    spec: Spec,
    system_prompt: String,
    task_context: String,
    complexity: TaskComplexity,
    completed_deps: Vec<Task>,
    work_log_summary: String,
    exploration_allowance: usize,
}

async fn prepare_agentic_task(
    engine: &DevLoopEngine,
    project_id: &ProjectId,
    task: &Task,
    session: &Session,
    agent: Option<&AgentInstance>,
    work_log: &[String],
    workspace_cache: &WorkspaceCache,
) -> Result<AgenticTaskSetup, EngineError> {
    let project = engine.project_service.get_project_async(project_id).await?;
    let spec = engine.load_spec(project_id, &task.spec_id).await?;

    let exploration_allowance =
        compute_exploration_allowance(&task.title, &task.description, workspace_cache.member_count);
    let workspace_map = &workspace_cache.workspace_map_text;
    let workspace_info = if workspace_map.is_empty() {
        None
    } else {
        Some(workspace_map.as_str())
    };
    let system_prompt =
        agentic_execution_system_prompt(&project, agent, workspace_info, exploration_allowance);

    let ctx = fetch_codebase_context(&project, task, &spec, workspace_cache, workspace_map).await;
    let completed_deps = resolve_completed_deps(&engine.task_service, project_id, task).await;
    let complexity = classify_task_complexity(&task.title, &task.description);

    let work_log_summary = build_work_log_summary(work_log);
    let base_context = build_agentic_task_context(
        &project,
        &spec,
        task,
        session,
        &completed_deps,
        &work_log_summary,
    );
    let task_context = build_full_task_context(
        base_context,
        workspace_map,
        &ctx.type_defs_context,
        &ctx.codebase_snapshot,
        &ctx.dep_api_context,
    );

    Ok(AgenticTaskSetup {
        project,
        spec,
        system_prompt,
        task_context,
        complexity,
        completed_deps,
        work_log_summary,
        exploration_allowance,
    })
}

fn build_executor(
    engine: &DevLoopEngine,
    setup: &AgenticTaskSetup,
    task: &Task,
    session: &Session,
    tracked_file_ops: Arc<Mutex<Vec<FileOp>>>,
    notes: Arc<Mutex<String>>,
    follow_ups: Arc<Mutex<Vec<FollowUpSuggestion>>>,
) -> EngineToolLoopExecutor {
    let pid = setup.project.project_id;
    let aiid = session.agent_instance_id;
    EngineToolLoopExecutor {
        inner: ChatToolExecutor::new(
            engine.store.clone(),
            engine.storage_client.clone(),
            engine.project_service.clone(),
            engine.task_service.clone(),
        ),
        project_id: pid,
        project: setup.project.clone(),
        spec: setup.spec.clone(),
        task: task.clone(),
        session: session.clone(),
        engine_event_tx: engine.event_tx.clone(),
        agent_instance_id: aiid,
        task_id: task.task_id,
        tracked_file_ops,
        notes,
        follow_ups,
        stub_fix_attempts: Arc::new(Mutex::new(0)),
        completed_deps: setup.completed_deps.clone(),
        work_log_summary: setup.work_log_summary.clone(),
        task_phase: Arc::new(Mutex::new(if setup.complexity == TaskComplexity::Simple {
            TaskPhase::Implementing {
                plan: TaskPlan::empty(),
            }
        } else {
            TaskPhase::Exploring
        })),
        self_review_done: Arc::new(AtomicBool::new(false)),
        files_read: Arc::new(Mutex::new(HashSet::new())),
    }
}


pub(crate) struct AgenticTaskParams<'a> {
    pub project_id: &'a ProjectId,
    pub task: &'a Task,
    pub session: &'a Session,
    pub agent: Option<&'a AgentInstance>,
    pub work_log: &'a [String],
    pub workspace_cache: &'a WorkspaceCache,
}

impl DevLoopEngine {
    pub(crate) async fn execute_task_agentic(
        &self,
        atp: &AgenticTaskParams<'_>,
    ) -> Result<TaskExecution, EngineError> {
        let setup = prepare_agentic_task(
            self,
            atp.project_id,
            atp.task,
            atp.session,
            atp.agent,
            atp.work_log,
            atp.workspace_cache,
        )
        .await?;

        if setup.complexity == TaskComplexity::Simple {
            if let Some(skip_reason) =
                check_already_completed(&setup.project, atp.task, &setup.completed_deps).await
            {
                tracing::info!(task_id = %atp.task.task_id, reason = %skip_reason, "Skipping redundant simple task");
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

        let tracked_file_ops: Arc<Mutex<Vec<FileOp>>> = Arc::new(Mutex::new(Vec::new()));
        let notes: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
        let follow_ups: Arc<Mutex<Vec<FollowUpSuggestion>>> = Arc::new(Mutex::new(Vec::new()));

        let executor = build_executor(
            self,
            &setup,
            atp.task,
            atp.session,
            tracked_file_ops.clone(),
            notes.clone(),
            follow_ups.clone(),
        );
        let config = configure_turn_config(
            setup.complexity,
            &self.llm_config,
            &self.engine_config,
            setup.exploration_allowance,
            atp.workspace_cache.member_count,
        );

        let pid = *atp.project_id;
        let aiid = atp.session.agent_instance_id;
        let (forwarder, event_tx) =
            spawn_runtime_event_forwarder(&self.event_tx, pid, aiid, atp.task.task_id);

        let tools: Arc<[aura_claude::ToolDefinition]> = engine_tool_definitions()
            .iter()
            .cloned()
            .map(Into::into)
            .collect::<Vec<_>>()
            .into();

        let adapter: Arc<dyn aura_link::ToolExecutor> = Arc::new(executor);
        let request = aura_link::TurnRequest {
            system_prompt: setup.system_prompt,
            messages: rich_messages_to_link(vec![RichMessage::user(&setup.task_context)]),
            tools: tool_defs_to_link(tools),
            executor: adapter,
            config,
            event_tx: Some(event_tx),
            auth_token: self.store.get_jwt(),
        };

        let turn_result = self.runtime.execute_turn(request).await;
        let _ = forwarder.await;

        let result = match turn_result {
            Ok(r) => r,
            Err(e) => {
                return Err(match e {
                    aura_link::RuntimeError::InsufficientCredits => {
                        EngineError::InsufficientCredits
                    }
                    other => EngineError::LlmError(other.to_string()),
                });
            }
        };

        finalize_turn_result(result, tracked_file_ops, notes, follow_ups).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_core::{EngineConfig, LlmConfig};

    #[test]
    fn test_configure_turn_config_simple_caps_max_tokens() {
        let llm = LlmConfig::default();
        let engine = EngineConfig::default();
        let config = configure_turn_config(TaskComplexity::Simple, &llm, &engine, 8, 3);
        assert!(config.max_tokens <= 8_192);
        assert!(config.max_iterations <= 15);
        assert!(config.model_override.is_some());
    }

    #[test]
    fn test_configure_turn_config_complex_uses_full_budget() {
        let llm = LlmConfig::default();
        let engine = EngineConfig::default();
        let config = configure_turn_config(TaskComplexity::Complex, &llm, &engine, 18, 3);
        assert_eq!(config.max_tokens, llm.task_execution_max_tokens);
        assert_eq!(config.max_iterations, engine.max_agentic_iterations);
        assert!(config.model_override.is_none());
    }

    #[test]
    fn test_configure_turn_config_maps_all_fields() {
        let llm = LlmConfig::default();
        let engine = EngineConfig::default();
        let config = configure_turn_config(TaskComplexity::Standard, &llm, &engine, 12, 3);
        assert_eq!(config.exploration_allowance, Some(12));
        assert_eq!(config.billing_reason.as_deref(), Some("aura_task"));
        assert_eq!(config.auto_build_cooldown, Some(1));
    }
}
