use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::ids::{AgentId, OrgId};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentOrchestration {
    pub orchestration_id: uuid::Uuid,
    pub agent_id: AgentId,
    pub org_id: OrgId,
    pub intent: String,
    pub plan: Vec<AgentOrchestrationStep>,
    pub status: crate::enums::OrchestrationStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentOrchestrationStep {
    pub step_index: u32,
    pub tool_name: String,
    pub tool_input: serde_json::Value,
    pub status: crate::enums::StepStatus,
    pub result: Option<serde_json::Value>,
}
