use std::sync::Arc;

use chrono::Utc;
use tokio::sync::broadcast;
use tracing::{info, warn};

use aura_os_core::{
    ProcessEvent, ProcessEventId, ProcessEventStatus, ProcessNodeType, ProcessRun, ProcessRunId,
    ProcessRunStatus, ProcessRunTrigger, ProcessId,
};

use crate::error::ProcessError;
use crate::process_store::ProcessStore;

pub struct ProcessExecutor {
    store: Arc<ProcessStore>,
    event_broadcast: broadcast::Sender<serde_json::Value>,
}

impl ProcessExecutor {
    pub fn new(
        store: Arc<ProcessStore>,
        event_broadcast: broadcast::Sender<serde_json::Value>,
    ) -> Self {
        Self {
            store,
            event_broadcast,
        }
    }

    pub fn trigger(
        &self,
        process_id: &ProcessId,
        trigger: ProcessRunTrigger,
    ) -> Result<ProcessRun, ProcessError> {
        let process = self
            .store
            .get_process(process_id)?
            .ok_or_else(|| ProcessError::NotFound(process_id.to_string()))?;

        let now = Utc::now();
        let run = ProcessRun {
            run_id: ProcessRunId::new(),
            process_id: process.process_id,
            status: ProcessRunStatus::Pending,
            trigger,
            error: None,
            started_at: now,
            completed_at: None,
        };
        self.store.save_run(&run)?;

        let _ = self.event_broadcast.send(serde_json::json!({
            "type": "process_run_started",
            "process_id": process.process_id.to_string(),
            "run_id": run.run_id.to_string(),
        }));

        info!(
            process_id = %process.process_id,
            run_id = %run.run_id,
            "Process run triggered"
        );

        let store = self.store.clone();
        let broadcast = self.event_broadcast.clone();
        let run_clone = run.clone();
        tokio::spawn(async move {
            if let Err(e) = execute_run(&store, &broadcast, &run_clone).await {
                warn!(run_id = %run_clone.run_id, error = %e, "Process run failed");
            }
        });

        Ok(run)
    }
}

async fn execute_run(
    store: &ProcessStore,
    broadcast: &broadcast::Sender<serde_json::Value>,
    run: &ProcessRun,
) -> Result<(), ProcessError> {
    let mut current_run = run.clone();
    current_run.status = ProcessRunStatus::Running;
    store.save_run(&current_run)?;

    let nodes = store.list_nodes(&run.process_id)?;
    let connections = store.list_connections(&run.process_id)?;

    let ignition = nodes
        .iter()
        .find(|n| n.node_type == ProcessNodeType::Ignition)
        .ok_or_else(|| ProcessError::InvalidGraph("No ignition node found".into()))?;

    // BFS walk from ignition through connections
    let mut queue = std::collections::VecDeque::new();
    queue.push_back(ignition.node_id);
    let mut visited = std::collections::HashSet::new();

    while let Some(node_id) = queue.pop_front() {
        if !visited.insert(node_id) {
            continue;
        }

        let node = nodes
            .iter()
            .find(|n| n.node_id == node_id)
            .ok_or_else(|| ProcessError::NodeNotFound(node_id.to_string()))?;

        let now = Utc::now();
        let event = ProcessEvent {
            event_id: ProcessEventId::new(),
            run_id: run.run_id,
            node_id: node.node_id,
            process_id: run.process_id,
            status: ProcessEventStatus::Completed,
            input_snapshot: node.prompt.clone(),
            output: String::new(),
            started_at: now,
            completed_at: Some(now),
        };
        store.save_event(&event)?;

        let _ = broadcast.send(serde_json::json!({
            "type": "process_node_executed",
            "process_id": run.process_id.to_string(),
            "run_id": run.run_id.to_string(),
            "node_id": node_id.to_string(),
            "node_type": format!("{:?}", node.node_type),
        }));

        // Enqueue downstream nodes
        for conn in &connections {
            if conn.source_node_id == node_id {
                queue.push_back(conn.target_node_id);
            }
        }
    }

    current_run.status = ProcessRunStatus::Completed;
    current_run.completed_at = Some(Utc::now());
    store.save_run(&current_run)?;

    let _ = broadcast.send(serde_json::json!({
        "type": "process_run_completed",
        "process_id": run.process_id.to_string(),
        "run_id": run.run_id.to_string(),
    }));

    Ok(())
}
