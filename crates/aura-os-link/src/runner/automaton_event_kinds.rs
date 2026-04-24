//! Wire-level automaton JSON event `type` strings and shared predicates.
//!
//! Keeping these in one place lets the event collector and downstream forwarders
//! stay aligned when harness aliases evolve.

pub const TEXT_DELTA: &str = "text_delta";
pub const THINKING_DELTA: &str = "thinking_delta";

pub const TOOL_USE_START: &str = "tool_use_start";
pub const TOOL_CALL_STARTED: &str = "tool_call_started";
pub const TOOL_CALL_SNAPSHOT: &str = "tool_call_snapshot";
pub const TOOL_CALL_COMPLETED: &str = "tool_call_completed";
pub const TOOL_RESULT: &str = "tool_result";

pub const TOKEN_USAGE: &str = "token_usage";
pub const ASSISTANT_MESSAGE_END: &str = "assistant_message_end";
pub const USAGE: &str = "usage";
pub const SESSION_USAGE: &str = "session_usage";

pub const TASK_COMPLETED: &str = "task_completed";
pub const TASK_FAILED: &str = "task_failed";
pub const DONE: &str = "done";
pub const ERROR: &str = "error";

pub const GIT_COMMITTED: &str = "git_committed";
pub const GIT_COMMIT_FAILED: &str = "git_commit_failed";
pub const GIT_PUSHED: &str = "git_pushed";
pub const GIT_PUSH_FAILED: &str = "git_push_failed";

#[inline]
pub fn normalize_sync_milestone_type(evt_type: &str) -> &str {
    match evt_type {
        "commit_created" => GIT_COMMITTED,
        "push_succeeded" => GIT_PUSHED,
        "push_failed" => GIT_PUSH_FAILED,
        other => other,
    }
}

#[inline]
pub fn is_sync_milestone_event(evt_type: &str) -> bool {
    matches!(
        normalize_sync_milestone_type(evt_type),
        GIT_COMMITTED | GIT_COMMIT_FAILED | GIT_PUSHED | GIT_PUSH_FAILED
    )
}

/// Stream events forwarded into the process UI when mirroring harness output.
#[inline]
pub fn is_process_stream_forward_event(evt_type: &str) -> bool {
    matches!(
        evt_type,
        TEXT_DELTA
            | THINKING_DELTA
            | TOOL_USE_START
            | TOOL_CALL_STARTED
            | TOOL_CALL_SNAPSHOT
            | TOOL_CALL_COMPLETED
            | TOOL_RESULT
    )
}

/// Harness events whose `usage`/`token` fields update collected totals in
/// [`super::collect_automaton_events`].
#[inline]
pub fn is_usage_totals_event(evt_type: &str) -> bool {
    matches!(
        evt_type,
        ASSISTANT_MESSAGE_END | TOKEN_USAGE | USAGE | SESSION_USAGE
    )
}

/// Events that drive `process_run_progress` synthesis in the process executor.
#[inline]
pub fn is_process_progress_broadcast_event(evt_type: &str) -> bool {
    matches!(evt_type, TOKEN_USAGE | ASSISTANT_MESSAGE_END)
}

/// Git/sync milestone events that callers may want to persist or summarize.
#[inline]
pub fn is_git_sync_event(evt_type: &str) -> bool {
    matches!(
        evt_type,
        GIT_COMMITTED | GIT_COMMIT_FAILED | GIT_PUSHED | GIT_PUSH_FAILED
    )
}

/// Map harness tool-start aliases to the type string used on process streams.
#[inline]
pub fn normalize_process_tool_type_field(evt_type: &str) -> &str {
    if evt_type == TOOL_CALL_STARTED {
        TOOL_USE_START
    } else {
        evt_type
    }
}
