use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use tokio::sync::broadcast;
use tracing::{info, warn};

use aura_os_agents::AgentService;
use aura_os_core::{
    ArtifactType, ProcessArtifact, ProcessArtifactId, ProcessEvent, ProcessEventId,
    ProcessEventStatus, ProcessNode, ProcessNodeId, ProcessNodeType, ProcessRun, ProcessRunId,
    ProcessRunStatus, ProcessRunTrigger, ProcessId,
};
use aura_os_link::{
    HarnessInbound, HarnessLink, HarnessOutbound, SessionConfig, SessionUsage, UserMessage,
};
use aura_os_store::RocksStore;

use crate::error::ProcessError;
use crate::process_store::ProcessStore;

const DEFAULT_MAX_TURNS: u32 = 25;
const DEFAULT_HARNESS_TIMEOUT_SECS: u64 = 300; // 5 minutes

#[derive(Debug, Clone, Default)]
struct NodeTokenUsage {
    input_tokens: u64,
    output_tokens: u64,
    model: Option<String>,
}

struct DeltaForwarder<'a> {
    broadcast: &'a broadcast::Sender<serde_json::Value>,
    process_id: ProcessId,
    run_id: ProcessRunId,
    node_id: ProcessNodeId,
}

impl DeltaForwarder<'_> {
    fn forward(&self, text: &str) {
        let _ = self.broadcast.send(serde_json::json!({
            "type": "process_node_output_delta",
            "process_id": self.process_id.to_string(),
            "run_id": self.run_id.to_string(),
            "node_id": self.node_id.to_string(),
            "text": text,
        }));
    }
}

fn estimate_cost_usd(input_tokens: u64, output_tokens: u64) -> f64 {
    let input_cost = (input_tokens as f64) * 3.0 / 1_000_000.0;
    let output_cost = (output_tokens as f64) * 15.0 / 1_000_000.0;
    input_cost + output_cost
}

const PROCESS_EXECUTION_PREAMBLE: &str = "\
You are executing a step in an automated workflow process. \
Your text output is passed DIRECTLY to downstream nodes as structured data. \
Output ONLY the final result. No planning, no narration, no \"let me try\" preamble. \
If you use tools, work silently and return only the finished product. \
Never describe your process, failed attempts, or intermediate steps in text output.";

pub struct ProcessExecutor {
    store: Arc<ProcessStore>,
    event_broadcast: broadcast::Sender<serde_json::Value>,
    harness: Arc<dyn HarnessLink>,
    data_dir: PathBuf,
    rocks_store: Arc<RocksStore>,
    agent_service: Arc<AgentService>,
}

impl ProcessExecutor {
    pub fn new(
        store: Arc<ProcessStore>,
        event_broadcast: broadcast::Sender<serde_json::Value>,
        harness: Arc<dyn HarnessLink>,
        data_dir: PathBuf,
        rocks_store: Arc<RocksStore>,
        agent_service: Arc<AgentService>,
    ) -> Self {
        Self {
            store,
            event_broadcast,
            harness,
            data_dir,
            rocks_store,
            agent_service,
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
        let agent_service = self.agent_service.clone();
        let run_clone = run.clone();
        tokio::spawn(async move {
            if let Err(e) = execute_run(
                &store,
                &broadcast,
                &run_clone,
                &*harness,
                &data_dir,
                &rocks_store,
                &agent_service,
            )
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

#[allow(clippy::too_many_arguments)]
async fn execute_run(
    store: &ProcessStore,
    broadcast: &broadcast::Sender<serde_json::Value>,
    run: &ProcessRun,
    harness: &dyn HarnessLink,
    data_dir: &Path,
    rocks_store: &RocksStore,
    agent_service: &AgentService,
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
            record_event(store, broadcast, run, node, ProcessEventStatus::Skipped, "", "", None, None, None);
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

        // ── broadcast running status ───────────────────────────────────
        let node_started_at = Utc::now();
        let _ = broadcast.send(serde_json::json!({
            "type": "process_node_executed",
            "process_id": run.process_id.to_string(),
            "run_id": run.run_id.to_string(),
            "node_id": node_id.to_string(),
            "node_type": format!("{:?}", node.node_type),
            "status": "running",
        }));

        // ── execute node ───────────────────────────────────────────────
        let fwd = DeltaForwarder {
            broadcast,
            process_id: run.process_id,
            run_id: run.run_id,
            node_id,
        };
        let result: Result<(String, Option<NodeTokenUsage>), ProcessError> = match node.node_type {
            ProcessNodeType::Ignition => execute_ignition(node).map(|s| (s, None)),
            ProcessNodeType::Action => {
                execute_action(node, &upstream_context, harness, jwt.as_deref(), agent_service, Some(&fwd)).await
            }
            ProcessNodeType::Condition => {
                execute_condition(node, &upstream_context, harness, jwt.as_deref(), agent_service, Some(&fwd)).await
            }
            ProcessNodeType::Delay => execute_delay(node).await.map(|s| (s, None)),
            ProcessNodeType::Artifact => {
                execute_artifact(
                    node,
                    &upstream_context,
                    &run.process_id,
                    &run.run_id,
                    data_dir,
                    store,
                    harness,
                    jwt.as_deref(),
                    agent_service,
                    Some(&fwd),
                )
                .await
            }
            ProcessNodeType::Merge => Ok((upstream_context.clone(), None)),
        };

        let node_completed_at = Utc::now();

        match result {
            Ok((output, token_usage)) => {
                if node.node_type == ProcessNodeType::Condition {
                    condition_results.insert(node_id, parse_condition_result(&output));
                }

                if let Some(ref usage) = token_usage {
                    run_input_tokens += usage.input_tokens;
                    run_output_tokens += usage.output_tokens;
                }

                let event_output = match node.node_type {
                    ProcessNodeType::Merge => {
                        format!("Merged {} upstream output(s) ({} bytes)", incoming.len(), output.len())
                    }
                    ProcessNodeType::Artifact => {
                        let name = node.config.get("artifact_name")
                            .and_then(|v| v.as_str())
                            .unwrap_or(&node.label);
                        format!("Artifact saved: {} ({} bytes)", name, output.len())
                    }
                    _ => output.clone(),
                };

                record_event(
                    store,
                    broadcast,
                    run,
                    node,
                    ProcessEventStatus::Completed,
                    &upstream_context,
                    &event_output,
                    Some(node_started_at),
                    Some(node_completed_at),
                    token_usage.as_ref(),
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
                    Some(node_started_at),
                    Some(node_completed_at),
                    None,
                );

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

    current_run.status = ProcessRunStatus::Completed;
    current_run.completed_at = Some(Utc::now());
    current_run.total_input_tokens = Some(run_input_tokens);
    current_run.total_output_tokens = Some(run_output_tokens);
    current_run.cost_usd = Some(estimate_cost_usd(run_input_tokens, run_output_tokens));
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
}

// ---------------------------------------------------------------------------
// Agent resolution helper
// ---------------------------------------------------------------------------

/// Build a SessionConfig enriched with the agent's system prompt, name, and
/// node-level overrides (model, max_turns). Falls back gracefully if the agent
/// cannot be loaded.
fn build_session_config(
    node: &ProcessNode,
    token: Option<&str>,
    agent_service: &AgentService,
    system_prompt_override: Option<String>,
) -> SessionConfig {
    let agent_id_str = node.agent_id.as_ref().map(|id| id.to_string());

    let (system_prompt, agent_name) = match node.agent_id.as_ref() {
        Some(aid) => match agent_service.get_agent_local(aid) {
            Ok(agent) => {
                let prompt = system_prompt_override.unwrap_or_else(|| {
                    if agent.system_prompt.is_empty() {
                        PROCESS_EXECUTION_PREAMBLE.to_string()
                    } else {
                        format!("{}\n\n{}", PROCESS_EXECUTION_PREAMBLE, agent.system_prompt)
                    }
                });
                (Some(prompt), Some(agent.name))
            }
            Err(e) => {
                warn!(agent_id = %aid, error = %e, "Could not load agent for process node; using defaults");
                (
                    Some(PROCESS_EXECUTION_PREAMBLE.to_string()),
                    None,
                )
            }
        },
        None => (Some(PROCESS_EXECUTION_PREAMBLE.to_string()), None),
    };

    let model = node
        .config
        .get("model")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let max_turns = node
        .config
        .get("max_turns")
        .and_then(|v| v.as_u64())
        .map(|n| n as u32)
        .or(Some(DEFAULT_MAX_TURNS));

    SessionConfig {
        system_prompt,
        agent_id: agent_id_str,
        agent_name,
        model,
        max_turns,
        token: token.map(|s| s.to_string()),
        ..Default::default()
    }
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
    agent_service: &AgentService,
    forwarder: Option<&DeltaForwarder<'_>>,
) -> Result<(String, Option<NodeTokenUsage>), ProcessError> {
    let timeout_secs = node
        .config
        .get("timeout_seconds")
        .and_then(|v| v.as_u64())
        .unwrap_or(DEFAULT_HARNESS_TIMEOUT_SECS);

    let config = build_session_config(node, token, agent_service, None);

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

    let (raw_text, usage) = collect_harness_response(&session.events_tx, timeout_secs, forwarder).await?;

    if let Err(e) = harness.close_session(&session.session_id).await {
        warn!(session_id = %session.session_id, error = %e, "Failed to close harness session");
    }

    let text = extract_final_output(&raw_text);

    let token_usage = usage.map(|u| NodeTokenUsage {
        input_tokens: u.cumulative_input_tokens,
        output_tokens: u.cumulative_output_tokens,
        model: Some(u.model),
    });

    Ok((text, token_usage))
}

async fn execute_condition(
    node: &ProcessNode,
    upstream_context: &str,
    harness: &dyn HarnessLink,
    token: Option<&str>,
    agent_service: &AgentService,
    forwarder: Option<&DeltaForwarder<'_>>,
) -> Result<(String, Option<NodeTokenUsage>), ProcessError> {
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
    let config = build_session_config(node, token, agent_service, condition_system);

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

    let (text, usage) = collect_harness_response(&session.events_tx, 60, forwarder).await?;

    if let Err(e) = harness.close_session(&session.session_id).await {
        warn!(session_id = %session.session_id, error = %e, "Failed to close condition session");
    }

    let token_usage = usage.map(|u| NodeTokenUsage {
        input_tokens: u.cumulative_input_tokens,
        output_tokens: u.cumulative_output_tokens,
        model: Some(u.model),
    });

    Ok((text, token_usage))
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

const ARTIFACT_REFINEMENT_PREAMBLE: &str = "\
You are producing a structured artifact in an automated workflow. \
You will receive context from previous steps and instructions for how to \
refine or transform that context into the final artifact. \
Output ONLY the refined result. No narration, no commentary, no markdown \
wrappers unless the instructions explicitly request them.";

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
    forwarder: Option<&DeltaForwarder<'_>>,
) -> Result<(String, Option<NodeTokenUsage>), ProcessError> {
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
    let filename = format!("{safe_name}.md");

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

    let raw_content = match (data_content.as_deref(), upstream_context.is_empty()) {
        (Some(data), true) => data.to_string(),
        (Some(data), false) => format!("{upstream_context}\n\n---\n\n{data}"),
        (None, _) => upstream_context.to_string(),
    };

    let (content, token_usage) = if !node.prompt.trim().is_empty() && !raw_content.is_empty() {
        let timeout_secs = node
            .config
            .get("timeout_seconds")
            .and_then(|v| v.as_u64())
            .unwrap_or(DEFAULT_HARNESS_TIMEOUT_SECS);

        let session_config = build_session_config(
            node,
            token,
            agent_service,
            Some(ARTIFACT_REFINEMENT_PREAMBLE.to_string()),
        );

        let session = harness
            .open_session(session_config)
            .await
            .map_err(|e| ProcessError::Execution(format!("Failed to open artifact harness session: {e}")))?;

        let refinement_prompt = format!(
            "## Input from previous steps\n\n{raw_content}\n\n## Instructions\n\n{}",
            node.prompt
        );

        session
            .commands_tx
            .send(HarnessInbound::UserMessage(UserMessage {
                content: refinement_prompt,
                tool_hints: None,
            }))
            .map_err(|e| ProcessError::Execution(format!("Failed to send artifact message: {e}")))?;

        let (raw_text, usage) = collect_harness_response(&session.events_tx, timeout_secs, forwarder).await?;

        if let Err(e) = harness.close_session(&session.session_id).await {
            warn!(session_id = %session.session_id, error = %e, "Failed to close artifact harness session");
        }

        let refined = extract_final_output(&raw_text);
        let tu = usage.map(|u| NodeTokenUsage {
            input_tokens: u.cumulative_input_tokens,
            output_tokens: u.cumulative_output_tokens,
            model: Some(u.model),
        });
        (refined, tu)
    } else {
        (raw_content, None)
    };

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

    Ok((content, token_usage))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Collect the harness response, keeping only text from the final turn.
///
/// In multi-turn agentic sessions the model emits narration between tool calls.
/// We track `ToolUseStart` / `ToolResult` events as turn boundaries and reset
/// the text buffer after each `ToolResult`, so the returned string contains
/// only the model's output from its last turn (the actual answer).  The full
/// accumulated text is kept as a fallback in case the final segment is empty.
async fn collect_harness_response(
    events_tx: &broadcast::Sender<HarnessOutbound>,
    timeout_secs: u64,
    forwarder: Option<&DeltaForwarder<'_>>,
) -> Result<(String, Option<SessionUsage>), ProcessError> {
    let mut rx = events_tx.subscribe();
    let mut full_output = String::new();
    let mut last_turn_output = String::new();
    let mut in_tool_call = false;
    let mut had_tool_calls = false;
    let mut usage: Option<SessionUsage> = None;
    let deadline = Duration::from_secs(timeout_secs);

    let collect = async {
        loop {
            match rx.recv().await {
                Ok(HarnessOutbound::TextDelta(delta)) => {
                    if let Some(fwd) = forwarder {
                        fwd.forward(&delta.text);
                    }
                    full_output.push_str(&delta.text);
                    if !in_tool_call {
                        last_turn_output.push_str(&delta.text);
                    }
                }
                Ok(HarnessOutbound::ToolUseStart(_)) => {
                    in_tool_call = true;
                    had_tool_calls = true;
                }
                Ok(HarnessOutbound::ToolResult(_)) => {
                    in_tool_call = false;
                    last_turn_output.clear();
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
                    if full_output.is_empty() {
                        return Err(ProcessError::Execution(
                            "Harness connection closed before producing any output".into(),
                        ));
                    }
                    warn!(
                        bytes = full_output.len(),
                        "Harness connection closed before AssistantMessageEnd; returning partial output"
                    );
                    break;
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
            if full_output.is_empty() {
                return Err(ProcessError::Execution(format!(
                    "Harness timed out after {timeout_secs}s without producing output"
                )));
            }
            warn!(
                bytes = full_output.len(),
                timeout_secs,
                "Harness timed out; returning partial output"
            );
        }
    };

    let text = if had_tool_calls && !last_turn_output.trim().is_empty() {
        last_turn_output
    } else {
        full_output
    };

    Ok((text, usage))
}

/// Extract the final meaningful output from a multi-turn agentic response.
///
/// During agentic loops the model often emits planning / narration text between
/// tool calls. This function tries to return only the final result:
///   1. If the output ends with a fenced code block, return its contents.
///   2. Otherwise if a `---` separator is present, return the text after the
///      last separator (the model's final output section).
///   3. Fall back to the full text when neither heuristic matches.
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

    if let Some(sep_pos) = trimmed.rfind("\n---\n") {
        let after = trimmed[sep_pos + 5..].trim();
        if !after.is_empty() {
            return after.to_string();
        }
    }

    trimmed.to_string()
}

fn parse_condition_result(output: &str) -> bool {
    let normalized = output.trim().to_lowercase();
    normalized.contains("true") && !normalized.contains("false")
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

fn record_event(
    store: &ProcessStore,
    broadcast: &broadcast::Sender<serde_json::Value>,
    run: &ProcessRun,
    node: &ProcessNode,
    status: ProcessEventStatus,
    input: &str,
    output: &str,
    started_at: Option<DateTime<Utc>>,
    completed_at: Option<DateTime<Utc>>,
    token_usage: Option<&NodeTokenUsage>,
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
        started_at: started_at.unwrap_or(now),
        completed_at: Some(completed_at.unwrap_or(now)),
        input_tokens: token_usage.map(|u| u.input_tokens),
        output_tokens: token_usage.map(|u| u.output_tokens),
        model: token_usage.and_then(|u| u.model.clone()),
    };

    if let Err(e) = store.save_event(&event) {
        warn!(event_id = %event.event_id, error = %e, "Failed to save process event");
    }

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
