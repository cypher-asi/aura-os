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

/// If the run is still active (Pending/Running), mark it as Failed with the
/// given error and broadcast `process_run_failed`. This is a safety net for
/// early errors in `execute_run` that exit before the per-node error handler.
async fn mark_run_failed_if_active(
    executor: &ProcessExecutor,
    broadcast: &broadcast::Sender<serde_json::Value>,
    run: &ProcessRun,
    error: &str,
    auth_jwt: Option<&str>,
) {
    let current = executor.tracked_run(&run.run_id);
    let dominated = current.as_ref().is_some_and(|r| {
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
    if let Some(target) = process_storage_sync_client(executor.storage_client.as_ref(), auth_jwt) {
        if let Err(sync_error) = sync_run_to_storage(&target, &failed_run, false).await {
            warn!(
                run_id = %failed_run.run_id,
                error = %sync_error,
                "Failed to mark process run as failed in aura-storage"
            );
        }
    }
    executor.forget_run(&failed_run);

    emit_process_event(
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
