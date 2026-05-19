//! Canonical harness wire-event-type strings consumed by the dev-loop
//! progress mapper.
//!
//! These mirror the constants in
//! `crates/aura-os-harness/src/runner/automaton_event_kinds.rs`
//! byte-for-byte. The `event_kinds_match_harness_constants` test in
//! the colocated `tests` module asserts the equivalence at every
//! `cargo test -p aura-os-automation` so the duplication cannot drift
//! silently.
//!
//! Production code in `aura-os-automation` MUST NOT depend on
//! `aura-os-harness` — the harness crate is the harness-client layer
//! and sits above the Domain layer. Domain peers (this crate,
//! `aura-os-loops`, `aura-os-events`) consume these constants here so
//! the dependency edge stays Domain-internal. A later cleanup (G6
//! follow-up) can collapse the mirror once `aura-protocol` or the
//! harness owns the canonical list.

/// `text_delta` — incremental assistant text output.
pub const TEXT_DELTA: &str = "text_delta";

/// `thinking_delta` — incremental assistant scratchpad output.
pub const THINKING_DELTA: &str = "thinking_delta";

/// `tool_use_start` — assistant decided to invoke a tool. The event
/// payload carries the tool name in `tool` (or, on some harness
/// builds, `name`).
pub const TOOL_USE_START: &str = "tool_use_start";

/// `tool_call_started` — alias the harness emits for some tool kinds;
/// semantically identical to [`TOOL_USE_START`] for the progress
/// mapper.
pub const TOOL_CALL_STARTED: &str = "tool_call_started";

/// `tool_call_snapshot` — incremental update on an in-flight tool
/// call. High-frequency; the progress mapper deliberately ignores it
/// to avoid flooding the activity broadcast.
pub const TOOL_CALL_SNAPSHOT: &str = "tool_call_snapshot";

/// `tool_call_completed` — terminal event for a tool call's lifecycle
/// (the assistant has the result).
pub const TOOL_CALL_COMPLETED: &str = "tool_call_completed";

/// `tool_result` — the actual tool result block delivered to the
/// assistant.
pub const TOOL_RESULT: &str = "tool_result";

/// `token_usage` — incremental token usage update.
pub const TOKEN_USAGE: &str = "token_usage";

/// `assistant_message_end` — terminal event for one assistant turn.
pub const ASSISTANT_MESSAGE_END: &str = "assistant_message_end";

/// `usage` — full-stream token usage rollup emitted alongside
/// `assistant_message_end` on some harness builds.
pub const USAGE: &str = "usage";

/// `session_usage` — session-scoped token usage rollup.
pub const SESSION_USAGE: &str = "session_usage";

/// `task_completed` — task-level success terminal event.
pub const TASK_COMPLETED: &str = "task_completed";

/// `task_failed` — task-level failure terminal event.
pub const TASK_FAILED: &str = "task_failed";

/// `done` — automaton-stream success terminal event.
pub const DONE: &str = "done";

/// `error` — automaton-stream error terminal event.
pub const ERROR: &str = "error";

/// `git_committed` — successful commit emitted by the harness sync
/// path.
pub const GIT_COMMITTED: &str = "git_committed";

/// `git_commit_failed` — failed commit attempt.
pub const GIT_COMMIT_FAILED: &str = "git_commit_failed";

/// `git_pushed` — successful push.
pub const GIT_PUSHED: &str = "git_pushed";

/// `git_push_failed` — failed push attempt.
pub const GIT_PUSH_FAILED: &str = "git_push_failed";

#[cfg(test)]
mod tests;
