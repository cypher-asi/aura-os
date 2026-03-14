mod error;
pub use error::AgentError;

use std::sync::Arc;

use chrono::Utc;

use aura_core::*;
use aura_store::RocksStore;

pub struct AgentService {
    store: Arc<RocksStore>,
}

impl AgentService {
    pub fn new(store: Arc<RocksStore>) -> Self {
        Self { store }
    }

    pub fn create_agent(&self, project_id: &ProjectId, name: String) -> Result<Agent, AgentError> {
        let now = Utc::now();
        let agent = Agent {
            agent_id: AgentId::new(),
            project_id: *project_id,
            name,
            status: AgentStatus::Idle,
            current_task_id: None,
            current_session_id: None,
            created_at: now,
            updated_at: now,
        };
        self.store.put_agent(&agent)?;
        Ok(agent)
    }

    pub fn transition_agent(
        &self,
        project_id: &ProjectId,
        agent_id: &AgentId,
        new_status: AgentStatus,
    ) -> Result<Agent, AgentError> {
        let mut agent = self.get_agent(project_id, agent_id)?;
        Self::validate_transition(agent.status, new_status)?;
        agent.status = new_status;
        agent.updated_at = Utc::now();
        self.store.put_agent(&agent)?;
        Ok(agent)
    }

    pub fn validate_transition(
        current: AgentStatus,
        target: AgentStatus,
    ) -> Result<(), AgentError> {
        let legal = matches!(
            (current, target),
            (AgentStatus::Idle, AgentStatus::Working)
                | (AgentStatus::Working, AgentStatus::Idle)
                | (AgentStatus::Working, AgentStatus::Blocked)
                | (AgentStatus::Working, AgentStatus::Error)
                | (AgentStatus::Working, AgentStatus::Stopped)
                | (AgentStatus::Blocked, AgentStatus::Working)
                | (AgentStatus::Idle, AgentStatus::Stopped)
                | (AgentStatus::Stopped, AgentStatus::Idle)
                | (AgentStatus::Error, AgentStatus::Idle)
        );
        if legal {
            Ok(())
        } else {
            Err(AgentError::IllegalTransition { current, target })
        }
    }

    pub fn start_working(
        &self,
        project_id: &ProjectId,
        agent_id: &AgentId,
        task_id: &TaskId,
        session_id: &SessionId,
    ) -> Result<Agent, AgentError> {
        let mut agent = self.get_agent(project_id, agent_id)?;
        Self::validate_transition(agent.status, AgentStatus::Working)?;
        agent.status = AgentStatus::Working;
        agent.current_task_id = Some(*task_id);
        agent.current_session_id = Some(*session_id);
        agent.updated_at = Utc::now();
        self.store.put_agent(&agent)?;
        Ok(agent)
    }

    pub fn finish_working(
        &self,
        project_id: &ProjectId,
        agent_id: &AgentId,
    ) -> Result<Agent, AgentError> {
        let mut agent = self.get_agent(project_id, agent_id)?;
        Self::validate_transition(agent.status, AgentStatus::Idle)?;
        agent.status = AgentStatus::Idle;
        agent.current_task_id = None;
        agent.updated_at = Utc::now();
        self.store.put_agent(&agent)?;
        Ok(agent)
    }

    pub fn get_agent(
        &self,
        project_id: &ProjectId,
        agent_id: &AgentId,
    ) -> Result<Agent, AgentError> {
        self.store
            .get_agent(project_id, agent_id)
            .map_err(|e| match e {
                aura_store::StoreError::NotFound(_) => AgentError::NotFound,
                other => AgentError::Store(other),
            })
    }

    pub fn list_agents(&self, project_id: &ProjectId) -> Result<Vec<Agent>, AgentError> {
        Ok(self.store.list_agents_by_project(project_id)?)
    }
}
