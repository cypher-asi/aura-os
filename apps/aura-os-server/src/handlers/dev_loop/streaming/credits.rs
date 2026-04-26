//! Credit-exhaustion detection on harness events and the corresponding
//! best-effort automaton shutdown.

use tracing::warn;

use aura_os_core::{AgentInstanceId, ProjectId};
use aura_os_harness::AutomatonClient;

use crate::handlers::dev_loop::signals::is_insufficient_credits_failure_for_tests;
use crate::state::AppState;

pub(super) async fn stop_automaton_for_credit_exhaustion(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    automaton_id: &str,
) {
    let base_url = {
        let reg = state.automaton_registry.lock().await;
        reg.get(&(project_id, agent_instance_id))
            .filter(|entry| entry.automaton_id == automaton_id)
            .map(|entry| entry.harness_base_url.clone())
    };
    let Some(base_url) = base_url else {
        return;
    };
    if let Err(error) = AutomatonClient::new(&base_url).stop(automaton_id).await {
        warn!(%automaton_id, %error, "failed to stop automaton after credits were exhausted");
    }
}

pub(super) async fn remove_matching_registry_entry(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    automaton_id: &str,
) {
    let mut reg = state.automaton_registry.lock().await;
    if reg
        .get(&(project_id, agent_instance_id))
        .is_some_and(|entry| entry.automaton_id == automaton_id)
    {
        reg.remove(&(project_id, agent_instance_id));
    }
}

pub(super) fn insufficient_credits_event_message(
    event_type: &str,
    event: &serde_json::Value,
) -> Option<String> {
    if !matches!(event_type, "task_failed" | "error") {
        return None;
    }
    let text = event_failure_text(event);
    if !is_insufficient_credits_failure_for_tests(&text) {
        return None;
    }
    Some(event_message(event))
}

pub(super) fn event_message(event: &serde_json::Value) -> String {
    first_string(event, &["reason", "message", "error", "code"])
        .map(str::to_string)
        .unwrap_or_else(|| "Automaton execution failed".to_string())
}

fn event_failure_text(event: &serde_json::Value) -> String {
    ["reason", "message", "error", "code"]
        .iter()
        .filter_map(|key| event.get(*key).and_then(|value| value.as_str()))
        .collect::<Vec<_>>()
        .join(" ")
}

fn first_string<'a>(value: &'a serde_json::Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(serde_json::Value::as_str))
}
