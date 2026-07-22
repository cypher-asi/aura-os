//! Dev-loop streaming infrastructure: forwards harness events into the
//! legacy broadcast firehose and the topic-scoped event hub, drives
//! [`LoopHandle`] activity transitions, persists side-effects (task
//! output / usage / failure reason), and stops automatons that hit
//! credit exhaustion.
//!
//! Sub-modules:
//!
//! * [`activity`] â€” translates harness events into loop status
//!   transitions.
//! * [`credits`] â€” credit-exhaustion detection and automaton shutdown.
//! * [`forwarder`] â€” the harness-event consumer task wiring everything
//!   together.
//! * [`side_effects`] â€” task output / usage cache / persisted failure
//!   reason writes triggered by individual events.

mod activity;
mod credits;
mod forwarder;
mod provider_circuit;
mod side_effects;
mod tool_summary;

use aura_os_core::{AgentInstanceId, ProjectId, SessionId};
use aura_os_events::{DomainEvent, LegacyJsonEvent};

use crate::state::AppState;

pub(crate) use forwarder::{current_millis, spawn_event_forwarder};
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
    emit_domain_event_with_session(DomainEventInputs {
        state,
        event_type,
        project_id,
        agent_instance_id,
        session_id: None,
        extra,
    });
}

/// Inputs for [`emit_domain_event_with_session`]. Bundled to keep
/// the helper under the project's five-parameter ceiling.
pub(crate) struct DomainEventInputs<'a> {
    pub(crate) state: &'a AppState,
    pub(crate) event_type: &'a str,
    pub(crate) project_id: ProjectId,
    pub(crate) agent_instance_id: AgentInstanceId,
    pub(crate) session_id: Option<SessionId>,
    pub(crate) extra: serde_json::Value,
}

/// Same as [`emit_domain_event`] but also stamps the routing
/// `session_id` so subscribers filtering by session topic receive the
/// loop event without having to peek into the JSON payload.
pub(crate) fn emit_domain_event_with_session(inputs: DomainEventInputs<'_>) {
    let DomainEventInputs {
        state,
        event_type,
        project_id,
        agent_instance_id,
        session_id,
        extra,
    } = inputs;
    let mut event = serde_json::json!({
        "type": event_type,
        "project_id": project_id.to_string(),
        "agent_instance_id": agent_instance_id.to_string(),
        // Legacy alias: many client handlers still read `agent_id`
        // at the top level (AutomationBar bound-loop binding,
        // loop_finished scoping). Single-task runs worked without
        // this because they emit `task_started` before the HTTP
        // response; automation relies on `loop_started` + tool
        // events where only `agent_instance_id` was present.
        "agent_id": agent_instance_id.to_string(),
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

/// Inputs for [`emit_log_line`]. Bundled to keep the helper
/// under the project's five-parameter ceiling. `message` is owned
/// rather than `impl Into<String>` so the inputs struct stays
/// callable with a heap-allocated payload assembled at the call site.
pub(crate) struct LogLineInputs<'a> {
    pub(crate) state: &'a AppState,
    pub(crate) project_id: ProjectId,
    pub(crate) agent_instance_id: AgentInstanceId,
    pub(crate) session_id: Option<SessionId>,
    pub(crate) message: String,
    pub(crate) extra: serde_json::Value,
}

/// Publish a `log_line` event onto both the legacy `event_broadcast`
/// firehose and the topic-scoped event hub, so the SidekickLog panel
/// gets a human-readable row even for activity that does not have
/// its own typed engine event (per-turn tool calls, streaming
/// heartbeats, forwarder lifecycle, ...).
///
/// `LogLine` is already in the UI subscription set
/// (`interface/src/hooks/use-log-stream.ts::ALL_ENGINE_EVENT_TYPES`)
/// and in the server persistence allowlist
/// (`crate::persistence::LOG_WORTHY_TYPES`), so every line emitted
/// through this helper lands in the panel live and on history
/// reload without any further wiring.
///
/// `extra` is merged shallowly onto the payload --- pass
/// `serde_json::json!({})` if you only need the `message` field.
/// Caller-supplied keys lose to anything already in `payload` (the
/// `message` field and the routing keys stamped by
/// [`emit_domain_event_with_session`]) so a malformed `extra` cannot
/// shadow the wire-critical fields.
pub(crate) fn emit_log_line(inputs: LogLineInputs<'_>) {
    let LogLineInputs {
        state,
        project_id,
        agent_instance_id,
        session_id,
        message,
        extra,
    } = inputs;
    let mut payload = serde_json::json!({ "message": message });
    if let (Some(payload_obj), Some(extra_obj)) = (payload.as_object_mut(), extra.as_object()) {
        for (key, value) in extra_obj {
            payload_obj
                .entry(key.clone())
                .or_insert_with(|| value.clone());
        }
    }
    emit_domain_event_with_session(DomainEventInputs {
        state,
        event_type: "log_line",
        project_id,
        agent_instance_id,
        session_id,
        extra: payload,
    });
}

#[cfg(test)]
mod tests {
    use super::extract_task_failure_reason;
    use serde_json::json;

    use super::side_effects::log_line_for_event;

    #[test]
    fn log_line_for_tool_call_started_includes_name_and_input() {
        let event = json!({ "name": "edit_file", "input": {"path": "foo.rs"} });
        assert_eq!(
            log_line_for_event("tool_call_started", &event).as_deref(),
            Some("Calling tool: edit_file (foo.rs)"),
        );
        let command = json!({ "name": "run_command", "input": {"command": "cargo test"} });
        assert_eq!(
            log_line_for_event("tool_call_started", &command).as_deref(),
            Some("Calling tool: run_command (cargo test)"),
        );
    }

    #[test]
    fn log_line_for_tool_call_started_falls_back_to_alias_then_default() {
        let aliased = json!({ "tool_name": "run_command" });
        assert_eq!(
            log_line_for_event("tool_use_start", &aliased).as_deref(),
            Some("Calling tool: run_command"),
        );
        let nameless = json!({});
        assert_eq!(
            log_line_for_event("tool_call_started", &nameless).as_deref(),
            Some("Calling tool: tool"),
        );
    }

    #[test]
    fn log_line_for_tool_call_completed_marks_errors() {
        let ok = json!({ "name": "read_file" });
        assert_eq!(
            log_line_for_event("tool_call_completed", &ok).as_deref(),
            Some("Tool completed: read_file"),
        );
        let err = json!({ "name": "read_file", "is_error": true });
        assert_eq!(
            log_line_for_event("tool_call_completed", &err).as_deref(),
            Some("Tool completed: read_file (error)"),
        );
        let timed_out = json!({
            "name": "run_command",
            "is_error": true,
            "reason": "Tool timed out after 120000ms",
        });
        assert_eq!(
            log_line_for_event("tool_call_completed", &timed_out).as_deref(),
            Some("Tool failed: run_command (Tool timed out after 120000ms)"),
        );
    }

    #[test]
    fn log_line_for_text_delta_is_heartbeat_string() {
        let event = json!({ "text": "hello" });
        assert_eq!(
            log_line_for_event("text_delta", &event).as_deref(),
            Some("Streaming response..."),
        );
    }

    #[test]
    fn log_line_for_assistant_message_end_includes_tokens_when_present() {
        let nested = json!({
            "usage": { "input_tokens": 1234, "output_tokens": 567 },
        });
        assert_eq!(
            log_line_for_event("assistant_message_end", &nested).as_deref(),
            Some("Turn ended (1234 in / 567 out tokens)"),
        );
        let flat = json!({ "input_tokens": 10, "output_tokens": 20 });
        assert_eq!(
            log_line_for_event("assistant_message_end", &flat).as_deref(),
            Some("Turn ended (10 in / 20 out tokens)"),
        );
        let missing = json!({});
        assert_eq!(
            log_line_for_event("assistant_message_end", &missing).as_deref(),
            Some("Turn ended"),
        );
    }

    #[test]
    fn log_line_returns_none_for_uncovered_event_types() {
        // task_started already surfaces via the typed Task badge in
        // the SidekickLog subscription set; we deliberately do NOT
        // duplicate it as a LOG row.
        assert!(log_line_for_event("task_started", &json!({})).is_none());
        assert!(log_line_for_event("file_ops_applied", &json!({})).is_none());
        assert!(log_line_for_event("token_usage", &json!({})).is_none());
    }
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
