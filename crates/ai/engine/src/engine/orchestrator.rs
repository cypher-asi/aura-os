use std::sync::Arc;
use std::time::Instant;

use tokio::sync::{mpsc, watch};
use tracing::{error, info, warn};

use chrono::{DateTime, Utc};

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
use super::shell;
use super::types::*;
use super::write_coordinator::ProjectWriteCoordinator;
use crate::error::EngineError;
use crate::events::EngineEvent;
use crate::file_ops::FileOp;

fn storage_spec_to_core(s: aura_storage::StorageSpec) -> Result<Spec, String> {
    let parse_dt = |v: &Option<String>| -> DateTime<Utc> {
        v.as_deref()
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(Utc::now)
    };
    Ok(Spec {
        spec_id: s.id.parse().map_err(|e| format!("invalid spec id: {e}"))?,
        project_id: s
            .project_id
            .as_deref()
            .unwrap_or("")
            .parse()
            .map_err(|e| format!("invalid project id: {e}"))?,
        title: s.title.unwrap_or_default(),
        order_index: s.order_index.unwrap_or(0) as u32,
        markdown_contents: s.markdown_contents.unwrap_or_default(),
        created_at: parse_dt(&s.created_at),
        updated_at: parse_dt(&s.updated_at),
    })
}

pub struct LoopHandle {
    pub project_id: ProjectId,
    pub agent_instance_id: AgentInstanceId,
    stop_tx: watch::Sender<LoopCommand>,
    join_handle: tokio::task::JoinHandle<Result<LoopOutcome, EngineError>>,
}

impl LoopHandle {
    pub fn pause(&self) {
        let _ = self.stop_tx.send(LoopCommand::Pause);
    }

    pub fn stop(&self) {
        let _ = self.stop_tx.send(LoopCommand::Stop);
    }

    pub fn is_finished(&self) -> bool {
        self.join_handle.is_finished()
    }

    pub async fn wait(self) -> Result<LoopOutcome, EngineError> {
        self.join_handle
            .await
            .map_err(|e| EngineError::Join(e.to_string()))?
    }
}

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
        storage_spec_to_core(ss)
            .map_err(|e| EngineError::Parse(format!("spec conversion: {e}")))
    }

    fn get_jwt_for_storage(&self) -> Result<String, EngineError> {
        let bytes = self
            .store
            .get_setting("zero_auth_session")
            .map_err(|_| EngineError::Parse("no active session for aura-storage".into()))?;
        let session: ZeroAuthSession =
            serde_json::from_slice(&bytes).map_err(|e| EngineError::Parse(e.to_string()))?;
        Ok(session.access_token)
    }

    pub fn with_write_coordinator(mut self, coordinator: ProjectWriteCoordinator) -> Self {
        self.write_coordinator = coordinator;
        self
    }

    pub async fn start(
        self: Arc<Self>,
        project_id: ProjectId,
        agent_instance_id: Option<AgentInstanceId>,
    ) -> Result<LoopHandle, EngineError> {
        let _project = self.project_service.get_project_async(&project_id).await?;

        let agent = if let Some(aiid) = agent_instance_id {
            self.agent_instance_service
                .get_instance(&project_id, &aiid)
                .await
                .map_err(|_| EngineError::Parse(format!("agent instance {aiid} not found")))?
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
            self.agent_instance_service
                .create_instance_from_agent(&project_id, &default_agent)
                .await?
        };

        let stale = self.session_service.close_stale_sessions(
            &project_id,
            Some(&agent.agent_instance_id),
        ).await?;
        if !stale.is_empty() {
            info!("closed {} stale active session(s) for agent {}", stale.len(), agent.agent_instance_id);
        }

        let agent = if agent.status == AgentStatus::Working {
            info!(
                agent_instance_id = %agent.agent_instance_id,
                "resetting stale Working agent to Idle before starting loop"
            );
            self.agent_instance_service
                .finish_working(&project_id, &agent.agent_instance_id)
                .await
                .ok();
            self.agent_instance_service
                .get_instance(&project_id, &agent.agent_instance_id)
                .await
                .map_err(|_| EngineError::Parse(format!("agent instance {} not found", agent.agent_instance_id)))?
        } else {
            agent
        };

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
        let join_handle = tokio::spawn(async move {
            let result = engine
                .run_loop(project_id, aiid, session, stop_rx)
                .await;
            if let Err(ref e) = result {
                error!(error = %e, "run_loop exited with error, emitting LoopFinished");

                // Reset any tasks stuck in InProgress so the UI doesn't show stale spinners
                if let Ok(orphaned) = engine.task_service.reset_in_progress_tasks(&project_id).await {
                    for t in &orphaned {
                        engine.emit(EngineEvent::TaskBecameReady {
                            project_id,
                            agent_instance_id: aiid,
                            task_id: t.task_id,
                        });
                    }
                }

                engine.emit(EngineEvent::LoopFinished {
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
                let _ = engine.agent_instance_service.finish_working(&project_id, &aiid).await;
            }
            result
        });

        Ok(LoopHandle {
            project_id,
            agent_instance_id: agent.agent_instance_id,
            stop_tx,
            join_handle,
        })
    }

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
            let agent = self.agent_instance_service
                .get_instance(&project_id, &agent_instance_id).await.ok();
            let result = if let Some(cmd) = shell::extract_shell_command(&task) {
                Some(self.execute_shell_task(&project, &task, &cmd, agent_instance_id).await)
            } else {
                tokio::select! {
                    r = self.execute_task_agentic(
                        &project_id, &task, &ctx.session, &ctx.api_key,
                        agent.as_ref(), &ctx.work_log, &ctx.workspace_cache,
                    ) => Some(r),
                    _ = stop_rx.changed() => None,
                }
            };
            let Some(result) = result else {
                return Ok(ctx.handle_interruption(self, &task, &stop_rx).await);
            };
            let outcome = self.finalize_task_execution(
                project_id, agent_instance_id, &task, &ctx.session, &ctx.api_key,
                &ctx.session.user_id, &ctx.session.model, task_start, &baseline,
                &build_baseline, result, &ctx.workspace_cache,
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

    pub(crate) fn update_task_tracking(
        &self,
        project_id: &ProjectId,
        task: &Task,
        user_id: &Option<String>,
        model: &Option<String>,
        input_tokens: u64,
        output_tokens: u64,
    ) {
        // Token tracking fields are not stored in aura-storage's StorageTask.
        // They live on agent instances / sessions instead.
        let _ = (project_id, task, user_id, model, input_tokens, output_tokens);
    }

    pub(crate) fn current_user_id(&self) -> Option<String> {
        self.store
            .get_setting("zero_auth_session")
            .ok()
            .and_then(|bytes| serde_json::from_slice::<ZeroAuthSession>(&bytes).ok())
            .map(|s| s.user_id)
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
        let project_root = &project.linked_folder_path;
        if !crate::git_ops::is_git_repo(project_root) {
            return;
        }

        let all_tasks = match self.task_service.list_tasks(&task.project_id).await {
            Ok(t) => t,
            Err(_) => return,
        };
        let spec_tasks: Vec<&Task> = all_tasks
            .iter()
            .filter(|t| t.spec_id == task.spec_id)
            .collect();
        let all_done = spec_tasks
            .iter()
            .all(|t| t.status == TaskStatus::Done);
        if !all_done {
            return;
        }

        let jwt = match self.get_jwt_for_storage() {
            Ok(jwt) => jwt,
            Err(_) => return,
        };

        let repo_label = format!(
            "{}/{}",
            project.orbit_owner.as_deref().unwrap_or(""),
            project.orbit_repo.as_deref().unwrap_or("")
        );

        match crate::git_ops::git_push(project_root, git_repo_url, branch, &jwt).await {
            Ok(commits) => {
                let summary = format!(
                    "Spec complete -- {} task(s) pushed",
                    spec_tasks.len()
                );
                self.emit(EngineEvent::GitPushed {
                    project_id: task.project_id,
                    agent_instance_id,
                    spec_id: task.spec_id,
                    repo: repo_label.clone(),
                    branch: branch.to_string(),
                    commits: commits.clone(),
                    summary: summary.clone(),
                });

                self.post_feed_event(
                    agent_instance_id,
                    task.project_id,
                    &repo_label,
                    branch,
                    &commits,
                    &summary,
                )
                .await;
            }
            Err(e) => {
                warn!(error = %e, "git push after spec completion failed (non-fatal)");
            }
        }
    }

    /// Post a feed event to aura-network's internal activity API.
    async fn post_feed_event(
        &self,
        agent_instance_id: AgentInstanceId,
        project_id: ProjectId,
        repo: &str,
        branch: &str,
        commits: &[crate::git_ops::CommitInfo],
        summary: &str,
    ) {
        let network = match self.network_client.as_ref() {
            Some(n) => n,
            None => return,
        };
        let token = match self.internal_service_token.as_deref() {
            Some(t) if !t.is_empty() => t,
            _ => return,
        };

        let instance = self
            .agent_instance_service
            .get_instance(&project_id, &agent_instance_id)
            .await
            .ok();

        let jwt = self.get_jwt_for_storage().ok();
        let net_agent = match (instance.as_ref(), jwt.as_deref()) {
            (Some(inst), Some(jwt)) => {
                network.get_agent(&inst.agent_id.to_string(), jwt).await.ok()
            }
            _ => None,
        };

        let profile_id = net_agent
            .as_ref()
            .and_then(|a| a.profile_id.as_deref())
            .unwrap_or("");
        if profile_id.is_empty() {
            info!("agent has no profile_id, skipping feed event post");
            return;
        }

        let metadata = serde_json::json!({
            "author_name": net_agent.as_ref().map(|a| a.name.as_str()).unwrap_or("Agent"),
            "author_type": "agent",
            "author_avatar": net_agent.as_ref().and_then(|a| a.icon.as_deref()).unwrap_or(""),
            "repo": repo,
            "branch": branch,
            "commits": commits,
            "summary": summary,
        });

        if let Err(e) = network
            .post_internal_activity(token, profile_id, "push", metadata)
            .await
        {
            warn!(error = %e, "failed to post feed event to aura-network (non-fatal)");
        } else {
            info!("posted push feed event to aura-network");
        }
    }

    pub(crate) fn emit(&self, event: EngineEvent) {
        let _ = self.event_tx.send(event);
    }
}
