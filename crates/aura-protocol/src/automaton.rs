//! Classification of harness automaton / dev-loop events.
//!
//! These events ride the harness WebSocket alongside the typed chat
//! protocol ([`crate::OutboundMessage`]) but are intentionally **not**
//! part of it: they are forwarded verbatim as JSON on the bridge's raw
//! channel and consumed by the dev-loop / process pipeline. The shared
//! WS bridge needs to tell them apart from genuinely corrupt or
//! unexpected frames so it does not mis-report a benign automaton event
//! as a `harness_protocol_mismatch`.
//!
//! [`AutomatonEvent`] is a lightweight, forward-compatible classifier
//! for exactly that purpose. It is internally tagged on `type` and uses
//! a `#[serde(other)]` catch-all so harness builds that add new event
//! types do not regress into spurious mismatch errors — an unrecognized
//! `type` deserializes to [`AutomatonEvent::Unknown`], which the bridge
//! treats as real protocol drift. Variants carry no payload because the
//! raw `serde_json::Value` is what gets forwarded; this enum only
//! answers "is this an expected automaton event shape?".

use serde::Deserialize;

/// Recognized harness automaton / dev-loop event tags that are
/// deliberately absent from [`crate::OutboundMessage`].
///
/// Deliberately excludes any tag that maps to an `OutboundMessage`
/// variant (`text_delta`, `thinking_delta`, `tool_use_start`,
/// `tool_call_snapshot`, `tool_result`, `assistant_message_end`,
/// `error`, ...): those are parsed on the typed chat path and must
/// never be classified here.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AutomatonEvent {
    ToolCallStarted,
    ToolCallCompleted,
    TokenUsage,
    Usage,
    SessionUsage,
    Started,
    Stopped,
    LogLine,
    LoopFinished,
    TaskCompleted,
    TaskFailed,
    Done,
    GitCommitted,
    GitCommitFailed,
    GitPushed,
    GitPushFailed,
    /// Forward-compat fallback for any `type` not enumerated above.
    /// The bridge treats this as genuine protocol drift (warn +
    /// `harness_protocol_mismatch`).
    #[serde(other)]
    Unknown,
}

impl AutomatonEvent {
    /// `true` for any harness frame that is a recognized automaton /
    /// dev-loop event and therefore expected to fail the typed
    /// [`crate::OutboundMessage`] parse.
    ///
    /// Covers the enumerated [`AutomatonEvent`] tags plus the open
    /// `debug.*` instrumentation namespace (`debug.iteration`,
    /// `debug.llm_call`, ...). The `debug.*` family is a prefix
    /// namespace that an internally-tagged enum cannot express as fixed
    /// variants, so it is matched explicitly here.
    #[must_use]
    pub fn is_recognized(value: &serde_json::Value) -> bool {
        if value
            .get("type")
            .and_then(|t| t.as_str())
            .is_some_and(|t| t.starts_with("debug."))
        {
            return true;
        }
        matches!(
            AutomatonEvent::deserialize(value),
            Ok(event) if event != AutomatonEvent::Unknown
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn recognizes_enumerated_automaton_events() {
        for value in [
            json!({"type": "token_usage", "input_tokens": 1, "output_tokens": 259}),
            json!({"type": "tool_call_completed", "id": "abc", "name": "search_code"}),
            json!({"type": "tool_call_started", "id": "abc"}),
            json!({"type": "usage"}),
            json!({"type": "session_usage"}),
            json!({"type": "started"}),
            json!({"type": "stopped"}),
            json!({"type": "log_line", "message": "Listening for harness events"}),
            json!({"type": "loop_finished", "succeeded": true}),
            json!({"type": "task_completed", "task_id": "t"}),
            json!({"type": "task_failed", "task_id": "t"}),
            json!({"type": "done"}),
            json!({"type": "git_committed", "commit_sha": "deadbeef"}),
            json!({"type": "git_commit_failed"}),
            json!({"type": "git_pushed"}),
            json!({"type": "git_push_failed"}),
        ] {
            assert!(
                AutomatonEvent::is_recognized(&value),
                "{value} should be recognized"
            );
        }
    }

    #[test]
    fn recognizes_debug_namespace() {
        for value in [
            json!({"type": "debug.iteration", "index": 3}),
            json!({"type": "debug.llm_call"}),
            json!({"type": "debug.tool_call"}),
            json!({"type": "debug.some_future_event"}),
        ] {
            assert!(
                AutomatonEvent::is_recognized(&value),
                "{value} should be recognized via debug.* namespace"
            );
        }
    }

    #[test]
    fn unknown_type_is_not_recognized() {
        // Genuine protocol drift / corruption must NOT be suppressed.
        for value in [
            json!({"type": "totally_unknown_event"}),
            json!({"type": "debugiteration"}),
            json!({"no_type_field": true}),
        ] {
            assert!(
                !AutomatonEvent::is_recognized(&value),
                "{value} must be treated as protocol drift"
            );
        }
    }

    #[test]
    fn chat_protocol_tags_are_not_recognized_as_automaton() {
        // These map to OutboundMessage variants and must stay on the
        // typed path, never classified as automaton events.
        for value in [
            json!({"type": "text_delta", "text": "hi"}),
            json!({"type": "tool_use_start", "id": "x", "name": "y"}),
            json!({"type": "tool_result"}),
            json!({"type": "assistant_message_end"}),
            json!({"type": "error", "code": "x", "message": "y"}),
        ] {
            assert!(
                !AutomatonEvent::is_recognized(&value),
                "{value} must not be classified as an automaton event"
            );
        }
    }
}
