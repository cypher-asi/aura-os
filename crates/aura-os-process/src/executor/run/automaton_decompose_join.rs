type DecomposedSubtaskJoinHandle =
    tokio::task::JoinHandle<Result<(String, u64, u64, Option<String>), ProcessError>>;

struct DecomposedJoinBroadcastIds<'a> {
    proj_str: &'a str,
    task_id: &'a str,
    pid_str: &'a str,
    rid_str: &'a str,
    nid_str: &'a str,
}

enum DecomposedSubtaskJoinPiece {
    Success {
        output: String,
        input_tokens: u64,
        output_tokens: u64,
        model: Option<String>,
    },
    Failure(String),
}

fn send_decomposed_join_text(
    broadcast: Option<&broadcast::Sender<serde_json::Value>>,
    ids: &DecomposedJoinBroadcastIds<'_>,
    message: &str,
) {
    if let Some(tx) = broadcast {
        send_process_text(
            tx,
            ids.proj_str,
            ids.task_id,
            ids.pid_str,
            ids.rid_str,
            ids.nid_str,
            message,
        );
    }
}

fn decomposed_join_failure_piece(
    broadcast: Option<&broadcast::Sender<serde_json::Value>>,
    ids: &DecomposedJoinBroadcastIds<'_>,
    idx: usize,
    task_title: &str,
    reason: &str,
) -> DecomposedSubtaskJoinPiece {
    let msg = format!("Sub-task #{} ({}) {}", idx + 1, task_title, reason);
    send_decomposed_join_text(broadcast, ids, &format!("\n--- {} ---\n", msg));
    DecomposedSubtaskJoinPiece::Failure(msg)
}

async fn await_decomposed_subtask_join(
    handle: DecomposedSubtaskJoinHandle,
    idx: usize,
    task_title: &str,
    total_subtasks: usize,
    broadcast: Option<&broadcast::Sender<serde_json::Value>>,
    ids: &DecomposedJoinBroadcastIds<'_>,
) -> DecomposedSubtaskJoinPiece {
    match handle.await {
        Ok(Ok((output, inp, out, model))) => {
            send_decomposed_join_text(
                broadcast,
                ids,
                &format!(
                    "\n--- Sub-task {}/{} completed: {} ({} bytes) ---\n",
                    idx + 1,
                    total_subtasks,
                    task_title,
                    output.len()
                ),
            );
            DecomposedSubtaskJoinPiece::Success {
                output,
                input_tokens: inp,
                output_tokens: out,
                model,
            }
        }
        Ok(Err(e)) => {
            decomposed_join_failure_piece(broadcast, ids, idx, task_title, &format!("failed: {e}"))
        }
        Err(e) => decomposed_join_failure_piece(
            broadcast,
            ids,
            idx,
            task_title,
            &format!("panicked: {e}"),
        ),
    }
}

struct DecomposedJoinAccum {
    merged_parts: Vec<String>,
    total_input_tokens: u64,
    total_output_tokens: u64,
    last_model: Option<String>,
    failures: Vec<String>,
}

fn fold_decomposed_join_pieces(pieces: Vec<DecomposedSubtaskJoinPiece>) -> DecomposedJoinAccum {
    let mut acc = DecomposedJoinAccum {
        merged_parts: Vec::with_capacity(pieces.len()),
        total_input_tokens: 0,
        total_output_tokens: 0,
        last_model: None,
        failures: Vec::new(),
    };
    for piece in pieces {
        match piece {
            DecomposedSubtaskJoinPiece::Success {
                output,
                input_tokens,
                output_tokens,
                model,
            } => {
                acc.total_input_tokens += input_tokens;
                acc.total_output_tokens += output_tokens;
                if model.is_some() {
                    acc.last_model = model;
                }
                acc.merged_parts.push(output);
            }
            DecomposedSubtaskJoinPiece::Failure(msg) => acc.failures.push(msg),
        }
    }
    acc
}

async fn persist_merged_decomposed_output(
    merged_output: &str,
    node: &ProcessNode,
    project_path: &str,
    process_id: &ProcessId,
    run_id: &ProcessRunId,
    storage_client: &StorageClient,
    token: Option<&str>,
) {
    let output_file = node
        .config
        .get("output_file")
        .and_then(|v| v.as_str())
        .unwrap_or("output.txt");
    let output_file_path = Path::new(project_path).join(output_file);
    if let Err(e) = tokio::fs::write(&output_file_path, merged_output.as_bytes()).await {
        warn!(node_id = %node.node_id, error = %e, "Failed to write merged output");
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
        name: output_file.to_string(),
        file_path: rel_path,
        size_bytes: merged_output.len() as u64,
        metadata: serde_json::json!({}),
        created_at: Utc::now(),
    };
    let target = process_storage_sync_target_from_client(storage_client, token);
    if let Some(target) = target {
        if let Err(e) = sync_artifact_to_storage(&target, &artifact).await {
            warn!(node_id = %node.node_id, error = %e, "Failed to save merged artifact");
        }
    } else {
        warn!(
            node_id = %node.node_id,
            "Skipping merged artifact persistence because no storage auth is available"
        );
    }
}

async fn gather_decomposed_join_pieces(
    handles: Vec<DecomposedSubtaskJoinHandle>,
    sub_tasks: &[SubTaskPlan],
    broadcast: Option<&broadcast::Sender<serde_json::Value>>,
    ids: &DecomposedJoinBroadcastIds<'_>,
) -> Vec<DecomposedSubtaskJoinPiece> {
    let total = sub_tasks.len();
    let mut pieces = Vec::with_capacity(handles.len());
    for (idx, handle) in handles.into_iter().enumerate() {
        let task_title = sub_tasks.get(idx).map(|t| t.title.as_str()).unwrap_or("?");
        pieces.push(
            await_decomposed_subtask_join(handle, idx, task_title, total, broadcast, ids).await,
        );
    }
    pieces
}

fn node_result_from_decomposed_join(acc: DecomposedJoinAccum) -> NodeResult {
    let merged_output = acc.merged_parts.join("\n\n---\n\n");
    let token_usage = if acc.total_input_tokens > 0 || acc.total_output_tokens > 0 {
        Some(NodeTokenUsage {
            input_tokens: acc.total_input_tokens,
            output_tokens: acc.total_output_tokens,
            model: acc.last_model,
        })
    } else {
        None
    };
    NodeResult {
        downstream_output: merged_output,
        display_output: None,
        token_usage,
        content_blocks: None,
    }
}

async fn join_decomposed_subtask_handles(
    handles: Vec<DecomposedSubtaskJoinHandle>,
    sub_tasks: &[SubTaskPlan],
    storage_client: &StorageClient,
    broadcast: Option<&broadcast::Sender<serde_json::Value>>,
    proj_str: &str,
    task_id: &str,
    pid_str: &str,
    rid_str: &str,
    nid_str: &str,
    node: &ProcessNode,
    project_path: &str,
    process_id: &ProcessId,
    run_id: &ProcessRunId,
    token: Option<&str>,
) -> Result<NodeResult, ProcessError> {
    let ids = DecomposedJoinBroadcastIds {
        proj_str,
        task_id,
        pid_str,
        rid_str,
        nid_str,
    };
    let pieces = gather_decomposed_join_pieces(handles, sub_tasks, broadcast, &ids).await;

    let acc = fold_decomposed_join_pieces(pieces);

    if !acc.failures.is_empty() {
        warn!(
            node_id = %node.node_id,
            failure_count = acc.failures.len(),
            total = sub_tasks.len(),
            "Some sub-tasks failed"
        );
    }

    let result = node_result_from_decomposed_join(acc);
    persist_merged_decomposed_output(
        &result.downstream_output,
        node,
        project_path,
        process_id,
        run_id,
        storage_client,
        token,
    )
    .await;

    Ok(result)
}
