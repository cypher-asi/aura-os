use std::sync::atomic::Ordering;

use tokio::sync::broadcast;

use aura_os_core::{AgentInstanceId, ProjectId};
use aura_os_harness::collect_automaton_events;

use crate::state::{AppState, CachedTaskOutput};

use super::types::ForwarderContext;

pub(crate) fn emit_domain_event(
    broadcast_tx: &broadcast::Sender<serde_json::Value>,
    event_type: &str,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    extra: serde_json::Value,
) {
    let mut event = serde_json::json!({
        "type": event_type,
        "project_id": project_id.to_string(),
        "agent_instance_id": agent_instance_id.to_string(),
    });
    if let (Some(base), Some(extra)) = (event.as_object_mut(), extra.as_object()) {
        for (key, value) in extra {
            base.insert(key.clone(), value.clone());
        }
    }
    let _ = broadcast_tx.send(event);
}

pub(super) fn spawn_event_forwarder(ctx: ForwarderContext) -> tokio::task::AbortHandle {
    let handle = tokio::spawn(async move {
        let ForwarderContext {
            state,
            project_id,
            agent_instance_id,
            automaton_id,
            task_id,
            events_tx,
            ws_reader_handle: _ws_reader_handle,
            alive,
            timeout,
        } = ctx;
        let rx = events_tx.subscribe();
        let fallback_task_id = task_id.clone();
        let completion = collect_automaton_events(rx, timeout, |event, event_type| {
            let state = state.clone();
            let event = event.clone();
            let event_type = event_type.to_string();
            let fallback_task_id = fallback_task_id.clone();
            tokio::spawn(async move {
                record_event_side_effects(
                    &state,
                    project_id,
                    agent_instance_id,
                    fallback_task_id,
                    event,
                    &event_type,
                )
                .await;
            });
        })
        .await;
        alive.store(false, Ordering::SeqCst);
        remove_matching_registry_entry(&state, agent_instance_id, &automaton_id).await;
        emit_domain_event(
            &state.event_broadcast,
            if completion.is_success() {
                "loop_finished"
            } else {
                "task_failed"
            },
            project_id,
            agent_instance_id,
            serde_json::json!({}),
        );
    });
    handle.abort_handle()
}

async fn remove_matching_registry_entry(
    state: &AppState,
    agent_instance_id: AgentInstanceId,
    automaton_id: &str,
) {
    let mut reg = state.automaton_registry.lock().await;
    if reg
        .get(&agent_instance_id)
        .is_some_and(|entry| entry.automaton_id == automaton_id)
    {
        reg.remove(&agent_instance_id);
    }
}

async fn record_event_side_effects(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    fallback_task_id: Option<String>,
    event: serde_json::Value,
    event_type: &str,
) {
    let task_id = event
        .get("task_id")
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .or(fallback_task_id);
    let enriched = enrich_event(
        event.clone(),
        project_id,
        agent_instance_id,
        task_id.as_deref(),
    );
    let _ = state.event_broadcast.send(enriched);

    match event_type {
        "task_started" => {
            if let Some(task_id) = task_id.as_ref() {
                seed_task_output(state, project_id, agent_instance_id, task_id).await;
                set_current_task(state, agent_instance_id, Some(task_id.clone())).await;
            }
        }
        "task_completed" | "task_failed" => {
            set_current_task(state, agent_instance_id, None).await;
        }
        "text_delta" => {
            if let Some((task_id, text)) = task_id.as_ref().zip(event_text(&event)) {
                append_task_output(state, task_id, text).await;
            }
        }
        "token_usage" | "assistant_message_end" | "usage" | "session_usage" => {
            if let Some(task_id) = task_id.as_ref() {
                update_usage_cache(state, task_id, &event).await;
            }
        }
        _ => {}
    }
}

fn enrich_event(
    event: serde_json::Value,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    task_id: Option<&str>,
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
    }
    enriched
}

async fn set_current_task(
    state: &AppState,
    agent_instance_id: AgentInstanceId,
    task_id: Option<String>,
) {
    if let Some(entry) = state
        .automaton_registry
        .lock()
        .await
        .get_mut(&agent_instance_id)
    {
        entry.current_task_id = task_id;
    }
}

async fn append_task_output(state: &AppState, task_id: &str, text: &str) {
    state
        .task_output_cache
        .lock()
        .await
        .entry(task_id.to_string())
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

pub(super) async fn seed_task_output(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    task_id: &str,
) {
    state
        .task_output_cache
        .lock()
        .await
        .entry(task_id.to_string())
        .or_insert_with(|| CachedTaskOutput {
            project_id: Some(project_id.to_string()),
            agent_instance_id: Some(agent_instance_id.to_string()),
            ..Default::default()
        });
}

async fn update_usage_cache(state: &AppState, task_id: &str, event: &serde_json::Value) {
    let usage = event.get("usage").unwrap_or(event);
    let mut cache = state.task_output_cache.lock().await;
    let entry = cache.entry(task_id.to_string()).or_default();
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
