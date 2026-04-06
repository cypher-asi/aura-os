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
use aura_os_link::{
    AutomatonClient, AutomatonStartParams, HarnessInbound, HarnessLink, HarnessOutbound,
    SessionConfig, SessionProviderConfig, SessionUsage, UserMessage,
};
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

/// Shared output-extraction pipeline applied to every LLM-backed node.
/// Strips `<thinking>` tags and trims whitespace. When `extract_code_block`
/// is true (artifact nodes), also unwraps a trailing fenced code block.
fn canonicalize_output(raw: &str, extract_code_block: bool) -> String {
    let cleaned = strip_thinking_tags(raw.trim());
    if extract_code_block {
        extract_final_output(&cleaned)
    } else {
        cleaned
    }
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

const PROCESS_EXECUTION_PREAMBLE: &str = "\
You are executing a step in an automated workflow process. \
Output ONLY the final result. No planning, no narration, no \"let me try\" preamble. \
Never describe your process — just output the finished product as text.\n\n\
TOOL RULES:\n\
- Use `read_file` / `write_file` / `edit_file` for file operations.\n\
- Use `list_files` or `find_files` to browse the filesystem.\n\
- Use `run_command` for build, test, git, and other shell commands.\n\
- Treat the project root as `.` and always use relative paths.\n\n\
TOOL-FAILURE RULE: If the majority of your tool calls fail or return errors, \
STOP immediately and output a structured error report listing each failed tool call, \
the error, and what data is missing. Do NOT fabricate results, echo back your search \
queries, or produce placeholder output. Downstream nodes depend on real data — passing \
garbage forward is worse than reporting an honest failure.";

const PROCESS_EXECUTION_PREAMBLE_WITH_OUTPUT_FILE: &str = "\
You are executing a step in an automated workflow process.\n\n\
OUTPUT FILE REQUIREMENT: You MUST write your final results to the designated \
output file using `write_file`. This file is the ONLY output passed to \
downstream nodes. If the file is empty when your session ends, the node \
FAILS and the workflow stops.\n\n\
WRITE INCREMENTALLY: Write to the output file after each batch of results you \
collect, not just at the end. This way partial progress survives if you run out \
of time.\n\n\
SIZE LIMIT: Each individual `write_file` call MUST contain fewer than 4000 \
characters of content. If your output is larger, split it across multiple \
writes — write the first section, then use `edit_file` or another `write_file` \
to append subsequent sections.\n\n\
WRITE-FAILURE FALLBACK: If `write_file` fails 3 or more times in a row, STOP \
trying to write to the file. Instead, output your complete results directly as \
text in your response message. The system will recover this text automatically. \
Do NOT keep retrying `write_file` indefinitely.\n\n\
TOOL RULES:\n\
- Use `read_file` / `write_file` / `edit_file` for file operations.\n\
- Use `list_files` or `find_files` to browse the filesystem.\n\
- Use `run_command` for build, test, git, and other shell commands.\n\
- Treat the project root as `.` and always use relative paths.\n\n\
TOOL-FAILURE RULE: If the majority of your tool calls fail or return errors, \
STOP immediately and write a structured error report TO THE OUTPUT FILE listing \
each failed tool call, the error, and what data is missing. Do NOT fabricate \
results or produce placeholder output.";

fn action_preamble(output_file: &str) -> String {
    let now = Utc::now();
    format!(
        "{PROCESS_EXECUTION_PREAMBLE_WITH_OUTPUT_FILE}\n\n\
         Current UTC date/time: {now}\n\
         Your output file is: `{output_file}`"
    )
}

fn continuation_prompt(output_file: &str, byte_count: usize) -> String {
    format!(
        "The previous session ran out of time before completing the output file.\n\
         The file `{output_file}` has {byte_count} bytes of partial content.\n\n\
         INSTRUCTIONS:\n\
         1. Read `{output_file}` to see what is already written.\n\
         2. COMPLETE the file by appending the remaining content using `edit_file`.\n\
         3. Do NOT rewrite or duplicate content that is already present.\n\
         4. Ensure all JSON braces/brackets are properly closed at the end.\n\
         5. Each write must be under 4000 characters."
    )
}

fn is_truncated_output(content: &str) -> bool {
    let trimmed = content.trim();
    if trimmed.len() < 100 {
        return false;
    }
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        let open = trimmed.matches('{').count() + trimmed.matches('[').count();
        let close = trimmed.matches('}').count() + trimmed.matches(']').count();
        if open > close {
            return true;
        }
    }
    trimmed.ends_with(',')
}

#[derive(Clone)]
pub struct ProcessExecutor {
    store: Arc<ProcessStore>,
    event_broadcast: broadcast::Sender<serde_json::Value>,
    harness: Arc<dyn HarnessLink>,
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
        harness: Arc<dyn HarnessLink>,
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
            harness,
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
                &*executor.harness,
                &executor.data_dir,
                &executor.rocks_store,
                &executor.agent_service,
                &executor.org_service,
            )
            .await
            {
                warn!(run_id = %run_clone.run_id, error = %e, "Process run failed");
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

        execute_run(
            self,
            &self.store,
            &self.event_broadcast,
            &run,
            &*self.harness,
            &self.data_dir,
            &self.rocks_store,
            &self.agent_service,
            &self.org_service,
        )
        .await?;

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
    harness: &'a dyn HarnessLink,
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

    // ── create spec + tasks when process is linked to a project ────────
    let process = store.get_process(&run.process_id)?
        .ok_or_else(|| ProcessError::NotFound(run.process_id.to_string()))?;
    let mut node_task_ids: HashMap<ProcessNodeId, String> = HashMap::new();
    let spec_id_for_run: Option<String> = if let Some(ref project_id) = process.project_id {
        if let Some(ref sc) = executor.storage_client {
            match create_spec_and_tasks(
                sc, jwt.as_deref(), project_id, &process, &nodes, &sorted, &reachable,
            ).await {
                Ok((sid, task_map)) => {
                    node_task_ids = task_map;
                    Some(sid)
                }
                Err(e) => {
                    warn!(error = %e, "Failed to create spec/tasks for process run; falling back to harness path");
                    None
                }
            }
        } else {
            None
        }
    } else {
        None
    };

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

        let use_automaton = node_task_ids.contains_key(&node_id)
            && process.project_id.is_some()
            && matches!(node.node_type, ProcessNodeType::Action | ProcessNodeType::Prompt | ProcessNodeType::Artifact);

        let result: Result<NodeResult, ProcessError> = match node.node_type {
            ProcessNodeType::Ignition => execute_ignition(node).map(|s| NodeResult {
                downstream_output: s, display_output: None, token_usage: None, content_blocks: None,
            }),
            ProcessNodeType::Action if use_automaton => {
                let task_id = &node_task_ids[&node_id];
                let project_id = process.project_id.as_ref().unwrap();
                let timeout_secs = node.config.get("timeout_seconds").and_then(|v| v.as_u64()).unwrap_or(DEFAULT_HARNESS_TIMEOUT_SECS);
                execute_action_via_automaton(
                    node, task_id, project_id, &run.process_id, &run.run_id,
                    &executor.automaton_client, store, Some(&fwd), &workspace_path,
                    timeout_secs, jwt.as_deref(), &executor.task_service,
                    agent_service, org_service,
                ).await
            }
            ProcessNodeType::Action => {
                execute_action(node, &upstream_context, &run.process_id, &run.run_id, store, harness, jwt.as_deref(), agent_service, org_service, Some(&fwd), Some(&workspace_path)).await
            }
            ProcessNodeType::Condition => {
                execute_condition(node, &upstream_context, harness, jwt.as_deref(), agent_service, org_service, Some(&fwd), Some(&workspace_path)).await
            }
            ProcessNodeType::Delay => execute_delay(node).await.map(|s| NodeResult {
                downstream_output: s, display_output: None, token_usage: None, content_blocks: None,
            }),
            ProcessNodeType::Artifact if use_automaton => {
                let task_id = &node_task_ids[&node_id];
                let project_id = process.project_id.as_ref().unwrap();
                let timeout_secs = node.config.get("timeout_seconds").and_then(|v| v.as_u64()).unwrap_or(DEFAULT_HARNESS_TIMEOUT_SECS);
                execute_action_via_automaton(
                    node, task_id, project_id, &run.process_id, &run.run_id,
                    &executor.automaton_client, store, Some(&fwd), &workspace_path,
                    timeout_secs, jwt.as_deref(), &executor.task_service,
                    agent_service, org_service,
                ).await
            }
            ProcessNodeType::Artifact => {
                execute_artifact(
                    node, &upstream_context, &run.process_id, &run.run_id,
                    data_dir, store, harness, jwt.as_deref(),
                    agent_service, org_service, Some(&fwd), Some(&workspace_path),
                ).await
            }
            ProcessNodeType::Prompt if use_automaton => {
                let task_id = &node_task_ids[&node_id];
                let project_id = process.project_id.as_ref().unwrap();
                let timeout_secs = node.config.get("timeout_seconds").and_then(|v| v.as_u64()).unwrap_or(DEFAULT_HARNESS_TIMEOUT_SECS);
                execute_action_via_automaton(
                    node, task_id, project_id, &run.process_id, &run.run_id,
                    &executor.automaton_client, store, Some(&fwd), &workspace_path,
                    timeout_secs, jwt.as_deref(), &executor.task_service,
                    agent_service, org_service,
                ).await
            }
            ProcessNodeType::Prompt => {
                execute_prompt(
                    node, &upstream_context, &run.process_id, &run.run_id,
                    data_dir, store, harness, jwt.as_deref(),
                    agent_service, org_service, Some(&fwd), Some(&workspace_path),
                ).await
            }
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
                    if let Some(ref pid) = process.project_id {
                        let tid_parsed = tid.parse().ok();
                        let sid = spec_id_for_run.as_ref().and_then(|s| s.parse().ok());
                        if let (Some(task_id), Some(spec_id)) = (tid_parsed, sid) {
                            if let Err(e) = executor.task_service.transition_task(pid, &spec_id, &task_id, TaskStatus::Done).await {
                                warn!(task_id = %tid, error = %e, "Failed to transition task to Done");
                            }
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
                    if let Some(ref pid) = process.project_id {
                        let tid_parsed = tid.parse().ok();
                        let sid = spec_id_for_run.as_ref().and_then(|s| s.parse().ok());
                        if let (Some(task_id), Some(spec_id)) = (tid_parsed, sid) {
                            if let Err(te) = executor.task_service.transition_task(pid, &spec_id, &task_id, TaskStatus::Failed).await {
                                warn!(task_id = %tid, error = %te, "Failed to transition task to Failed");
                            }
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

/// Build a `SessionProviderConfig` from a resolved integration and the
/// effective model, matching the chat handler's `build_harness_provider_config`.
fn build_provider_config(
    integration: &ResolvedIntegration,
    model: Option<&str>,
) -> Option<SessionProviderConfig> {
    if integration.metadata.provider != "anthropic" {
        warn!(provider = %integration.metadata.provider, "Process executor only supports anthropic provider");
        return None;
    }

    Some(SessionProviderConfig {
        provider: "anthropic".to_string(),
        routing_mode: Some("direct".to_string()),
        api_key: integration.secret.clone(),
        base_url: None,
        default_model: model
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .or_else(|| integration.metadata.default_model.clone()),
        fallback_model: None,
        prompt_caching_enabled: Some(true),
    })
}

/// Build a SessionConfig enriched with the agent's system prompt, name,
/// provider config, and node-level overrides (model, max_turns). Mirrors the
/// same session setup path as the chat handler to ensure identical behaviour.
fn build_session_config(
    node: &ProcessNode,
    token: Option<&str>,
    agent_service: &AgentService,
    org_service: &OrgService,
    system_prompt_override: Option<String>,
    project_path: Option<&str>,
) -> SessionConfig {
    let agent_id_str = node.agent_id.as_ref().map(|id| id.to_string());

    let (system_prompt, agent_name, resolved_integration, loaded_agent) =
        match node.agent_id.as_ref() {
            Some(aid) => match agent_service.get_agent_local(aid) {
                Ok(agent) => {
                    let prompt = system_prompt_override.unwrap_or_else(|| {
                        let now = Utc::now();
                        if agent.system_prompt.is_empty() {
                            format!("{PROCESS_EXECUTION_PREAMBLE}\n\nCurrent UTC date/time: {now}")
                        } else {
                            format!("{PROCESS_EXECUTION_PREAMBLE}\n\nCurrent UTC date/time: {now}\n\n{}", agent.system_prompt)
                        }
                    });
                    let ri = resolve_agent_integration(&agent, org_service);
                    (Some(prompt), Some(agent.name.clone()), ri, Some(agent))
                }
                Err(e) => {
                    warn!(agent_id = %aid, error = %e, "Could not load agent for process node; using defaults");
                    let now = Utc::now();
                    (
                        Some(format!("{PROCESS_EXECUTION_PREAMBLE}\n\nCurrent UTC date/time: {now}")),
                        None,
                        None,
                        None,
                    )
                }
            },
            None => {
                let now = Utc::now();
                (
                    Some(format!("{PROCESS_EXECUTION_PREAMBLE}\n\nCurrent UTC date/time: {now}")),
                    None,
                    None,
                    None,
                )
            },
        };

    let model = effective_model(node, loaded_agent.as_ref(), resolved_integration.as_ref());
    let provider_config = resolved_integration
        .as_ref()
        .and_then(|ri| build_provider_config(ri, model.as_deref()));

    let max_turns = node
        .config
        .get("max_turns")
        .and_then(|v| v.as_u64())
        .map(|n| n as u32)
        .or(Some(100));

    SessionConfig {
        system_prompt,
        agent_id: agent_id_str,
        agent_name,
        model,
        max_turns,
        token: token.map(|s| s.to_string()),
        project_path: project_path.map(|s| s.to_string()),
        provider_config,
        ..Default::default()
    }
}

// ---------------------------------------------------------------------------
// Shared harness session helper
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
async fn run_harness_session(
    node: &ProcessNode,
    prompt: String,
    system_prompt_override: Option<String>,
    harness: &dyn HarnessLink,
    token: Option<&str>,
    agent_service: &AgentService,
    org_service: &OrgService,
    forwarder: Option<&DeltaForwarder<'_>>,
    project_path: Option<&str>,
    timeout_secs: u64,
) -> Result<(HarnessResponse, Option<NodeTokenUsage>), ProcessError> {
    let config = build_session_config(
        node, token, agent_service, org_service, system_prompt_override, project_path,
    );

    let session = harness
        .open_session(config)
        .await
        .map_err(|e| ProcessError::Execution(format!("Failed to open harness session: {e}")))?;

    session
        .commands_tx
        .send(HarnessInbound::UserMessage(UserMessage {
            content: prompt,
            tool_hints: None,
            attachments: None,
        }))
        .map_err(|e| ProcessError::Execution(format!("Failed to send message: {e}")))?;

    let resp = collect_harness_response(&session.events_tx, timeout_secs, forwarder).await?;

    if let Err(e) = harness.close_session(&session.session_id).await {
        warn!(session_id = %session.session_id, error = %e, "Failed to close harness session");
    }

    let token_usage = resp.usage.as_ref().map(|u| NodeTokenUsage {
        input_tokens: u.cumulative_input_tokens,
        output_tokens: u.cumulative_output_tokens,
        model: Some(u.model.clone()),
    });

    Ok((resp, token_usage))
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
                order_index: None,
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
            ProcessNodeType::Action | ProcessNodeType::Prompt | ProcessNodeType::Artifact
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

#[allow(clippy::too_many_arguments)]
async fn execute_action_via_automaton(
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

#[allow(clippy::too_many_arguments)]
async fn execute_action(
    node: &ProcessNode,
    upstream_context: &str,
    process_id: &ProcessId,
    run_id: &ProcessRunId,
    store: &ProcessStore,
    harness: &dyn HarnessLink,
    token: Option<&str>,
    agent_service: &AgentService,
    org_service: &OrgService,
    forwarder: Option<&DeltaForwarder<'_>>,
    project_path: Option<&str>,
) -> Result<NodeResult, ProcessError> {
    let timeout_secs = node
        .config
        .get("timeout_seconds")
        .and_then(|v| v.as_u64())
        .unwrap_or(DEFAULT_HARNESS_TIMEOUT_SECS);

    let output_file = node
        .config
        .get("output_file")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "output.txt".to_string());

    let full_prompt = if upstream_context.is_empty() {
        node.prompt.clone()
    } else {
        format!(
            "## Context from previous steps\n\n{upstream_context}\n\n## Task\n\n{}",
            node.prompt
        )
    };

    let output_file_path = Path::new(project_path.unwrap_or(".")).join(&output_file);

    let max_continuations: u64 = node
        .config
        .get("max_continuations")
        .and_then(|v| v.as_u64())
        .unwrap_or(2);

    // -- Continuation loop --------------------------------------------------
    // Run the initial harness session, then check if the output file is
    // structurally truncated (unclosed JSON, trailing commas). If so, spawn
    // additional "continuation" sessions that read the existing file and
    // append the remaining content.
    let mut cumulative_input_tokens: u64 = 0;
    let mut cumulative_output_tokens: u64 = 0;
    let mut last_model: Option<String> = None;
    let mut last_harness_result: Option<Result<(HarnessResponse, Option<NodeTokenUsage>), ProcessError>> = None;
    let mut last_content_blocks: Option<Vec<serde_json::Value>> = None;

    for attempt in 0..=max_continuations {
        let prompt = if attempt == 0 {
            full_prompt.clone()
        } else {
            let bytes = tokio::fs::metadata(&output_file_path)
                .await
                .map(|m| m.len() as usize)
                .unwrap_or(0);
            info!(
                node_id = %node.node_id,
                attempt,
                file_bytes = bytes,
                "Starting continuation session for truncated output"
            );
            continuation_prompt(&output_file, bytes)
        };

        let result = run_harness_session(
            node,
            prompt,
            Some(action_preamble(&output_file)),
            harness,
            token,
            agent_service,
            org_service,
            forwarder,
            project_path,
            timeout_secs,
        )
        .await;

        if let Ok((ref resp, ref tu)) = result {
            if let Some(ref u) = tu {
                cumulative_input_tokens += u.input_tokens;
                cumulative_output_tokens += u.output_tokens;
                last_model = u.model.clone();
            }
            last_content_blocks = Some(resp.content_blocks.clone());
        }
        last_harness_result = Some(result);

        if attempt == max_continuations {
            break;
        }

        // Check whether the output file still needs continuation.
        let needs_more = match tokio::fs::read_to_string(&output_file_path).await {
            Ok(ref content) if !content.trim().is_empty() => is_truncated_output(content),
            _ => false,
        };
        if !needs_more {
            break;
        }
    }

    let harness_result = last_harness_result.unwrap();
    let cumulative_usage = if cumulative_input_tokens > 0 || cumulative_output_tokens > 0 {
        Some(NodeTokenUsage {
            input_tokens: cumulative_input_tokens,
            output_tokens: cumulative_output_tokens,
            model: last_model,
        })
    } else {
        None
    };

    // -- Read final output file ---------------------------------------------
    let file_content = match tokio::fs::read_to_string(&output_file_path).await {
        Ok(content) if !content.trim().is_empty() => {
            info!(path = %output_file_path.display(), bytes = content.len(), "Read designated output file");
            Some(content)
        }
        _ => None,
    };

    // Try to extract recovery candidates from the harness response.
    // Priority: final_text (last turn only) > synthesized blocks > all_text.
    let (recovery_content, token_usage, content_blocks) = match harness_result {
        Ok((resp, _tu)) => {
            let final_text_clean = canonicalize_output(&resp.final_text, false);
            let all_text_clean = canonicalize_output(&resp.all_text, false);
            let synthesized = synthesize_output_from_blocks(&resp.content_blocks);

            let best_recovery = if final_text_clean.len() > 500 {
                Some(final_text_clean)
            } else if let Some(s) = synthesized {
                Some(s)
            } else if all_text_clean.len() > 500 {
                Some(all_text_clean)
            } else {
                None
            };
            (best_recovery, cumulative_usage, last_content_blocks)
        }
        Err(e) => {
            if file_content.is_some() {
                (None, cumulative_usage, last_content_blocks)
            } else {
                return Err(e);
            }
        }
    };

    // Pick the best available content: prefer whichever source is largest,
    // but only override the file when recovery is substantially better.
    let chosen = match (&file_content, &recovery_content) {
        (Some(fc), Some(rc))
            if rc.len() > fc.len() * 3 && rc.len() > fc.len() + 500 =>
        {
            warn!(
                node_id = %node.node_id,
                file_bytes = fc.len(),
                recovered_bytes = rc.len(),
                "Recovery content is substantially larger than output file; using recovery"
            );
            recovery_content.unwrap()
        }
        (Some(fc), _) => fc.clone(),
        (None, Some(_)) => {
            warn!(
                node_id = %node.node_id,
                output_file = %output_file,
                recovered_bytes = recovery_content.as_ref().map_or(0, |r| r.len()),
                "Output file missing; using recovered content"
            );
            recovery_content.unwrap()
        }
        (None, None) => {
            return Err(ProcessError::Execution(format!(
                "Action node output file '{}' is missing/empty and no substantial output \
                 could be recovered. This usually means the agent got stuck or ran out of \
                 turns before writing results. Check the prompt, increase max_turns, or \
                 increase timeout_seconds.",
                output_file,
            )));
        }
    };

    // Persist the chosen content to disk and save the artifact.
    if let Err(e) = tokio::fs::write(&output_file_path, chosen.as_bytes()).await {
        warn!(node_id = %node.node_id, error = %e, "Failed to write action output to disk");
    }
    let rel_path = format!(
        "process-workspaces/{}/{}/{}",
        process_id, run_id, output_file
    );
    let artifact = ProcessArtifact {
        artifact_id: ProcessArtifactId::new(),
        process_id: *process_id,
        run_id: *run_id,
        node_id: node.node_id,
        artifact_type: ArtifactType::Document,
        name: output_file.clone(),
        file_path: rel_path,
        size_bytes: chosen.len() as u64,
        metadata: serde_json::json!({}),
        created_at: Utc::now(),
    };
    if let Err(e) = store.save_artifact(&artifact) {
        warn!(node_id = %node.node_id, error = %e, "Failed to save action artifact");
    }

    Ok(NodeResult {
        downstream_output: chosen,
        display_output: None,
        token_usage,
        content_blocks,
    })
}

fn sanitize_label_to_filename(label: &str) -> String {
    let sanitized: String = label
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect();
    let trimmed = sanitized.trim_matches('-').to_lowercase();
    if trimmed.is_empty() {
        "prompt-output.md".to_string()
    } else {
        format!("{trimmed}.md")
    }
}

#[allow(clippy::too_many_arguments)]
async fn execute_prompt(
    node: &ProcessNode,
    upstream_context: &str,
    process_id: &ProcessId,
    run_id: &ProcessRunId,
    _data_dir: &Path,
    store: &ProcessStore,
    harness: &dyn HarnessLink,
    token: Option<&str>,
    agent_service: &AgentService,
    org_service: &OrgService,
    forwarder: Option<&DeltaForwarder<'_>>,
    project_path: Option<&str>,
) -> Result<NodeResult, ProcessError> {
    let timeout_secs = node
        .config
        .get("timeout_seconds")
        .and_then(|v| v.as_u64())
        .unwrap_or(DEFAULT_HARNESS_TIMEOUT_SECS);

    let output_file = node
        .config
        .get("output_file")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| sanitize_label_to_filename(&node.label));

    let full_prompt = if upstream_context.is_empty() {
        node.prompt.clone()
    } else {
        format!(
            "## Context from previous steps\n\n{upstream_context}\n\n## Task\n\n{}",
            node.prompt
        )
    };

    let output_file_path = Path::new(project_path.unwrap_or(".")).join(&output_file);

    let harness_result = run_harness_session(
        node, full_prompt,
        Some(action_preamble(&output_file)),
        harness, token, agent_service, org_service, forwarder, project_path,
        timeout_secs,
    ).await;

    let file_content = match tokio::fs::read_to_string(&output_file_path).await {
        Ok(content) if !content.trim().is_empty() => {
            info!(path = %output_file_path.display(), bytes = content.len(), "Read prompt output file");
            Some(content)
        }
        _ => None,
    };

    let (content, token_usage, content_blocks, from_file) = if let Some(fc) = file_content {
        let token_usage = harness_result.ok().and_then(|(_, tu)| tu);
        (fc, token_usage, None, true)
    } else {
        let (resp, token_usage) = harness_result?;
        let cleaned = canonicalize_output(&resp.final_text, false);
        if cleaned.is_empty() {
            return Err(ProcessError::Execution(
                "Prompt node produced empty output".into(),
            ));
        }
        (cleaned, token_usage, Some(resp.content_blocks), false)
    };

    // When content was recovered from the LLM response (not the file), write
    // it to disk so get_artifact_content can serve it.
    if !from_file {
        if let Err(e) = tokio::fs::write(&output_file_path, content.as_bytes()).await {
            warn!(
                node_id = %node.node_id,
                error = %e,
                "Failed to write prompt fallback content to disk"
            );
        }
    }

    let artifact_type_str = node
        .config
        .get("artifact_type")
        .and_then(|v| v.as_str())
        .unwrap_or("document");
    let artifact_type: ArtifactType =
        serde_json::from_value(serde_json::Value::String(artifact_type_str.to_string()))
            .unwrap_or(ArtifactType::Document);

    let rel_path = format!(
        "process-workspaces/{}/{}/{}",
        process_id, run_id, output_file
    );
    let artifact = ProcessArtifact {
        artifact_id: ProcessArtifactId::new(),
        process_id: *process_id,
        run_id: *run_id,
        node_id: node.node_id,
        artifact_type,
        name: output_file.clone(),
        file_path: rel_path,
        size_bytes: content.len() as u64,
        metadata: serde_json::json!({}),
        created_at: Utc::now(),
    };
    if let Err(e) = store.save_artifact(&artifact) {
        warn!(node_id = %node.node_id, error = %e, "Failed to save prompt artifact");
    }

    info!(
        node_id = %node.node_id,
        artifact_id = %artifact.artifact_id,
        output_file = %output_file,
        bytes = content.len(),
        "Prompt artifact saved"
    );

    Ok(NodeResult {
        downstream_output: content,
        display_output: None,
        token_usage,
        content_blocks,
    })
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

async fn execute_condition(
    node: &ProcessNode,
    upstream_context: &str,
    harness: &dyn HarnessLink,
    token: Option<&str>,
    agent_service: &AgentService,
    org_service: &OrgService,
    forwarder: Option<&DeltaForwarder<'_>>,
    project_path: Option<&str>,
) -> Result<NodeResult, ProcessError> {
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

    let condition_system = Some(
        "You are a condition evaluator in an automated workflow. \
         Respond with ONLY the word \"true\" or \"false\". Do not use tools."
            .to_string(),
    );

    let (resp, token_usage) = run_harness_session(
        node, evaluation_prompt,
        condition_system,
        harness, token, agent_service, org_service, forwarder, project_path,
        60,
    ).await?;

    Ok(NodeResult {
        downstream_output: canonicalize_output(&resp.final_text, false),
        display_output: None,
        token_usage,
        content_blocks: Some(resp.content_blocks),
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

const ARTIFACT_PROMPT_PREAMBLE: &str = "\
You are producing a structured artifact in an automated workflow. \
You will receive context from previous steps and instructions for how to \
refine or transform that context into the final artifact. \
Output ONLY the refined result as text in your response. No narration, no commentary, \
no markdown wrappers unless the instructions explicitly request them.\n\n\
NEVER use write_file or any file-writing tools. Your text response IS the artifact. \
Even for large outputs (JSON, reports, etc.), emit everything directly as text.";

const ARTIFACT_SCHEMA_PREAMBLE: &str = "\
You are a data transformation engine in an automated workflow. \
You will receive raw data from previous steps and a target JSON structure. \
Your job is to extract and transform the input data so it conforms to the \
target JSON structure. Output ONLY valid JSON matching the target shape. \
No narration, no commentary, no markdown wrappers. \
Fill in every field from the input data. Use null for fields you cannot populate.\n\n\
NEVER use write_file or any file-writing tools. Your text response IS the artifact. \
Emit the full JSON directly as text, no matter how large.";

#[allow(clippy::too_many_arguments)]
async fn execute_artifact(
    node: &ProcessNode,
    upstream_context: &str,
    process_id: &ProcessId,
    run_id: &ProcessRunId,
    data_dir: &Path,
    store: &ProcessStore,
    harness: &dyn HarnessLink,
    token: Option<&str>,
    agent_service: &AgentService,
    org_service: &OrgService,
    forwarder: Option<&DeltaForwarder<'_>>,
    project_path: Option<&str>,
) -> Result<NodeResult, ProcessError> {
    let cfg = &node.config;
    let artifact_name = cfg
        .get("artifact_name")
        .and_then(|v| v.as_str())
        .unwrap_or(&node.label);
    let artifact_type_str = cfg
        .get("artifact_type")
        .and_then(|v| v.as_str())
        .unwrap_or("report");
    let artifact_type: ArtifactType =
        serde_json::from_value(serde_json::Value::String(artifact_type_str.to_string()))
            .unwrap_or(ArtifactType::Report);

    let safe_name = artifact_name
        .replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
    let date_str = Utc::now().format("%Y-%m-%d");
    let short_id = &run_id.to_string()[..8];
    let filename = format!("{safe_name} - {date_str} - {short_id}.md");

    let rel_path = format!(
        "process-artifacts/{}/{}/{}",
        process_id, run_id, filename
    );
    let dir = data_dir
        .join("process-artifacts")
        .join(process_id.to_string())
        .join(run_id.to_string());

    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| ProcessError::Execution(format!("Failed to create artifact dir: {e}")))?;

    let artifact_mode = cfg
        .get("artifact_mode")
        .and_then(|v| v.as_str())
        .unwrap_or("prompt");

    let data_content = cfg.get("data").and_then(|v| {
        if v.is_null() {
            return None;
        }
        Some(if v.is_string() {
            v.as_str().unwrap_or_default().to_string()
        } else {
            serde_json::to_string_pretty(v).unwrap_or_default()
        })
    });

    let is_schema_mode = artifact_mode == "json_schema";

    let upstream_degraded = upstream_context.contains("⚠ DEGRADED OUTPUT:");

    let upstream_warning = if upstream_degraded {
        "\n\n⚠ WARNING: The input from previous steps is flagged as degraded \
         (most tool calls failed). The data below may be incomplete or missing \
         entirely. Use null for any fields you cannot populate from the available \
         input. Do NOT invent data.\n"
    } else {
        ""
    };

    let (preamble, user_message) = if is_schema_mode {
        let schema = data_content.as_deref().unwrap_or("{}");
        let instructions = if node.prompt.trim().is_empty() {
            "Transform the input data to match the target JSON structure.".to_string()
        } else {
            node.prompt.clone()
        };
        let msg = if upstream_context.is_empty() {
            format!("## Target JSON structure\n\n{schema}\n\n## Instructions\n\n{instructions}")
        } else {
            format!("## Input from previous steps\n{upstream_warning}\n{upstream_context}\n\n## Target JSON structure\n\n{schema}\n\n## Instructions\n\n{instructions}")
        };
        (ARTIFACT_SCHEMA_PREAMBLE, msg)
    } else {
        let msg = if upstream_context.is_empty() {
            format!("## Instructions\n\n{}", node.prompt)
        } else {
            format!(
                "## Input from previous steps\n{upstream_warning}\n{upstream_context}\n\n## Instructions\n\n{}",
                node.prompt
            )
        };
        (ARTIFACT_PROMPT_PREAMBLE, msg)
    };

    let timeout_secs = node
        .config
        .get("timeout_seconds")
        .and_then(|v| v.as_u64())
        .unwrap_or(DEFAULT_HARNESS_TIMEOUT_SECS);

    let (resp, token_usage) = run_harness_session(
        node, user_message,
        Some(preamble.to_string()),
        harness, token, agent_service, org_service, forwarder, project_path,
        timeout_secs,
    ).await?;

    let content = canonicalize_output(&resp.final_text, true);
    if content.is_empty() {
        return Err(ProcessError::Execution(
            "Artifact node produced empty output from harness".into(),
        ));
    }

    let file_path = dir.join(&filename);
    tokio::fs::write(&file_path, content.as_bytes())
        .await
        .map_err(|e| ProcessError::Execution(format!("Failed to write artifact: {e}")))?;

    let artifact = ProcessArtifact {
        artifact_id: ProcessArtifactId::new(),
        process_id: *process_id,
        run_id: *run_id,
        node_id: node.node_id,
        artifact_type,
        name: artifact_name.to_string(),
        file_path: rel_path,
        size_bytes: content.len() as u64,
        metadata: serde_json::json!({}),
        created_at: Utc::now(),
    };
    store.save_artifact(&artifact)?;

    info!(
        node_id = %node.node_id,
        artifact_id = %artifact.artifact_id,
        path = %file_path.display(),
        bytes = content.len(),
        "Artifact saved"
    );

    let display = format!("Artifact saved: {} ({} bytes)", artifact_name, content.len());

    Ok(NodeResult {
        downstream_output: content,
        display_output: Some(display),
        token_usage,
        content_blocks: Some(resp.content_blocks),
    })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

struct HarnessResponse {
    /// Text from the model's final turn only (after the last tool result).
    final_text: String,
    /// Full accumulated text across all turns (for recovery when final_text is
    /// just narration but the agent actually produced substantial output).
    all_text: String,
    /// Structured content blocks mirroring the agents-app conversation format.
    content_blocks: Vec<serde_json::Value>,
    usage: Option<SessionUsage>,
}

/// Collect the full harness conversation, capturing structured content blocks
/// (text, tool_use, tool_result, thinking) exactly like the agents app does.
///
/// Also tracks tool-call boundaries so `final_text` contains only the model's
/// output from its last turn — the actual answer, not intermediate narration.
async fn collect_harness_response(
    events_tx: &broadcast::Sender<HarnessOutbound>,
    timeout_secs: u64,
    forwarder: Option<&DeltaForwarder<'_>>,
) -> Result<HarnessResponse, ProcessError> {
    let mut rx = events_tx.subscribe();
    let mut all_text = String::new();
    let mut last_turn_text = String::new();
    let mut text_segment = String::new();
    let mut thinking_buf = String::new();
    let mut in_tool_call = false;
    let mut had_tool_calls = false;
    let mut content_blocks: Vec<serde_json::Value> = Vec::new();
    let mut last_tool_use_id = String::new();
    let mut usage: Option<SessionUsage> = None;
    let deadline = Duration::from_secs(timeout_secs);

    let collect = async {
        loop {
            match rx.recv().await {
                Ok(HarnessOutbound::TextDelta(delta)) => {
                    if let Some(fwd) = forwarder {
                        fwd.forward_text(&delta.text);
                    }
                    all_text.push_str(&delta.text);
                    text_segment.push_str(&delta.text);
                    if !in_tool_call {
                        last_turn_text.push_str(&delta.text);
                    }
                }
                Ok(HarnessOutbound::ThinkingDelta(delta)) => {
                    if let Some(fwd) = forwarder {
                        fwd.forward_thinking(&delta.thinking);
                    }
                    thinking_buf.push_str(&delta.thinking);
                }
                Ok(HarnessOutbound::ToolUseStart(tool)) => {
                    if !text_segment.is_empty() {
                        content_blocks.push(serde_json::json!({
                            "type": "text", "text": &text_segment
                        }));
                        text_segment.clear();
                    }
                    if !thinking_buf.is_empty() {
                        content_blocks.push(serde_json::json!({
                            "type": "thinking", "thinking": &thinking_buf
                        }));
                        thinking_buf.clear();
                    }
                    last_tool_use_id = tool.id.clone();
                    content_blocks.push(serde_json::json!({
                        "type": "tool_use",
                        "id": &tool.id,
                        "name": &tool.name,
                    }));
                    if let Some(fwd) = forwarder {
                        fwd.forward_tool_start(&tool.id, &tool.name);
                    }
                    in_tool_call = true;
                    had_tool_calls = true;
                }
                Ok(HarnessOutbound::ToolCallSnapshot(snap)) => {
                    if let Some(block) = content_blocks.iter_mut().rev().find(|b| {
                        b.get("type").and_then(|t| t.as_str()) == Some("tool_use")
                            && b.get("id").and_then(|i| i.as_str()) == Some(&snap.id)
                    }) {
                        block["input"] = snap.input.clone();
                    }
                    if let Some(fwd) = forwarder {
                        fwd.forward_tool_snapshot(&snap.id, &snap.name, &snap.input);
                    }
                }
                Ok(HarnessOutbound::ToolResult(result)) => {
                    content_blocks.push(serde_json::json!({
                        "type": "tool_result",
                        "tool_use_id": &last_tool_use_id,
                        "name": &result.name,
                        "result": &result.result,
                        "is_error": result.is_error,
                    }));
                    if let Some(fwd) = forwarder {
                        fwd.forward_tool_result(&result.name, &result.result, result.is_error);
                    }
                    in_tool_call = false;
                    last_turn_text.clear();
                }
                Ok(HarnessOutbound::AssistantMessageEnd(end)) => {
                    usage = Some(end.usage);
                    break;
                }
                Ok(HarnessOutbound::Error(err)) => {
                    return Err(ProcessError::Execution(format!(
                        "Harness error ({}): {}",
                        err.code, err.message
                    )));
                }
                Err(broadcast::error::RecvError::Closed) => {
                    let tool_count = content_blocks.iter()
                        .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("tool_use"))
                        .count();
                    return Err(ProcessError::Execution(format!(
                        "Harness connection closed unexpectedly after {} bytes of text \
                         and {} tool calls. The harness process may have crashed.",
                        all_text.len(), tool_count,
                    )));
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    warn!(skipped = n, "Harness event receiver lagged");
                    continue;
                }
                _ => continue,
            }
        }
        Ok(())
    };

    match tokio::time::timeout(deadline, collect).await {
        Ok(Ok(())) => {}
        Ok(Err(e)) => return Err(e),
        Err(_) => {
            let tool_count = content_blocks.iter()
                .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("tool_use"))
                .count();
            return Err(ProcessError::Execution(format!(
                "Harness timed out after {timeout_secs}s. Collected {} bytes of text \
                 and {} tool calls but session did not complete. Increase \
                 timeout_seconds in node config or simplify the task.",
                all_text.len(), tool_count,
            )));
        }
    };

    if !text_segment.is_empty() {
        content_blocks.push(serde_json::json!({
            "type": "text", "text": &text_segment
        }));
    }
    if !thinking_buf.is_empty() {
        content_blocks.push(serde_json::json!({
            "type": "thinking", "thinking": &thinking_buf
        }));
    }

    let final_text = if had_tool_calls && !last_turn_text.trim().is_empty() {
        last_turn_text
    } else {
        all_text.clone()
    };

    Ok(HarnessResponse {
        final_text,
        all_text,
        content_blocks,
        usage,
    })
}

/// Strip `<thinking>...</thinking>` blocks that some models emit as plain text
/// instead of using the structured thinking protocol.
fn strip_thinking_tags(text: &str) -> String {
    let mut result = text.to_string();
    while let Some(start) = result.find("<thinking>") {
        if let Some(end_offset) = result[start..].find("</thinking>") {
            result.replace_range(start..start + end_offset + "</thinking>".len(), "");
        } else {
            break;
        }
    }
    result.trim().to_string()
}

/// Extract the final meaningful output from a multi-turn agentic response.
///
/// If the output ends with a fenced code block, return its contents (strips
/// the wrapping fences). Otherwise return the full trimmed text.
fn extract_final_output(raw: &str) -> String {
    let trimmed = raw.trim();

    if let Some(last_fence_start) = trimmed.rfind("\n```") {
        let before_close = &trimmed[..last_fence_start];
        if let Some(open_pos) = before_close.rfind("```") {
            let inside_start = before_close[open_pos + 3..]
                .find('\n')
                .map(|i| open_pos + 3 + i + 1)
                .unwrap_or(open_pos + 3);
            let block = before_close[inside_start..].trim();
            if !block.is_empty() {
                return block.to_string();
            }
        }
    }

    trimmed.to_string()
}

/// Attempt to recover output from content blocks when the output file is
/// missing and the conversation text is too short. Looks for `write_file`
/// tool calls and returns the largest content payload, since the agent may
/// have tried to write the file but the tool call failed.
fn synthesize_output_from_blocks(blocks: &[serde_json::Value]) -> Option<String> {
    // Tier 1: find the largest write_file call that has actual content.
    let mut best_write: Option<String> = None;
    for block in blocks {
        let is_write = block.get("type").and_then(|t| t.as_str()) == Some("tool_use")
            && block
                .get("name")
                .and_then(|n| n.as_str())
                .map(|n| n == "write_file" || n == "write")
                .unwrap_or(false);
        if !is_write {
            continue;
        }
        let content = block
            .get("input")
            .and_then(|inp| {
                inp.get("content")
                    .or_else(|| inp.get("contents"))
                    .or_else(|| inp.get("text"))
            })
            .and_then(|v| v.as_str());
        if let Some(c) = content {
            if c.len() > best_write.as_ref().map_or(0, |b| b.len()) {
                best_write = Some(c.to_string());
            }
        }
    }
    if let Some(ref w) = best_write {
        if w.len() > 200 {
            return best_write;
        }
    }

    // Tier 2: concatenate substantial results from successful tool calls.
    // When write_file calls were all truncated by MaxTokens, the actual research
    // data lives in tool_result blocks from run_command and similar tools.
    let skip_tools: &[&str] = &[
        "write_file", "write", "read_file", "list_files", "find_files", "edit_file",
    ];
    let mut tool_outputs: Vec<&str> = Vec::new();
    for block in blocks {
        if block.get("type").and_then(|t| t.as_str()) != Some("tool_result") {
            continue;
        }
        if block.get("is_error").and_then(|e| e.as_bool()).unwrap_or(false) {
            continue;
        }
        let name = block.get("name").and_then(|n| n.as_str()).unwrap_or("");
        if skip_tools.contains(&name) {
            continue;
        }
        if let Some(result) = block.get("result").and_then(|r| r.as_str()) {
            if result.len() > 200 {
                tool_outputs.push(result);
            }
        }
    }
    if !tool_outputs.is_empty() {
        let combined = tool_outputs.join("\n\n---\n\n");
        if combined.len() > 500 {
            return Some(combined);
        }
    }

    None
}

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
