//! Local self-improvement settings and proposal queue for agents.
//!
//! This is intentionally local-only. The durable effects still flow through
//! the existing memory and skill APIs once a user applies a proposal.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use aura_os_core::AgentId;

use super::AgentService;
use crate::errors::AgentError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentSelfImprovementMode {
    Off,
    Propose,
}

impl Default for AgentSelfImprovementMode {
    fn default() -> Self {
        Self::Off
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentSelfImprovementConfig {
    #[serde(default)]
    pub mode: AgentSelfImprovementMode,
    #[serde(default = "default_true")]
    pub allow_memory: bool,
    #[serde(default = "default_true")]
    pub allow_skills: bool,
    #[serde(default)]
    pub allow_background_review: bool,
}

impl Default for AgentSelfImprovementConfig {
    fn default() -> Self {
        Self {
            mode: AgentSelfImprovementMode::Off,
            allow_memory: true,
            allow_skills: true,
            allow_background_review: false,
        }
    }
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentImprovementKind {
    MemoryFact,
    MemoryProcedure,
    SkillCreate,
    SkillUpdate,
}

impl AgentImprovementKind {
    pub fn touches_memory(self) -> bool {
        matches!(self, Self::MemoryFact | Self::MemoryProcedure)
    }

    pub fn touches_skills(self) -> bool {
        matches!(self, Self::SkillCreate | Self::SkillUpdate)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentImprovementStatus {
    Pending,
    Applied,
    Rejected,
    Failed,
}

impl Default for AgentImprovementStatus {
    fn default() -> Self {
        Self::Pending
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentImprovementSource {
    AgentTool,
    LearningReview,
}

impl Default for AgentImprovementSource {
    fn default() -> Self {
        Self::AgentTool
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentImprovementProvenance {
    #[serde(default)]
    pub source: AgentImprovementSource,
    #[serde(default = "default_agent_tool_created_by")]
    pub created_by: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review_id: Option<String>,
}

impl Default for AgentImprovementProvenance {
    fn default() -> Self {
        Self {
            source: AgentImprovementSource::AgentTool,
            created_by: default_agent_tool_created_by(),
            review_id: None,
        }
    }
}

fn default_agent_tool_created_by() -> String {
    "agent_tool".to_string()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentImprovementEvidence {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event_type: Option<String>,
    pub quote: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentImprovementProposal {
    pub id: String,
    pub agent_id: AgentId,
    pub kind: AgentImprovementKind,
    pub title: String,
    pub rationale: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_session_id: Option<String>,
    /// Project in which the lesson was learned. Older persisted proposals do
    /// not have this field and continue to deserialize as unscoped.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub evidence: Vec<AgentImprovementEvidence>,
    #[serde(default)]
    pub provenance: AgentImprovementProvenance,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dedup_key: Option<String>,
    #[serde(default)]
    pub payload: Value,
    #[serde(default)]
    pub status: AgentImprovementStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub applied_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentLearningReviewResult {
    pub review_id: String,
    pub scanned_sessions: usize,
    pub scanned_events: usize,
    pub created_proposals: usize,
    pub skipped_existing: usize,
    pub limit_reached: bool,
    pub proposals: Vec<AgentImprovementProposal>,
}

impl AgentService {
    pub(super) fn agent_self_improvement_key(agent_id: &AgentId) -> String {
        format!("agent:self_improvement:{agent_id}")
    }

    pub(super) fn agent_improvements_key(agent_id: &AgentId) -> String {
        format!("agent:improvements:{agent_id}")
    }

    pub fn load_agent_self_improvement_config(
        &self,
        agent_id: &AgentId,
    ) -> Result<AgentSelfImprovementConfig, AgentError> {
        let bytes = match self
            .store
            .get_setting(&Self::agent_self_improvement_key(agent_id))
        {
            Ok(bytes) => bytes,
            Err(aura_os_store::StoreError::NotFound(_)) => {
                return Ok(AgentSelfImprovementConfig::default())
            }
            Err(e) => return Err(AgentError::Store(e)),
        };
        serde_json::from_slice(&bytes).map_err(|e| AgentError::Parse(e.to_string()))
    }

    pub fn save_agent_self_improvement_config(
        &self,
        agent_id: &AgentId,
        config: &AgentSelfImprovementConfig,
    ) -> Result<(), AgentError> {
        let payload = serde_json::to_vec(config).map_err(|e| AgentError::Parse(e.to_string()))?;
        self.store
            .put_setting(&Self::agent_self_improvement_key(agent_id), &payload)
            .map_err(AgentError::Store)
    }

    pub fn delete_agent_self_improvement_config(
        &self,
        agent_id: &AgentId,
    ) -> Result<(), AgentError> {
        match self
            .store
            .delete_setting(&Self::agent_self_improvement_key(agent_id))
        {
            Ok(()) | Err(aura_os_store::StoreError::NotFound(_)) => Ok(()),
            Err(e) => Err(AgentError::Store(e)),
        }
    }

    pub fn list_agent_improvement_proposals(
        &self,
        agent_id: &AgentId,
    ) -> Result<Vec<AgentImprovementProposal>, AgentError> {
        self.load_agent_improvement_proposals(agent_id)
    }

    pub fn get_agent_improvement_proposal(
        &self,
        agent_id: &AgentId,
        proposal_id: &str,
    ) -> Result<AgentImprovementProposal, AgentError> {
        self.load_agent_improvement_proposals(agent_id)?
            .into_iter()
            .find(|proposal| proposal.id == proposal_id)
            .ok_or(AgentError::NotFound)
    }

    pub fn save_agent_improvement_proposal(
        &self,
        proposal: AgentImprovementProposal,
    ) -> Result<AgentImprovementProposal, AgentError> {
        let mut proposals = self.load_agent_improvement_proposals(&proposal.agent_id)?;
        proposals.retain(|existing| existing.id != proposal.id);
        proposals.push(proposal.clone());
        proposals.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        self.save_agent_improvement_proposals(&proposal.agent_id, &proposals)?;
        Ok(proposal)
    }

    pub fn delete_agent_improvement_proposals(&self, agent_id: &AgentId) -> Result<(), AgentError> {
        match self
            .store
            .delete_setting(&Self::agent_improvements_key(agent_id))
        {
            Ok(()) | Err(aura_os_store::StoreError::NotFound(_)) => Ok(()),
            Err(e) => Err(AgentError::Store(e)),
        }
    }

    fn load_agent_improvement_proposals(
        &self,
        agent_id: &AgentId,
    ) -> Result<Vec<AgentImprovementProposal>, AgentError> {
        let bytes = match self
            .store
            .get_setting(&Self::agent_improvements_key(agent_id))
        {
            Ok(bytes) => bytes,
            Err(aura_os_store::StoreError::NotFound(_)) => return Ok(Vec::new()),
            Err(e) => return Err(AgentError::Store(e)),
        };
        serde_json::from_slice(&bytes).map_err(|e| AgentError::Parse(e.to_string()))
    }

    fn save_agent_improvement_proposals(
        &self,
        agent_id: &AgentId,
        proposals: &[AgentImprovementProposal],
    ) -> Result<(), AgentError> {
        let payload =
            serde_json::to_vec(proposals).map_err(|e| AgentError::Parse(e.to_string()))?;
        self.store
            .put_setting(&Self::agent_improvements_key(agent_id), &payload)
            .map_err(AgentError::Store)
    }
}
