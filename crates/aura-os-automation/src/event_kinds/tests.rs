//! Test-only invariant: every constant in
//! [`crate::event_kinds`] must equal its counterpart in
//! `aura_os_harness::runner::automaton_event_kinds` byte-for-byte.
//!
//! Without this guard, a rename in the harness crate would silently
//! desynchronise the two lists and the dev-loop progress mapper would
//! return to the same stale-event-name failure mode that motivated
//! Phase G2 / Section A.

use crate::event_kinds as auto;
use aura_os_harness::runner::automaton_event_kinds as harness;

#[test]
fn event_kinds_match_harness_constants() {
    assert_eq!(auto::TEXT_DELTA, harness::TEXT_DELTA);
    assert_eq!(auto::THINKING_DELTA, harness::THINKING_DELTA);
    assert_eq!(auto::TOOL_USE_START, harness::TOOL_USE_START);
    assert_eq!(auto::TOOL_CALL_STARTED, harness::TOOL_CALL_STARTED);
    assert_eq!(auto::TOOL_CALL_SNAPSHOT, harness::TOOL_CALL_SNAPSHOT);
    assert_eq!(auto::TOOL_CALL_COMPLETED, harness::TOOL_CALL_COMPLETED);
    assert_eq!(auto::TOOL_RESULT, harness::TOOL_RESULT);
    assert_eq!(auto::TOKEN_USAGE, harness::TOKEN_USAGE);
    assert_eq!(auto::ASSISTANT_MESSAGE_END, harness::ASSISTANT_MESSAGE_END);
    assert_eq!(auto::USAGE, harness::USAGE);
    assert_eq!(auto::SESSION_USAGE, harness::SESSION_USAGE);
    assert_eq!(auto::TASK_COMPLETED, harness::TASK_COMPLETED);
    assert_eq!(auto::TASK_FAILED, harness::TASK_FAILED);
    assert_eq!(auto::DONE, harness::DONE);
    assert_eq!(auto::ERROR, harness::ERROR);
    assert_eq!(auto::GIT_COMMITTED, harness::GIT_COMMITTED);
    assert_eq!(auto::GIT_COMMIT_FAILED, harness::GIT_COMMIT_FAILED);
    assert_eq!(auto::GIT_PUSHED, harness::GIT_PUSHED);
    assert_eq!(auto::GIT_PUSH_FAILED, harness::GIT_PUSH_FAILED);
}
