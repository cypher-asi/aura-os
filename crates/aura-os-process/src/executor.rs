use std::collections::{HashMap, HashSet, VecDeque};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use chrono::{DateTime, Utc};
use tokio::sync::broadcast;
use tracing::{info, warn};

use aura_os_agents::AgentService;
use aura_os_core::{
    Agent, ArtifactType, ProcessArtifact, ProcessArtifactId, ProcessEvent, ProcessEventId,
    ProcessEventStatus, ProcessNode, ProcessNodeId, ProcessNodeType, ProcessRun, ProcessRunId,
    ProcessRunStatus, ProcessRunTranscriptEvent, ProcessRunTrigger, ProcessId, ProjectId,
    TaskStatus,
};
use aura_os_link::{
    AutomatonClient, AutomatonStartParams, RunCompletion, start_and_connect,
    collect_automaton_events,
};
use aura_os_orgs::OrgService;
use aura_os_storage::StorageClient;
use aura_os_store::RocksStore;
use aura_os_tasks::TaskService;

use crate::error::ProcessError;
use crate::process_store::ProcessStore;

const DEFAULT_HARNESS_TIMEOUT_SECS: u64 = 600; // 10 minutes

/// Scan a workspace directory for output files written by the automaton.
///
/// Called as a fallback when the expected output file (e.g. `output.txt`) is
/// missing. Since process workspaces are fresh directories, every file present
/// was written by the automaton.
///
/// When multiple non-hidden files exist (e.g. `part1`, `part2`, ...) they are
/// concatenated in sorted order -- this covers the common case where the model
/// splits a large deliverable across numbered segment files.  When only a
/// single file exists it is returned directly.
async fn find_workspace_output(workspace: &Path) -> Option<String> {
    let mut files: Vec<PathBuf> = Vec::new();
    let mut entries = tokio::fs::read_dir(workspace).await.ok()?;
    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str.starts_with('.') || name_str == "node_modules" {
            continue;
        }
        if let Ok(meta) = entry.metadata().await {
            if meta.is_file() && meta.len() > 0 {
                files.push(entry.path());
            }
        }
    }
    if files.is_empty() {
        return None;
    }
    files.sort();

    if files.len() == 1 {
        return tokio::fs::read_to_string(&files[0])
            .await
            .ok()
            .filter(|s| !s.trim().is_empty());
    }

    let mut combined = String::new();
    for path in &files {
        if let Ok(content) = tokio::fs::read_to_string(path).await {
            if !content.trim().is_empty() {
                if !combined.is_empty() {
                    combined.push('\n');
                }
                combined.push_str(&content);
            }
        }
    }
    if combined.trim().is_empty() { None } else { Some(combined) }
}

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

// ---------------------------------------------------------------------------
// Model-aware cost estimation (ported from dev_loop handler)
// ---------------------------------------------------------------------------

fn default_fee_schedule() -> [(&'static str, f64, f64); 3] {
    [
        ("claude-opus-4-6", 5.0, 25.0),
        ("claude-sonnet-4-5", 3.0, 15.0),
        ("claude-haiku-4-5", 0.80, 4.00),
    ]
}

fn lookup_model_rates(model: &str) -> (f64, f64) {
    let normalized = model.trim().to_ascii_lowercase();
    for (candidate, input, output) in default_fee_schedule() {
        if normalized == candidate || normalized.starts_with(candidate) || candidate.starts_with(&normalized) {
            return (input, output);
        }
    }
    (3.0, 15.0)
}

fn estimate_cost_usd(model: Option<&str>, input_tokens: u64, output_tokens: u64) -> f64 {
    let (input_rate, output_rate) = lookup_model_rates(model.unwrap_or("claude-sonnet-4-5"));
    input_tokens as f64 * input_rate / 1_000_000.0
        + output_tokens as f64 * output_rate / 1_000_000.0
}

fn merge_usage_totals(
    usage: &serde_json::Value,
    prev_input: u64,
    prev_output: u64,
) -> (u64, u64, Option<String>) {
    let next_input = usage
        .get("cumulative_input_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or_else(|| {
            prev_input + usage.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0)
        });
    let next_output = usage
        .get("cumulative_output_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or_else(|| {
            prev_output + usage.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0)
        });
    let model = usage
        .get("model")
        .and_then(|v| v.as_str())
        .map(ToString::to_string);

    (next_input, next_output, model)
}

#[derive(Debug, Clone, serde::Deserialize)]
struct SubTaskPlan {
    title: String,
    description: String,
}

/// Forward a raw automaton event to the app broadcast, stamping it with
/// process-specific identifiers.  Only forwards streamable event types.
fn emit_process_event(
    store: &ProcessStore,
    tx: &broadcast::Sender<serde_json::Value>,
    payload: serde_json::Value,
) {
    if let (Some(process_id), Some(run_id), Some(event_type)) = (
        payload.get("process_id").and_then(|v| v.as_str()),
        payload.get("run_id").and_then(|v| v.as_str()),
        payload.get("type").and_then(|v| v.as_str()),
    ) {
        if let (Ok(process_id), Ok(run_id)) = (process_id.parse(), run_id.parse()) {
            let transcript_event = ProcessRunTranscriptEvent {
                transcript_id: ProcessEventId::new().to_string(),
                process_id,
                run_id,
                event_type: event_type.to_string(),
                payload: payload.clone(),
                created_at: Utc::now(),
            };
            if let Err(e) = store.save_run_transcript_event(&transcript_event) {
                warn!(
                    process_id = %transcript_event.process_id,
                    run_id = %transcript_event.run_id,
                    error = %e,
                    "Failed to persist process run transcript event"
                );
            }
        }
    }
    let _ = tx.send(payload);
}

fn forward_process_event(
    store: &ProcessStore,
    tx: &broadcast::Sender<serde_json::Value>,
    project_id: &str,
    task_id: &str,
    process_id: &str,
    run_id: &str,
    node_id: &str,
    evt: &serde_json::Value,
    sub_task: Option<&str>,
) {
    let mut v = serde_json::json!({
        "project_id": project_id,
        "task_id": task_id,
        "process_id": process_id,
        "run_id": run_id,
        "node_id": node_id,
    });
    if let Some(obj) = evt.as_object() {
        if let Some(map) = v.as_object_mut() {
            for (k, val) in obj {
                map.insert(k.clone(), val.clone());
            }
        }
    }
    if let Some(sub) = sub_task {
        v["sub_task"] = sub.into();
    }
    if let Some(t) = v.get("type").and_then(|t| t.as_str()).map(|t| t.to_string()) {
        if t == "tool_call_started" {
            v["type"] = "tool_use_start".into();
        }
    }
    emit_process_event(store, tx, v);
}

/// Send a progress text message to the app broadcast with process context.
fn send_process_text(
    store: &ProcessStore,
    tx: &broadcast::Sender<serde_json::Value>,
    project_id: &str,
    task_id: &str,
    process_id: &str,
    run_id: &str,
    node_id: &str,
    text: &str,
) {
    emit_process_event(store, tx, serde_json::json!({
        "type": "text_delta",
        "text": text,
        "project_id": project_id,
        "task_id": task_id,
        "process_id": process_id,
        "run_id": run_id,
        "node_id": node_id,
    }));
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
    router_url: String,
    http_client: reqwest::Client,
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
        router_url: String,
        http_client: reqwest::Client,
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
            router_url,
            http_client,
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

        emit_process_event(&self.store, &self.event_broadcast, serde_json::json!({
            "type": "process_run_completed",
            "process_id": process_id.to_string(),
            "run_id": run_id.to_string(),
            "status": "cancelled",
            "total_input_tokens": run.total_input_tokens,
            "total_output_tokens": run.total_output_tokens,
            "cost_usd": run.cost_usd,
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

        emit_process_event(&self.store, &self.event_broadcast, serde_json::json!({
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

        emit_process_event(&self.store, &self.event_broadcast, serde_json::json!({
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
    // Group nodes are purely visual — strip them and any connection that
    // touches them so they have zero impact on execution topology.
    let group_ids: HashSet<ProcessNodeId> = nodes
        .iter()
        .filter(|n| n.node_type == ProcessNodeType::Group)
        .map(|n| n.node_id)
        .collect();

    let exec_nodes: Vec<_> = nodes.iter().filter(|n| !group_ids.contains(&n.node_id)).collect();
    let exec_node_ids: HashSet<ProcessNodeId> = exec_nodes.iter().map(|n| n.node_id).collect();

    let mut in_degree: HashMap<ProcessNodeId, usize> = HashMap::new();
    let mut adjacency: HashMap<ProcessNodeId, Vec<ProcessNodeId>> = HashMap::new();

    for node in &exec_nodes {
        in_degree.entry(node.node_id).or_insert(0);
        adjacency.entry(node.node_id).or_default();
    }

    for conn in connections {
        if !exec_node_ids.contains(&conn.source_node_id) || !exec_node_ids.contains(&conn.target_node_id) {
            continue;
        }
        *in_degree.entry(conn.target_node_id).or_insert(0) += 1;
        adjacency.entry(conn.source_node_id).or_default().push(conn.target_node_id);
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

    let expected = exec_nodes.len();
    if sorted.len() != expected {
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
    let group_ids: HashSet<ProcessNodeId> = nodes
        .iter()
        .filter(|n| n.node_type == ProcessNodeType::Group)
        .map(|n| n.node_id)
        .collect();

    let mut adjacency: HashMap<ProcessNodeId, Vec<ProcessNodeId>> = HashMap::new();
    for conn in connections {
        if group_ids.contains(&conn.source_node_id) || group_ids.contains(&conn.target_node_id) {
            continue;
        }
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
    // aggregate usage across the run
    let mut run_input_tokens: u64 = 0;
    let mut run_output_tokens: u64 = 0;
    let mut run_cost_usd: f64 = 0.0;

    for &node_id in &sorted {
        let node = *nodes_by_id
            .get(&node_id)
            .ok_or_else(|| ProcessError::NodeNotFound(node_id.to_string()))?;

        if node.node_type == ProcessNodeType::Group {
            continue;
        }

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

            emit_process_event(store, broadcast, serde_json::json!({
                "type": "process_run_progress",
                "process_id": run.process_id.to_string(),
                "run_id": run.run_id.to_string(),
                "total_input_tokens": run_input_tokens,
                "total_output_tokens": run_output_tokens,
                "cost_usd": run_cost_usd,
            }));
            continue;
        }

        // ── execute node ───────────────────────────────────────────────
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
                    Some(broadcast), &workspace_path,
                    timeout_secs, jwt.as_deref(), &executor.task_service,
                    agent_service, org_service, &upstream_context,
                    &executor.http_client, &executor.router_url,
                    run_input_tokens, run_output_tokens, run_cost_usd,
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
            ProcessNodeType::Group => unreachable!("Group nodes are filtered before execution"),
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
                    run_cost_usd += estimate_cost_usd(
                        usage.model.as_deref(),
                        usage.input_tokens,
                        usage.output_tokens,
                    );
                }

                current_run.total_input_tokens = Some(run_input_tokens);
                current_run.total_output_tokens = Some(run_output_tokens);
                current_run.cost_usd = Some(run_cost_usd);
                store.save_run(&current_run)?;

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

                emit_process_event(store, broadcast, serde_json::json!({
                    "type": "process_run_progress",
                    "process_id": run.process_id.to_string(),
                    "run_id": run.run_id.to_string(),
                    "total_input_tokens": run_input_tokens,
                    "total_output_tokens": run_output_tokens,
                    "cost_usd": run_cost_usd,
                }));

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
                current_run.cost_usd = Some(run_cost_usd);
                store.save_run(&current_run)?;

                emit_process_event(store, broadcast, serde_json::json!({
                    "type": "process_run_failed",
                    "process_id": run.process_id.to_string(),
                    "run_id": run.run_id.to_string(),
                    "error": current_run.error,
                    "total_input_tokens": run_input_tokens,
                    "total_output_tokens": run_output_tokens,
                    "cost_usd": run_cost_usd,
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
    current_run.cost_usd = Some(run_cost_usd);
    current_run.output = run_output;
    store.save_run(&current_run)?;

    emit_process_event(store, broadcast, serde_json::json!({
        "type": "process_run_completed",
        "process_id": run.process_id.to_string(),
        "run_id": run.run_id.to_string(),
        "total_input_tokens": run_input_tokens,
        "total_output_tokens": run_output_tokens,
        "cost_usd": run_cost_usd,
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

/// Split a node's work into sub-tasks by examining the upstream context.
/// Uses deterministic heuristics — no LLM call needed:
///   1. If upstream is a JSON array → one sub-task per element
///   2. If upstream has `---` delimited sections → one sub-task per section
///   3. If upstream has bullet/numbered lists → one sub-task per item
///   4. Otherwise → single task (no split)
fn plan_sub_tasks(
    node: &ProcessNode,
    upstream_context: &str,
) -> Vec<SubTaskPlan> {
    let trimmed = upstream_context.trim();
    if trimmed.is_empty() {
        return vec![SubTaskPlan {
            title: node.label.clone(),
            description: node.prompt.clone(),
        }];
    }

    // 1. JSON array upstream → one sub-task per element
    if trimmed.starts_with('[') {
        if let Ok(arr) = serde_json::from_str::<Vec<serde_json::Value>>(trimmed) {
            if arr.len() > 1 {
                return arr.iter().enumerate().map(|(i, v)| {
                    let item_str = if let Some(s) = v.as_str() {
                        s.to_string()
                    } else {
                        serde_json::to_string(v).unwrap_or_default()
                    };
                    let title = v.get("name").or_else(|| v.get("title"))
                        .and_then(|n| n.as_str())
                        .unwrap_or(&item_str);
                    let short_title = if title.len() > 60 { &title[..60] } else { title };
                    SubTaskPlan {
                        title: format!("#{}: {}", i + 1, short_title),
                        description: format!("{}\n\nItem:\n{}", node.prompt, item_str),
                    }
                }).collect();
            }
        }
    }

    // 2. Section-delimited upstream (---) → one sub-task per section
    let sections: Vec<&str> = trimmed.split("\n---\n")
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();
    if sections.len() > 1 {
        return sections.iter().enumerate().map(|(i, section)| {
            let first_line = section.lines().next().unwrap_or("Section");
            let title = first_line.trim_start_matches('#').trim();
            let short_title = if title.len() > 60 { &title[..60] } else { title };
            SubTaskPlan {
                title: format!("#{}: {}", i + 1, short_title),
                description: format!("{}\n\nSection:\n{}", node.prompt, section),
            }
        }).collect();
    }

    // 3. Bullet/numbered list upstream → one sub-task per item
    let list_items: Vec<&str> = trimmed.lines()
        .map(|l| l.trim())
        .filter(|l| {
            l.starts_with("- ") || l.starts_with("* ") ||
            l.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) && l.contains(". ")
        })
        .collect();
    if list_items.len() > 1 {
        return list_items.iter().enumerate().map(|(i, item)| {
            let cleaned = item.trim_start_matches(|c: char| c == '-' || c == '*' || c.is_ascii_digit() || c == '.' || c == ' ');
            let short_title = if cleaned.len() > 60 { &cleaned[..60] } else { cleaned };
            SubTaskPlan {
                title: format!("#{}: {}", i + 1, short_title),
                description: format!("{}\n\nItem: {}", node.prompt, cleaned),
            }
        }).collect();
    }

    // 4. Default: single task
    vec![SubTaskPlan {
        title: node.label.clone(),
        description: format!("{}\n\nContext:\n{}", node.prompt, upstream_context),
    }]
}

// ---------------------------------------------------------------------------
// LLM-based sub-task planning (direct router call)
// ---------------------------------------------------------------------------

const PLANNING_MODEL: &str = "claude-haiku-4-5";
const PLANNING_MAX_TOKENS: u32 = 4096;
const PLANNING_CONTEXT_CHAR_LIMIT: usize = 12_000;

const PLANNING_SYSTEM_PROMPT: &str = "\
You are a task planner for an AI process engine. Each sub-task you produce will be \
executed by a separate AI coding agent that has access to shell commands and file \
read/write tools in an empty workspace directory.\n\n\
Rules:\n\
- If the work is genuinely a single atomic task, return a single-element array.\n\
- Each sub-task description MUST contain concrete, operational steps — not just a topic.\n\
- Preserve any tool-specific references from the original prompt (CLI commands like `tvly`, \
API calls, specific tools). The executing agent needs to know WHAT to run.\n\
- Do NOT instruct agents to build software projects (no Cargo.toml, package.json, etc.). \
Agents should run commands and write output files directly.\n\
- Each sub-task writes its results to a file. Keep outputs as plain text or JSON.\n\
- Sub-tasks must be independent and parallelizable — don't reference other sub-tasks.\n\n\
Respond ONLY with a JSON array, no markdown fences:\n\
[{\"title\": \"short title\", \"description\": \"step-by-step instructions for this sub-task\"}]";

async fn plan_sub_tasks_via_llm(
    http: &reqwest::Client,
    router_url: &str,
    token: &str,
    node: &ProcessNode,
    upstream_context: &str,
) -> Result<Vec<SubTaskPlan>, String> {
    let mut context = upstream_context.to_string();
    if context.len() > PLANNING_CONTEXT_CHAR_LIMIT {
        context.truncate(PLANNING_CONTEXT_CHAR_LIMIT);
        context.push_str("\n[truncated]");
    }

    let user_message = format!(
        "Task: {}\n\nPrompt:\n{}\n\nUpstream context:\n{}",
        node.label, node.prompt, context,
    );

    let req_body = serde_json::json!({
        "model": PLANNING_MODEL,
        "max_tokens": PLANNING_MAX_TOKENS,
        "system": PLANNING_SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": user_message}],
    });

    let resp = http
        .post(format!("{router_url}/v1/messages"))
        .bearer_auth(token)
        .json(&req_body)
        .send()
        .await
        .map_err(|e| format!("LLM planning request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("LLM planning returned {status}: {body}"));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("parsing LLM planning response: {e}"))?;

    let text = body
        .get("content")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .and_then(|block| block.get("text"))
        .and_then(|t| t.as_str())
        .unwrap_or("[]");

    // Strip markdown fences if the model wraps its response
    let cleaned = text.trim();
    let json_str = if cleaned.starts_with("```") {
        cleaned
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim()
    } else {
        cleaned
    };

    let plans: Vec<SubTaskPlan> = serde_json::from_str(json_str)
        .map_err(|e| format!("failed to parse planning JSON: {e}"))?;

    if plans.is_empty() {
        return Err("LLM returned empty plan".into());
    }

    Ok(plans)
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
    broadcast: Option<&broadcast::Sender<serde_json::Value>>,
    project_path: &str,
    timeout_secs: u64,
    token: Option<&str>,
    task_service: &TaskService,
    agent_service: &AgentService,
    org_service: &OrgService,
    upstream_context: &str,
    http_client: &reqwest::Client,
    router_url: &str,
    run_base_input: u64,
    run_base_output: u64,
    run_base_cost: f64,
) -> Result<NodeResult, ProcessError> {
    let proj_str = project_id.to_string();
    let pid_str = process_id.to_string();
    let rid_str = run_id.to_string();
    let nid_str = node.node_id.to_string();

    if node.node_type == ProcessNodeType::Condition {
        return execute_single_automaton(
            node, task_id, project_id, process_id, run_id,
            automaton_client, store, broadcast, project_path,
            timeout_secs, token, task_service, agent_service, org_service,
            run_base_input, run_base_output, run_base_cost,
        ).await;
    }

    let plan_mode = node.config.get("plan_mode")
        .and_then(|v| v.as_str())
        .unwrap_or("auto");

    let mut sub_tasks = plan_sub_tasks(node, upstream_context);

    if sub_tasks.len() <= 1 && plan_mode != "off" {
        if let Some(jwt) = token {
            info!(node_id = %node.node_id, "Heuristic split found 1 task; attempting LLM-based planning");
            match plan_sub_tasks_via_llm(
                http_client, router_url, jwt, node, upstream_context,
            ).await {
                Ok(llm_tasks) if llm_tasks.len() > 1 => {
                    info!(
                        node_id = %node.node_id,
                        sub_task_count = llm_tasks.len(),
                        "LLM planning decomposed into {} sub-tasks",
                        llm_tasks.len()
                    );
                    if let Some(tx) = broadcast {
                        send_process_text(
                            store, tx, &proj_str, task_id, &pid_str, &rid_str, &nid_str,
                            &format!("Planned {} sub-tasks via LLM decomposition.\n\n", llm_tasks.len()),
                        );
                    }
                    sub_tasks = llm_tasks;
                }
                Ok(_) => {
                    info!(node_id = %node.node_id, "LLM planning confirmed single task");
                }
                Err(e) => {
                    warn!(node_id = %node.node_id, error = %e, "LLM planning failed; falling back to single execution");
                }
            }
        }
    }

    if sub_tasks.len() <= 1 {
        if let Some(tx) = broadcast {
            send_process_text(store, tx, &proj_str, task_id, &pid_str, &rid_str, &nid_str, "Single task — executing directly.\n\n");
        }
        return execute_single_automaton(
            node, task_id, project_id, process_id, run_id,
            automaton_client, store, broadcast, project_path,
            timeout_secs, token, task_service, agent_service, org_service,
            run_base_input, run_base_output, run_base_cost,
        ).await;
    }

    info!(
        node_id = %node.node_id,
        sub_task_count = sub_tasks.len(),
        "Executing node with parallel sub-tasks"
    );

    if let Some(tx) = broadcast {
        send_process_text(store, tx, &proj_str, task_id, &pid_str, &rid_str, &nid_str, &format!("\n\nCreating {} sub-tasks...\n", sub_tasks.len()));
    }

    let max_concurrency = node
        .config
        .get("max_concurrency")
        .and_then(|v| v.as_u64())
        .unwrap_or(3) as usize;

    let jwt = token.ok_or_else(|| ProcessError::Execution("No JWT for sub-task creation".into()))?;
    let pid = project_id.to_string();

    let semaphore = Arc::new(tokio::sync::Semaphore::new(max_concurrency));
    let mut handles = Vec::with_capacity(sub_tasks.len());
    let transcript_store = store.clone();
    let shared_node_in = Arc::new(AtomicU64::new(0));
    let shared_node_out = Arc::new(AtomicU64::new(0));

    for (idx, sub_task) in sub_tasks.iter().enumerate() {
        let created_task = storage_client
            .create_task(
                &pid,
                jwt,
                &aura_os_storage::CreateTaskRequest {
                    spec_id: spec_id.to_string(),
                    title: sub_task.title.clone(),
                    org_id: None,
                    description: Some(format!(
                        "Original task instructions:\n{}\n\n---\nSub-task:\n{}",
                        node.prompt, sub_task.description,
                    )),
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

        if let Some(tx) = broadcast {
            send_process_text(store, tx, &proj_str, task_id, &pid_str, &rid_str, &nid_str,
                &format!("  Creating task {}/{}... {}\n", idx + 1, sub_tasks.len(), sub_task.title));
        }

        let sem = semaphore.clone();
        let ac = automaton_client.clone();
        let sub_task_id = created_task.id.clone();
        let sub_project_id = *project_id;
        let sub_process_id = *process_id;
        let sub_run_id = *run_id;
        let sub_project_path = project_path.to_string();
        let sub_token = token.map(|s| s.to_string());
        let sub_timeout = timeout_secs;
        let sub_node_id = node.node_id;
        let sub_title = sub_task.title.clone();
        let broadcast_tx = broadcast.cloned();
        let sub_store = transcript_store.clone();
        let task_node_in = shared_node_in.clone();
        let task_node_out = shared_node_out.clone();
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

            let output_file = format!("output-{}.txt", sub_task_id);
            let instructions = format!(
                "Write your final deliverable to `{output_file}` in the workspace root.\n\
                 This file is used as the sub-task's output for the next process step.\n\
                 Do NOT create project scaffolding (no Cargo.toml, package.json, etc.).\n\
                 Use shell commands and write files directly."
            );
            let instructions_path = Path::new(&sub_project_path).join(".process-instructions");
            let _ = tokio::fs::write(&instructions_path, instructions.as_bytes()).await;

            let authed_ac = ac.clone()
                .with_auth(sub_token.clone());
            let (_start_result, events_tx) = start_and_connect(
                &authed_ac,
                AutomatonStartParams {
                    project_id: sub_project_id.to_string(),
                    auth_token: sub_token.clone(),
                    model,
                    workspace_root: Some(sub_project_path.clone()),
                    task_id: Some(sub_task_id.clone()),
                    git_repo_url: None,
                    git_branch: None,
                },
                2,
            )
            .await
            .map_err(|e| ProcessError::Execution(format!("Sub-task automaton failed: {e}")))?;

            let rx = events_tx.subscribe();
            let fwd_proj = sub_project_id.to_string();
            let fwd_tid = sub_task_id.clone();
            let fwd_pid = sub_process_id.to_string();
            let fwd_rid = sub_run_id.to_string();
            let fwd_nid = sub_node_id.to_string();
            let fwd_title = sub_title.clone();

            let completion = collect_automaton_events(
                rx,
                Duration::from_secs(sub_timeout),
                |evt, evt_type| {
                    if let Some(ref tx) = broadcast_tx {
                        if matches!(evt_type, "text_delta" | "thinking_delta"
                            | "tool_use_start" | "tool_call_started" | "tool_call_snapshot" | "tool_result") {
                            forward_process_event(&sub_store, tx, &fwd_proj, &fwd_tid, &fwd_pid, &fwd_rid, &fwd_nid, evt, Some(&fwd_title));
                        }
                        if matches!(evt_type, "token_usage" | "assistant_message_end") {
                            let usage = evt.get("usage").unwrap_or(evt);
                            let prev_in = task_node_in.load(Ordering::Relaxed);
                            let prev_out = task_node_out.load(Ordering::Relaxed);
                            let (total_in, total_out, usage_model) =
                                merge_usage_totals(usage, prev_in, prev_out);
                            task_node_in.store(total_in, Ordering::Relaxed);
                            task_node_out.store(total_out, Ordering::Relaxed);
                            let cost = estimate_cost_usd(usage_model.as_deref(), total_in, total_out);
                            emit_process_event(&sub_store, tx, serde_json::json!({
                                "type": "process_run_progress",
                                "process_id": &fwd_pid,
                                "run_id": &fwd_rid,
                                "total_input_tokens": run_base_input + total_in,
                                "total_output_tokens": run_base_output + total_out,
                                "cost_usd": run_base_cost + cost,
                            }));
                        }
                    }
                },
            )
            .await;

            match completion {
                RunCompletion::Done(out) | RunCompletion::StreamClosed(out) => {
                    let output_file_path = Path::new(&sub_project_path)
                        .join(format!("output-{}.txt", sub_task_id));
                    let file_content = match tokio::fs::read_to_string(&output_file_path).await {
                        Ok(content) if !content.trim().is_empty() => Some(content),
                        _ => None,
                    };
                    let workspace_content = if file_content.is_none() {
                        find_workspace_output(Path::new(&sub_project_path)).await
                    } else {
                        None
                    };
                    let final_output = file_content
                        .or(workspace_content)
                        .unwrap_or(out.output_text);
                    Ok((final_output, out.input_tokens, out.output_tokens, out.model))
                }
                RunCompletion::Failed { message, .. } => {
                    Err(ProcessError::Execution(message))
                }
                RunCompletion::Timeout(_) => {
                    Err(ProcessError::Execution(format!(
                        "Sub-task timed out after {sub_timeout}s for node {sub_node_id}"
                    )))
                }
            }
        }));
    }

    if let Some(tx) = broadcast {
        send_process_text(store, tx, &proj_str, task_id, &pid_str, &rid_str, &nid_str,
            &format!("\nExecuting {} sub-tasks (max {} concurrent)...\n\n", sub_tasks.len(), max_concurrency));
    }

    let mut merged_parts: Vec<String> = Vec::with_capacity(handles.len());
    let mut total_input_tokens: u64 = 0;
    let mut total_output_tokens: u64 = 0;
    let mut last_model: Option<String> = None;
    let mut failures: Vec<String> = Vec::new();

    for (idx, handle) in handles.into_iter().enumerate() {
        let task_title = sub_tasks.get(idx).map(|t| t.title.as_str()).unwrap_or("?");
        match handle.await {
            Ok(Ok((output, inp, out, model))) => {
                total_input_tokens += inp;
                total_output_tokens += out;
                if model.is_some() {
                    last_model = model;
                }
                if let Some(tx) = broadcast {
                    send_process_text(store, tx, &proj_str, task_id, &pid_str, &rid_str, &nid_str,
                        &format!("\n--- Sub-task {}/{} completed: {} ({} bytes) ---\n", idx + 1, sub_tasks.len(), task_title, output.len()));
                }
                merged_parts.push(output);
            }
            Ok(Err(e)) => {
                let msg = format!("Sub-task #{} ({}) failed: {}", idx, task_title, e);
                failures.push(msg.clone());
                if let Some(tx) = broadcast {
                    send_process_text(store, tx, &proj_str, task_id, &pid_str, &rid_str, &nid_str, &format!("\n--- {} ---\n", msg));
                }
            }
            Err(e) => {
                let msg = format!("Sub-task #{} ({}) panicked: {}", idx, task_title, e);
                failures.push(msg.clone());
                if let Some(tx) = broadcast {
                    send_process_text(store, tx, &proj_str, task_id, &pid_str, &rid_str, &nid_str, &format!("\n--- {} ---\n", msg));
                }
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
    broadcast: Option<&broadcast::Sender<serde_json::Value>>,
    project_path: &str,
    timeout_secs: u64,
    token: Option<&str>,
    _task_service: &TaskService,
    agent_service: &AgentService,
    org_service: &OrgService,
    run_base_input: u64,
    run_base_output: u64,
    run_base_cost: f64,
) -> Result<NodeResult, ProcessError> {
    let model = {
        let loaded_agent = node.agent_id.as_ref().and_then(|aid| {
            agent_service.get_agent_local(aid).ok()
        });
        let ri = loaded_agent.as_ref().and_then(|a| resolve_agent_integration(a, org_service));
        effective_model(node, loaded_agent.as_ref(), ri.as_ref())
    };

    let output_file = node
        .config
        .get("output_file")
        .and_then(|v| v.as_str())
        .unwrap_or("output.txt");
    let instructions = format!(
        "Write your final deliverable to `{output_file}` in the workspace root. \
         This file is used as the node's downstream output for the next process step."
    );
    let instructions_path = Path::new(project_path).join(".process-instructions");
    let _ = tokio::fs::write(&instructions_path, instructions.as_bytes()).await;

    let authed_client = automaton_client.clone()
        .with_auth(token.map(|s| s.to_string()));
    let (start_result, events_tx) = start_and_connect(
        &authed_client,
        AutomatonStartParams {
            project_id: project_id.to_string(),
            auth_token: token.map(|s| s.to_string()),
            model,
            workspace_root: Some(project_path.to_string()),
            task_id: Some(task_id.to_string()),
            git_repo_url: None,
            git_branch: None,
        },
        2,
    )
    .await
    .map_err(|e| ProcessError::Execution(format!("Failed to start automaton: {e}")))?;

    info!(
        automaton_id = %start_result.automaton_id,
        task_id = %task_id,
        node_id = %node.node_id,
        "Automaton started for process node"
    );

    let rx = events_tx.subscribe();
    let proj = project_id.to_string();
    let tid = task_id.to_string();
    let pid = process_id.to_string();
    let rid = run_id.to_string();
    let nid = node.node_id.to_string();
    let tx = broadcast.cloned();

    let mut node_in: u64 = 0;
    let mut node_out: u64 = 0;

    let completion = collect_automaton_events(
        rx,
        Duration::from_secs(timeout_secs),
        |evt, evt_type| {
            if let Some(ref tx) = tx {
                if matches!(evt_type, "text_delta" | "thinking_delta"
                    | "tool_use_start" | "tool_call_started" | "tool_call_snapshot" | "tool_result") {
                    forward_process_event(store, tx, &proj, &tid, &pid, &rid, &nid, evt, None);
                }
                if matches!(evt_type, "token_usage" | "assistant_message_end") {
                    let usage = evt.get("usage").unwrap_or(evt);
                    let (next_in, next_out, usage_model) = merge_usage_totals(usage, node_in, node_out);
                    node_in = next_in;
                    node_out = next_out;
                    let cost = estimate_cost_usd(usage_model.as_deref(), node_in, node_out);
                    emit_process_event(store, tx, serde_json::json!({
                        "type": "process_run_progress",
                        "process_id": &pid,
                        "run_id": &rid,
                        "total_input_tokens": run_base_input + node_in,
                        "total_output_tokens": run_base_output + node_out,
                        "cost_usd": run_base_cost + cost,
                    }));
                }
            }
        },
    )
    .await;

    let out = match completion {
        RunCompletion::Done(out) | RunCompletion::StreamClosed(out) => out,
        RunCompletion::Failed { message, .. } => {
            return Err(ProcessError::Execution(message));
        }
        RunCompletion::Timeout(_) => {
            return Err(ProcessError::Execution(format!(
                "Automaton timed out after {timeout_secs}s for node {}", node.node_id
            )));
        }
    };

    let output_file_path = Path::new(project_path).join(output_file);
    let file_content = match tokio::fs::read_to_string(&output_file_path).await {
        Ok(content) if !content.trim().is_empty() => Some(content),
        _ => None,
    };

    let workspace_content = if file_content.is_none() {
        find_workspace_output(Path::new(project_path)).await
    } else {
        None
    };

    let downstream = file_content
        .or(workspace_content)
        .unwrap_or_else(|| out.output_text.clone());

    if downstream.trim().is_empty() {
        return Err(ProcessError::Execution(format!(
            "Automaton produced no output for node {}", node.node_id
        )));
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
        size_bytes: downstream.len() as u64,
        metadata: serde_json::json!({}),
        created_at: Utc::now(),
    };
    if let Err(e) = store.save_artifact(&artifact) {
        warn!(node_id = %node.node_id, error = %e, "Failed to save automaton artifact");
    }

    let token_usage = if out.input_tokens > 0 || out.output_tokens > 0 {
        Some(NodeTokenUsage {
            input_tokens: out.input_tokens,
            output_tokens: out.output_tokens,
            model: out.model,
        })
    } else {
        None
    };

    Ok(NodeResult {
        downstream_output: downstream,
        display_output: None,
        token_usage,
        content_blocks: if out.content_blocks.is_empty() { None } else { Some(out.content_blocks) },
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

/// Try to recover a JSON array from mixed upstream text (e.g. sub-task
/// outputs joined by `---` separators with possible error lines).
fn extract_json_array_from_mixed(text: &str) -> Option<Vec<serde_json::Value>> {
    // Split on the standard sub-task separator and parse each section independently.
    let sections: Vec<&str> = text.split("\n\n---\n\n").collect();
    if sections.len() > 1 {
        let mut all_items = Vec::new();
        for section in &sections {
            if let Ok(arr) = serde_json::from_str::<Vec<serde_json::Value>>(section.trim()) {
                all_items.extend(arr);
            }
        }
        if !all_items.is_empty() {
            return Some(all_items);
        }
    }

    // Scan for the first valid `[…]` JSON array anywhere in the text.
    for (start, ch) in text.char_indices() {
        if ch == '[' {
            if let Ok(arr) = serde_json::from_str::<Vec<serde_json::Value>>(&text[start..]) {
                return Some(arr);
            }
        }
    }

    None
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
            let trimmed = upstream_context.trim();
            let parsed: Vec<serde_json::Value> =
                serde_json::from_str(trimmed)
                    .or_else(|_| {
                        extract_json_array_from_mixed(trimmed)
                            .ok_or_else(|| serde_json::from_str::<serde_json::Value>("!").unwrap_err())
                    })
                    .map_err(|_| ProcessError::Execution(
                        "ForEach: upstream does not contain a valid JSON array".into(),
                    ))?;
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

    emit_process_event(store, broadcast, serde_json::json!({
        "type": "process_run_failed",
        "process_id": run.process_id.to_string(),
        "run_id": run.run_id.to_string(),
        "error": error,
        "total_input_tokens": failed_run.total_input_tokens,
        "total_output_tokens": failed_run.total_output_tokens,
        "cost_usd": failed_run.cost_usd,
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

    broadcast_node_status(store, broadcast, run, node, ProcessEventStatus::Running, None);
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

    broadcast_node_status(store, broadcast, run, node, status, token_usage);
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

    broadcast_node_status(store, broadcast, run, node, status, None);
}

fn broadcast_node_status(
    store: &ProcessStore,
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
    emit_process_event(store, broadcast, payload);
}
