//! Side-effects triggered by individual harness events: appending to
//! the live task output cache, persisting fail reasons to
//! `tasks.execution_notes`, and updating per-task usage counters.

use std::str::FromStr;

use tracing::{info, warn};

use aura_os_core::{AgentInstanceId, ProjectId, SessionId, TaskId, TaskStatus};
use aura_os_events::{DomainEvent, LegacyJsonEvent};
use aura_os_storage::{StorageTaskFileChangeSummary, UpdateTaskRequest};

use crate::state::{AppState, CachedTaskOutput, TestPassEvidence};

use super::super::session::record_task_worked;
use super::super::signals::{
    extract_task_failure_context, is_completion_contract_failure_for_tests,
    is_successful_test_run_event, recognized_test_runner_label,
};

#[allow(clippy::too_many_arguments)]
pub(super) async fn record_event_side_effects(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    fallback_task_id: Option<String>,
    event: serde_json::Value,
    event_type: &str,
    jwt: Option<&str>,
    session_id: Option<SessionId>,
) {
    let task_id = event
        .get("task_id")
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .or(fallback_task_id);
    let mut enriched = enrich_event(
        event.clone(),
        project_id,
        agent_instance_id,
        task_id.as_deref(),
        session_id,
    );
    if event_type == "task_failed" {
        let reason = extract_task_failure_reason(&enriched);
        let ctx = extract_task_failure_context(&enriched, reason.as_deref());
        if ctx.has_any() {
            if let Some(object) = enriched.as_object_mut() {
                ctx.merge_into(object);
            }
        }
    }

    // Tests-as-truth override: if this is a CompletionContract
    // `task_failed` and we accumulated successful test-runner evidence
    // earlier in the run, transition the task to Done in storage and
    // **replace** the broadcast payload with a synthetic
    // `task_completed`. Doing this before any broadcast avoids
    // briefly showing the failure to live subscribers when we already
    // know we're going to override it.
    let mut effective_event_type: &str = event_type;
    let mut broadcast_payload = enriched;
    if event_type == "task_failed" {
        if let (Some(task_id_str), Some(jwt)) = (task_id.as_deref(), jwt) {
            if let Some(synthetic) = maybe_apply_test_evidence_override(
                state,
                project_id,
                agent_instance_id,
                task_id_str,
                jwt,
                &event,
                session_id,
            )
            .await
            {
                broadcast_payload = synthetic;
                effective_event_type = "task_completed";
            }
        }
    }

    let _ = state.event_broadcast.send(broadcast_payload.clone());
    state
        .event_hub
        .publish(DomainEvent::LegacyJson(LegacyJsonEvent {
            project_id: Some(project_id),
            agent_instance_id: Some(agent_instance_id),
            session_id,
            loop_id: None,
            payload: broadcast_payload,
        }));

    apply_event_side_effect(
        state,
        project_id,
        agent_instance_id,
        effective_event_type,
        task_id.as_deref(),
        &event,
        jwt,
        session_id,
    )
    .await;
}

async fn apply_event_side_effect(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    event_type: &str,
    task_id: Option<&str>,
    event: &serde_json::Value,
    jwt: Option<&str>,
    session_id: Option<SessionId>,
) {
    match event_type {
        "task_started" => {
            if let Some(task_id) = task_id {
                seed_task_output(state, project_id, agent_instance_id, task_id).await;
                set_current_task(
                    state,
                    project_id,
                    agent_instance_id,
                    Some(task_id.to_string()),
                )
                .await;
                // Increment `tasks_worked_count` on the storage session
                // so per-session stats reflect automation activity too.
                if let Some(session_id) = session_id {
                    record_task_worked(
                        &state.session_service,
                        project_id,
                        agent_instance_id,
                        session_id,
                        task_id,
                    )
                    .await;
                }
            }
        }
        "task_completed" => {
            set_current_task(state, project_id, agent_instance_id, None).await;
            // Drain the in-memory `task_output_cache` (tokens, files-
            // changed, live output, build/test/git steps) into the
            // persisted aura-storage task record + session events.
            // Without this, tokens accumulated in `update_usage_cache`
            // are silently discarded when the cache is evicted,
            // leaving the dashboard "Tokens" stat at 0.
            if let (Some(task_id), Some(jwt)) = (task_id, jwt) {
                persist_cached_task_output(state, project_id, jwt, task_id).await;
            }
        }
        "task_failed" => {
            set_current_task(state, project_id, agent_instance_id, None).await;
            // Persist the fail reason onto `tasks.execution_notes` so
            // it survives a page reload. The live WebSocket path
            // already carries the reason to `useTaskStatus`, but that
            // state resets to `null` on mount; without this write,
            // "Copy All Output" on a reloaded failed task has no
            // reason to render (the hook has nothing to seed from).
            if let (Some(task_id), Some(jwt)) = (task_id, jwt) {
                persist_task_failure_reason(state, jwt, task_id, event).await;
                // Same accumulator drain as task_completed: failed tasks
                // also have token usage that should appear in stats.
                persist_cached_task_output(state, project_id, jwt, task_id).await;
            }
        }
        "tool_call_completed" => {
            if let Some(task_id) = task_id {
                record_test_pass_evidence(state, project_id, task_id, event).await;
            }
        }
        "text_delta" => {
            if let Some((task_id, text)) = task_id.zip(event_text(event)) {
                append_task_output(state, project_id, task_id, text).await;
            }
        }
        "token_usage" | "assistant_message_end" | "usage" | "session_usage" => {
            if let Some(task_id) = task_id.as_deref() {
                update_usage_cache(state, project_id, task_id, event).await;
            }
            if event_type == "assistant_message_end" {
                if let Some(task_id) = task_id.as_deref() {
                    record_files_changed(state, project_id, task_id, event).await;
                }
            }
        }
        _ => {}
    }
}

/// Accumulate evidence when the harness reports a successful test-runner
/// invocation. Idempotent: replays of the same event reset the
/// `recorded_at` timestamp but do not double-count anything.
async fn record_test_pass_evidence(
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

/// Override path for `task_failed` events whose reason matches the
/// completion-contract classifier. Returns `Some(synthetic)` when the
/// task was transitioned to `Done` and the caller should broadcast the
/// returned `task_completed` payload **instead** of the original
/// failure event. Returns `None` when no override applied (no
/// evidence, override already fired, classifier rejected the reason,
/// storage unavailable, bridge transition failed, ...), in which case
/// the caller continues with normal failure persistence and broadcast.
///
/// `_session_id` is reserved for routing — the caller already plumbs
/// it through the broadcast envelope, so the synthetic payload only
/// needs the in-payload `task_id` / `project_id` keys to satisfy the
/// existing UI handlers.
async fn maybe_apply_test_evidence_override(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    task_id: &str,
    jwt: &str,
    event: &serde_json::Value,
    _session_id: Option<SessionId>,
) -> Option<serde_json::Value> {
    let reason = extract_task_failure_reason(event)?;
    if !is_completion_contract_failure_for_tests(&reason) {
        return None;
    }

    let key = parse_task_key(project_id, task_id)?;

    let evidence = {
        let mut cache = state.task_output_cache.lock().await;
        let entry = cache.get_mut(&key)?;
        if entry.completion_override_applied {
            return None;
        }
        let evidence = entry.test_pass_evidence.clone()?;
        // Optimistically claim the override slot before issuing the
        // storage transition so a concurrent re-emit (WS reconnect)
        // doesn't enter the bridge twice.
        entry.completion_override_applied = true;
        evidence
    };

    let storage = state.storage_client.as_ref()?;

    info!(
        %task_id,
        runner = evidence.runner,
        command = %evidence.command,
        "overriding harness CompletionContract failure with test-pass evidence"
    );

    if let Err(error) =
        aura_os_tasks::safe_transition(storage, jwt, task_id, TaskStatus::Done).await
    {
        warn!(
            %task_id,
            %error,
            "failed to bridge task to Done after test-evidence override; \
             leaving harness verdict in place"
        );
        // Re-arm the override flag so a subsequent retry can try again
        // rather than silently swallowing the failure.
        let mut cache = state.task_output_cache.lock().await;
        if let Some(entry) = cache.get_mut(&key) {
            entry.completion_override_applied = false;
        }
        return None;
    }

    let notes = format!(
        "Completed via passing tests ({}). Command: `{}`",
        evidence.runner, evidence.command
    );
    let update = UpdateTaskRequest {
        execution_notes: Some(notes.clone()),
        ..Default::default()
    };
    if let Err(error) = storage.update_task(task_id, jwt, &update).await {
        warn!(
            %task_id,
            %error,
            "failed to persist test-evidence execution_notes"
        );
    }

    Some(serde_json::json!({
        "type": "task_completed",
        "task_id": task_id,
        "project_id": project_id.to_string(),
        "agent_instance_id": agent_instance_id.to_string(),
        "outcome": "test_evidence_accepted",
        "execution_notes": notes,
        "test_pass_evidence": {
            "runner": evidence.runner,
            "command": evidence.command,
            "recorded_at": evidence.recorded_at,
        },
    }))
}

/// Extract the fail reason from a `task_failed` event. Checks the same
/// field order as `event_message` (`reason`/`message`/`error`/`code`)
/// and returns `None` when all are missing or empty — callers can
/// decide whether to fall back to the generic "Automaton execution
/// failed" string or skip the write entirely.
///
/// Trims whitespace so we don't persist empty strings or pure-space
/// payloads as if they were real reasons.
pub(crate) fn extract_task_failure_reason(event: &serde_json::Value) -> Option<String> {
    for key in ["reason", "message", "error", "code"] {
        if let Some(value) = event.get(key).and_then(|v| v.as_str()) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

/// Best-effort write of `tasks.execution_notes` from the reason field
/// of a `task_failed` event. Intentionally non-fatal: failures (no
/// storage client configured, expired JWT, network blip) are logged at
/// `warn` level and the caller continues. Callers only hit this path
/// after already forwarding the event to live subscribers, so the
/// reload-visible state is strictly better-off than before regardless
/// of outcome.
async fn persist_task_failure_reason(
    state: &AppState,
    jwt: &str,
    task_id: &str,
    event: &serde_json::Value,
) {
    let Some(storage) = state.storage_client.as_ref() else {
        return;
    };
    let Some(reason) = extract_task_failure_reason(event) else {
        return;
    };
    let update = UpdateTaskRequest {
        execution_notes: Some(reason),
        ..Default::default()
    };
    if let Err(error) = storage.update_task(task_id, jwt, &update).await {
        warn!(
            %task_id,
            %error,
            "failed to persist task_failed reason to tasks.execution_notes"
        );
    }
}

fn enrich_event(
    event: serde_json::Value,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    task_id: Option<&str>,
    session_id: Option<SessionId>,
) -> serde_json::Value {
    let mut enriched = event;
    if let Some(object) = enriched.as_object_mut() {
        object
            .entry("project_id".to_string())
            .or_insert_with(|| project_id.to_string().into());
        object
            .entry("agent_instance_id".to_string())
            .or_insert_with(|| agent_instance_id.to_string().into());
        if let Some(task_id) = task_id {
            object
                .entry("task_id".to_string())
                .or_insert_with(|| task_id.to_string().into());
        }
        if let Some(session_id) = session_id {
            object
                .entry("session_id".to_string())
                .or_insert_with(|| session_id.to_string().into());
        }
    }
    enriched
}

async fn set_current_task(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    task_id: Option<String>,
) {
    if let Some(entry) = state
        .automaton_registry
        .lock()
        .await
        .get_mut(&(project_id, agent_instance_id))
    {
        entry.current_task_id = task_id;
    }
}

async fn append_task_output(state: &AppState, project_id: ProjectId, task_id: &str, text: &str) {
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

fn event_text(event: &serde_json::Value) -> Option<&str> {
    event
        .get("text")
        .or_else(|| event.get("delta"))
        .and_then(|value| value.as_str())
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

async fn update_usage_cache(
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
}

/// Drain `assistant_message_end.files_changed` into the per-task cache.
///
/// Closes the long-standing "Lines = 0" dashboard gap. The cache field
/// has documented `Populated from … assistant_message_end` semantics
/// since the dev-loop refactor, but no production code path was
/// actually wiring the event payload into the cache — leaving
/// `cached.files_changed` always-empty and so `tasks.files_changed`
/// always-empty too.
///
/// Reads the protocol-typed `created` / `modified` / `deleted` arrays
/// for the file list, then joins per-path against the new `diffs`
/// array (which the harness populates from `edit_file` line counts) to
/// fill `lines_added` / `lines_removed` on the persisted summary. Paths
/// without a `diffs` entry fall through to 0 — that's the "unknown"
/// signal the dashboard should treat as missing data, not as a real
/// zero-line change.
///
/// Idempotency: the cache field is rebuilt from scratch on every
/// `assistant_message_end`, so out-of-order delivery is harmless. We
/// keep the most recently received summary because the harness emits
/// the event once per turn with the cumulative net effect — there is
/// no incremental-append semantics to preserve.
async fn record_files_changed(
    state: &AppState,
    project_id: ProjectId,
    task_id: &str,
    event: &serde_json::Value,
) {
    let Some(key) = parse_task_key(project_id, task_id) else {
        return;
    };
    let Some(files) = event.get("files_changed") else {
        return;
    };
    let summary = build_files_changed_summary(files);
    if summary.is_empty() {
        return;
    }

    let mut cache = state.task_output_cache.lock().await;
    let entry = cache.entry(key).or_default();
    entry.files_changed = summary;
}

/// Pure conversion from a `files_changed` JSON payload (as emitted on
/// `assistant_message_end`) to the typed summary the cache stores.
///
/// Joins per-path against the `diffs` array (sent by the harness for
/// tools that compute a real line diff — currently `edit_file`) to fill
/// `lines_added` / `lines_removed`. Paths without a matching diff entry
/// keep counts at 0; consumers must read 0 as "unknown" rather than
/// "no change".
fn build_files_changed_summary(files: &serde_json::Value) -> Vec<StorageTaskFileChangeSummary> {
    let lookup_lines = |path: &str| -> (u32, u32) {
        let Some(diffs) = files.get("diffs").and_then(|v| v.as_array()) else {
            return (0, 0);
        };
        for diff in diffs {
            if diff.get("path").and_then(|v| v.as_str()) == Some(path) {
                let added = diff
                    .get("lines_added")
                    .and_then(serde_json::Value::as_u64)
                    .unwrap_or(0);
                let removed = diff
                    .get("lines_removed")
                    .and_then(serde_json::Value::as_u64)
                    .unwrap_or(0);
                return (
                    u32::try_from(added).unwrap_or(u32::MAX),
                    u32::try_from(removed).unwrap_or(u32::MAX),
                );
            }
        }
        (0, 0)
    };

    let mut summary: Vec<StorageTaskFileChangeSummary> = Vec::new();
    for (op, field) in [
        ("create", "created"),
        ("modify", "modified"),
        ("delete", "deleted"),
    ] {
        if let Some(paths) = files.get(field).and_then(|v| v.as_array()) {
            for path in paths.iter().filter_map(|v| v.as_str()) {
                let (lines_added, lines_removed) = lookup_lines(path);
                summary.push(StorageTaskFileChangeSummary {
                    op: op.to_string(),
                    path: path.to_string(),
                    lines_added,
                    lines_removed,
                });
            }
        }
    }
    summary
}

/// Parse a free-form task id string into a typed cache key. Returns
/// `None` for non-UUID task ids; the caller silently drops the entry
/// in that case (legacy harness payloads occasionally carry synthetic
/// `"runner-<n>"` ids that should not pollute the cache).
fn parse_task_key(project_id: ProjectId, task_id: &str) -> Option<(ProjectId, TaskId)> {
    TaskId::from_str(task_id).ok().map(|tid| (project_id, tid))
}

/// Drain the in-memory accumulator for `task_id` and persist it to
/// aura-storage via `persist_task_output`. Called once per task on
/// `task_completed` or `task_failed`.
///
/// Bridges the live-event accumulator (`task_output_cache`) to the
/// persisted `tasks` row + session events. The cache entry is removed
/// after persistence so the in-memory map doesn't grow unbounded
/// across task completions.
async fn persist_cached_task_output(
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

#[cfg(test)]
mod tests {
    use super::build_files_changed_summary;
    use serde_json::json;

    #[test]
    fn build_files_changed_summary_groups_paths_by_op() {
        let files = json!({
            "created": ["src/new.rs"],
            "modified": ["src/lib.rs"],
            "deleted": ["src/old.rs"],
        });
        let summary = build_files_changed_summary(&files);
        assert_eq!(summary.len(), 3);
        assert_eq!(summary[0].op, "create");
        assert_eq!(summary[0].path, "src/new.rs");
        assert_eq!(summary[1].op, "modify");
        assert_eq!(summary[2].op, "delete");
        // No diffs supplied -> counts default to 0 across the board.
        assert!(summary.iter().all(|s| s.lines_added == 0));
        assert!(summary.iter().all(|s| s.lines_removed == 0));
    }

    #[test]
    fn build_files_changed_summary_joins_diffs_by_path() {
        let files = json!({
            "created": [],
            "modified": ["src/lib.rs", "src/main.rs"],
            "deleted": [],
            "diffs": [
                {"path": "src/lib.rs", "lines_added": 12, "lines_removed": 3},
                // src/main.rs intentionally absent — exercises the
                // "unknown" / 0-fallback branch.
            ],
        });
        let summary = build_files_changed_summary(&files);
        assert_eq!(summary.len(), 2);

        let lib = summary.iter().find(|s| s.path == "src/lib.rs").unwrap();
        assert_eq!(lib.lines_added, 12);
        assert_eq!(lib.lines_removed, 3);

        let main = summary.iter().find(|s| s.path == "src/main.rs").unwrap();
        assert_eq!(main.lines_added, 0);
        assert_eq!(main.lines_removed, 0);
    }

    #[test]
    fn build_files_changed_summary_returns_empty_when_no_paths() {
        let files = json!({
            "created": [],
            "modified": [],
            "deleted": [],
        });
        assert!(build_files_changed_summary(&files).is_empty());
    }

    #[test]
    fn build_files_changed_summary_clamps_pathological_line_counts() {
        let files = json!({
            "modified": ["x"],
            "diffs": [
                // u32::MAX + 1 — out-of-range u32 should clamp, not panic.
                {"path": "x", "lines_added": 4_294_967_296u64, "lines_removed": 0},
            ],
        });
        let summary = build_files_changed_summary(&files);
        assert_eq!(summary.len(), 1);
        assert_eq!(summary[0].lines_added, u32::MAX);
        assert_eq!(summary[0].lines_removed, 0);
    }
}
