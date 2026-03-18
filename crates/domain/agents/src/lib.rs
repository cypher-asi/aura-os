mod error;
pub use error::AgentError;

use std::sync::Arc;

use chrono::Utc;

use aura_core::*;
use aura_store::RocksStore;

// ---------------------------------------------------------------------------
// AgentService – user-level agent templates
// ---------------------------------------------------------------------------

pub struct AgentService {
    store: Arc<RocksStore>,
}

impl AgentService {
    pub fn new(store: Arc<RocksStore>) -> Self {
        Self { store }
    }

    pub fn get_agent(&self, user_id: &str, agent_id: &AgentId) -> Result<Agent, AgentError> {
        self.store
            .get_agent(user_id, agent_id)
            .map_err(|e| match e {
                aura_store::StoreError::NotFound(_) => AgentError::NotFound,
                other => AgentError::Store(other),
            })
    }
}

// ---------------------------------------------------------------------------
// AgentInstanceService – project-level agent instances
// ---------------------------------------------------------------------------

pub struct AgentInstanceService {
    store: Arc<RocksStore>,
}

impl AgentInstanceService {
    pub fn new(store: Arc<RocksStore>) -> Self {
        Self { store }
    }

    pub fn create_instance(
        &self,
        project_id: &ProjectId,
        name: String,
    ) -> Result<AgentInstance, AgentError> {
        let now = Utc::now();
        let instance = AgentInstance {
            agent_instance_id: AgentInstanceId::new(),
            project_id: *project_id,
            agent_id: AgentId::new(),
            name,
            role: String::new(),
            personality: String::new(),
            system_prompt: String::new(),
            skills: Vec::new(),
            icon: None,
            status: AgentStatus::Idle,
            current_task_id: None,
            current_session_id: None,
            total_input_tokens: 0,
            total_output_tokens: 0,
            model: None,
            created_at: now,
            updated_at: now,
        };
        self.store.put_agent_instance(&instance)?;
        Ok(instance)
    }

    pub fn create_instance_from_agent(
        &self,
        project_id: &ProjectId,
        agent: &Agent,
    ) -> Result<AgentInstance, AgentError> {
        let now = Utc::now();
        let instance = AgentInstance {
            agent_instance_id: AgentInstanceId::new(),
            project_id: *project_id,
            agent_id: agent.agent_id,
            name: agent.name.clone(),
            role: agent.role.clone(),
            personality: agent.personality.clone(),
            system_prompt: agent.system_prompt.clone(),
            skills: agent.skills.clone(),
            icon: agent.icon.clone(),
            status: AgentStatus::Idle,
            current_task_id: None,
            current_session_id: None,
            total_input_tokens: 0,
            total_output_tokens: 0,
            model: None,
            created_at: now,
            updated_at: now,
        };
        self.store.put_agent_instance(&instance)?;
        Ok(instance)
    }

    pub fn get_instance(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
    ) -> Result<AgentInstance, AgentError> {
        self.store
            .get_agent_instance(project_id, agent_instance_id)
            .map_err(|e| match e {
                aura_store::StoreError::NotFound(_) => AgentError::NotFound,
                other => AgentError::Store(other),
            })
    }

    pub fn list_instances(
        &self,
        project_id: &ProjectId,
    ) -> Result<Vec<AgentInstance>, AgentError> {
        Ok(self.store.list_agent_instances_by_project(project_id)?)
    }

    pub fn update_instance(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
        name: Option<String>,
        role: Option<String>,
        personality: Option<String>,
        system_prompt: Option<String>,
    ) -> Result<AgentInstance, AgentError> {
        let mut instance = self.get_instance(project_id, agent_instance_id)?;
        if let Some(v) = name {
            instance.name = v;
        }
        if let Some(v) = role {
            instance.role = v;
        }
        if let Some(v) = personality {
            instance.personality = v;
        }
        if let Some(v) = system_prompt {
            instance.system_prompt = v;
        }
        instance.updated_at = Utc::now();
        self.store.put_agent_instance(&instance)?;
        Ok(instance)
    }

    pub fn delete_instance(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
    ) -> Result<(), AgentError> {
        self.store
            .delete_messages_by_agent_instance(project_id, agent_instance_id)?;
        self.store
            .delete_agent_instance(project_id, agent_instance_id)?;
        Ok(())
    }

    pub fn transition_instance(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
        new_status: AgentStatus,
    ) -> Result<AgentInstance, AgentError> {
        let mut instance = self.get_instance(project_id, agent_instance_id)?;
        Self::validate_transition(instance.status, new_status)?;
        instance.status = new_status;
        instance.updated_at = Utc::now();
        self.store.put_agent_instance(&instance)?;
        Ok(instance)
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
        agent_instance_id: &AgentInstanceId,
        task_id: &TaskId,
        session_id: &SessionId,
    ) -> Result<AgentInstance, AgentError> {
        let mut instance = self.get_instance(project_id, agent_instance_id)?;
        Self::validate_transition(instance.status, AgentStatus::Working)?;
        instance.status = AgentStatus::Working;
        instance.current_task_id = Some(*task_id);
        instance.current_session_id = Some(*session_id);
        instance.updated_at = Utc::now();
        self.store.put_agent_instance(&instance)?;
        Ok(instance)
    }

    pub fn finish_working(
        &self,
        project_id: &ProjectId,
        agent_instance_id: &AgentInstanceId,
    ) -> Result<AgentInstance, AgentError> {
        let mut instance = self.get_instance(project_id, agent_instance_id)?;
        Self::validate_transition(instance.status, AgentStatus::Idle)?;
        instance.status = AgentStatus::Idle;
        instance.current_task_id = None;
        instance.updated_at = Utc::now();
        self.store.put_agent_instance(&instance)?;
        Ok(instance)
    }
}
