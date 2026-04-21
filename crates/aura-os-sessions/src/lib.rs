mod error;
pub use error::SessionError;

use std::sync::Arc;

use chrono::Utc;
use tracing::warn;

pub use aura_os_core::parse_dt;
use aura_os_core::*;
use aura_os_storage::StorageClient;

#[derive(Debug)]
pub struct CreateSessionParams {
    pub agent_instance_id: AgentInstanceId,
    pub project_id: ProjectId,
    pub active_task_id: Option<TaskId>,
    pub summary: String,
    pub user_id: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Copy)]
pub struct UpdateContextUsageParams {
    pub project_id: ProjectId,
    pub agent_instance_id: AgentInstanceId,
    pub session_id: SessionId,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_input_tokens: Option<u64>,
    pub total_output_tokens: Option<u64>,
    pub context_usage_estimate: Option<f64>,
}

#[derive(Debug)]
pub struct RolloverSessionParams {
    pub project_id: ProjectId,
    pub agent_instance_id: AgentInstanceId,
    pub session_id: SessionId,
    pub summary: String,
    pub next_task_id: Option<TaskId>,
}

pub struct SessionService {
    jwt_provider: Arc<dyn JwtProvider>,
    storage_client: Option<Arc<StorageClient>>,
    rollover_threshold: f64,
    model_context_window: u64,
}

/// Convert a `StorageSession` into a domain `Session`, optionally merging
/// ephemeral fields from a `local_overrides` session held in memory.
///
/// Without overrides the ephemeral fields (`active_task_id`, `total_*_tokens`,
/// `user_id`, `model`) are defaulted; `tasks_worked` is reconstructed from the
/// persisted `tasks_worked_count`.
pub fn storage_session_to_session(
    s: aura_os_storage::StorageSession,
    local_overrides: Option<&Session>,
) -> Result<Session, String> {
    let mut session = Session::try_from(s)?;
    if let Some(o) = local_overrides {
        session.active_task_id = o.active_task_id;
        session.tasks_worked = o.tasks_worked.clone();
        session.total_input_tokens = o.total_input_tokens;
        session.total_output_tokens = o.total_output_tokens;
        session.user_id = o.user_id.clone();
        session.model = o.model.clone();
    }
    Ok(session)
}

impl SessionService {
    pub fn new(
        jwt_provider: Arc<dyn JwtProvider>,
        rollover_threshold: f64,
        model_context_window: u64,
    ) -> Self {
        Self {
            jwt_provider,
            storage_client: None,
            rollover_threshold,
            model_context_window,
        }
    }

    pub fn with_storage_client(mut self, client: Option<Arc<StorageClient>>) -> Self {
        self.storage_client = client;
        self
    }

    fn get_jwt(&self) -> Result<String, SessionError> {
        self.jwt_provider
            .get_jwt()
            .ok_or_else(|| SessionError::Parse("no active session for JWT".into()))
    }

    pub async fn create_session(
        &self,
        params: CreateSessionParams,
    ) -> Result<Session, SessionError> {
        let CreateSessionParams {
            agent_instance_id,
            project_id,
            active_task_id,
            summary,
            user_id,
            model,
        } = params;
        if let Some(ref storage) = self.storage_client {
            let jwt = self.get_jwt()?;
            let req = aura_os_storage::CreateSessionRequest {
                project_id: project_id.to_string(),
                org_id: None,
                model: model.clone(),
                status: Some("active".to_string()),
                context_usage_estimate: Some(0.0),
                summary_of_previous_context: if summary.is_empty() {
                    None
                } else {
                    Some(summary.clone())
                },
            };
            let ss = storage
                .create_session(&agent_instance_id.to_string(), &jwt, &req)
                .await?;
            let mut session = storage_session_to_session(ss, None).map_err(SessionError::Parse)?;
            session.active_task_id = active_task_id;
            session.user_id = user_id;
            session.model = model;
            session.summary_of_previous_context = summary;
            return Ok(session);
        }

        let now = Utc::now();
        Ok(Session {
            session_id: SessionId::new(),
            agent_instance_id,
            project_id,
            active_task_id,
            tasks_worked: Vec::new(),
            context_usage_estimate: 0.0,
            total_input_tokens: 0,
            total_output_tokens: 0,
            summary_of_previous_context: summary,
            status: SessionStatus::Active,
            user_id,
            model,
            started_at: now,
            ended_at: None,
        })
    }

    /// Update context usage after an LLM turn. `context_usage_estimate` is
    /// persisted to aura-storage together with cumulative token totals.
    pub async fn update_context_usage(
        &self,
        params: UpdateContextUsageParams,
    ) -> Result<Session, SessionError> {
        let UpdateContextUsageParams {
            project_id,
            agent_instance_id,
            session_id,
            input_tokens,
            output_tokens,
            total_input_tokens,
            total_output_tokens,
            context_usage_estimate,
        } = params;
        let mut session = self
            .get_session(&project_id, &agent_instance_id, &session_id)
            .await?;
        let turn_usage = (input_tokens + output_tokens) as f64 / self.model_context_window as f64;
        session.context_usage_estimate = context_usage_estimate
            .unwrap_or(session.context_usage_estimate + turn_usage)
            .clamp(0.0, 1.0);
        session.total_input_tokens =
            total_input_tokens.unwrap_or(session.total_input_tokens + input_tokens);
        session.total_output_tokens =
            total_output_tokens.unwrap_or(session.total_output_tokens + output_tokens);

        if let Some(ref storage) = self.storage_client {
            let jwt = self.get_jwt()?;
            let req = aura_os_storage::UpdateSessionRequest {
                status: None,
                total_input_tokens: Some(session.total_input_tokens),
                total_output_tokens: Some(session.total_output_tokens),
                context_usage_estimate: Some(session.context_usage_estimate),
                summary_of_previous_context: None,
                tasks_worked_count: None,
                ended_at: None,
            };
            storage
                .update_session(&session_id.to_string(), &jwt, &req)
                .await?;
        }
        Ok(session)
    }

    pub fn should_rollover(&self, session: &Session) -> bool {
        const MAX_TASKS_PER_SESSION: usize = 8;
        session.context_usage_estimate >= self.rollover_threshold
            || session.tasks_worked.len() >= MAX_TASKS_PER_SESSION
    }

    pub async fn rollover_session(
        &self,
        params: RolloverSessionParams,
    ) -> Result<Session, SessionError> {
        let RolloverSessionParams {
            project_id,
            agent_instance_id,
            session_id,
            summary,
            next_task_id,
        } = params;
        let old_session = self
            .get_session(&project_id, &agent_instance_id, &session_id)
            .await?;
        let user_id = old_session.user_id.clone();
        let model = old_session.model.clone();

        if let Some(ref storage) = self.storage_client {
            let jwt = self.get_jwt()?;
            let req = aura_os_storage::UpdateSessionRequest {
                status: Some("rolled_over".to_string()),
                total_input_tokens: None,
                total_output_tokens: None,
                context_usage_estimate: None,
                summary_of_previous_context: None,
                tasks_worked_count: None,
                ended_at: Some(Utc::now().to_rfc3339()),
            };
            storage
                .update_session(&session_id.to_string(), &jwt, &req)
                .await?;
        }

        self.create_session(CreateSessionParams {
            agent_instance_id,
            project_id,
            active_task_id: next_task_id,
            summary,
            user_id,
            model,
        })
        .await
    }

    pub async fn end_session(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
        session_id: &SessionId,
        status: SessionStatus,
    ) -> Result<Session, SessionError> {
        let mut session = self
            .get_session(project_id, agent_instance_id, session_id)
            .await?;
        session.status = status;
        session.ended_at = Some(Utc::now());

        if let Some(ref storage) = self.storage_client {
            let jwt = self.get_jwt()?;
            let status_str = serde_json::to_value(status)
                .ok()
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or_else(|| "completed".to_string());
            let req = aura_os_storage::UpdateSessionRequest {
                status: Some(status_str),
                total_input_tokens: Some(session.total_input_tokens),
                total_output_tokens: Some(session.total_output_tokens),
                context_usage_estimate: None,
                summary_of_previous_context: None,
                tasks_worked_count: None,
                ended_at: Some(
                    session
                        .ended_at
                        .ok_or(SessionError::Parse(
                            "ended_at missing on completed session".into(),
                        ))?
                        .to_rfc3339(),
                ),
            };
            storage
                .update_session(&session_id.to_string(), &jwt, &req)
                .await?;
        }
        Ok(session)
    }

    pub async fn get_session(
        &self,
        _project_id: &ProjectId,
        _agent_instance_id: &AgentInstanceId,
        session_id: &SessionId,
    ) -> Result<Session, SessionError> {
        if let Some(ref storage) = self.storage_client {
            let jwt = self.get_jwt()?;
            match storage.get_session(&session_id.to_string(), &jwt).await {
                Ok(ss) => {
                    return storage_session_to_session(ss, None).map_err(SessionError::Parse);
                }
                Err(aura_os_storage::StorageError::Server { status: 404, .. }) => {
                    return Err(SessionError::NotFound);
                }
                Err(e) => return Err(SessionError::Storage(e)),
            }
        }
        Err(SessionError::NotFound)
    }

    pub async fn list_sessions(
        &self,
        _project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
    ) -> Result<Vec<Session>, SessionError> {
        if let Some(ref storage) = self.storage_client {
            let jwt = self.get_jwt()?;
            let storage_sessions = storage
                .list_sessions(&agent_instance_id.to_string(), &jwt)
                .await?;
            return Ok(storage_sessions
                .into_iter()
                .filter_map(|s| storage_session_to_session(s, None).ok())
                .collect());
        }
        Ok(Vec::new())
    }

    /// Record that a task was worked in this session.
    ///
    /// Increments the persisted `tasks_worked_count` in aura-storage so that
    /// the 8-task rollover limit survives process restarts. Returns the
    /// refreshed session when storage is available, or a dummy otherwise.
    pub async fn record_task_worked(
        &self,
        project_id: &ProjectId,
        _agent_instance_id: &AgentInstanceId,
        session_id: &SessionId,
        task_id: TaskId,
    ) -> Result<Session, SessionError> {
        if let Some(ref storage) = self.storage_client {
            let jwt = self.get_jwt()?;
            let current = storage.get_session(&session_id.to_string(), &jwt).await?;
            let new_count = current.tasks_worked_count.unwrap_or(0) + 1;
            let req = aura_os_storage::UpdateSessionRequest {
                status: None,
                total_input_tokens: None,
                total_output_tokens: None,
                context_usage_estimate: None,
                summary_of_previous_context: None,
                tasks_worked_count: Some(new_count),
                ended_at: None,
            };
            storage
                .update_session(&session_id.to_string(), &jwt, &req)
                .await?;
            let mut session =
                storage_session_to_session(current, None).map_err(SessionError::Parse)?;
            session.tasks_worked.push(task_id);
            return Ok(session);
        }

        let mut session = Session::dummy(*project_id);
        session.tasks_worked.push(task_id);
        Ok(session)
    }

    /// Close stale active sessions for a specific agent instance (scoped)
    /// or all agent instances in the project (broad, if `agent_instance_id` is None).
    pub async fn close_stale_sessions(
        &self,
        project_id: &ProjectId,
        agent_instance_id: Option<&AgentInstanceId>,
    ) -> Result<Vec<Session>, SessionError> {
        let Some(ref storage) = self.storage_client else {
            return Ok(Vec::new());
        };
        let jwt = self.get_jwt()?;

        let agent_ids: Vec<String> = if let Some(aiid) = agent_instance_id {
            vec![aiid.to_string()]
        } else {
            let agents = storage
                .list_project_agents(&project_id.to_string(), &jwt)
                .await?;
            agents.into_iter().map(|a| a.id).collect()
        };

        let mut closed = Vec::new();
        let now = Utc::now();
        for aid in &agent_ids {
            let sessions = storage.list_sessions(aid, &jwt).await?;
            for ss in sessions {
                if ss.status.as_deref() == Some("active") {
                    let req = aura_os_storage::UpdateSessionRequest {
                        status: Some("completed".to_string()),
                        total_input_tokens: ss.total_input_tokens,
                        total_output_tokens: ss.total_output_tokens,
                        context_usage_estimate: None,
                        summary_of_previous_context: None,
                        tasks_worked_count: None,
                        ended_at: Some(now.to_rfc3339()),
                    };
                    if let Err(e) = storage.update_session(&ss.id, &jwt, &req).await {
                        warn!(session_id = %ss.id, error = %e, "failed to close stale session");
                        continue;
                    }
                    if let Ok(mut s) = storage_session_to_session(ss, None) {
                        s.status = SessionStatus::Completed;
                        s.ended_at = Some(now);
                        closed.push(s);
                    }
                }
            }
        }
        Ok(closed)
    }

    pub async fn session_count(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
    ) -> Result<usize, SessionError> {
        Ok(self
            .list_sessions(project_id, agent_instance_id)
            .await?
            .len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[tokio::test]
    async fn should_rollover_at_threshold() {
        let tmp = tempfile::TempDir::new().expect("temp dir should be created");
        let store = Arc::new(
            aura_os_store::SettingsStore::open(tmp.path()).expect("SettingsStore should open"),
        );
        let svc = SessionService::new(store, 0.8, 150_000);

        let below = Session {
            session_id: SessionId::new(),
            agent_instance_id: AgentInstanceId::new(),
            project_id: ProjectId::new(),
            active_task_id: None,
            tasks_worked: vec![],
            context_usage_estimate: 0.79,
            total_input_tokens: 0,
            total_output_tokens: 0,
            summary_of_previous_context: String::new(),
            status: SessionStatus::Active,
            user_id: None,
            model: None,
            started_at: Utc::now(),
            ended_at: None,
        };
        assert!(!svc.should_rollover(&below));

        let at = Session {
            context_usage_estimate: 0.8,
            ..below.clone()
        };
        assert!(svc.should_rollover(&at));

        let above = Session {
            context_usage_estimate: 0.95,
            ..below
        };
        assert!(svc.should_rollover(&above));
    }

    #[tokio::test]
    async fn create_session_returns_active_session() {
        let tmp = tempfile::TempDir::new().expect("temp dir should be created");
        let store = Arc::new(
            aura_os_store::SettingsStore::open(tmp.path()).expect("SettingsStore should open"),
        );
        let svc = SessionService::new(store, 0.8, 150_000);

        let pid = ProjectId::new();
        let aid = AgentInstanceId::new();
        let session = svc
            .create_session(CreateSessionParams {
                agent_instance_id: aid,
                project_id: pid,
                active_task_id: None,
                summary: "initial context".into(),
                user_id: None,
                model: None,
            })
            .await
            .expect("session creation should succeed");

        assert_eq!(session.status, SessionStatus::Active);
        assert_eq!(session.summary_of_previous_context, "initial context");
        assert_eq!(session.project_id, pid);
        assert_eq!(session.agent_instance_id, aid);
        assert_eq!(session.context_usage_estimate, 0.0);
    }
}
