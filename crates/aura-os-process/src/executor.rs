use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use tokio::sync::broadcast;
use tracing::{info, warn};

use aura_os_agents::AgentService;
use aura_os_core::{
    Agent, ArtifactType, ProcessArtifact, ProcessArtifactId, ProcessEvent, ProcessEventId,
    ProcessEventStatus, ProcessNode, ProcessNodeId, ProcessNodeType, ProcessRun, ProcessRunId,
    ProcessRunStatus, ProcessRunTrigger, ProcessId,
};
use aura_os_link::{
    HarnessInbound, HarnessLink, HarnessOutbound, SessionConfig, SessionProviderConfig,
    SessionUsage, UserMessage,
};
use aura_os_orgs::OrgService;
use aura_os_store::RocksStore;

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
    output: String,
    token_usage: Option<NodeTokenUsage>,
    content_blocks: Option<Vec<serde_json::Value>>,
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
CRITICAL: Your final text response is the ONLY data passed to downstream nodes. \
Tool outputs and file writes do NOT flow downstream — only your text does. \
After using tools, you MUST repeat all collected data in your final text response. \
Output ONLY the final result. No planning, no narration, no \"let me try\" preamble. \
Never describe your process — just output the finished product as text.\n\n\
NEVER use write_file to produce your final output. Data inside write_file tool \
inputs is invisible to downstream nodes. Always emit your result as plain text in \
your assistant message. If your output is large (JSON, reports, etc.), output it \
directly as text — do NOT try to save it to a file.\n\n\
TOOL-FAILURE RULE: If the majority of your tool calls fail or return errors, \
STOP immediately and output a structured error report listing each failed tool call, \
the error, and what data is missing. Do NOT fabricate results, echo back your search \
queries, or produce placeholder output. Downstream nodes depend on real data — passing \
garbage forward is worse than reporting an honest failure.";

fn output_file_addendum(output_file: &str) -> String {
    format!(
        "\n\nOUTPUT FILE: Write your results to `{output_file}` in the working directory. \
         You may write incrementally as you collect data. This file is automatically \
         read after your session ends and passed to downstream nodes. You do NOT need \
         to repeat its contents in your text response. Write each result to disk as \
         you go so partial progress survives timeouts."
    )
}

pub struct ProcessExecutor {
    store: Arc<ProcessStore>,
    event_broadcast: broadcast::Sender<serde_json::Value>,
    harness: Arc<dyn HarnessLink>,
    data_dir: PathBuf,
    rocks_store: Arc<RocksStore>,
    agent_service: Arc<AgentService>,
    org_service: Arc<OrgService>,
}

impl ProcessExecutor {
    pub fn new(
        store: Arc<ProcessStore>,
        event_broadcast: broadcast::Sender<serde_json::Value>,
        harness: Arc<dyn HarnessLink>,
        data_dir: PathBuf,
        rocks_store: Arc<RocksStore>,
        agent_service: Arc<AgentService>,
        org_service: Arc<OrgService>,
    ) -> Self {
        Self {
            store,
            event_broadcast,
            harness,
            data_dir,
            rocks_store,
            agent_service,
            org_service,
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
        let org_service = self.org_service.clone();
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
                &org_service,
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
    org_service: &OrgService,
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

    let workspace_dir = data_dir
        .join("process-workspaces")
        .join(run.process_id.to_string())
        .join(run.run_id.to_string());
    tokio::fs::create_dir_all(&workspace_dir)
        .await
        .map_err(|e| ProcessError::Execution(format!("Failed to create process workspace: {e}")))?;
    let workspace_path = workspace_dir.to_string_lossy().to_string();

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
            record_event(store, broadcast, run, node, ProcessEventStatus::Skipped, "", "", None, None, None, None);
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
        let running_event_id = record_event(
            store, broadcast, run, node,
            ProcessEventStatus::Running,
            &upstream_context, "",
            Some(node_started_at), None,
            None, None,
        );

        // ── check for pinned output (skip execution) ──────────────────
        if let Some(pinned) = node.config.get("pinned_output").and_then(|v| v.as_str()) {
            if let Some(ref rid) = running_event_id {
                let _ = store.delete_event(rid);
            }
            record_event(
                store, broadcast, run, node,
                ProcessEventStatus::Completed,
                &upstream_context, pinned,
                Some(node_started_at), Some(Utc::now()),
                None, None,
            );
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
        let result: Result<NodeResult, ProcessError> = match node.node_type {
            ProcessNodeType::Ignition => execute_ignition(node).map(|s| NodeResult { output: s, token_usage: None, content_blocks: None }),
            ProcessNodeType::Action => {
                execute_action(node, &upstream_context, harness, jwt.as_deref(), agent_service, org_service, Some(&fwd), Some(&workspace_path)).await
            }
            ProcessNodeType::Condition => {
                execute_condition(node, &upstream_context, harness, jwt.as_deref(), agent_service, org_service, Some(&fwd), Some(&workspace_path)).await
            }
            ProcessNodeType::Delay => execute_delay(node).await.map(|s| NodeResult { output: s, token_usage: None, content_blocks: None }),
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
                    org_service,
                    Some(&fwd),
                    Some(&workspace_path),
                )
                .await
            }
            ProcessNodeType::Merge => Ok(NodeResult { output: upstream_context.clone(), token_usage: None, content_blocks: None }),
        };

        let node_completed_at = Utc::now();

        match result {
            Ok(node_result) => {
                if node.node_type == ProcessNodeType::Condition {
                    condition_results.insert(node_id, parse_condition_result(&node_result.output));
                }

                if let Some(ref usage) = node_result.token_usage {
                    run_input_tokens += usage.input_tokens;
                    run_output_tokens += usage.output_tokens;
                }

                let event_output = match node.node_type {
                    ProcessNodeType::Merge => {
                        format!("Merged {} upstream output(s) ({} bytes)", incoming.len(), node_result.output.len())
                    }
                    ProcessNodeType::Artifact => {
                        let name = node.config.get("artifact_name")
                            .and_then(|v| v.as_str())
                            .unwrap_or(&node.label);
                        format!("Artifact saved: {} ({} bytes)", name, node_result.output.len())
                    }
                    _ => node_result.output.clone(),
                };

                if let Some(ref rid) = running_event_id {
                    let _ = store.delete_event(rid);
                }
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
                    node_result.token_usage.as_ref(),
                    node_result.content_blocks.as_deref(),
                );
                node_outputs.insert(node_id, node_result.output);
            }
            Err(e) => {
                let err_msg = e.to_string();
                if let Some(ref rid) = running_event_id {
                    let _ = store.delete_event(rid);
                }
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
                        if agent.system_prompt.is_empty() {
                            PROCESS_EXECUTION_PREAMBLE.to_string()
                        } else {
                            format!("{}\n\n{}", PROCESS_EXECUTION_PREAMBLE, agent.system_prompt)
                        }
                    });
                    let ri = resolve_agent_integration(&agent, org_service);
                    (Some(prompt), Some(agent.name.clone()), ri, Some(agent))
                }
                Err(e) => {
                    warn!(agent_id = %aid, error = %e, "Could not load agent for process node; using defaults");
                    (
                        Some(PROCESS_EXECUTION_PREAMBLE.to_string()),
                        None,
                        None,
                        None,
                    )
                }
            },
            None => (
                Some(PROCESS_EXECUTION_PREAMBLE.to_string()),
                None,
                None,
                None,
            ),
        };

    let model = effective_model(node, loaded_agent.as_ref(), resolved_integration.as_ref());
    let provider_config = resolved_integration
        .as_ref()
        .and_then(|ri| build_provider_config(ri, model.as_deref()));

    let max_turns = node
        .config
        .get("max_turns")
        .and_then(|v| v.as_u64())
        .map(|n| n as u32);

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

    let mut config = build_session_config(node, token, agent_service, org_service, None, project_path);

    if let Some(ref mut sp) = config.system_prompt {
        sp.push_str(&output_file_addendum(&output_file));
    }

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
            attachments: None,
        }))
        .map_err(|e| ProcessError::Execution(format!("Failed to send message: {e}")))?;

    let resp = collect_harness_response(&session.events_tx, timeout_secs, forwarder).await?;

    if let Err(e) = harness.close_session(&session.session_id).await {
        warn!(session_id = %session.session_id, error = %e, "Failed to close harness session");
    }

    // --- determine downstream output ---
    let file_content = {
        let path = Path::new(project_path.unwrap_or(".")).join(&output_file);
        match tokio::fs::read_to_string(&path).await {
            Ok(content) if !content.trim().is_empty() => {
                info!(path = %path.display(), bytes = content.len(), "Read designated output file");
                Some(content)
            }
            Ok(_) => None,
            Err(_) => None,
        }
    };

    let final_text = strip_thinking_tags(resp.final_text.trim());

    let output = if let Some(fc) = file_content {
        fc
    } else if !final_text.is_empty() {
        final_text
    } else {
        return Err(ProcessError::Execution(
            "Action node produced no output: the designated output file is \
             missing/empty and the model's final text response is empty. \
             Check the node's prompt and tool access."
                .into(),
        ));
    };

    let token_usage = resp.usage.map(|u| NodeTokenUsage {
        input_tokens: u.cumulative_input_tokens,
        output_tokens: u.cumulative_output_tokens,
        model: Some(u.model),
    });

    Ok(NodeResult {
        output,
        token_usage,
        content_blocks: Some(resp.content_blocks),
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
    let config = build_session_config(node, token, agent_service, org_service, condition_system, project_path);

    let session = harness
        .open_session(config)
        .await
        .map_err(|e| ProcessError::Execution(format!("Failed to open condition session: {e}")))?;

    session
        .commands_tx
        .send(HarnessInbound::UserMessage(UserMessage {
            content: evaluation_prompt,
            tool_hints: None,
            attachments: None,
        }))
        .map_err(|e| ProcessError::Execution(format!("Failed to send condition message: {e}")))?;

    let resp = collect_harness_response(&session.events_tx, 60, forwarder).await?;

    if let Err(e) = harness.close_session(&session.session_id).await {
        warn!(session_id = %session.session_id, error = %e, "Failed to close condition session");
    }

    let token_usage = resp.usage.map(|u| NodeTokenUsage {
        input_tokens: u.cumulative_input_tokens,
        output_tokens: u.cumulative_output_tokens,
        model: Some(u.model),
    });

    Ok(NodeResult {
        output: resp.final_text,
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

    let mut session_config = build_session_config(
        node,
        token,
        agent_service,
        org_service,
        Some(preamble.to_string()),
        project_path,
    );
    let artifact_max_turns = cfg
        .get("max_turns")
        .and_then(|v| v.as_u64())
        .map(|v| v as u32)
        .unwrap_or(3);
    session_config.max_turns = Some(artifact_max_turns);

    let artifact_output_file = cfg
        .get("output_file")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "output.md".to_string());

    if let Some(ref mut sp) = session_config.system_prompt {
        sp.push_str(&output_file_addendum(&artifact_output_file));
    }

    let session = harness
        .open_session(session_config)
        .await
        .map_err(|e| ProcessError::Execution(format!("Failed to open artifact harness session: {e}")))?;

    session
        .commands_tx
        .send(HarnessInbound::UserMessage(UserMessage {
            content: user_message,
            tool_hints: None,
            attachments: None,
        }))
        .map_err(|e| ProcessError::Execution(format!("Failed to send artifact message: {e}")))?;

    let resp = collect_harness_response(&session.events_tx, timeout_secs, forwarder).await?;

    if let Err(e) = harness.close_session(&session.session_id).await {
        warn!(session_id = %session.session_id, error = %e, "Failed to close artifact harness session");
    }

    let file_content = {
        let path = Path::new(project_path.unwrap_or(".")).join(&artifact_output_file);
        match tokio::fs::read_to_string(&path).await {
            Ok(c) if !c.trim().is_empty() => {
                info!(path = %path.display(), bytes = c.len(), "Read artifact output file");
                Some(c)
            }
            _ => None,
        }
    };

    let content = if let Some(fc) = file_content {
        fc
    } else {
        let mut c = extract_final_output(&strip_thinking_tags(&resp.final_text));
        if c.is_empty() {
            c = extract_final_output(&strip_thinking_tags(&resp.full_text));
        }
        if c.is_empty() {
            return Err(ProcessError::Execution(
                "Artifact node produced empty output from harness".into(),
            ));
        }
        c
    };
    let token_usage = resp.usage.map(|u| NodeTokenUsage {
        input_tokens: u.cumulative_input_tokens,
        output_tokens: u.cumulative_output_tokens,
        model: Some(u.model),
    });
    let blocks = Some(resp.content_blocks);

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

    Ok(NodeResult {
        output: content,
        token_usage,
        content_blocks: blocks,
    })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

struct HarnessResponse {
    /// Text from the model's final turn only (after the last tool result).
    final_text: String,
    /// All text concatenated across every turn (fallback).
    #[allow(dead_code)]
    full_text: String,
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
    let mut full_text = String::new();
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
                    full_text.push_str(&delta.text);
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
                    if full_text.is_empty() {
                        return Err(ProcessError::Execution(
                            "Harness connection closed before producing any output".into(),
                        ));
                    }
                    warn!(
                        bytes = full_text.len(),
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
            if full_text.is_empty() {
                return Err(ProcessError::Execution(format!(
                    "Harness timed out after {timeout_secs}s without producing output"
                )));
            }
            warn!(
                bytes = full_text.len(),
                timeout_secs,
                "Harness timed out; returning partial output"
            );
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
        full_text.clone()
    };

    Ok(HarnessResponse {
        final_text,
        full_text,
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
    content_blocks: Option<&[serde_json::Value]>,
) -> Option<ProcessEventId> {
    let now = Utc::now();
    let event_id = ProcessEventId::new();
    let event = ProcessEvent {
        event_id,
        run_id: run.run_id,
        node_id: node.node_id,
        process_id: run.process_id,
        status,
        input_snapshot: input.to_string(),
        output: output.to_string(),
        started_at: started_at.unwrap_or(now),
        completed_at: if status == ProcessEventStatus::Running { None } else { Some(completed_at.unwrap_or(now)) },
        input_tokens: token_usage.map(|u| u.input_tokens),
        output_tokens: token_usage.map(|u| u.output_tokens),
        model: token_usage.and_then(|u| u.model.clone()),
        content_blocks: content_blocks.map(|b| b.to_vec()),
    };

    if let Err(e) = store.save_event(&event) {
        warn!(event_id = %event.event_id, error = %e, "Failed to save process event");
        return None;
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
    Some(event_id)
}
