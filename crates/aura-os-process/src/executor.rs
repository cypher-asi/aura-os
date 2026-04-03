use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use chrono::Utc;
use tokio::sync::broadcast;
use tracing::{info, warn};

use aura_os_core::{
    ProcessEvent, ProcessEventId, ProcessEventStatus, ProcessNode, ProcessNodeId,
    ProcessNodeType, ProcessRun, ProcessRunId, ProcessRunStatus, ProcessRunTrigger, ProcessId,
};
use aura_os_link::{
    HarnessInbound, HarnessLink, HarnessOutbound, SessionConfig, UserMessage,
};
use aura_os_store::RocksStore;

use crate::error::ProcessError;
use crate::process_store::ProcessStore;

pub struct ProcessExecutor {
    store: Arc<ProcessStore>,
    event_broadcast: broadcast::Sender<serde_json::Value>,
    harness: Arc<dyn HarnessLink>,
    data_dir: PathBuf,
    rocks_store: Arc<RocksStore>,
}

impl ProcessExecutor {
    pub fn new(
        store: Arc<ProcessStore>,
        event_broadcast: broadcast::Sender<serde_json::Value>,
        harness: Arc<dyn HarnessLink>,
        data_dir: PathBuf,
        rocks_store: Arc<RocksStore>,
    ) -> Self {
        Self {
            store,
            event_broadcast,
            harness,
            data_dir,
            rocks_store,
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
        let harness = self.harness.clone();
        let data_dir = self.data_dir.clone();
        let rocks_store = self.rocks_store.clone();
        let run_clone = run.clone();
        tokio::spawn(async move {
            if let Err(e) =
                execute_run(&store, &broadcast, &run_clone, &*harness, &data_dir, &rocks_store)
                    .await
            {
                warn!(run_id = %run_clone.run_id, error = %e, "Process run failed");
            }
        });

        Ok(run)
    }
}

// ---------------------------------------------------------------------------
// Topological sort (Kahn's algorithm)
// ---------------------------------------------------------------------------

fn topological_sort(
    nodes: &[ProcessNode],
    connections: &[aura_os_core::ProcessNodeConnection],
) -> Result<Vec<ProcessNodeId>, ProcessError> {
    let mut in_degree: HashMap<ProcessNodeId, usize> = HashMap::new();
    let mut adjacency: HashMap<ProcessNodeId, Vec<ProcessNodeId>> = HashMap::new();

    for node in nodes {
        in_degree.entry(node.node_id).or_insert(0);
        adjacency.entry(node.node_id).or_default();
    }

    for conn in connections {
        *in_degree.entry(conn.target_node_id).or_insert(0) += 1;
        adjacency
            .entry(conn.source_node_id)
            .or_default()
            .push(conn.target_node_id);
    }

    let mut queue: VecDeque<ProcessNodeId> = in_degree
        .iter()
        .filter(|(_, &deg)| deg == 0)
        .map(|(&id, _)| id)
        .collect();

    let mut sorted = Vec::new();

    while let Some(id) = queue.pop_front() {
        sorted.push(id);
        if let Some(neighbors) = adjacency.get(&id) {
            for &neighbor in neighbors {
                if let Some(deg) = in_degree.get_mut(&neighbor) {
                    *deg -= 1;
                    if *deg == 0 {
                        queue.push_back(neighbor);
                    }
                }
            }
        }
    }

    if sorted.len() != nodes.len() {
        return Err(ProcessError::InvalidGraph(
            "Graph contains a cycle".into(),
        ));
    }

    Ok(sorted)
}

// ---------------------------------------------------------------------------
// Run execution
// ---------------------------------------------------------------------------

async fn execute_run(
    store: &ProcessStore,
    broadcast: &broadcast::Sender<serde_json::Value>,
    run: &ProcessRun,
    harness: &dyn HarnessLink,
    data_dir: &Path,
    rocks_store: &RocksStore,
) -> Result<(), ProcessError> {
    let mut current_run = run.clone();
    current_run.status = ProcessRunStatus::Running;
    store.save_run(&current_run)?;

    let nodes = store.list_nodes(&run.process_id)?;
    let connections = store.list_connections(&run.process_id)?;

    let sorted = topological_sort(&nodes, &connections)?;
    let nodes_by_id: HashMap<ProcessNodeId, &ProcessNode> =
        nodes.iter().map(|n| (n.node_id, n)).collect();

    let jwt = rocks_store.get_jwt();

    // node_id → output text (only present for completed nodes)
    let mut node_outputs: HashMap<ProcessNodeId, String> = HashMap::new();
    // condition node_id → whether it evaluated true
    let mut condition_results: HashMap<ProcessNodeId, bool> = HashMap::new();

    for &node_id in &sorted {
        let node = *nodes_by_id
            .get(&node_id)
            .ok_or_else(|| ProcessError::NodeNotFound(node_id.to_string()))?;

        // ── gather upstream context ────────────────────────────────────
        let incoming: Vec<_> = connections
            .iter()
            .filter(|c| c.target_node_id == node_id)
            .collect();

        let mut upstream_parts: Vec<&str> = Vec::new();
        let mut has_valid_upstream = false;

        for conn in &incoming {
            // If the source was a condition node, only follow the taken branch.
            if let Some(&cond_result) = condition_results.get(&conn.source_node_id) {
                let is_false_edge = conn.source_handle.as_deref() == Some("false");
                if (cond_result && is_false_edge) || (!cond_result && !is_false_edge) {
                    continue;
                }
            }

            if let Some(output) = node_outputs.get(&conn.source_node_id) {
                has_valid_upstream = true;
                if !output.is_empty() {
                    upstream_parts.push(output);
                }
            }
        }

        // Nodes with upstream dependencies but no valid completed parent → skip
        if !incoming.is_empty() && !has_valid_upstream {
            record_event(store, broadcast, run, node, ProcessEventStatus::Skipped, "", "");
            continue;
        }

        let upstream_context = upstream_parts.join("\n\n---\n\n");

        // ── broadcast running status ───────────────────────────────────
        let _started_at = Utc::now();
        let _ = broadcast.send(serde_json::json!({
            "type": "process_node_executed",
            "process_id": run.process_id.to_string(),
            "run_id": run.run_id.to_string(),
            "node_id": node_id.to_string(),
            "node_type": format!("{:?}", node.node_type),
            "status": "running",
        }));

        // ── execute node ───────────────────────────────────────────────
        let result = match node.node_type {
            ProcessNodeType::Ignition => execute_ignition(node),
            ProcessNodeType::Action => {
                execute_action(node, &upstream_context, harness, jwt.as_deref()).await
            }
            ProcessNodeType::Condition => {
                execute_condition(node, &upstream_context, harness, jwt.as_deref()).await
            }
            ProcessNodeType::Delay => execute_delay(node).await,
            ProcessNodeType::Artifact => {
                execute_artifact(node, &upstream_context, &run.process_id, &run.run_id, data_dir)
                    .await
            }
            ProcessNodeType::Merge => Ok(upstream_context.clone()),
        };

        match result {
            Ok(output) => {
                if node.node_type == ProcessNodeType::Condition {
                    condition_results.insert(node_id, parse_condition_result(&output));
                }

                record_event(
                    store,
                    broadcast,
                    run,
                    node,
                    ProcessEventStatus::Completed,
                    &upstream_context,
                    &output,
                );
                node_outputs.insert(node_id, output);
            }
            Err(e) => {
                let err_msg = e.to_string();
                record_event(
                    store,
                    broadcast,
                    run,
                    node,
                    ProcessEventStatus::Failed,
                    &upstream_context,
                    &err_msg,
                );

                current_run.status = ProcessRunStatus::Failed;
                current_run.error = Some(err_msg);
                current_run.completed_at = Some(Utc::now());
                store.save_run(&current_run)?;

                let _ = broadcast.send(serde_json::json!({
                    "type": "process_run_failed",
                    "process_id": run.process_id.to_string(),
                    "run_id": run.run_id.to_string(),
                    "error": current_run.error,
                }));

                return Err(e);
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

// ---------------------------------------------------------------------------
// Per-node execution
// ---------------------------------------------------------------------------

fn execute_ignition(node: &ProcessNode) -> Result<String, ProcessError> {
    let mut parts = Vec::new();

    if !node.prompt.is_empty() {
        parts.push(node.prompt.clone());
    }

    if !node.config.is_null() && node.config != serde_json::Value::Object(Default::default()) {
        parts.push(format!(
            "## Configuration\n\n```json\n{}\n```",
            serde_json::to_string_pretty(&node.config).unwrap_or_default()
        ));
    }

    Ok(parts.join("\n\n"))
}

async fn execute_action(
    node: &ProcessNode,
    upstream_context: &str,
    harness: &dyn HarnessLink,
    token: Option<&str>,
) -> Result<String, ProcessError> {
    let config = SessionConfig {
        agent_id: node.agent_id.as_ref().map(|id| id.to_string()),
        token: token.map(|s| s.to_string()),
        ..Default::default()
    };

    let session = harness
        .open_session(config)
        .await
        .map_err(|e| ProcessError::Execution(format!("Failed to open harness session: {e}")))?;

    let full_prompt = if upstream_context.is_empty() {
        node.prompt.clone()
    } else {
        format!(
            "## Context from previous steps\n\n{upstream_context}\n\n## Task\n\n{}",
            node.prompt
        )
    };

    session
        .commands_tx
        .send(HarnessInbound::UserMessage(UserMessage {
            content: full_prompt,
            tool_hints: None,
        }))
        .map_err(|e| ProcessError::Execution(format!("Failed to send message: {e}")))?;

    collect_harness_response(&session.events_tx).await
}

async fn execute_condition(
    node: &ProcessNode,
    upstream_context: &str,
    harness: &dyn HarnessLink,
    token: Option<&str>,
) -> Result<String, ProcessError> {
    let cfg = &node.config;
    let condition_expr = cfg
        .get("condition_expression")
        .and_then(|v| v.as_str())
        .unwrap_or(&node.prompt);

    let evaluation_prompt = format!(
        "Evaluate the following condition and respond with ONLY the word \"true\" or \"false\".\n\n\
         ## Condition\n{condition_expr}\n\n\
         ## Context\n{upstream_context}"
    );

    let config = SessionConfig {
        agent_id: node.agent_id.as_ref().map(|id| id.to_string()),
        token: token.map(|s| s.to_string()),
        ..Default::default()
    };

    let session = harness
        .open_session(config)
        .await
        .map_err(|e| ProcessError::Execution(format!("Failed to open condition session: {e}")))?;

    session
        .commands_tx
        .send(HarnessInbound::UserMessage(UserMessage {
            content: evaluation_prompt,
            tool_hints: None,
        }))
        .map_err(|e| ProcessError::Execution(format!("Failed to send condition message: {e}")))?;

    collect_harness_response(&session.events_tx).await
}

async fn execute_delay(node: &ProcessNode) -> Result<String, ProcessError> {
    let seconds = node
        .config
        .get("delay_seconds")
        .and_then(|v| v.as_u64())
        .unwrap_or(60);

    info!(node_id = %node.node_id, seconds, "Delay node sleeping");
    tokio::time::sleep(std::time::Duration::from_secs(seconds)).await;

    Ok(format!("Delayed {seconds} seconds"))
}

async fn execute_artifact(
    node: &ProcessNode,
    upstream_context: &str,
    process_id: &ProcessId,
    run_id: &ProcessRunId,
    data_dir: &Path,
) -> Result<String, ProcessError> {
    let cfg = &node.config;
    let artifact_name = cfg
        .get("artifact_name")
        .and_then(|v| v.as_str())
        .unwrap_or(&node.label);

    let safe_name = artifact_name
        .replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
    let filename = format!("{safe_name}.md");

    let dir = data_dir
        .join("process-artifacts")
        .join(process_id.to_string())
        .join(run_id.to_string());

    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| ProcessError::Execution(format!("Failed to create artifact dir: {e}")))?;

    let file_path = dir.join(&filename);
    tokio::fs::write(&file_path, upstream_context.as_bytes())
        .await
        .map_err(|e| ProcessError::Execution(format!("Failed to write artifact: {e}")))?;

    info!(
        node_id = %node.node_id,
        path = %file_path.display(),
        bytes = upstream_context.len(),
        "Artifact saved"
    );

    // Pass upstream through to downstream nodes
    Ok(upstream_context.to_string())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async fn collect_harness_response(
    events_tx: &broadcast::Sender<HarnessOutbound>,
) -> Result<String, ProcessError> {
    let mut rx = events_tx.subscribe();
    let mut output = String::new();

    loop {
        match rx.recv().await {
            Ok(HarnessOutbound::TextDelta(delta)) => {
                output.push_str(&delta.text);
            }
            Ok(HarnessOutbound::AssistantMessageEnd(_)) => break,
            Ok(HarnessOutbound::Error(err)) => {
                return Err(ProcessError::Execution(format!(
                    "Harness error ({}): {}",
                    err.code, err.message
                )));
            }
            Err(broadcast::error::RecvError::Closed) => break,
            Err(broadcast::error::RecvError::Lagged(n)) => {
                warn!(skipped = n, "Harness event receiver lagged");
                continue;
            }
            _ => continue,
        }
    }

    Ok(output)
}

fn parse_condition_result(output: &str) -> bool {
    let normalized = output.trim().to_lowercase();
    normalized.contains("true") && !normalized.contains("false")
}

fn record_event(
    store: &ProcessStore,
    broadcast: &broadcast::Sender<serde_json::Value>,
    run: &ProcessRun,
    node: &ProcessNode,
    status: ProcessEventStatus,
    input: &str,
    output: &str,
) {
    let now = Utc::now();
    let event = ProcessEvent {
        event_id: ProcessEventId::new(),
        run_id: run.run_id,
        node_id: node.node_id,
        process_id: run.process_id,
        status,
        input_snapshot: input.to_string(),
        output: output.to_string(),
        started_at: now,
        completed_at: Some(now),
    };

    if let Err(e) = store.save_event(&event) {
        warn!(event_id = %event.event_id, error = %e, "Failed to save process event");
    }

    let _ = broadcast.send(serde_json::json!({
        "type": "process_node_executed",
        "process_id": run.process_id.to_string(),
        "run_id": run.run_id.to_string(),
        "node_id": node.node_id.to_string(),
        "node_type": format!("{:?}", node.node_type),
        "status": format!("{:?}", status),
    }));
}
