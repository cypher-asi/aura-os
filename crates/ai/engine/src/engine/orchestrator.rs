use std::sync::Arc;
use std::time::Instant;

use chrono::Utc;
use tokio::sync::{mpsc, watch};
use tracing::{error, info, info_span, warn, Instrument};

use aura_core::*;
use aura_agents::AgentInstanceService;
use aura_billing::{MeteredLlm, PricingService};
use aura_projects::ProjectService;
use aura_sessions::SessionService;
use aura_network::NetworkClient;
use aura_storage::StorageClient;
use aura_tasks::TaskService;
use aura_settings::SettingsService;
use aura_store::RocksStore;

use super::loop_context::LoopRunContext;
use super::loop_handle::LoopHandle;
use super::shell;
use super::types::*;
use super::write_coordinator::ProjectWriteCoordinator;
use crate::channel_ext::send_or_log;
use crate::error::EngineError;
use crate::events::EngineEvent;
use crate::file_ops::FileOp;

pub struct DevLoopEngine {
    pub(crate) store: Arc<RocksStore>,
    pub(crate) settings: Arc<SettingsService>,
    pub(crate) llm: Arc<MeteredLlm>,
    pub(crate) project_service: Arc<ProjectService>,
    pub(crate) task_service: Arc<TaskService>,
    pub(crate) agent_instance_service: Arc<AgentInstanceService>,
    pub(crate) session_service: Arc<SessionService>,
    pub(crate) event_tx: mpsc::UnboundedSender<EngineEvent>,
    pub(crate) write_coordinator: ProjectWriteCoordinator,
    pub(crate) engine_config: EngineConfig,
    pub(crate) llm_config: LlmConfig,
    pub(crate) pricing_service: PricingService,
    pub(crate) storage_client: Option<Arc<StorageClient>>,
    pub(crate) network_client: Option<Arc<NetworkClient>>,
    pub(crate) internal_service_token: Option<String>,
}

impl DevLoopEngine {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        store: Arc<RocksStore>,
        settings: Arc<SettingsService>,
        llm: Arc<MeteredLlm>,
        project_service: Arc<ProjectService>,
        task_service: Arc<TaskService>,
        agent_instance_service: Arc<AgentInstanceService>,
        session_service: Arc<SessionService>,
        event_tx: mpsc::UnboundedSender<EngineEvent>,
    ) -> Self {
        let pricing_service = PricingService::new(store.clone());
        Self {
            store,
            settings,
            llm,
            project_service,
            task_service,
            agent_instance_service,
            session_service,
            event_tx,
            write_coordinator: ProjectWriteCoordinator::new(),
            engine_config: EngineConfig::from_env(),
            llm_config: LlmConfig::from_env(),
            pricing_service,
            storage_client: None,
            network_client: None,
            internal_service_token: None,
        }
    }

    pub fn with_storage_client(mut self, client: Option<Arc<StorageClient>>) -> Self {
        self.storage_client = client;
        self
    }

    pub fn with_network_client(mut self, client: Option<Arc<NetworkClient>>) -> Self {
        self.network_client = client;
        self
    }

    pub fn with_internal_service_token(mut self, token: Option<String>) -> Self {
        self.internal_service_token = token;
        self
    }

    /// Load a spec from aura-storage.
    pub(crate) async fn load_spec(
        &self,
        _project_id: &ProjectId,
        spec_id: &SpecId,
    ) -> Result<Spec, EngineError> {
        let storage = self.storage_client.as_ref()
            .ok_or_else(|| EngineError::Parse("aura-storage not configured".into()))?;
        let jwt = self.get_jwt_for_storage()?;
        let ss = storage
            .get_spec(&spec_id.to_string(), &jwt)
            .await?;
        Spec::try_from(ss)
            .map_err(|e| EngineError::Parse(format!("spec conversion: {e}")))
    }

    fn get_jwt_for_storage(&self) -> Result<String, EngineError> {
        self.store
            .get_jwt()
            .ok_or_else(|| EngineError::Parse("no active session for aura-storage".into()))
    }

    pub fn with_write_coordinator(mut self, coordinator: ProjectWriteCoordinator) -> Self {
        self.write_coordinator = coordinator;
        self
    }

    async fn resolve_or_create_agent(
        &self,
        project_id: &ProjectId,
        agent_instance_id: Option<AgentInstanceId>,
    ) -> Result<AgentInstance, EngineError> {
        if let Some(aiid) = agent_instance_id {
            self.agent_instance_service
                .get_instance(project_id, &aiid)
                .await
                .map_err(|_| EngineError::Parse(format!("agent instance {aiid} not found")))
        } else {
            let now = Utc::now();
            let default_agent = Agent {
                agent_id: AgentId::new(),
                user_id: self.current_user_id().unwrap_or_default(),
                name: "dev-agent".into(),
                role: String::new(),
                personality: String::new(),
                system_prompt: String::new(),
                skills: Vec::new(),
                icon: None,
                network_agent_id: None,
                profile_id: None,
                created_at: now,
                updated_at: now,
            };
            Ok(self.agent_instance_service
                .create_instance_from_agent(project_id, &default_agent)
                .await?)
        }
    }

    async fn reset_stale_agent(
        &self,
        project_id: &ProjectId,
        agent: AgentInstance,
    ) -> Result<AgentInstance, EngineError> {
        let stale = self.session_service.close_stale_sessions(
            project_id,
            Some(&agent.agent_instance_id),
        ).await?;
        if !stale.is_empty() {
            info!("closed {} stale active session(s) for agent {}", stale.len(), agent.agent_instance_id);
        }

        if agent.status == AgentStatus::Working {
            info!(
                agent_instance_id = %agent.agent_instance_id,
                "resetting stale Working agent to Idle before starting loop"
            );
            self.agent_instance_service
                .finish_working(project_id, &agent.agent_instance_id)
                .await
                .ok();
            self.agent_instance_service
                .get_instance(project_id, &agent.agent_instance_id)
                .await
                .map_err(|_| EngineError::Parse(format!("agent instance {} not found", agent.agent_instance_id)))
        } else {
            Ok(agent)
        }
    }

    async fn handle_loop_error(
        &self,
        project_id: ProjectId,
        aiid: AgentInstanceId,
        e: &EngineError,
    ) {
        error!(error = %e, "run_loop exited with error, emitting LoopFinished");
        if let Ok(orphaned) = self.task_service.reset_in_progress_tasks(&project_id).await {
            for t in &orphaned {
                self.emit(EngineEvent::TaskBecameReady {
                    project_id,
                    agent_instance_id: aiid,
                    task_id: t.task_id,
                });
            }
        }
        self.emit(EngineEvent::LoopFinished {
            project_id,
            agent_instance_id: aiid,
            outcome: format!("error: {e}"),
            total_duration_ms: None,
            tasks_completed: None,
            tasks_failed: None,
            tasks_retried: None,
            total_input_tokens: None,
            total_output_tokens: None,
            total_cost_usd: None,
            sessions_used: None,
            total_parse_retries: None,
            total_build_fix_attempts: None,
            duplicate_error_bailouts: None,
        });
        if let Err(e) = self.agent_instance_service.finish_working(&project_id, &aiid).await {
            tracing::warn!(
                %project_id, agent_instance_id = %aiid, error = %e,
                "failed to mark agent instance as finished"
            );
        }
    }

    pub async fn start(
        self: Arc<Self>,
        project_id: ProjectId,
        agent_instance_id: Option<AgentInstanceId>,
    ) -> Result<LoopHandle, EngineError> {
        let _project = self.project_service.get_project_async(&project_id).await?;

        let agent = self.resolve_or_create_agent(&project_id, agent_instance_id).await?;
        let agent = self.reset_stale_agent(&project_id, agent).await?;

        let session = self.session_service.create_session(
            &agent.agent_instance_id,
            &project_id,
            None,
            String::new(),
            self.current_user_id(),
            Some(self.llm_config.default_model.clone()),
        ).await?;

        let (stop_tx, stop_rx) = watch::channel(LoopCommand::Continue);

        self.emit(EngineEvent::LoopStarted {
            project_id,
            agent_instance_id: agent.agent_instance_id,
        });

        let engine = self.clone();
        let aiid = agent.agent_instance_id;
        let loop_span = info_span!(
            "engine_loop",
            %project_id,
            agent_instance_id = %aiid,
        );
        let join_handle = tokio::spawn(async move {
            let result = engine
                .run_loop(project_id, aiid, session, stop_rx)
                .await;
            if let Err(ref e) = result {
                engine.handle_loop_error(project_id, aiid, e).await;
            }
            result
        }.instrument(loop_span));

        Ok(LoopHandle {
            project_id,
            agent_instance_id: agent.agent_instance_id,
            stop_tx,
            join_handle,
        })
    }

    /// Execute the main task loop for a project.
    ///
    /// ## State machine
    ///
    /// ```text
    ///  ┌────────────────────────────────────────────────────────┐
    ///  │                    run_loop                            │
    ///  │                                                       │
    ///  │   ┌──────────────┐                                    │
    ///  │   │ reset +      │  (in_progress→ready, pending→ready)│
    ///  │   │ promote      │                                    │
    ///  │   └──────┬───────┘                                    │
    ///  │          ▼                                             │
    ///  │   ┌──────────────┐  no tasks  ┌──────────────────┐   │
    ///  │   │ claim_next   │──────────▶│ try_retry_failed  │   │
    ///  │   │ _task        │           └──────┬───────────┘   │
    ///  │   └──────┬───────┘                  │ no retries    │
    ///  │          │ task                      ▼               │
    ///  │          ▼                    ┌──────────────┐       │
    ///  │   ┌──────────────┐           │ Finished     │       │
    ///  │   │ begin_task   │           │ (complete/   │       │
    ///  │   │ + execute    │           │  blocked)    │       │
    ///  │   └──────┬───────┘           └──────────────┘       │
    ///  │          │                                           │
    ///  │          ▼                                           │
    ///  │   ┌──────────────┐                                  │
    ///  │   │ finalize +   │──failed──▶ continue (retry)      │
    ///  │   │ process      │                                  │
    ///  │   │ outcome      │──ok──▶ push + rollover check     │
    ///  │   └──────────────┘           │                      │
    ///  │                              ▼                      │
    ///  │                    ┌──────────────────┐             │
    ///  │                    │try_session_      │             │
    ///  │                    │rollover          │             │
    ///  │                    └──────┬───────────┘             │
    ///  │                          │ (loop back to claim)     │
    ///  │                          ▼                          │
    ///  │                    claim_next_task ...              │
    ///  └────────────────────────────────────────────────────┘
    ///
    /// Invariants:
    ///   - Exactly one task is InProgress at a time per agent
    ///   - Session rollover only occurs after successful task completion
    ///   - Credits are checked after every task finalization
    ///   - Failed tasks are retried (up to max_loop_task_retries) only
    ///     when no Ready tasks remain
    ///   - Stop/Pause commands are checked at the top of every loop iteration
    /// ```
    async fn run_loop(
        &self,
        project_id: ProjectId,
        agent_instance_id: AgentInstanceId,
        session: Session,
        mut stop_rx: watch::Receiver<LoopCommand>,
    ) -> Result<LoopOutcome, EngineError> {
        let mut ctx = LoopRunContext::new(self, project_id, agent_instance_id, session).await?;
        ctx.reset_and_promote_tasks(self).await?;
        loop {
            if let Some(out) = ctx.check_command(self, &stop_rx).await { return Ok(out); }
            let task = match self.task_service.claim_next_task(
                &project_id, &agent_instance_id, Some(ctx.session.session_id),
            ).await? {
                Some(t) => t,
                None => {
                    if ctx.try_retry_failed(self).await? { continue; }
                    return ctx.handle_no_more_tasks(self).await;
                }
            };
            ctx.begin_task(self, &task).await?;
            let project = self.project_service.get_project_async(&project_id).await?;
            let baseline = ctx.get_or_capture_test_baseline(self, &project).await;
            let build_baseline = ctx.get_or_capture_build_baseline(self, &project).await;
            let task_start = Instant::now();
            let agent = match self.agent_instance_service
                .get_instance(&project_id, &agent_instance_id).await {
                Ok(a) => Some(a),
                Err(e) => {
                    tracing::warn!(
                        %project_id, %agent_instance_id, error = %e,
                        "failed to fetch agent instance for task context"
                    );
                    None
                }
            };
            let result = if let Some(cmd) = shell::extract_shell_command(&task) {
                Some(self.execute_shell_task(&project, &task, &cmd, agent_instance_id).await)
            } else {
                let agentic_params = super::executor_agentic::AgenticTaskParams {
                    project_id: &project_id, task: &task, session: &ctx.session,
                    api_key: &ctx.api_key, agent: agent.as_ref(),
                    work_log: &ctx.work_log, workspace_cache: &ctx.workspace_cache,
                };
                tokio::select! {
                    r = self.execute_task_agentic(&agentic_params) => Some(r),
                    _ = stop_rx.changed() => None,
                }
            };
            let Some(result) = result else {
                return Ok(ctx.handle_interruption(self, &task, &stop_rx).await);
            };
            let outcome = self.finalize_task_execution(
                super::executor::TaskFinalizationParams {
                    project_id, agent_instance_id,
                    task: &task, session: &ctx.session, api_key: &ctx.api_key,
                    model: &ctx.session.model, task_start,
                    baseline_test_failures: &baseline,
                    baseline_build_errors: &build_baseline,
                    workspace_cache: &ctx.workspace_cache,
                }, result,
            ).await?;
            let failed = ctx.process_outcome(self, &task, outcome).await?;
            self.agent_instance_service.finish_working(&project_id, &agent_instance_id).await?;
            if self.llm.is_credits_exhausted() { return Ok(ctx.handle_credits_exhausted(self).await); }
            if failed { continue; }

            self.try_push_after_spec(&task, &project, agent_instance_id).await;
            if let Some(out) = ctx.try_session_rollover(self, &mut stop_rx).await? {
                return Ok(out);
            }
        }
    }

    pub(crate) fn emit_file_ops_applied(&self, project_id: ProjectId, agent_instance_id: AgentInstanceId, task: &Task, ops: &[FileOp]) {
        let files_written = ops.iter().filter(|op| matches!(op, FileOp::Create { .. } | FileOp::Modify { .. } | FileOp::SearchReplace { .. })).count();
        let files_deleted = ops.iter().filter(|op| matches!(op, FileOp::Delete { .. })).count();
        let files: Vec<crate::events::FileOpSummary> = ops.iter().map(|op| {
            let (op_name, path) = match op {
                FileOp::Create { path, .. } => ("create", path.as_str()),
                FileOp::Modify { path, .. } => ("modify", path.as_str()),
                FileOp::Delete { path } => ("delete", path.as_str()),
                FileOp::SearchReplace { path, .. } => ("search_replace", path.as_str()),
            };
            crate::events::FileOpSummary { op: op_name.to_string(), path: path.to_string() }
        }).collect();
        self.emit(EngineEvent::FileOpsApplied {
            project_id,
            agent_instance_id,
            task_id: task.task_id,
            files_written,
            files_deleted,
            files,
        });
    }

    pub(crate) fn current_user_id(&self) -> Option<String> {
        self.store
            .get_setting("zero_auth_session")
            .ok()
            .and_then(|bytes| serde_json::from_slice::<ZeroAuthSession>(&bytes).ok())
            .map(|s| s.user_id)
    }

    async fn all_spec_tasks_done(&self, task: &Task) -> Option<usize> {
        let all_tasks = self.task_service.list_tasks(&task.project_id).await.ok()?;
        let spec_tasks: Vec<&Task> = all_tasks.iter().filter(|t| t.spec_id == task.spec_id).collect();
        if spec_tasks.iter().all(|t| t.status == TaskStatus::Done) {
            Some(spec_tasks.len())
        } else {
            None
        }
    }

    /// After a task completes, check if all tasks for its spec are done; if so, push to orbit.
    async fn try_push_after_spec(
        &self,
        task: &Task,
        project: &Project,
        agent_instance_id: AgentInstanceId,
    ) {
        let git_repo_url = match project.git_repo_url.as_deref() {
            Some(url) if !url.is_empty() => url,
            _ => return,
        };
        let branch = project.git_branch.as_deref().unwrap_or("main");
        if !crate::git_ops::is_git_repo(&project.linked_folder_path) { return; }
        let task_count = match self.all_spec_tasks_done(task).await { Some(c) => c, None => return };
        let jwt = match self.get_jwt_for_storage() { Ok(j) => j, Err(_) => return };

        let repo_label = format!(
            "{}/{}", project.orbit_owner.as_deref().unwrap_or(""), project.orbit_repo.as_deref().unwrap_or("")
        );
        match crate::git_ops::git_push(&project.linked_folder_path, git_repo_url, branch, &jwt).await {
            Ok(commits) => {
                self.emit(EngineEvent::GitPushed {
                    project_id: task.project_id, agent_instance_id, spec_id: task.spec_id,
                    repo: repo_label, branch: branch.to_string(), commits,
                    summary: format!("Spec complete -- {task_count} task(s) pushed"),
                });
            }
            Err(e) => { warn!(error = %e, "git push after spec completion failed (non-fatal)"); }
        }
    }

    pub(crate) fn emit(&self, event: EngineEvent) {
        send_or_log(&self.event_tx, event);
    }
}
