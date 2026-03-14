use std::sync::Arc;

use chrono::Utc;

use aura_core::*;
use aura_store::RocksStore;

use crate::claude::ClaudeClient;
use crate::error::SessionError;

pub(crate) const SUMMARY_SYSTEM_PROMPT: &str = r#"
You are a context summarizer. Given the conversation history of an AI coding
agent working on a software project, produce a concise summary that captures:

1. What tasks were completed and their outcomes
2. Key decisions made
3. Current state of the codebase (files changed, patterns established)
4. What the next task should focus on
5. Any blockers or concerns

Keep the summary under 2000 tokens. Be specific about file paths and code patterns.
Respond with the summary text only, no JSON wrapping.
"#;

pub struct SessionService {
    store: Arc<RocksStore>,
    rollover_threshold: f64,
    model_context_window: u64,
}

impl SessionService {
    pub fn new(store: Arc<RocksStore>) -> Self {
        Self {
            store,
            rollover_threshold: 0.5,
            model_context_window: 200_000,
        }
    }

    #[cfg(test)]
    pub fn with_threshold(store: Arc<RocksStore>, threshold: f64) -> Self {
        Self {
            store,
            rollover_threshold: threshold,
            model_context_window: 200_000,
        }
    }

    pub fn create_session(
        &self,
        agent_id: &AgentId,
        project_id: &ProjectId,
        active_task_id: Option<TaskId>,
        summary: String,
    ) -> Result<Session, SessionError> {
        let now = Utc::now();
        let session = Session {
            session_id: SessionId::new(),
            agent_id: *agent_id,
            project_id: *project_id,
            active_task_id,
            tasks_worked: Vec::new(),
            context_usage_estimate: 0.0,
            summary_of_previous_context: summary,
            status: SessionStatus::Active,
            started_at: now,
            ended_at: None,
        };
        self.store.put_session(&session)?;
        Ok(session)
    }

    pub fn update_context_usage(
        &self,
        project_id: &ProjectId,
        agent_id: &AgentId,
        session_id: &SessionId,
        input_tokens: u64,
        output_tokens: u64,
    ) -> Result<Session, SessionError> {
        let mut session = self.get_session(project_id, agent_id, session_id)?;
        let turn_usage = (input_tokens + output_tokens) as f64 / self.model_context_window as f64;
        session.context_usage_estimate = (session.context_usage_estimate + turn_usage).min(1.0);
        self.store.put_session(&session)?;
        Ok(session)
    }

    pub fn should_rollover(&self, session: &Session) -> bool {
        session.context_usage_estimate >= self.rollover_threshold
    }

    pub fn rollover_session(
        &self,
        project_id: &ProjectId,
        agent_id: &AgentId,
        session_id: &SessionId,
        summary: String,
        next_task_id: Option<TaskId>,
    ) -> Result<Session, SessionError> {
        let mut old_session = self.get_session(project_id, agent_id, session_id)?;
        old_session.status = SessionStatus::RolledOver;
        old_session.ended_at = Some(Utc::now());
        self.store.put_session(&old_session)?;

        self.create_session(agent_id, project_id, next_task_id, summary)
    }

    pub fn end_session(
        &self,
        project_id: &ProjectId,
        agent_id: &AgentId,
        session_id: &SessionId,
        status: SessionStatus,
    ) -> Result<Session, SessionError> {
        let mut session = self.get_session(project_id, agent_id, session_id)?;
        session.status = status;
        session.ended_at = Some(Utc::now());
        self.store.put_session(&session)?;
        Ok(session)
    }

    pub fn get_session(
        &self,
        project_id: &ProjectId,
        agent_id: &AgentId,
        session_id: &SessionId,
    ) -> Result<Session, SessionError> {
        self.store
            .get_session(project_id, agent_id, session_id)
            .map_err(|e| match e {
                aura_store::StoreError::NotFound(_) => SessionError::NotFound,
                other => SessionError::Store(other),
            })
    }

    pub fn list_sessions(
        &self,
        project_id: &ProjectId,
        agent_id: &AgentId,
    ) -> Result<Vec<Session>, SessionError> {
        Ok(self.store.list_sessions_by_agent(project_id, agent_id)?)
    }

    pub fn session_count(
        &self,
        project_id: &ProjectId,
        agent_id: &AgentId,
    ) -> Result<usize, SessionError> {
        Ok(self
            .store
            .list_sessions_by_agent(project_id, agent_id)?
            .len())
    }

    pub async fn generate_rollover_summary(
        &self,
        claude_client: &ClaudeClient,
        api_key: &str,
        conversation_history: &str,
    ) -> Result<String, SessionError> {
        let summary = claude_client
            .complete(api_key, SUMMARY_SYSTEM_PROMPT, conversation_history, 2048)
            .await
            .map_err(SessionError::Claude)?;
        Ok(summary)
    }
}
