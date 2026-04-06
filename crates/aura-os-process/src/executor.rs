use std::collections::{HashMap, HashSet, VecDeque};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use tokio::sync::broadcast;
use tracing::{info, warn};

use aura_os_agents::AgentService;
use aura_os_core::{
    Agent, ArtifactType, ProcessArtifact, ProcessArtifactId, ProcessEvent, ProcessEventId,
    ProcessEventStatus, ProcessNode, ProcessNodeId, ProcessNodeType, ProcessRun, ProcessRunId,
    ProcessRunStatus, ProcessRunTrigger, ProcessId, ProjectId, TaskStatus,
};
use aura_os_link::{AutomatonClient, AutomatonStartParams};
use aura_os_orgs::OrgService;
use aura_os_storage::StorageClient;
use aura_os_store::RocksStore;
use aura_os_tasks::TaskService;

use crate::error::ProcessError;
use crate::process_store::ProcessStore;

const DEFAULT_HARNESS_TIMEOUT_SECS: u64 = 600; // 10 minutes

#[derive(Debug, Clone, Default)]
struct NodeTokenUsage {
    input_tokens: u64,
    output_tokens: u64,
    model: Option<String>,
}

struct NodeResult {
    /// Canonical output passed to downstream nodes via `node_outputs`.
    downstream_output: String,
    /// Human-readable summary for the persisted ProcessEvent. When `None` the
    /// `downstream_output` is used as the event display text.
    display_output: Option<String>,
    token_usage: Option<NodeTokenUsage>,
    content_blocks: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct SubTaskPlan {
    title: String,
    description: String,
}

struct DeltaForwarder<'a> {
    broadcast: &'a broadcast::Sender<serde_json::Value>,
    process_id: ProcessId,
    run_id: ProcessRunId,
    node_id: ProcessNodeId,
}

impl DeltaForwarder<'_> {
    fn ctx(&self) -> serde_json::Value {
        serde_json::json!({
            "process_id": self.process_id.to_string(),
            "run_id": self.run_id.to_string(),
            "node_id": self.node_id.to_string(),
        })
    }

    fn forward_text(&self, text: &str) {
        let mut v = self.ctx();
        v["type"] = "text_delta".into();
        v["text"] = text.into();
        let _ = self.broadcast.send(v);
    }

    fn forward_thinking(&self, thinking: &str) {
        let mut v = self.ctx();
        v["type"] = "thinking_delta".into();
        v["thinking"] = thinking.into();
        let _ = self.broadcast.send(v);
    }

    fn forward_tool_start(&self, id: &str, name: &str) {
        let mut v = self.ctx();
        v["type"] = "tool_use_start".into();
        v["id"] = id.into();
        v["name"] = name.into();
        let _ = self.broadcast.send(v);
    }

    #[allow(dead_code)]
    fn forward_tool_snapshot(&self, id: &str, name: &str, input: &serde_json::Value) {
        let mut v = self.ctx();
        v["type"] = "tool_call_snapshot".into();
        v["id"] = id.into();
        v["name"] = name.into();
        v["input"] = input.clone();
        let _ = self.broadcast.send(v);
    }

    fn forward_tool_result(&self, name: &str, result: &str, is_error: bool) {
        let mut v = self.ctx();
        v["type"] = "tool_result".into();
        v["name"] = name.into();
        v["result"] = result.into();
        v["is_error"] = is_error.into();
        let _ = self.broadcast.send(v);
    }
}

fn estimate_cost_usd(input_tokens: u64, output_tokens: u64) -> f64 {
    let input_cost = (input_tokens as f64) * 3.0 / 1_000_000.0;
    let output_cost = (output_tokens as f64) * 15.0 / 1_000_000.0;
    input_cost + output_cost
}

#[derive(Clone)]
pub struct ProcessExecutor {
    store: Arc<ProcessStore>,
    event_broadcast: broadcast::Sender<serde_json::Value>,
    data_dir: PathBuf,
    rocks_store: Arc<RocksStore>,
    agent_service: Arc<AgentService>,
    org_service: Arc<OrgService>,
    automaton_client: Arc<AutomatonClient>,
    storage_client: Option<Arc<StorageClient>>,
    task_service: Arc<TaskService>,
}

impl ProcessExecutor {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        store: Arc<ProcessStore>,
        event_broadcast: broadcast::Sender<serde_json::Value>,
        data_dir: PathBuf,
        rocks_store: Arc<RocksStore>,
        agent_service: Arc<AgentService>,
        org_service: Arc<OrgService>,
        automaton_client: Arc<AutomatonClient>,
        storage_client: Option<Arc<StorageClient>>,
        task_service: Arc<TaskService>,
    ) -> Self {
        Self {
            store,
            event_broadcast,
            data_dir,
            rocks_store,
            agent_service,
            org_service,
            automaton_client,
            storage_client,
            task_service,
        }
    }

    pub fn cancel_run(
        &self,
        process_id: &ProcessId,
        run_id: &ProcessRunId,
    ) -> Result<(), ProcessError> {
        let mut run = self
            .store
            .list_runs(process_id)?
            .into_iter()
            .find(|r| r.run_id == *run_id)
            .ok_or_else(|| ProcessError::RunNotFound(run_id.to_string()))?;

        if !matches!(
            run.status,
            ProcessRunStatus::Pending | ProcessRunStatus::Running
        ) {
            return Err(ProcessError::RunNotActive);
        }

        run.status = ProcessRunStatus::Cancelled;
        run.completed_at = Some(Utc::now());
        self.store.save_run(&run)?;

        let _ = self.event_broadcast.send(serde_json::json!({
            "type": "process_run_completed",
            "process_id": process_id.to_string(),
            "run_id": run_id.to_string(),
            "status": "cancelled",
        }));

        info!(process_id = %process_id, run_id = %run_id, "Process run cancelled");
        Ok(())
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

        let existing_runs = self.store.list_runs(process_id)?;
        if existing_runs.iter().any(|r| {
            matches!(
                r.status,
                ProcessRunStatus::Pending | ProcessRunStatus::Running
            )
        }) {
            return Err(ProcessError::RunAlreadyActive);
        }

        let now = Utc::now();
        let run = ProcessRun {
            run_id: ProcessRunId::new(),
            process_id: process.process_id,
            status: ProcessRunStatus::Pending,
            trigger,
            error: None,
            started_at: now,
            completed_at: None,
            total_input_tokens: None,
            total_output_tokens: None,
            cost_usd: None,
            output: None,
            parent_run_id: None,
            input_override: None,
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

        let executor = self.clone();
        let run_clone = run.clone();
        tokio::spawn(async move {
            if let Err(e) = execute_run(
                &executor,
                &executor.store,
                &executor.event_broadcast,
                &run_clone,
                &executor.data_dir,
                &executor.rocks_store,
                &executor.agent_service,
                &executor.org_service,
            )
            .await
            {
                warn!(run_id = %run_clone.run_id, error = %e, "Process run failed");
                mark_run_failed_if_active(
                    &executor.store,
                    &executor.event_broadcast,
                    &run_clone,
                    &e.to_string(),
                );
            }
        });

        Ok(run)
    }

    /// Trigger a child process run and wait for it to complete, returning
    /// the finished `ProcessRun` (with `.output`).  Used by SubProcess and
    /// ForEach nodes to invoke another process synchronously.
    pub async fn trigger_and_await(
        &self,
        process_id: &ProcessId,
        trigger: ProcessRunTrigger,
        input_override: Option<String>,
        parent_run_id: Option<ProcessRunId>,
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
            total_input_tokens: None,
            total_output_tokens: None,
            cost_usd: None,
            output: None,
            parent_run_id,
            input_override: input_override.clone(),
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
            parent = ?parent_run_id,
            "Child process run triggered (await)"
        );

        if let Err(e) = execute_run(
            self,
            &self.store,
            &self.event_broadcast,
            &run,
            &self.data_dir,
            &self.rocks_store,
            &self.agent_service,
            &self.org_service,
        )
        .await
        {
            mark_run_failed_if_active(
                &self.store,
                &self.event_broadcast,
                &run,
                &e.to_string(),
            );
            return Err(e);
        }

        let completed_run = self
            .store
            .list_runs(process_id)?
            .into_iter()
            .find(|r| r.run_id == run.run_id)
            .ok_or_else(|| ProcessError::RunNotFound(run.run_id.to_string()))?;

        Ok(completed_run)
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
// Reachability from Ignition nodes
// ---------------------------------------------------------------------------

fn reachable_from_ignition(
    nodes: &[ProcessNode],
    connections: &[aura_os_core::ProcessNodeConnection],
) -> HashSet<ProcessNodeId> {
    let mut adjacency: HashMap<ProcessNodeId, Vec<ProcessNodeId>> = HashMap::new();
    for conn in connections {
        adjacency
            .entry(conn.source_node_id)
            .or_default()
            .push(conn.target_node_id);
    }

    let mut visited = HashSet::new();
    let mut queue: VecDeque<ProcessNodeId> = nodes
        .iter()
        .filter(|n| n.node_type == ProcessNodeType::Ignition)
        .map(|n| n.node_id)
        .collect();

    while let Some(id) = queue.pop_front() {
        if !visited.insert(id) {
            continue;
        }
        if let Some(neighbors) = adjacency.get(&id) {
            for &neighbor in neighbors {
                if !visited.contains(&neighbor) {
                    queue.push_back(neighbor);
                }
            }
        }
    }

    visited
}

// ---------------------------------------------------------------------------
// Run execution
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
fn execute_run<'a>(
    executor: &'a ProcessExecutor,
    store: &'a ProcessStore,
    broadcast: &'a broadcast::Sender<serde_json::Value>,
    run: &'a ProcessRun,
    data_dir: &'a Path,
    rocks_store: &'a RocksStore,
    agent_service: &'a AgentService,
    org_service: &'a OrgService,
) -> Pin<Box<dyn Future<Output = Result<(), ProcessError>> + Send + 'a>> {
    Box::pin(async move {
    let mut current_run = run.clone();
    current_run.status = ProcessRunStatus::Running;
    store.save_run(&current_run)?;

    let nodes = store.list_nodes(&run.process_id)?;
    let connections = store.list_connections(&run.process_id)?;

    let sorted = topological_sort(&nodes, &connections)?;
    let reachable = reachable_from_ignition(&nodes, &connections);
    let sorted: Vec<ProcessNodeId> = sorted
        .into_iter()
        .filter(|id| reachable.contains(id))
        .collect();
    let nodes_by_id: HashMap<ProcessNodeId, &ProcessNode> =
        nodes.iter().map(|n| (n.node_id, n)).collect();

    let jwt = rocks_store.get_jwt();

    let workspace_dir = data_dir
        .join("process-workspaces")
        .join(run.process_id.to_string())
        .join(run.run_id.to_string());
    tokio::fs::create_dir_all(&workspace_dir)
        .await
        .map_err(|e| ProcessError::Execution(format!("Failed to create process workspace: {e}")))?;
    let workspace_path = workspace_dir.to_string_lossy().to_string();

    // ── create spec + tasks ────────────────────────────────────────────
    let process = store.get_process(&run.process_id)?
        .ok_or_else(|| ProcessError::NotFound(run.process_id.to_string()))?;
    let project_id = process.project_id
        .ok_or_else(|| ProcessError::Execution("Process has no project_id".into()))?;
    let storage = executor.storage_client.as_ref()
        .ok_or_else(|| ProcessError::Execution("StorageClient required for process execution".into()))?;
    let (spec_id_for_run, node_task_ids) = create_spec_and_tasks(
        storage, jwt.as_deref(), &project_id, &process, &nodes, &sorted, &reachable,
    ).await?;

    // node_id → output text (only present for completed nodes)
    let mut node_outputs: HashMap<ProcessNodeId, String> = HashMap::new();
    // condition node_id → whether it evaluated true
    let mut condition_results: HashMap<ProcessNodeId, bool> = HashMap::new();
    // aggregate token usage across the run
    let mut run_input_tokens: u64 = 0;
    let mut run_output_tokens: u64 = 0;

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
            let now = Utc::now();
            record_terminal_event(store, broadcast, run, node, ProcessEventStatus::Skipped, "", "", now, now);
            continue;
        }

        let mut upstream_context = upstream_parts.join("\n\n---\n\n");

        // ── resolve input artifact refs ────────────────────────────────
        if let Some(refs) = node.config.get("input_artifact_refs").and_then(|v| v.as_array()) {
            for aref in refs {
                if let Some(artifact_ctx) = resolve_artifact_ref(aref, store, data_dir).await {
                    if !upstream_context.is_empty() {
                        upstream_context.push_str("\n\n---\n\n");
                    }
                    upstream_context.push_str(&artifact_ctx);
                }
            }
        }

        // ── inject vault_path into context if configured ───────────────
        if let Some(vault_path) = node.config.get("vault_path").and_then(|v| v.as_str()) {
            if !vault_path.is_empty() {
                upstream_context.push_str(&format!(
                    "\n\n## Obsidian Vault\n\nWrite output to: {vault_path}"
                ));
            }
        }

        // ── persist + broadcast running status ───────────────────────────
        let node_started_at = Utc::now();
        let mut running_event = start_event(
            store, broadcast, run, node, &upstream_context, node_started_at,
        );

        // ── check for pinned output (skip execution) ──────────────────
        if let Some(pinned) = node.config.get("pinned_output").and_then(|v| v.as_str()) {
            if let Some(ref mut evt) = running_event {
                complete_event(
                    store, broadcast, run, node, evt,
                    ProcessEventStatus::Completed, pinned, Utc::now(),
                    None, None,
                );
            } else {
                record_terminal_event(
                    store, broadcast, run, node,
                    ProcessEventStatus::Completed, &upstream_context, pinned,
                    node_started_at, Utc::now(),
                );
            }
            node_outputs.insert(node_id, pinned.to_string());

            let _ = broadcast.send(serde_json::json!({
                "type": "process_run_progress",
                "process_id": run.process_id.to_string(),
                "run_id": run.run_id.to_string(),
                "total_input_tokens": run_input_tokens,
                "total_output_tokens": run_output_tokens,
                "cost_usd": estimate_cost_usd(run_input_tokens, run_output_tokens),
            }));
            continue;
        }

        // ── execute node ───────────────────────────────────────────────
        let fwd = DeltaForwarder {
            broadcast,
            process_id: run.process_id,
            run_id: run.run_id,
            node_id,
        };

        if node.node_type == ProcessNodeType::Ignition {
            if let Some(ref override_text) = run.input_override {
                let now = Utc::now();
                if let Some(ref mut evt) = running_event {
                    complete_event(
                        store, broadcast, run, node, evt,
                        ProcessEventStatus::Completed, override_text, now,
                        None, None,
                    );
                }
                node_outputs.insert(node_id, override_text.clone());
                continue;
            }
        }

        let result: Result<NodeResult, ProcessError> = match node.node_type {
            ProcessNodeType::Ignition => execute_ignition(node).map(|s| NodeResult {
                downstream_output: s, display_output: None, token_usage: None, content_blocks: None,
            }),
            ProcessNodeType::Action | ProcessNodeType::Prompt | ProcessNodeType::Artifact | ProcessNodeType::Condition => {
                let task_id = node_task_ids.get(&node_id)
                    .ok_or_else(|| ProcessError::Execution(format!("No task created for node {}", node_id)))?;
                let timeout_secs = node.config.get("timeout_seconds").and_then(|v| v.as_u64()).unwrap_or(DEFAULT_HARNESS_TIMEOUT_SECS);
                execute_action_via_automaton(
                    node, task_id, &project_id, &run.process_id, &run.run_id,
                    &executor.automaton_client, store, storage, &spec_id_for_run,
                    Some(&fwd), &workspace_path,
                    timeout_secs, jwt.as_deref(), &executor.task_service,
                    agent_service, org_service, &upstream_context,
                ).await
            }
            ProcessNodeType::Delay => execute_delay(node).await.map(|s| NodeResult {
                downstream_output: s, display_output: None, token_usage: None, content_blocks: None,
            }),
            ProcessNodeType::SubProcess => {
                execute_subprocess(node, &upstream_context, executor, &run.run_id).await
            }
            ProcessNodeType::ForEach => {
                execute_foreach(node, &upstream_context, executor, &run.run_id).await
            }
            ProcessNodeType::Merge => {
                let display = format!(
                    "Merged {} upstream output(s) ({} bytes)",
                    incoming.len(), upstream_context.len(),
                );
                Ok(NodeResult {
                    downstream_output: upstream_context.clone(),
                    display_output: Some(display),
                    token_usage: None,
                    content_blocks: None,
                })
            }
        };

        let node_completed_at = Utc::now();

        match result {
            Ok(node_result) => {
                if node.node_type == ProcessNodeType::Condition {
                    condition_results.insert(node_id, parse_condition_result(&node_result.downstream_output));
                }

                if let Some(ref usage) = node_result.token_usage {
                    run_input_tokens += usage.input_tokens;
                    run_output_tokens += usage.output_tokens;
                }

                let event_output = node_result.display_output.as_deref()
                    .unwrap_or(&node_result.downstream_output);

                if let Some(ref mut evt) = running_event {
                    complete_event(
                        store, broadcast, run, node, evt,
                        ProcessEventStatus::Completed, event_output, node_completed_at,
                        node_result.token_usage.as_ref(),
                        node_result.content_blocks.as_deref(),
                    );
                }

                if let Some(tid) = node_task_ids.get(&node_id) {
                    if let (Some(task_id), Some(spec_id)) = (tid.parse().ok(), spec_id_for_run.parse().ok()) {
                        if let Err(e) = executor.task_service.transition_task(&project_id, &spec_id, &task_id, TaskStatus::Done).await {
                            warn!(task_id = %tid, error = %e, "Failed to transition task to Done");
                        }
                    }
                }

                node_outputs.insert(node_id, node_result.downstream_output);
            }
            Err(e) => {
                let err_msg = e.to_string();
                if let Some(ref mut evt) = running_event {
                    complete_event(
                        store, broadcast, run, node, evt,
                        ProcessEventStatus::Failed, &err_msg, node_completed_at,
                        None, None,
                    );
                }

                if let Some(tid) = node_task_ids.get(&node_id) {
                    if let (Some(task_id), Some(spec_id)) = (tid.parse().ok(), spec_id_for_run.parse().ok()) {
                        if let Err(te) = executor.task_service.transition_task(&project_id, &spec_id, &task_id, TaskStatus::Failed).await {
                            warn!(task_id = %tid, error = %te, "Failed to transition task to Failed");
                        }
                    }
                }

                current_run.status = ProcessRunStatus::Failed;
                current_run.error = Some(err_msg);
                current_run.completed_at = Some(Utc::now());
                current_run.total_input_tokens = Some(run_input_tokens);
                current_run.total_output_tokens = Some(run_output_tokens);
                current_run.cost_usd = Some(estimate_cost_usd(run_input_tokens, run_output_tokens));
                store.save_run(&current_run)?;

                let _ = broadcast.send(serde_json::json!({
                    "type": "process_run_failed",
                    "process_id": run.process_id.to_string(),
                    "run_id": run.run_id.to_string(),
                    "error": current_run.error,
                    "total_input_tokens": run_input_tokens,
                    "total_output_tokens": run_output_tokens,
                    "cost_usd": current_run.cost_usd,
                }));

                return Err(e);
            }
        }
    }

    // Determine canonical run output from terminal (leaf) nodes — those with
    // no outgoing edges in the graph.
    let nodes_with_outgoing: std::collections::HashSet<ProcessNodeId> = connections
        .iter()
        .map(|c| c.source_node_id)
        .collect();
    let terminal_outputs: Vec<&str> = sorted
        .iter()
        .filter(|id| !nodes_with_outgoing.contains(id))
        .filter_map(|id| node_outputs.get(id).map(|s| s.as_str()))
        .collect();

    let run_output = if terminal_outputs.len() == 1 {
        Some(terminal_outputs[0].to_string())
    } else if terminal_outputs.len() > 1 {
        Some(terminal_outputs.join("\n\n---\n\n"))
    } else {
        None
    };

    current_run.status = ProcessRunStatus::Completed;
    current_run.completed_at = Some(Utc::now());
    current_run.total_input_tokens = Some(run_input_tokens);
    current_run.total_output_tokens = Some(run_output_tokens);
    current_run.cost_usd = Some(estimate_cost_usd(run_input_tokens, run_output_tokens));
    current_run.output = run_output;
    store.save_run(&current_run)?;

    let _ = broadcast.send(serde_json::json!({
        "type": "process_run_completed",
        "process_id": run.process_id.to_string(),
        "run_id": run.run_id.to_string(),
        "total_input_tokens": run_input_tokens,
        "total_output_tokens": run_output_tokens,
        "cost_usd": current_run.cost_usd,
    }));

    Ok(())
    }) // end Box::pin(async move { ... })
}

// ---------------------------------------------------------------------------
// Agent resolution helper
// ---------------------------------------------------------------------------

/// Resolved integration data for building provider config.
#[allow(dead_code)]
struct ResolvedIntegration {
    metadata: aura_os_core::OrgIntegration,
    secret: Option<String>,
}

/// Resolve the agent's org integration, returning the metadata and secret
/// needed to build a `SessionProviderConfig`.
fn resolve_agent_integration(
    agent: &Agent,
    org_service: &OrgService,
) -> Option<ResolvedIntegration> {
    if agent.auth_source != "org_integration" {
        return None;
    }
    let integration_id = agent.integration_id.as_deref()?;
    let org_id = agent.org_id.as_ref()?;

    let metadata = match org_service.get_integration(org_id, integration_id) {
        Ok(Some(m)) => m,
        Ok(None) => {
            warn!(%integration_id, "Integration not found for process agent");
            return None;
        }
        Err(e) => {
            warn!(%integration_id, error = %e, "Failed to load integration for process agent");
            return None;
        }
    };

    let secret = match org_service.get_integration_secret(integration_id) {
        Ok(s) => s,
        Err(e) => {
            warn!(%integration_id, error = %e, "Failed to load integration secret for process agent");
            return None;
        }
    };

    Some(ResolvedIntegration { metadata, secret })
}

/// Resolve the effective model using the same cascade as the chat handler:
/// node config override > agent default > integration default.
fn effective_model(
    node: &ProcessNode,
    agent: Option<&Agent>,
    integration: Option<&ResolvedIntegration>,
) -> Option<String> {
    node.config
        .get("model")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
        .or_else(|| {
            agent
                .and_then(|a| a.default_model.clone())
                .filter(|s| !s.trim().is_empty())
        })
        .or_else(|| {
            integration
                .and_then(|ri| ri.metadata.default_model.clone())
                .filter(|s| !s.trim().is_empty())
        })
}

// ---------------------------------------------------------------------------
// Spec/Task creation for project-linked processes
// ---------------------------------------------------------------------------

async fn create_spec_and_tasks(
    storage: &StorageClient,
    jwt: Option<&str>,
    project_id: &ProjectId,
    process: &aura_os_core::Process,
    nodes: &[ProcessNode],
    sorted: &[ProcessNodeId],
    reachable: &HashSet<ProcessNodeId>,
) -> Result<(String, HashMap<ProcessNodeId, String>), ProcessError> {
    let jwt = jwt.ok_or_else(|| ProcessError::Execution("No JWT available for task creation".into()))?;
    let pid = project_id.to_string();

    let spec = storage
        .create_spec(
            &pid,
            jwt,
            &aura_os_storage::CreateSpecRequest {
                title: format!("Process: {}", process.name),
                org_id: None,
                order_index: Some(0),
                markdown_contents: Some(process.description.clone()),
            },
        )
        .await
        .map_err(|e| ProcessError::Execution(format!("Failed to create spec: {e}")))?;

    let nodes_by_id: HashMap<ProcessNodeId, &ProcessNode> =
        nodes.iter().map(|n| (n.node_id, n)).collect();

    let mut task_map: HashMap<ProcessNodeId, String> = HashMap::new();

    for (idx, &nid) in sorted.iter().enumerate() {
        if !reachable.contains(&nid) {
            continue;
        }
        let Some(node) = nodes_by_id.get(&nid) else { continue };
        let eligible = matches!(
            node.node_type,
            ProcessNodeType::Action | ProcessNodeType::Prompt | ProcessNodeType::Artifact | ProcessNodeType::Condition
        );
        if !eligible {
            continue;
        }

        let task = storage
            .create_task(
                &pid,
                jwt,
                &aura_os_storage::CreateTaskRequest {
                    spec_id: spec.id.clone(),
                    title: node.label.clone(),
                    org_id: None,
                    description: Some(node.prompt.clone()),
                    status: Some("ready".to_string()),
                    order_index: Some(idx as i32),
                    dependency_ids: None,
                    assigned_project_agent_id: None,
                },
            )
            .await
            .map_err(|e| ProcessError::Execution(format!("Failed to create task for node {}: {e}", node.label)))?;

        task_map.insert(nid, task.id.clone());
        info!(node_id = %nid, task_id = %task.id, "Created task for process node");
    }

    Ok((spec.id, task_map))
}

// ---------------------------------------------------------------------------
// Automaton-based execution for Action nodes
// ---------------------------------------------------------------------------

async fn plan_sub_tasks(
    node: &ProcessNode,
    upstream_context: &str,
    automaton_client: &AutomatonClient,
    project_id: &ProjectId,
    project_path: &str,
    token: Option<&str>,
    agent_service: &AgentService,
    org_service: &OrgService,
) -> Result<Vec<SubTaskPlan>, ProcessError> {
    let model = {
        let loaded_agent = node.agent_id.as_ref().and_then(|aid| {
            agent_service.get_agent_local(aid).ok()
        });
        let ri = loaded_agent.as_ref().and_then(|a| resolve_agent_integration(a, org_service));
        effective_model(node, loaded_agent.as_ref(), ri.as_ref())
    };

    let _planning_prompt = format!(
        "You are a task planner for an automated workflow.\n\n\
         ## Node Task\n{}\n\n\
         ## Upstream Context\n{}\n\n\
         Break this task into independent sub-tasks that can be executed in parallel.\n\
         Each sub-task should produce a self-contained section of the output.\n\n\
         Output ONLY a JSON array, no other text:\n\
         [{{\"title\": \"short title\", \"description\": \"what to do\"}}]\n\n\
         Rules:\n\
         - Each sub-task must be independently executable\n\
         - 2-10 sub-tasks typically\n\
         - If the task is simple or atomic, return a single-element array\n\
         - The description should be specific enough for an agent to execute without additional context",
        node.prompt, upstream_context
    );

    let start_result = automaton_client
        .start(AutomatonStartParams {
            project_id: project_id.to_string(),
            auth_token: token.map(|s| s.to_string()),
            model,
            workspace_root: Some(project_path.to_string()),
            task_id: None,
            git_repo_url: None,
            git_branch: None,
        })
        .await
        .map_err(|e| ProcessError::Execution(format!("Planning automaton failed to start: {e}")))?;

    let event_tx = automaton_client
        .connect_event_stream(
            &start_result.automaton_id,
            Some(&start_result.event_stream_url),
        )
        .await
        .map_err(|e| ProcessError::Execution(format!("Planning event stream failed: {e}")))?;

    let mut rx = event_tx.subscribe();
    let mut output_text = String::new();
    let deadline = Duration::from_secs(120);

    let collect = async {
        loop {
            match rx.recv().await {
                Ok(evt) => {
                    let evt_type = evt.get("type").and_then(|t| t.as_str()).unwrap_or("");
                    match evt_type {
                        "text_delta" => {
                            if let Some(text) = evt.get("text").and_then(|t| t.as_str()) {
                                output_text.push_str(text);
                            }
                        }
                        "task_completed" | "done" | "task_failed" | "error" => break,
                        _ => {}
                    }
                }
                Err(broadcast::error::RecvError::Closed) => break,
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
            }
        }
    };

    if tokio::time::timeout(deadline, collect).await.is_err() {
        warn!(node_id = %node.node_id, "Planning automaton timed out; using single-task fallback");
        return Ok(vec![SubTaskPlan {
            title: node.label.clone(),
            description: node.prompt.clone(),
        }]);
    }

    let trimmed = output_text.trim();
    let json_start = trimmed.find('[');
    let json_end = trimmed.rfind(']');

    if let (Some(start), Some(end)) = (json_start, json_end) {
        if end > start {
            let json_str = &trimmed[start..=end];
            if let Ok(plans) = serde_json::from_str::<Vec<SubTaskPlan>>(json_str) {
                if !plans.is_empty() {
                    info!(node_id = %node.node_id, sub_tasks = plans.len(), "Planning produced sub-tasks");
                    return Ok(plans);
                }
            }
        }
    }

    warn!(node_id = %node.node_id, "Planning output not valid JSON; using single-task fallback");
    Ok(vec![SubTaskPlan {
        title: node.label.clone(),
        description: node.prompt.clone(),
    }])
}

#[allow(clippy::too_many_arguments)]
async fn execute_action_via_automaton(
    node: &ProcessNode,
    task_id: &str,
    project_id: &ProjectId,
    process_id: &ProcessId,
    run_id: &ProcessRunId,
    automaton_client: &AutomatonClient,
    store: &ProcessStore,
    storage_client: &StorageClient,
    spec_id: &str,
    forwarder: Option<&DeltaForwarder<'_>>,
    project_path: &str,
    timeout_secs: u64,
    token: Option<&str>,
    task_service: &TaskService,
    agent_service: &AgentService,
    org_service: &OrgService,
    upstream_context: &str,
) -> Result<NodeResult, ProcessError> {
    if node.node_type == ProcessNodeType::Condition {
        return execute_single_automaton(
            node, task_id, project_id, process_id, run_id,
            automaton_client, store, forwarder, project_path,
            timeout_secs, token, task_service, agent_service, org_service,
        ).await;
    }

    let sub_tasks = plan_sub_tasks(
        node, upstream_context, automaton_client, project_id,
        project_path, token, agent_service, org_service,
    ).await?;

    if sub_tasks.len() <= 1 {
        return execute_single_automaton(
            node, task_id, project_id, process_id, run_id,
            automaton_client, store, forwarder, project_path,
            timeout_secs, token, task_service, agent_service, org_service,
        ).await;
    }

    info!(
        node_id = %node.node_id,
        sub_task_count = sub_tasks.len(),
        "Executing node with parallel sub-tasks"
    );

    let max_concurrency = node
        .config
        .get("max_concurrency")
        .and_then(|v| v.as_u64())
        .unwrap_or(3) as usize;

    let jwt = token.ok_or_else(|| ProcessError::Execution("No JWT for sub-task creation".into()))?;
    let pid = project_id.to_string();

    let semaphore = Arc::new(tokio::sync::Semaphore::new(max_concurrency));
    let mut handles = Vec::with_capacity(sub_tasks.len());

    for (idx, sub_task) in sub_tasks.iter().enumerate() {
        let created_task = storage_client
            .create_task(
                &pid,
                jwt,
                &aura_os_storage::CreateTaskRequest {
                    spec_id: spec_id.to_string(),
                    title: sub_task.title.clone(),
                    org_id: None,
                    description: Some(sub_task.description.clone()),
                    status: Some("ready".to_string()),
                    order_index: Some((idx + 100) as i32),
                    dependency_ids: None,
                    assigned_project_agent_id: None,
                },
            )
            .await
            .map_err(|e| ProcessError::Execution(format!("Failed to create sub-task: {e}")))?;

        info!(
            node_id = %node.node_id,
            sub_task_idx = idx,
            sub_task_id = %created_task.id,
            title = %sub_task.title,
            "Created sub-task"
        );

        let sem = semaphore.clone();
        let ac = automaton_client.clone();
        let sub_task_id = created_task.id.clone();
        let sub_project_id = *project_id;
        let _sub_process_id = *process_id;
        let _sub_run_id = *run_id;
        let sub_project_path = project_path.to_string();
        let sub_token = token.map(|s| s.to_string());
        let sub_timeout = timeout_secs;
        let sub_node_id = node.node_id;
        let model = {
            let loaded_agent = node.agent_id.as_ref().and_then(|aid| {
                agent_service.get_agent_local(aid).ok()
            });
            let ri = loaded_agent.as_ref().and_then(|a| resolve_agent_integration(a, org_service));
            effective_model(node, loaded_agent.as_ref(), ri.as_ref())
        };

        handles.push(tokio::spawn(async move {
            let _permit = sem.acquire().await.map_err(|e| {
                ProcessError::Execution(format!("Semaphore error: {e}"))
            })?;

            let start_result = ac
                .start(AutomatonStartParams {
                    project_id: sub_project_id.to_string(),
                    auth_token: sub_token.clone(),
                    model,
                    workspace_root: Some(sub_project_path.clone()),
                    task_id: Some(sub_task_id.clone()),
                    git_repo_url: None,
                    git_branch: None,
                })
                .await
                .map_err(|e| ProcessError::Execution(format!("Sub-task automaton failed: {e}")))?;

            let event_tx = ac
                .connect_event_stream(
                    &start_result.automaton_id,
                    Some(&start_result.event_stream_url),
                )
                .await
                .map_err(|e| ProcessError::Execution(format!("Sub-task event stream failed: {e}")))?;

            let mut rx = event_tx.subscribe();
            let mut output = String::new();
            let mut input_tokens: u64 = 0;
            let mut output_tokens: u64 = 0;
            let mut model_name: Option<String> = None;
            let mut failed = false;
            let mut err_msg: Option<String> = None;
            let deadline = Duration::from_secs(sub_timeout);

            let collect = async {
                loop {
                    match rx.recv().await {
                        Ok(evt) => {
                            let evt_type = evt.get("type").and_then(|t| t.as_str()).unwrap_or("");
                            match evt_type {
                                "text_delta" => {
                                    if let Some(text) = evt.get("text").and_then(|t| t.as_str()) {
                                        output.push_str(text);
                                    }
                                }
                                "usage" | "session_usage" => {
                                    if let Some(inp) = evt.get("input_tokens").and_then(|v| v.as_u64()) {
                                        input_tokens = inp;
                                    }
                                    if let Some(out) = evt.get("output_tokens").and_then(|v| v.as_u64()) {
                                        output_tokens = out;
                                    }
                                    if let Some(m) = evt.get("model").and_then(|v| v.as_str()) {
                                        model_name = Some(m.to_string());
                                    }
                                }
                                "task_completed" | "done" => break,
                                "task_failed" | "error" => {
                                    failed = true;
                                    err_msg = evt.get("message")
                                        .or_else(|| evt.get("error"))
                                        .and_then(|v| v.as_str())
                                        .map(|s| s.to_string());
                                    break;
                                }
                                _ => {}
                            }
                        }
                        Err(broadcast::error::RecvError::Closed) => break,
                        Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    }
                }
            };

            if tokio::time::timeout(deadline, collect).await.is_err() {
                return Err(ProcessError::Execution(format!(
                    "Sub-task timed out after {sub_timeout}s for node {sub_node_id}"
                )));
            }

            if failed {
                return Err(ProcessError::Execution(
                    err_msg.unwrap_or_else(|| "Sub-task failed".to_string()),
                ));
            }

            let output_file_path = Path::new(&sub_project_path).join(format!("output-{}.txt", sub_task_id));
            let file_content = match tokio::fs::read_to_string(&output_file_path).await {
                Ok(content) if !content.trim().is_empty() => Some(content),
                _ => None,
            };

            let final_output = file_content.unwrap_or(output);

            Ok((final_output, input_tokens, output_tokens, model_name))
        }));
    }

    let mut merged_parts: Vec<String> = Vec::with_capacity(handles.len());
    let mut total_input_tokens: u64 = 0;
    let mut total_output_tokens: u64 = 0;
    let mut last_model: Option<String> = None;
    let mut failures: Vec<String> = Vec::new();

    for (idx, handle) in handles.into_iter().enumerate() {
        match handle.await {
            Ok(Ok((output, inp, out, model))) => {
                total_input_tokens += inp;
                total_output_tokens += out;
                if model.is_some() {
                    last_model = model;
                }
                merged_parts.push(output);
            }
            Ok(Err(e)) => {
                failures.push(format!("Sub-task #{} failed: {}", idx, e));
                merged_parts.push(format!("(sub-task #{} failed: {})", idx, e));
            }
            Err(e) => {
                failures.push(format!("Sub-task #{} panicked: {}", idx, e));
                merged_parts.push(format!("(sub-task #{} panicked: {})", idx, e));
            }
        }
    }

    if !failures.is_empty() {
        warn!(
            node_id = %node.node_id,
            failure_count = failures.len(),
            total = sub_tasks.len(),
            "Some sub-tasks failed"
        );
    }

    let merged_output = merged_parts.join("\n\n---\n\n");

    let output_file = node
        .config
        .get("output_file")
        .and_then(|v| v.as_str())
        .unwrap_or("output.txt");
    let output_file_path = Path::new(project_path).join(output_file);
    if let Err(e) = tokio::fs::write(&output_file_path, merged_output.as_bytes()).await {
        warn!(node_id = %node.node_id, error = %e, "Failed to write merged output");
    }

    let rel_path = format!("process-workspaces/{}/{}/{}", process_id, run_id, output_file);
    let artifact = ProcessArtifact {
        artifact_id: ProcessArtifactId::new(),
        process_id: *process_id,
        run_id: *run_id,
        node_id: node.node_id,
        artifact_type: ArtifactType::Document,
        name: output_file.to_string(),
        file_path: rel_path,
        size_bytes: merged_output.len() as u64,
        metadata: serde_json::json!({}),
        created_at: Utc::now(),
    };
    if let Err(e) = store.save_artifact(&artifact) {
        warn!(node_id = %node.node_id, error = %e, "Failed to save merged artifact");
    }

    let display = format!(
        "Executed {} sub-tasks in parallel ({} failures), {} total bytes",
        sub_tasks.len(), failures.len(), merged_output.len()
    );

    let token_usage = if total_input_tokens > 0 || total_output_tokens > 0 {
        Some(NodeTokenUsage {
            input_tokens: total_input_tokens,
            output_tokens: total_output_tokens,
            model: last_model,
        })
    } else {
        None
    };

    Ok(NodeResult {
        downstream_output: merged_output,
        display_output: Some(display),
        token_usage,
        content_blocks: None,
    })
}

#[allow(clippy::too_many_arguments)]
async fn execute_single_automaton(
    node: &ProcessNode,
    task_id: &str,
    project_id: &ProjectId,
    process_id: &ProcessId,
    run_id: &ProcessRunId,
    automaton_client: &AutomatonClient,
    store: &ProcessStore,
    forwarder: Option<&DeltaForwarder<'_>>,
    project_path: &str,
    timeout_secs: u64,
    token: Option<&str>,
    _task_service: &TaskService,
    agent_service: &AgentService,
    org_service: &OrgService,
) -> Result<NodeResult, ProcessError> {
    let model = {
        let loaded_agent = node.agent_id.as_ref().and_then(|aid| {
            agent_service.get_agent_local(aid).ok()
        });
        let ri = loaded_agent.as_ref().and_then(|a| resolve_agent_integration(a, org_service));
        effective_model(node, loaded_agent.as_ref(), ri.as_ref())
    };

    let start_result = automaton_client
        .start(AutomatonStartParams {
            project_id: project_id.to_string(),
            auth_token: token.map(|s| s.to_string()),
            model,
            workspace_root: Some(project_path.to_string()),
            task_id: Some(task_id.to_string()),
            git_repo_url: None,
            git_branch: None,
        })
        .await
        .map_err(|e| ProcessError::Execution(format!("Failed to start automaton: {e}")))?;

    info!(
        automaton_id = %start_result.automaton_id,
        task_id = %task_id,
        node_id = %node.node_id,
        "Automaton started for process node"
    );

    let event_tx = automaton_client
        .connect_event_stream(
            &start_result.automaton_id,
            Some(&start_result.event_stream_url),
        )
        .await
        .map_err(|e| ProcessError::Execution(format!("Failed to connect automaton event stream: {e}")))?;

    let mut rx = event_tx.subscribe();
    let mut output_text = String::new();
    let mut total_input_tokens: u64 = 0;
    let mut total_output_tokens: u64 = 0;
    let mut last_model: Option<String> = None;
    let mut content_blocks: Vec<serde_json::Value> = Vec::new();
    let mut automaton_failed = false;
    let mut error_message: Option<String> = None;
    let deadline = Duration::from_secs(timeout_secs);

    let collect = async {
        loop {
            match rx.recv().await {
                Ok(evt) => {
                    let evt_type = evt.get("type").and_then(|t| t.as_str()).unwrap_or("");
                    match evt_type {
                        "text_delta" => {
                            if let Some(text) = evt.get("text").and_then(|t| t.as_str()) {
                                output_text.push_str(text);
                                if let Some(fwd) = forwarder {
                                    fwd.forward_text(text);
                                }
                            }
                        }
                        "thinking_delta" => {
                            if let Some(thinking) = evt.get("thinking").and_then(|t| t.as_str()) {
                                if let Some(fwd) = forwarder {
                                    fwd.forward_thinking(thinking);
                                }
                            }
                        }
                        "tool_use_start" => {
                            let id = evt.get("id").and_then(|v| v.as_str()).unwrap_or("");
                            let name = evt.get("name").and_then(|v| v.as_str()).unwrap_or("");
                            content_blocks.push(serde_json::json!({
                                "type": "tool_use", "id": id, "name": name,
                            }));
                            if let Some(fwd) = forwarder {
                                fwd.forward_tool_start(id, name);
                            }
                        }
                        "tool_result" => {
                            let name = evt.get("name").and_then(|v| v.as_str()).unwrap_or("");
                            let result = evt.get("result").and_then(|v| v.as_str()).unwrap_or("");
                            let is_error = evt.get("is_error").and_then(|v| v.as_bool()).unwrap_or(false);
                            content_blocks.push(serde_json::json!({
                                "type": "tool_result", "name": name, "result": result, "is_error": is_error,
                            }));
                            if let Some(fwd) = forwarder {
                                fwd.forward_tool_result(name, result, is_error);
                            }
                        }
                        "usage" | "session_usage" => {
                            if let Some(inp) = evt.get("input_tokens").and_then(|v| v.as_u64()) {
                                total_input_tokens = inp;
                            }
                            if let Some(out) = evt.get("output_tokens").and_then(|v| v.as_u64()) {
                                total_output_tokens = out;
                            }
                            if let Some(m) = evt.get("model").and_then(|v| v.as_str()) {
                                last_model = Some(m.to_string());
                            }
                        }
                        "task_completed" | "done" => {
                            break;
                        }
                        "task_failed" | "error" => {
                            automaton_failed = true;
                            error_message = evt.get("message")
                                .or_else(|| evt.get("error"))
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string());
                            break;
                        }
                        _ => {}
                    }
                }
                Err(broadcast::error::RecvError::Closed) => break,
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    warn!(skipped = n, "Automaton event receiver lagged");
                    continue;
                }
            }
        }
    };

    match tokio::time::timeout(deadline, collect).await {
        Ok(()) => {}
        Err(_) => {
            return Err(ProcessError::Execution(format!(
                "Automaton timed out after {timeout_secs}s for node {}", node.node_id
            )));
        }
    }

    if automaton_failed {
        let msg = error_message.unwrap_or_else(|| "Automaton execution failed".to_string());
        return Err(ProcessError::Execution(msg));
    }

    // Read output file if applicable
    let output_file = node
        .config
        .get("output_file")
        .and_then(|v| v.as_str())
        .unwrap_or("output.txt");
    let output_file_path = Path::new(project_path).join(output_file);
    let file_content = match tokio::fs::read_to_string(&output_file_path).await {
        Ok(content) if !content.trim().is_empty() => Some(content),
        _ => None,
    };

    let downstream = file_content.unwrap_or(output_text);
    if downstream.trim().is_empty() {
        return Err(ProcessError::Execution(format!(
            "Automaton produced no output for node {}", node.node_id
        )));
    }

    // Persist artifact
    let rel_path = format!("process-workspaces/{}/{}/{}", process_id, run_id, output_file);
    let artifact = ProcessArtifact {
        artifact_id: ProcessArtifactId::new(),
        process_id: *process_id,
        run_id: *run_id,
        node_id: node.node_id,
        artifact_type: ArtifactType::Document,
        name: output_file.to_string(),
        file_path: rel_path,
        size_bytes: downstream.len() as u64,
        metadata: serde_json::json!({}),
        created_at: Utc::now(),
    };
    if let Err(e) = store.save_artifact(&artifact) {
        warn!(node_id = %node.node_id, error = %e, "Failed to save automaton artifact");
    }

    let token_usage = if total_input_tokens > 0 || total_output_tokens > 0 {
        Some(NodeTokenUsage {
            input_tokens: total_input_tokens,
            output_tokens: total_output_tokens,
            model: last_model,
        })
    } else {
        None
    };

    Ok(NodeResult {
        downstream_output: downstream,
        display_output: None,
        token_usage,
        content_blocks: if content_blocks.is_empty() { None } else { Some(content_blocks) },
    })
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

async fn execute_subprocess(
    node: &ProcessNode,
    upstream_context: &str,
    executor: &ProcessExecutor,
    parent_run_id: &ProcessRunId,
) -> Result<NodeResult, ProcessError> {
    let child_process_id_str = node
        .config
        .get("child_process_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ProcessError::Execution(
            "SubProcess node missing 'child_process_id' in config".into(),
        ))?;

    let child_process_id: ProcessId = child_process_id_str
        .parse()
        .map_err(|_| ProcessError::Execution(format!(
            "Invalid child_process_id: {child_process_id_str}"
        )))?;

    let timeout_secs = node
        .config
        .get("timeout_seconds")
        .and_then(|v| v.as_u64())
        .unwrap_or(1200);

    info!(
        node_id = %node.node_id,
        child_process_id = %child_process_id,
        "SubProcess: triggering child process"
    );

    let input = if upstream_context.is_empty() {
        node.prompt.clone()
    } else if node.prompt.is_empty() {
        upstream_context.to_string()
    } else {
        format!("{}\n\n---\n\n{}", upstream_context, node.prompt)
    };

    let child_run = tokio::time::timeout(
        Duration::from_secs(timeout_secs),
        executor.trigger_and_await(
            &child_process_id,
            ProcessRunTrigger::Manual,
            Some(input),
            Some(*parent_run_id),
        ),
    )
    .await
    .map_err(|_| ProcessError::Execution(format!(
        "SubProcess timed out after {timeout_secs}s waiting for child process {child_process_id}"
    )))?
    ?;

    let output = child_run.output.unwrap_or_default();
    let display = format!(
        "SubProcess completed (child run {}): {} bytes output",
        child_run.run_id, output.len()
    );

    let mut token_usage = None;
    if let (Some(inp), Some(out)) = (child_run.total_input_tokens, child_run.total_output_tokens) {
        token_usage = Some(NodeTokenUsage {
            input_tokens: inp,
            output_tokens: out,
            model: None,
        });
    }

    Ok(NodeResult {
        downstream_output: output,
        display_output: Some(display),
        token_usage,
        content_blocks: None,
    })
}

async fn execute_foreach(
    node: &ProcessNode,
    upstream_context: &str,
    executor: &ProcessExecutor,
    parent_run_id: &ProcessRunId,
) -> Result<NodeResult, ProcessError> {
    let child_process_id_str = node
        .config
        .get("child_process_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ProcessError::Execution(
            "ForEach node missing 'child_process_id' in config".into(),
        ))?;

    let child_process_id: ProcessId = child_process_id_str
        .parse()
        .map_err(|_| ProcessError::Execution(format!(
            "Invalid child_process_id: {child_process_id_str}"
        )))?;

    let max_concurrency = node
        .config
        .get("max_concurrency")
        .and_then(|v| v.as_u64())
        .unwrap_or(3) as usize;

    let timeout_secs = node
        .config
        .get("timeout_seconds")
        .and_then(|v| v.as_u64())
        .unwrap_or(1800);

    let iterator_mode = node
        .config
        .get("iterator_mode")
        .and_then(|v| v.as_str())
        .unwrap_or("json_array");

    let item_variable = node
        .config
        .get("item_variable_name")
        .and_then(|v| v.as_str())
        .unwrap_or("item");

    let items: Vec<String> = match iterator_mode {
        "json_array" => {
            let parsed: Vec<serde_json::Value> = serde_json::from_str(upstream_context.trim())
                .map_err(|e| ProcessError::Execution(format!(
                    "ForEach: failed to parse upstream as JSON array: {e}"
                )))?;
            parsed.iter().map(|v| {
                if let Some(s) = v.as_str() { s.to_string() }
                else { serde_json::to_string(v).unwrap_or_default() }
            }).collect()
        }
        "line_delimited" => {
            upstream_context
                .lines()
                .map(|l| l.trim())
                .filter(|l| !l.is_empty())
                .map(|l| l.to_string())
                .collect()
        }
        _ => {
            let sep = node.config.get("separator")
                .and_then(|v| v.as_str())
                .unwrap_or("\n");
            upstream_context
                .split(sep)
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        }
    };

    if items.is_empty() {
        return Ok(NodeResult {
            downstream_output: "[]".to_string(),
            display_output: Some("ForEach: no items to iterate".to_string()),
            token_usage: None,
            content_blocks: None,
        });
    }

    info!(
        node_id = %node.node_id,
        child_process_id = %child_process_id,
        items = items.len(),
        max_concurrency,
        "ForEach: starting iteration"
    );

    let semaphore = Arc::new(tokio::sync::Semaphore::new(max_concurrency));
    let executor = executor.clone();
    let parent_run_id = *parent_run_id;
    let prompt_template = node.prompt.clone();

    let mut handles = Vec::with_capacity(items.len());

    for (idx, item) in items.iter().enumerate() {
        let sem = semaphore.clone();
        let exec = executor.clone();
        let cpid = child_process_id;
        let prid = parent_run_id;
        let item = item.clone();
        let prompt = prompt_template.clone();
        let item_var = item_variable.to_string();

        handles.push(tokio::spawn(async move {
            let _permit = sem.acquire().await.map_err(|e| {
                ProcessError::Execution(format!("ForEach semaphore error: {e}"))
            })?;

            let input = if prompt.is_empty() {
                format!("## {item_var} (#{idx})\n\n{item}")
            } else {
                format!("## {item_var} (#{idx})\n\n{item}\n\n## Task\n\n{prompt}")
            };

            exec.trigger_and_await(
                &cpid,
                ProcessRunTrigger::Manual,
                Some(input),
                Some(prid),
            ).await
        }));
    }

    let timeout_result = tokio::time::timeout(
        Duration::from_secs(timeout_secs),
        async {
            let mut results = Vec::with_capacity(handles.len());
            for handle in handles {
                results.push(handle.await.map_err(|e| {
                    ProcessError::Execution(format!("ForEach task join error: {e}"))
                })?);
            }
            Ok::<Vec<Result<ProcessRun, ProcessError>>, ProcessError>(results)
        }
    ).await;

    let child_results = match timeout_result {
        Ok(Ok(results)) => results,
        Ok(Err(e)) => return Err(e),
        Err(_) => return Err(ProcessError::Execution(format!(
            "ForEach timed out after {timeout_secs}s"
        ))),
    };

    let mut outputs = Vec::new();
    let mut total_input = 0u64;
    let mut total_output = 0u64;
    let mut failures = 0;

    for (idx, result) in child_results.into_iter().enumerate() {
        match result {
            Ok(run) => {
                total_input += run.total_input_tokens.unwrap_or(0);
                total_output += run.total_output_tokens.unwrap_or(0);
                outputs.push(run.output.unwrap_or_else(|| format!("(no output for item #{})", idx)));
            }
            Err(e) => {
                failures += 1;
                outputs.push(format!("(error for item #{}: {})", idx, e));
            }
        }
    }

    let collect_mode = node
        .config
        .get("collect_mode")
        .and_then(|v| v.as_str())
        .unwrap_or("json_array");

    let downstream = match collect_mode {
        "json_array" => {
            let arr: Vec<serde_json::Value> = outputs.iter()
                .map(|s| serde_json::Value::String(s.clone()))
                .collect();
            serde_json::to_string_pretty(&arr).unwrap_or_else(|_| outputs.join("\n\n---\n\n"))
        }
        _ => outputs.join("\n\n---\n\n"),
    };

    let display = format!(
        "ForEach completed: {} items, {} failures, {} input tokens, {} output tokens",
        items.len(), failures, total_input, total_output
    );

    let token_usage = if total_input > 0 || total_output > 0 {
        Some(NodeTokenUsage {
            input_tokens: total_input,
            output_tokens: total_output,
            model: None,
        })
    } else {
        None
    };

    Ok(NodeResult {
        downstream_output: downstream,
        display_output: Some(display),
        token_usage,
        content_blocks: None,
    })
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn parse_condition_result(output: &str) -> bool {
    let normalized = output.trim().to_lowercase();
    normalized == "true"
}

async fn resolve_artifact_ref(
    aref: &serde_json::Value,
    store: &ProcessStore,
    data_dir: &Path,
) -> Option<String> {
    let source_process_id: ProcessId = aref
        .get("source_process_id")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse().ok())?;

    let artifact_name = aref.get("artifact_name").and_then(|v| v.as_str());
    let use_latest = aref
        .get("use_latest")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    if !use_latest {
        return None;
    }

    let artifacts = store
        .list_artifacts_for_process(&source_process_id)
        .ok()?;

    let matched = if let Some(name) = artifact_name {
        artifacts.into_iter().filter(|a| a.name == name).last()
    } else {
        artifacts.into_iter().last()
    };

    let artifact = matched?;
    let file_path = data_dir.join(&artifact.file_path);
    tokio::fs::read_to_string(&file_path).await.ok()
}

/// If the run is still active (Pending/Running), mark it as Failed with the
/// given error and broadcast `process_run_failed`. This is a safety net for
/// early errors in `execute_run` that exit before the per-node error handler.
fn mark_run_failed_if_active(
    store: &ProcessStore,
    broadcast: &broadcast::Sender<serde_json::Value>,
    run: &ProcessRun,
    error: &str,
) {
    let current = store.list_runs(&run.process_id).ok().and_then(|runs| {
        runs.into_iter().find(|r| r.run_id == run.run_id)
    });
    let dominated = current.as_ref().map_or(true, |r| {
        matches!(r.status, ProcessRunStatus::Pending | ProcessRunStatus::Running)
    });
    if !dominated {
        return;
    }

    let mut failed_run = current.unwrap_or_else(|| run.clone());
    failed_run.status = ProcessRunStatus::Failed;
    failed_run.error = Some(error.to_string());
    failed_run.completed_at = Some(Utc::now());
    let _ = store.save_run(&failed_run);

    let _ = broadcast.send(serde_json::json!({
        "type": "process_run_failed",
        "process_id": run.process_id.to_string(),
        "run_id": run.run_id.to_string(),
        "error": error,
    }));
}

/// Create a new "running" event and persist + broadcast it. Returns the event
/// so callers can later complete it via `complete_event`.
fn start_event(
    store: &ProcessStore,
    broadcast: &broadcast::Sender<serde_json::Value>,
    run: &ProcessRun,
    node: &ProcessNode,
    input: &str,
    started_at: DateTime<Utc>,
) -> Option<ProcessEvent> {
    let event = ProcessEvent {
        event_id: ProcessEventId::new(),
        run_id: run.run_id,
        node_id: node.node_id,
        process_id: run.process_id,
        status: ProcessEventStatus::Running,
        input_snapshot: input.to_string(),
        output: String::new(),
        started_at,
        completed_at: None,
        input_tokens: None,
        output_tokens: None,
        model: None,
        content_blocks: None,
    };

    if let Err(e) = store.save_event(&event) {
        warn!(event_id = %event.event_id, error = %e, "Failed to save process event");
        return None;
    }

    broadcast_node_status(broadcast, run, node, ProcessEventStatus::Running, None);
    Some(event)
}

/// Update an existing event to a terminal status (completed / failed / skipped)
/// and persist + broadcast the change.
fn complete_event(
    store: &ProcessStore,
    broadcast: &broadcast::Sender<serde_json::Value>,
    run: &ProcessRun,
    node: &ProcessNode,
    event: &mut ProcessEvent,
    status: ProcessEventStatus,
    output: &str,
    completed_at: DateTime<Utc>,
    token_usage: Option<&NodeTokenUsage>,
    content_blocks: Option<&[serde_json::Value]>,
) {
    event.status = status;
    event.output = output.to_string();
    event.completed_at = Some(completed_at);
    event.input_tokens = token_usage.map(|u| u.input_tokens);
    event.output_tokens = token_usage.map(|u| u.output_tokens);
    event.model = token_usage.and_then(|u| u.model.clone());
    event.content_blocks = content_blocks.map(|b| b.to_vec());

    if let Err(e) = store.update_event(event) {
        warn!(event_id = %event.event_id, error = %e, "Failed to update process event");
    }

    broadcast_node_status(broadcast, run, node, status, token_usage);
}

/// Shortcut for events that need no running phase (skipped nodes, pinned output).
fn record_terminal_event(
    store: &ProcessStore,
    broadcast: &broadcast::Sender<serde_json::Value>,
    run: &ProcessRun,
    node: &ProcessNode,
    status: ProcessEventStatus,
    input: &str,
    output: &str,
    started_at: DateTime<Utc>,
    completed_at: DateTime<Utc>,
) {
    let event = ProcessEvent {
        event_id: ProcessEventId::new(),
        run_id: run.run_id,
        node_id: node.node_id,
        process_id: run.process_id,
        status,
        input_snapshot: input.to_string(),
        output: output.to_string(),
        started_at,
        completed_at: Some(completed_at),
        input_tokens: None,
        output_tokens: None,
        model: None,
        content_blocks: None,
    };

    if let Err(e) = store.save_event(&event) {
        warn!(event_id = %event.event_id, error = %e, "Failed to save process event");
    }

    broadcast_node_status(broadcast, run, node, status, None);
}

fn broadcast_node_status(
    broadcast: &broadcast::Sender<serde_json::Value>,
    run: &ProcessRun,
    node: &ProcessNode,
    status: ProcessEventStatus,
    token_usage: Option<&NodeTokenUsage>,
) {
    let mut payload = serde_json::json!({
        "type": "process_node_executed",
        "process_id": run.process_id.to_string(),
        "run_id": run.run_id.to_string(),
        "node_id": node.node_id.to_string(),
        "node_type": format!("{:?}", node.node_type),
        "status": format!("{:?}", status),
    });
    if let Some(usage) = token_usage {
        payload["input_tokens"] = serde_json::json!(usage.input_tokens);
        payload["output_tokens"] = serde_json::json!(usage.output_tokens);
        if let Some(ref model) = usage.model {
            payload["model"] = serde_json::json!(model);
        }
    }
    let _ = broadcast.send(payload);
}
