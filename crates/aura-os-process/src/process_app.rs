//! Application-level process workflows shared by HTTP handlers and agent tools.

use std::sync::Arc;

use chrono::{DateTime, Utc};
use serde_json::json;

use aura_os_core::{
    OrgId, Process, ProcessFolderId, ProcessId, ProcessNode, ProcessNodeId, ProcessNodeType,
    ProjectId,
};

use crate::error::ProcessError;
use crate::process_store::ProcessStore;

const IGNITION_LABEL: &str = "Ignition";
const IGNITION_POSITION_X: f64 = 250.0;
const IGNITION_POSITION_Y: f64 = 50.0;

/// Inputs for creating a new process and its default Ignition node.
pub struct CreateProcessInput {
    /// Owning organization.
    pub org_id: OrgId,
    pub user_id: String,
    pub name: String,
    pub description: String,
    pub project_id: Option<ProjectId>,
    pub folder_id: Option<ProcessFolderId>,
    pub schedule: Option<String>,
    pub tags: Vec<String>,
}

/// Shared process creation and bootstrap logic (e.g. default Ignition node).
#[derive(Clone)]
pub struct ProcessApplicationService {
    store: Arc<ProcessStore>,
}

impl ProcessApplicationService {
    /// Wraps the given store; cheap to clone via [`Arc`].
    pub fn new(store: Arc<ProcessStore>) -> Self {
        Self { store }
    }

    /// Persists a new [`Process`], creates the canonical Ignition node, and returns the process.
    pub fn create_process_with_default_graph(
        &self,
        input: CreateProcessInput,
    ) -> Result<Process, ProcessError> {
        let now = Utc::now();
        let process = build_process_record(&input, now);
        self.store.save_process(&process)?;
        let ignition = ignition_node(process.process_id, now);
        self.store.save_node(&ignition)?;
        Ok(process)
    }
}

fn build_process_record(input: &CreateProcessInput, now: DateTime<Utc>) -> Process {
    Process {
        process_id: ProcessId::new(),
        org_id: input.org_id,
        user_id: input.user_id.clone(),
        project_id: input.project_id,
        name: input.name.clone(),
        description: input.description.clone(),
        enabled: true,
        folder_id: input.folder_id,
        schedule: input.schedule.clone(),
        tags: input.tags.clone(),
        last_run_at: None,
        next_run_at: None,
        created_at: now,
        updated_at: now,
    }
}

fn ignition_node(process_id: ProcessId, now: DateTime<Utc>) -> ProcessNode {
    ProcessNode {
        node_id: ProcessNodeId::new(),
        process_id,
        node_type: ProcessNodeType::Ignition,
        label: IGNITION_LABEL.to_string(),
        agent_id: None,
        prompt: String::new(),
        config: json!({}),
        position_x: IGNITION_POSITION_X,
        position_y: IGNITION_POSITION_Y,
        created_at: now,
        updated_at: now,
    }
}
