//! Side-effects triggered by individual harness events: appending to
//! the live task output cache, persisting fail reasons to
//! `tasks.execution_notes`, and updating per-task usage counters.

use std::str::FromStr;

use tracing::{info, warn};

use aura_os_core::{AgentInstanceId, ProjectId, SessionId, TaskId, TaskStatus};
use aura_os_events::{DomainEvent, LegacyJsonEvent};
use aura_os_storage::{StorageTaskFileChangeSummary, UpdateTaskRequest};

use crate::state::{AppState, CachedTaskOutput, TestPassEvidence};
use crate::sync_state::{
    checkpoint_from_git_step, derive_sync_state_from_checkpoints, TaskSyncCheckpoint,
};

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
                record_git_commit_push_timeout(state, project_id, task_id, event).await;
            }
        }
        "git_committed" | "commit_created" | "git_commit_failed" | "git_pushed"
        | "push_succeeded" | "git_push_failed" | "push_failed" => {
            if let Some(task_id) = task_id {
                record_git_checkpoint(state, project_id, task_id, event_type, event).await;
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

async fn record_git_checkpoint(
    state: &AppState,
    project_id: ProjectId,
    task_id: &str,
    event_type: &str,
    event: &serde_json::Value,
) {
    let mut step = event.clone();
    if let Some(object) = step.as_object_mut() {
        object
            .entry("type".to_string())
            .or_insert_with(|| event_type.to_string().into());
    }
    let Some(checkpoint) = checkpoint_from_git_step(&step) else {
        return;
    };
    record_sync_checkpoint(state, project_id, task_id, step, checkpoint).await;
}

async fn record_git_commit_push_timeout(
    state: &AppState,
    project_id: ProjectId,
    task_id: &str,
    event: &serde_json::Value,
) {
    if !is_git_commit_push_timeout(event) {
        return;
    }
    let reason = event_reason(event).unwrap_or_else(|| "git_commit_push timed out".to_string());
    let Some(key) = parse_task_key(project_id, task_id) else {
        return;
    };

    let mut cache = state.task_output_cache.lock().await;
    let entry = cache.entry(key).or_default();
    let commit_sha = entry
        .sync_state
        .as_ref()
        .and_then(|state| state.last_commit_sha.clone())
        .or_else(|| {
            entry
                .sync_checkpoints
                .iter()
                .rev()
                .find_map(|checkpoint| checkpoint.commit_sha.clone())
        });
    let checkpoint = TaskSyncCheckpoint {
        kind: "git_push_failed".to_string(),
        phase: Some("push_failed".to_string()),
        commit_sha,
        reason: Some(reason.clone()),
        ..Default::default()
    };
    let step = serde_json::json!({
        "type": "git_push_failed",
        "commit_sha": checkpoint.commit_sha.clone(),
        "reason": reason,
    });
    record_sync_checkpoint_locked(entry, step, checkpoint);
}

async fn record_sync_checkpoint(
    state: &AppState,
    project_id: ProjectId,
    task_id: &str,
    step: serde_json::Value,
    checkpoint: TaskSyncCheckpoint,
) {
    let Some(key) = parse_task_key(project_id, task_id) else {
        return;
    };
    let mut cache = state.task_output_cache.lock().await;
    let entry = cache.entry(key).or_default();
    record_sync_checkpoint_locked(entry, step, checkpoint);
}

fn record_sync_checkpoint_locked(
    entry: &mut CachedTaskOutput,
    step: serde_json::Value,
    checkpoint: TaskSyncCheckpoint,
) {
    if !entry.sync_checkpoints.contains(&checkpoint) {
        entry.sync_checkpoints.push(checkpoint);
    }
    if !entry.git_steps.contains(&step) {
        entry.git_steps.push(step);
    }
    entry.sync_state = derive_sync_state_from_checkpoints(&entry.sync_checkpoints);
}

fn is_git_commit_push_timeout(event: &serde_json::Value) -> bool {
    event
        .get("is_error")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
        && event
            .get("name")
            .or_else(|| event.get("tool_name"))
            .and_then(|value| value.as_str())
            == Some("git_commit_push")
        && event_reason(event)
            .map(|reason| {
                let reason = reason.to_ascii_lowercase();
                reason.contains("timeout") || reason.contains("timed out")
            })
            .unwrap_or(false)
}

fn event_reason(event: &serde_json::Value) -> Option<String> {
    ["reason", "message", "error", "result", "result_preview"]
        .into_iter()
        .find_map(|key| {
            event
                .get(key)
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
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
/// for the file list, then joins per-path against the `diffs` array
/// (which the harness populates from per-tool line counts) to fill
/// `lines_added` / `lines_removed` on the persisted summary. Paths
/// without a `diffs` entry fall through to 0 — that's the "unknown"
/// signal the dashboard should treat as missing data, not as a real
/// zero-line change.
///
/// Cross-turn merge: the harness's `AgentLoopResult.file_changes` is
/// per-turn, so each `assistant_message_end` carries only that turn's
/// mutations. Multi-turn tasks (the common case in the dev loop) need
/// their per-turn summaries combined into a single net-effect view per
/// path, mirroring the within-turn collapse rules aura-agent already
/// enforces in `record_file_change`. Without this, a task that edits
/// `lib.rs` in turn 1 and `main.rs` in turn 2 would persist only the
/// turn-2 change and silently drop turn 1.
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
    let incoming = build_files_changed_summary(files);
    if incoming.is_empty() {
        return;
    }

    let mut cache = state.task_output_cache.lock().await;
    let entry = cache.entry(key).or_default();
    for change in incoming {
        merge_file_change(&mut entry.files_changed, change);
    }
}

/// Merge a freshly-arrived per-path summary into the existing cache
/// vector with the same kind-collapse semantics aura-agent applies
/// within a single turn (see `aura_agent::AgentLoopResult::record_file_change`).
///
/// Line counts always sum across merges (`saturating_add` guards the
/// pathological overflow case). The kind transition table:
///
/// | existing | incoming | result    |
/// |----------|----------|-----------|
/// | Create   | Modify   | Create    |
/// | Create   | Delete   | (dropped) |
/// | Modify   | Modify   | Modify    |
/// | Modify   | Delete   | Delete    |
/// | Delete   | Create   | Modify    |
/// | Delete   | Modify   | Modify    |
/// | otherwise (same/unknown) | (incoming kind wins) |
///
/// Create→Delete drops the entry entirely (the file existed only
/// transiently across the merged turns) and the accumulated line
/// counts go with it — matches the within-turn behavior so a file
/// that's created in turn 1 and deleted in turn 3 doesn't pollute
/// the dashboard with a phantom line count.
fn merge_file_change(
    target: &mut Vec<StorageTaskFileChangeSummary>,
    incoming: StorageTaskFileChangeSummary,
) {
    let Some(idx) = target.iter().position(|c| c.path == incoming.path) else {
        target.push(incoming);
        return;
    };
    let collapsed = collapse_op(target[idx].op.as_str(), incoming.op.as_str());
    if collapsed.is_none() {
        // Create → Delete: net effect is "no file"; drop the entry
        // entirely along with its accumulated counts.
        target.swap_remove(idx);
        return;
    }
    target[idx].lines_added = target[idx].lines_added.saturating_add(incoming.lines_added);
    target[idx].lines_removed = target[idx]
        .lines_removed
        .saturating_add(incoming.lines_removed);
    if let Some(op) = collapsed {
        target[idx].op = op.to_string();
    }
}

/// Decide the post-merge `op` value for a path that already has an
/// entry. Returns `None` when the merge net-effect is "no file"
/// (`Create` followed by `Delete`); the caller drops the entry in
/// that case.
fn collapse_op(existing: &str, incoming: &str) -> Option<&'static str> {
    match (existing, incoming) {
        ("create", "modify") => Some("create"),
        ("create", "delete") => None,
        ("modify", "modify") => Some("modify"),
        ("modify", "delete") => Some("delete"),
        ("delete", "create") => Some("modify"),
        ("delete", "modify") => Some("modify"),
        ("create", "create") => Some("create"),
        ("delete", "delete") => Some("delete"),
        // Any unrecognized op string falls through to the incoming
        // value, matching the within-turn fallback in aura-agent.
        (_, "create") => Some("create"),
        (_, "modify") => Some("modify"),
        (_, "delete") => Some("delete"),
        _ => Some("modify"),
    }
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
    use super::{build_files_changed_summary, collapse_op, merge_file_change};
    use aura_os_storage::StorageTaskFileChangeSummary;
    use serde_json::json;

    fn s(path: &str, op: &str, added: u32, removed: u32) -> StorageTaskFileChangeSummary {
        StorageTaskFileChangeSummary {
            op: op.to_string(),
            path: path.to_string(),
            lines_added: added,
            lines_removed: removed,
        }
    }

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

    // ====================================================================
    // collapse_op — kind-transition table (mirrors aura_agent's within-turn
    // record_file_change so cross-turn merges in the cache stay consistent
    // with the harness's net-effect semantics).
    // ====================================================================

    #[test]
    fn collapse_op_create_then_modify_keeps_create() {
        assert_eq!(collapse_op("create", "modify"), Some("create"));
    }

    #[test]
    fn collapse_op_create_then_delete_drops_entry() {
        assert_eq!(collapse_op("create", "delete"), None);
    }

    #[test]
    fn collapse_op_modify_then_modify_stays_modify() {
        assert_eq!(collapse_op("modify", "modify"), Some("modify"));
    }

    #[test]
    fn collapse_op_modify_then_delete_becomes_delete() {
        assert_eq!(collapse_op("modify", "delete"), Some("delete"));
    }

    #[test]
    fn collapse_op_delete_then_create_becomes_modify() {
        // The file existed before the turn, was deleted, then re-created
        // with potentially different content — net effect is a modify
        // (matches aura_agent::record_file_change).
        assert_eq!(collapse_op("delete", "create"), Some("modify"));
    }

    #[test]
    fn collapse_op_delete_then_modify_becomes_modify() {
        assert_eq!(collapse_op("delete", "modify"), Some("modify"));
    }

    #[test]
    fn collapse_op_create_then_create_stays_create() {
        // Pathological idempotent case (shouldn't happen with a sane
        // harness) but the merge must still be deterministic.
        assert_eq!(collapse_op("create", "create"), Some("create"));
    }

    #[test]
    fn collapse_op_delete_then_delete_stays_delete() {
        assert_eq!(collapse_op("delete", "delete"), Some("delete"));
    }

    #[test]
    fn collapse_op_unknown_existing_falls_through_to_incoming() {
        // Defensive fallback: if an upstream contract drift ever
        // serialised an unrecognised existing op, take the incoming
        // value rather than panicking.
        assert_eq!(collapse_op("rename", "modify"), Some("modify"));
        assert_eq!(collapse_op("rename", "create"), Some("create"));
        assert_eq!(collapse_op("rename", "delete"), Some("delete"));
    }

    #[test]
    fn collapse_op_unknown_pair_defaults_to_modify() {
        // Both ends unrecognised — pick the safest non-destructive
        // bucket so the row still surfaces in the dashboard.
        assert_eq!(collapse_op("rename", "rename"), Some("modify"));
    }

    // ====================================================================
    // merge_file_change — applies collapse_op + sums lines on a Vec target.
    // ====================================================================

    #[test]
    fn merge_file_change_inserts_new_path() {
        let mut target = vec![s("src/a.rs", "modify", 1, 1)];
        merge_file_change(&mut target, s("src/b.rs", "create", 5, 0));
        assert_eq!(target.len(), 2);
        let b = target.iter().find(|c| c.path == "src/b.rs").unwrap();
        assert_eq!(b.op, "create");
        assert_eq!(b.lines_added, 5);
    }

    #[test]
    fn merge_file_change_sums_line_counts_on_existing_path() {
        let mut target = vec![s("src/lib.rs", "modify", 10, 2)];
        merge_file_change(&mut target, s("src/lib.rs", "modify", 5, 3));
        assert_eq!(target.len(), 1);
        assert_eq!(target[0].lines_added, 15);
        assert_eq!(target[0].lines_removed, 5);
    }

    #[test]
    fn merge_file_change_create_then_delete_drops_entry_and_counts() {
        let mut target = vec![
            s("src/keep.rs", "modify", 1, 1),
            s("src/temp.rs", "create", 100, 0),
        ];
        merge_file_change(&mut target, s("src/temp.rs", "delete", 0, 0));
        assert_eq!(target.len(), 1);
        assert_eq!(target[0].path, "src/keep.rs");
    }

    #[test]
    fn merge_file_change_create_then_modify_preserves_create_kind() {
        let mut target = vec![s("src/new.rs", "create", 7, 0)];
        merge_file_change(&mut target, s("src/new.rs", "modify", 3, 1));
        assert_eq!(target.len(), 1);
        assert_eq!(target[0].op, "create");
        assert_eq!(target[0].lines_added, 10);
        assert_eq!(target[0].lines_removed, 1);
    }

    #[test]
    fn merge_file_change_clamps_at_u32_max() {
        let mut target = vec![s("x", "modify", u32::MAX - 1, 0)];
        merge_file_change(&mut target, s("x", "modify", 5, 0));
        assert_eq!(target[0].lines_added, u32::MAX);
    }

    // ====================================================================
    // Regression test for the multi-turn merge bug — the original case
    // that motivated the merge-not-overwrite redesign.
    // ====================================================================

    #[test]
    fn merge_preserves_paths_across_simulated_turns() {
        // Turn 1: edits src/lib.rs (+5/-2)
        // Turn 2: edits src/main.rs (+10/-0)
        // Turn 3: re-edits src/lib.rs (+3/-1) and creates src/new.rs (+8/-0)
        // Final cache must show all three paths with summed line counts —
        // the original overwrite-on-each-call implementation only kept
        // the last turn's payload.
        let mut target: Vec<StorageTaskFileChangeSummary> = Vec::new();

        merge_file_change(&mut target, s("src/lib.rs", "modify", 5, 2));
        merge_file_change(&mut target, s("src/main.rs", "modify", 10, 0));
        merge_file_change(&mut target, s("src/lib.rs", "modify", 3, 1));
        merge_file_change(&mut target, s("src/new.rs", "create", 8, 0));

        assert_eq!(target.len(), 3, "all three paths must survive merging");

        let lib = target.iter().find(|c| c.path == "src/lib.rs").unwrap();
        assert_eq!(lib.op, "modify");
        assert_eq!(lib.lines_added, 8); // 5 + 3
        assert_eq!(lib.lines_removed, 3); // 2 + 1

        let main = target.iter().find(|c| c.path == "src/main.rs").unwrap();
        assert_eq!(main.lines_added, 10);

        let new = target.iter().find(|c| c.path == "src/new.rs").unwrap();
        assert_eq!(new.op, "create");
        assert_eq!(new.lines_added, 8);
    }
}
