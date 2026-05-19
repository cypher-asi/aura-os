//! Per-task live-output cache helpers (seed/append/usage drain, persist on terminal), plus test-pass evidence accumulation.

use aura_os_core::{AgentInstanceId, ProjectId};

use super::super::super::signals::{is_successful_test_run_event, recognized_test_runner_label};
use super::common::parse_task_key;
use crate::state::{AppState, CachedTaskOutput, TestPassEvidence};

pub(super) async fn append_task_output(
    state: &AppState,
    project_id: ProjectId,
    task_id: &str,
    text: &str,
) {
    let Some(key) = parse_task_key(project_id, task_id) else {
        return;
    };
    state
        .task_output_cache
        .lock()
        .await
        .entry(key)
        .or_default()
        .live_output
        .push_str(text);
}

pub(crate) async fn seed_task_output(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    task_id: &str,
) {
    let Some(key) = parse_task_key(project_id, task_id) else {
        return;
    };
    state
        .task_output_cache
        .lock()
        .await
        .entry(key)
        .or_insert_with(|| CachedTaskOutput {
            project_id: Some(project_id.to_string()),
            agent_instance_id: Some(agent_instance_id.to_string()),
            ..Default::default()
        });
}

pub(super) async fn update_usage_cache(
    state: &AppState,
    project_id: ProjectId,
    task_id: &str,
    event: &serde_json::Value,
) {
    let Some(key) = parse_task_key(project_id, task_id) else {
        return;
    };
    let usage = event.get("usage").unwrap_or(event);
    let mut cache = state.task_output_cache.lock().await;
    let entry = cache.entry(key).or_default();
    if let Some(model) = usage.get("model").and_then(|value| value.as_str()) {
        entry.model = Some(model.to_string());
    }
    if let Some(provider) = usage.get("provider").and_then(|value| value.as_str()) {
        entry.provider = Some(provider.to_string());
    }
    if let Some(input) = usage.get("input_tokens").and_then(|value| value.as_u64()) {
        entry.input_tokens = entry.input_tokens.saturating_add(input);
        entry.total_input_tokens = entry.total_input_tokens.saturating_add(input);
    }
    if let Some(output) = usage.get("output_tokens").and_then(|value| value.as_u64()) {
        entry.output_tokens = entry.output_tokens.saturating_add(output);
        entry.total_output_tokens = entry.total_output_tokens.saturating_add(output);
    }
    if let Some(v) = usage
        .get("cache_creation_input_tokens")
        .and_then(|value| value.as_u64())
    {
        entry.total_cache_creation_input_tokens =
            entry.total_cache_creation_input_tokens.saturating_add(v);
    }
    if let Some(v) = usage
        .get("cache_read_input_tokens")
        .and_then(|value| value.as_u64())
    {
        entry.total_cache_read_input_tokens = entry.total_cache_read_input_tokens.saturating_add(v);
    }
}

/// Drain the in-memory accumulator for `task_id` and persist it to
/// aura-storage via `persist_task_output`. Called once per task on
/// `task_completed` or `task_failed`.
///
/// Bridges the live-event accumulator (`task_output_cache`) to the
/// persisted `tasks` row + session events. The cache entry is removed
/// after persistence so the in-memory map doesn't grow unbounded
/// across task completions.
pub(super) async fn persist_cached_task_output(
    state: &AppState,
    project_id: ProjectId,
    jwt: &str,
    task_id: &str,
) {
    let Some(key) = parse_task_key(project_id, task_id) else {
        return;
    };
    let cached = {
        let mut cache = state.task_output_cache.lock().await;
        cache.remove(&key)
    };
    let Some(cached) = cached else {
        return;
    };
    crate::persistence::persist_task_output(
        state.storage_client.as_ref(),
        Some(jwt),
        task_id,
        &cached,
    )
    .await;
}

/// Accumulate evidence when the harness reports a successful test-runner
/// invocation. Idempotent: replays of the same event reset the
/// `recorded_at` timestamp but do not double-count anything.
pub(super) async fn record_test_pass_evidence(
    state: &AppState,
    project_id: ProjectId,
    task_id: &str,
    event: &serde_json::Value,
) {
    if !is_successful_test_run_event("tool_call_completed", event) {
        return;
    }
    let Some(key) = parse_task_key(project_id, task_id) else {
        return;
    };
    let command = event
        .get("input")
        .and_then(|input| {
            input
                .get("command")
                .or_else(|| input.get("cmd"))
                .or_else(|| input.get("shell_command"))
        })
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .or_else(|| {
            event
                .get("input")
                .and_then(|input| input.get("args"))
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str())
                        .collect::<Vec<_>>()
                        .join(" ")
                })
        })
        .unwrap_or_default();
    let Some(runner) = recognized_test_runner_label(&command) else {
        return;
    };
    let evidence = TestPassEvidence {
        runner,
        command,
        recorded_at: chrono::Utc::now().to_rfc3339(),
    };
    let mut cache = state.task_output_cache.lock().await;
    let entry = cache.entry(key).or_default();
    entry.test_pass_evidence = Some(evidence);
}
