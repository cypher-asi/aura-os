use std::sync::Arc;

use chrono::Utc;
use tracing::warn;

use aura_os_core::*;
use aura_os_storage::StorageClient;

use crate::{CreateSessionParams, RolloverSessionParams, SessionError, UpdateContextUsageParams};

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

/// Convert a `StorageEnrichedSession` (the wire shape returned by
/// `/api/me/sessions`) into the domain `EnrichedSession`. Calls
/// through to `storage_session_to_session` for the inner `Session`
/// and parses the joined `agent_id` (a UUID string from
/// `project_agents.agent_id`) into an `AgentId`.
///
/// Malformed `agent_id` strings are silently dropped to `None`
/// rather than poisoning the entire row -- the chat-app left
/// panel can still render a session whose binding has been
/// migrated to a deleted agent, the row just won't carry an
/// avatar lookup key. This matches `EnrichedSession`'s
/// already-tolerant `Option<AgentId>` shape.
pub fn storage_enriched_session_to_enriched_session(
    s: aura_os_storage::StorageEnrichedSession,
    local_overrides: Option<&Session>,
) -> Result<EnrichedSession, String> {
    let agent_id = s
        .agent_id
        .as_deref()
        .filter(|id| !id.is_empty())
        .and_then(|id| id.parse::<AgentId>().ok());
    let session = storage_session_to_session(s.session, local_overrides)?;
    Ok(EnrichedSession { session, agent_id })
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
            cache_creation_input_tokens,
            cache_read_input_tokens,
            total_input_tokens,
            total_output_tokens,
            context_usage_estimate,
        } = params;
        let mut session = self
            .get_session(&project_id, &agent_instance_id, &session_id)
            .await?;
        let turn_tokens = input_tokens
            .saturating_add(output_tokens)
            .saturating_add(cache_creation_input_tokens)
            .saturating_add(cache_read_input_tokens);
        let turn_usage = turn_tokens as f64 / self.model_context_window as f64;
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
                total_input_tokens: Some(session.total_input_tokens),
                total_output_tokens: Some(session.total_output_tokens),
                context_usage_estimate: Some(session.context_usage_estimate),
                ..Default::default()
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
                ended_at: Some(Utc::now().to_rfc3339()),
                ..Default::default()
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

    /// Chat-flavoured rollover used by the auto-fork-on-context-pressure
    /// path. The chat resolver doesn't have an `AgentInstanceId` (the
    /// chat surface partitions sessions by `project_agent_id` — the
    /// project-binding handle aura-storage uses for its
    /// `/api/project-agents/{id}/sessions` endpoint), so this helper
    /// closes the previous chat session and mints the next one from
    /// chat-native identifiers without conflating with the dev-loop
    /// `rollover_session` API.
    ///
    /// Steps:
    /// 1. PUT the previous session to `status="rolled_over"` with
    ///    `ended_at=now` so the sidekick stops painting it as active
    ///    and `latest_context_usage_for_session` snapshots the right
    ///    row.
    /// 2. POST a fresh storage session for `project_agent_id` carrying
    ///    `summary_of_previous_context = summary` so the harness can
    ///    seed the new turn with the prior conversation summary.
    /// 3. Return the new session id parsed back into [`SessionId`].
    ///
    /// Returns [`SessionError::Parse`] when no `storage_client` is
    /// configured — chat auto-fork is meaningless without persistence,
    /// and silently no-op'ing would leave the harness pinned to a
    /// session storage already considers `rolled_over`.
    pub async fn create_chat_followup_session(
        &self,
        project_id: &ProjectId,
        project_agent_id: &str,
        previous_session_id: &SessionId,
        summary: String,
        model: Option<String>,
    ) -> Result<SessionId, SessionError> {
        let storage = self.storage_client.as_ref().ok_or_else(|| {
            SessionError::Parse(
                "create_chat_followup_session requires a configured storage client".into(),
            )
        })?;
        let jwt = self.get_jwt()?;

        let close_req = aura_os_storage::UpdateSessionRequest {
            status: Some("rolled_over".to_string()),
            ended_at: Some(Utc::now().to_rfc3339()),
            ..Default::default()
        };
        storage
            .update_session(&previous_session_id.to_string(), &jwt, &close_req)
            .await?;

        let create_req = aura_os_storage::CreateSessionRequest {
            project_id: project_id.to_string(),
            org_id: None,
            model,
            status: Some("active".to_string()),
            context_usage_estimate: Some(0.0),
            summary_of_previous_context: if summary.trim().is_empty() {
                None
            } else {
                Some(summary)
            },
        };
        let created = storage
            .create_session(project_agent_id, &jwt, &create_req)
            .await?;
        created.id.parse::<SessionId>().map_err(|e| {
            SessionError::Parse(format!(
                "storage returned a non-UUID session id `{}`: {e}",
                created.id
            ))
        })
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
                ended_at: Some(
                    session
                        .ended_at
                        .ok_or(SessionError::Parse(
                            "ended_at missing on completed session".into(),
                        ))?
                        .to_rfc3339(),
                ),
                ..Default::default()
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
                tasks_worked_count: Some(new_count),
                ..Default::default()
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
            // `include_empty`: the plain list filters event-less rows
            // (migration 0014), but a stale *empty* active session is
            // exactly the kind of row this sweep must retire — without
            // this, a session created by a reset and never written to
            // stays "active" forever.
            let sessions = storage.list_sessions_including_empty(aid, &jwt).await?;
            for ss in sessions {
                if ss.status.as_deref() == Some("active") {
                    let req = aura_os_storage::UpdateSessionRequest {
                        status: Some("completed".to_string()),
                        total_input_tokens: ss.total_input_tokens,
                        total_output_tokens: ss.total_output_tokens,
                        ended_at: Some(now.to_rfc3339()),
                        ..Default::default()
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
