const DEFAULT_HARNESS_TIMEOUT_SECS: u64 = 600; // 10 minutes
const DEFAULT_PROCESS_NODE_MODEL: &str = "claude-opus-4-6";

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

#[derive(Debug, Clone)]
struct ProcessNodeExecutionBinding {
    project_agent_id: String,
    model: String,
}

#[derive(Debug, Clone)]
struct ParentStreamMirrorContext {
    project_id: String,
    task_id: String,
    process_id: String,
    run_id: String,
    node_id: String,
    item_label: String,
    progress_state: Arc<Mutex<ParentProgressMirrorState>>,
}

#[derive(Debug, Clone, Default)]
struct ChildRunProgress {
    input_tokens: u64,
    output_tokens: u64,
    cost_usd: f64,
}

#[derive(Debug, Default)]
struct ParentProgressMirrorState {
    base_input_tokens: u64,
    base_output_tokens: u64,
    base_cost_usd: f64,
    child_runs: HashMap<String, ChildRunProgress>,
}

fn build_parent_mirrored_process_event(
    parent: &ParentStreamMirrorContext,
    child_run_id: &str,
    evt: &serde_json::Value,
    evt_type: &str,
) -> Option<serde_json::Value> {
    if !is_process_stream_forward_event(evt_type) {
        return None;
    }

    if evt.get("run_id").and_then(|v| v.as_str()) != Some(child_run_id) {
        return None;
    }

    let mut mirrored = evt.clone();
    let map = mirrored.as_object_mut()?;
    map.insert("project_id".into(), parent.project_id.clone().into());
    map.insert("task_id".into(), parent.task_id.clone().into());
    map.insert("process_id".into(), parent.process_id.clone().into());
    map.insert("run_id".into(), parent.run_id.clone().into());
    map.insert("node_id".into(), parent.node_id.clone().into());
    map.insert("child_run_id".into(), child_run_id.to_string().into());
    map.insert("sub_task".into(), parent.item_label.clone().into());
    let normalized = normalize_process_tool_type_field(evt_type);
    if normalized != evt_type {
        map.insert("type".into(), normalized.to_string().into());
    }
    Some(mirrored)
}

fn is_child_run_terminal_event(
    child_run_id: &str,
    evt: &serde_json::Value,
    evt_type: &str,
) -> bool {
    matches!(evt_type, "process_run_completed" | "process_run_failed")
        && evt.get("run_id").and_then(|v| v.as_str()) == Some(child_run_id)
}

fn emit_parent_progress_update(
    store: &ProcessStore,
    tx: &broadcast::Sender<serde_json::Value>,
    parent: &ParentStreamMirrorContext,
) {
    let state = parent
        .progress_state
        .lock()
        .expect("parent progress mirror state poisoned");
    let total_input_tokens = state.base_input_tokens
        + state
            .child_runs
            .values()
            .map(|usage| usage.input_tokens)
            .sum::<u64>();
    let total_output_tokens = state.base_output_tokens
        + state
            .child_runs
            .values()
            .map(|usage| usage.output_tokens)
            .sum::<u64>();
    let cost_usd = state.base_cost_usd
        + state
            .child_runs
            .values()
            .map(|usage| usage.cost_usd)
            .sum::<f64>();
    drop(state);

    emit_process_event(
        store,
        tx,
        serde_json::json!({
            "type": "process_run_progress",
            "project_id": parent.project_id,
            "task_id": parent.task_id,
            "process_id": parent.process_id,
            "run_id": parent.run_id,
            "node_id": parent.node_id,
            "total_input_tokens": total_input_tokens,
            "total_output_tokens": total_output_tokens,
            "cost_usd": cost_usd,
        }),
    );
}

#[derive(Debug, Clone, serde::Deserialize)]
struct SubTaskPlan {
    title: String,
    description: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ActionPlanMode {
    /// Follow the same conservative pattern as project builds:
    /// one planner, one executor, no decomposition unless explicitly enabled.
    SinglePath,
    /// Allow heuristic decomposition and optional LLM planning.
    Decompose,
}

fn resolve_action_plan_mode(config: &serde_json::Value) -> ActionPlanMode {
    let Some(mode) = config.get("plan_mode").and_then(|v| v.as_str()) else {
        return ActionPlanMode::SinglePath;
    };

    match mode.trim().to_ascii_lowercase().as_str() {
        "auto" | "on" | "llm" | "decompose" | "parallel" => ActionPlanMode::Decompose,
        _ => ActionPlanMode::SinglePath,
    }
}

fn resolve_output_max_chars(config: &serde_json::Value, key: &str) -> Option<usize> {
    config
        .get(key)
        .and_then(|value| value.as_u64())
        .map(|value| value as usize)
        .filter(|value| *value > 0)
}

fn compact_node_output(
    config: &serde_json::Value,
    content: &str,
    default_mode: OutputCompactionMode,
    max_chars_key: &str,
) -> String {
    let mode = parse_output_compaction_mode(
        config
            .get("output_compaction")
            .and_then(|value| value.as_str()),
        default_mode,
    );
    let max_chars = resolve_output_max_chars(config, max_chars_key)
        .or_else(|| resolve_output_max_chars(config, "max_output_chars"));
    compact_process_output(content, mode, max_chars)
}

fn resolve_foreach_item_projection(config: &serde_json::Value) -> Option<Vec<String>> {
    let raw = config.get("item_projection")?;

    let fields = match raw {
        serde_json::Value::Array(items) => items
            .iter()
            .filter_map(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>(),
        serde_json::Value::String(csv) => csv
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>(),
        _ => Vec::new(),
    };

    if fields.is_empty() {
        None
    } else {
        Some(fields)
    }
}

fn project_foreach_item_value(
    value: &serde_json::Value,
    item_projection: Option<&[String]>,
) -> serde_json::Value {
    let Some(fields) = item_projection else {
        return value.clone();
    };

    let Some(source) = value.as_object() else {
        return value.clone();
    };

    let projected = fields
        .iter()
        .filter_map(|field| {
            source
                .get(field)
                .cloned()
                .map(|value| (field.clone(), value))
        })
        .collect::<serde_json::Map<String, serde_json::Value>>();

    if projected.is_empty() {
        value.clone()
    } else {
        serde_json::Value::Object(projected)
    }
}

fn build_foreach_child_input(
    item_variable: &str,
    idx: usize,
    item: &str,
    prompt: &str,
    compact_input_framing: bool,
) -> String {
    if compact_input_framing {
        if prompt.is_empty() {
            format!("{item_variable}[{idx}]={item}")
        } else {
            format!("{item_variable}[{idx}]={item}\nTask:{prompt}")
        }
    } else if prompt.is_empty() {
        format!("## {item_variable} (#{idx})\n\n{item}")
    } else {
        format!("## {item_variable} (#{idx})\n\n{item}\n\n## Task\n\n{prompt}")
    }
}

fn single_sub_task(node: &ProcessNode, upstream_context: &str) -> SubTaskPlan {
    SubTaskPlan {
        title: node.label.clone(),
        description: format!("{}\n\nContext:\n{}", node.prompt, upstream_context),
    }
}

fn build_subtask_workspace(parent_workspace: &Path, sub_task_id: &str) -> PathBuf {
    parent_workspace.join("subtasks").join(sub_task_id)
}

fn merge_parallel_usage_totals(
    usage_totals: &Mutex<HashMap<String, NodeTokenUsage>>,
    sub_task_id: &str,
    usage: &serde_json::Value,
) -> (u64, u64, Option<String>) {
    let mut totals = usage_totals
        .lock()
        .expect("parallel sub-task usage mutex poisoned");
    let prev = totals.get(sub_task_id).cloned().unwrap_or_default();
    let (next_in, next_out, usage_model) =
        merge_usage_totals(usage, prev.input_tokens, prev.output_tokens);
    let model = usage_model.or(prev.model);
    totals.insert(
        sub_task_id.to_string(),
        NodeTokenUsage {
            input_tokens: next_in,
            output_tokens: next_out,
            model: model.clone(),
        },
    );
    let total_input = totals.values().map(|entry| entry.input_tokens).sum();
    let total_output = totals.values().map(|entry| entry.output_tokens).sum();
    (total_input, total_output, model)
}

async fn materialize_workspace_inputs(
    workspace_dir: &Path,
    inputs: &[(&str, &str, &str)],
) -> Result<Vec<(String, String)>, ProcessError> {
    let mut written = Vec::new();

    for (file_name, purpose, content) in inputs {
        if content.trim().is_empty() {
            continue;
        }

        let file_path = workspace_dir.join(file_name);
        tokio::fs::write(&file_path, content.as_bytes())
            .await
            .map_err(|e| {
                ProcessError::Execution(format!(
                    "Failed to write workspace input file {file_name}: {e}"
                ))
            })?;
        written.push(((*file_name).to_string(), (*purpose).to_string()));
    }

    if !written.is_empty() {
        let manifest = serde_json::json!({
            "files": written
                .iter()
                .map(|(file_name, purpose)| serde_json::json!({
                    "file_name": file_name,
                    "purpose": purpose,
                }))
                .collect::<Vec<_>>(),
        });
        let manifest_path = workspace_dir.join(".process-inputs.json");
        tokio::fs::write(&manifest_path, manifest.to_string().as_bytes())
            .await
            .map_err(|e| {
                ProcessError::Execution(format!(
                    "Failed to write workspace input manifest {}: {e}",
                    manifest_path.display()
                ))
            })?;
    }

    Ok(written)
}

fn build_workspace_instructions(output_file: &str, input_files: &[(String, String)]) -> String {
    let mut lines = vec![
        format!("Write your final deliverable to `{output_file}` in the workspace root."),
        "This file is used as the node's downstream output for the next process step.".to_string(),
        "Read the provided workspace input files before deciding the workspace has no input data."
            .to_string(),
        "Do NOT create project scaffolding (no Cargo.toml, package.json, etc.).".to_string(),
        "Use shell commands and write files directly.".to_string(),
    ];

    if !input_files.is_empty() {
        let listed = input_files
            .iter()
            .map(|(file_name, purpose)| format!("`{file_name}` ({purpose})"))
            .collect::<Vec<_>>()
            .join(", ");
        lines.push(format!("Input files available in the workspace: {listed}."));
    }

    lines.join("\n")
}

/// Forward a raw automaton event to the app broadcast, stamping it with
/// process-specific identifiers.  Only forwards streamable event types.
fn emit_process_event(
    store: &ProcessStore,
    tx: &broadcast::Sender<serde_json::Value>,
    payload: serde_json::Value,
) {
    let payload = sanitize_process_payload(payload);
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
                if matches!(
                    k.as_str(),
                    "project_id" | "task_id" | "process_id" | "run_id" | "node_id" | "sub_task"
                ) {
                    continue;
                }
                map.insert(k.clone(), val.clone());
            }
        }
    }
    if let Some(sub) = sub_task {
        v["sub_task"] = sub.into();
    }
    if let Some(t) = v
        .get("type")
        .and_then(|t| t.as_str())
        .map(|t| t.to_string())
    {
        let normalized = normalize_process_tool_type_field(t.as_str());
        if normalized != t.as_str() {
            v["type"] = normalized.to_string().into();
        }
    }
    if should_skip_streamed_process_event(&v) {
        return;
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
    emit_process_event(
        store,
        tx,
        serde_json::json!({
            "type": TEXT_DELTA,
            "text": text,
            "project_id": project_id,
            "task_id": task_id,
            "process_id": process_id,
            "run_id": run_id,
            "node_id": node_id,
        }),
    );
}
