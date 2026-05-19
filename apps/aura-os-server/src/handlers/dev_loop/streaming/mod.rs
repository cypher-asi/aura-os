//! Dev-loop streaming infrastructure: forwards harness events into the
//! legacy broadcast firehose and the topic-scoped event hub, drives
//! [`LoopHandle`] activity transitions, persists side-effects (task
//! output / usage / failure reason), and stops automatons that hit
//! credit exhaustion.
//!
//! Sub-modules:
//!
//! * [`activity`] — translates harness events into loop status
//!   transitions.
//! * [`credits`] — credit-exhaustion detection and automaton shutdown.
//! * [`forwarder`] — the harness-event consumer task wiring everything
//!   together.
//! * [`side_effects`] — task output / usage cache / persisted failure
//!   reason writes triggered by individual events.

mod activity;
mod credits;
mod forwarder;
mod side_effects;

use aura_os_core::{AgentInstanceId, ProjectId, SessionId};
use aura_os_events::{DomainEvent, LegacyJsonEvent};

use crate::state::AppState;

pub(crate) use forwarder::spawn_event_forwarder;
pub(crate) use side_effects::seed_task_output;

#[cfg(test)]
use side_effects::extract_task_failure_reason;

/// Publish an event into both the legacy `event_broadcast` firehose and
/// the topic-scoped [`aura_os_events::EventHub`]. Producers stamp the
/// project and agent-instance routing keys explicitly so the hub can
/// deliver only to subscribers that asked for them.
pub(crate) fn emit_domain_event(
    state: &AppState,
    event_type: &str,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    extra: serde_json::Value,
) {
    emit_domain_event_with_session(
        state,
        event_type,
        project_id,
        agent_instance_id,
        None,
        extra,
    );
}

/// Same as [`emit_domain_event`] but also stamps the routing
/// `session_id` so subscribers filtering by session topic receive the
/// loop event without having to peek into the JSON payload.
pub(crate) fn emit_domain_event_with_session(
    state: &AppState,
    event_type: &str,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    session_id: Option<SessionId>,
    extra: serde_json::Value,
) {
    let mut event = serde_json::json!({
        "type": event_type,
        "project_id": project_id.to_string(),
        "agent_instance_id": agent_instance_id.to_string(),
    });
    if let Some(session_id) = session_id {
        if let Some(object) = event.as_object_mut() {
            object.insert("session_id".to_string(), session_id.to_string().into());
        }
    }
    if let (Some(base), Some(extra)) = (event.as_object_mut(), extra.as_object()) {
        for (key, value) in extra {
            base.insert(key.clone(), value.clone());
        }
    }
    let _ = state.event_broadcast.send(event.clone());
    state
        .event_hub
        .publish(DomainEvent::LegacyJson(LegacyJsonEvent {
            project_id: Some(project_id),
            agent_instance_id: Some(agent_instance_id),
            session_id,
            loop_id: None,
            payload: event,
        }));
}

#[cfg(test)]
mod tests {
    use super::extract_task_failure_reason;
    use serde_json::json;

    #[test]
    fn extracts_reason_preferred_over_other_keys() {
        let event = json!({
            "type": "task_failed",
            "reason": "completion contract: task_done called with no file changes",
            "message": "harness shut down",
            "error": "ignored",
        });
        assert_eq!(
            extract_task_failure_reason(&event).as_deref(),
            Some("completion contract: task_done called with no file changes"),
        );
    }

    #[test]
    fn falls_back_through_message_error_code() {
        let message_only = json!({ "type": "task_failed", "message": "boom" });
        assert_eq!(
            extract_task_failure_reason(&message_only).as_deref(),
            Some("boom"),
        );
        let error_only = json!({ "type": "task_failed", "error": "net" });
        assert_eq!(
            extract_task_failure_reason(&error_only).as_deref(),
            Some("net"),
        );
        let code_only = json!({ "type": "task_failed", "code": "429" });
        assert_eq!(
            extract_task_failure_reason(&code_only).as_deref(),
            Some("429"),
        );
    }

    #[test]
    fn trims_whitespace_and_rejects_empty() {
        let whitespace = json!({ "type": "task_failed", "reason": "   " });
        assert!(extract_task_failure_reason(&whitespace).is_none());

        let padded = json!({ "type": "task_failed", "reason": "  real reason  " });
        assert_eq!(
            extract_task_failure_reason(&padded).as_deref(),
            Some("real reason"),
        );
    }

    #[test]
    fn returns_none_when_no_reason_fields() {
        let bare = json!({ "type": "task_failed", "task_id": "abc" });
        assert!(extract_task_failure_reason(&bare).is_none());
    }

    #[test]
    fn ignores_non_string_reason_fields() {
        // The harness occasionally routes structured error payloads;
        // we deliberately don't stringify them here to avoid
        // persisting e.g. `{"code":402}` as a JSON blob in
        // execution_notes. Falls through to the next string-typed
        // field instead.
        let structured = json!({
            "type": "task_failed",
            "reason": { "code": 500, "body": "internal" },
            "message": "upstream 5xx",
        });
        assert_eq!(
            extract_task_failure_reason(&structured).as_deref(),
            Some("upstream 5xx"),
        );
    }
}
