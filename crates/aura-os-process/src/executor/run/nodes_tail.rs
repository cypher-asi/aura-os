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

    let artifacts = store.list_artifacts_for_process(&source_process_id).ok()?;

    let matched = if let Some(name) = artifact_name {
        artifacts.into_iter().rfind(|a| a.name == name)
    } else {
        artifacts.into_iter().next_back()
    };

    let artifact = matched?;
    let file_path = data_dir.join(&artifact.file_path);
    tokio::fs::read_to_string(&file_path)
        .await
        .ok()
        .map(|content| truncate_for_artifact_context(&content))
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
    let current = store
        .list_runs(&run.process_id)
        .ok()
        .and_then(|runs| runs.into_iter().find(|r| r.run_id == run.run_id));
    let dominated = current.as_ref().is_none_or(|r| {
        matches!(
            r.status,
            ProcessRunStatus::Pending | ProcessRunStatus::Running
        )
    });
    if !dominated {
        return;
    }

    let mut failed_run = current.unwrap_or_else(|| run.clone());
    failed_run.status = ProcessRunStatus::Failed;
    failed_run.error = Some(error.to_string());
    failed_run.completed_at = Some(Utc::now());
    let _ = store.save_run(&failed_run);

    emit_process_event(
        store,
        broadcast,
        serde_json::json!({
            "type": "process_run_failed",
            "process_id": run.process_id.to_string(),
            "run_id": run.run_id.to_string(),
            "error": error,
            "total_input_tokens": failed_run.total_input_tokens,
            "total_output_tokens": failed_run.total_output_tokens,
            "cost_usd": failed_run.cost_usd,
        }),
    );
}
