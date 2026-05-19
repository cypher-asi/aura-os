//! Table-driven tests for [`crate::progress::apply_loop_activity`].
//!
//! Each test row pins one canonical event-kind constant from
//! [`crate::event_kinds`] to its expected transition. The tables stay
//! flat and short so adding a new harness event-kind is a one-line
//! change.
//!
//! These tests also pin the **OLD stale event-type strings** (the
//! ones the original `apps/aura-os-server/src/handlers/dev_loop/streaming/activity.rs`
//! was matching against — e.g. `"tool_call_start"` and
//! `"tool_invocation"`) to `None`, guarding against the original
//! Section A regression where the mapper silently dropped every tool
//! transition because the harness no longer emitted those names.

use aura_os_events::{LoopActivity, LoopStatus};
use chrono::Utc;

use crate::event_kinds as ek;
use crate::progress::activity::{
    apply_loop_activity, LoopActivityTransition, STEP_PROCESSING, STEP_THINKING,
};

fn starting_activity() -> LoopActivity {
    LoopActivity::starting(Utc::now())
}

fn running_with_step(step: &str) -> LoopActivity {
    let mut activity = starting_activity();
    activity.status = LoopStatus::Running;
    activity.current_step = Some(step.to_string());
    activity
}

#[test]
fn text_and_thinking_deltas_transition_to_running_thinking() {
    let current = starting_activity();
    for kind in [ek::TEXT_DELTA, ek::THINKING_DELTA] {
        let transition = apply_loop_activity(&current, kind);
        assert_eq!(
            transition,
            Some(LoopActivityTransition::Running {
                step: STEP_THINKING,
            }),
            "expected Running(thinking) for {kind}",
        );
    }
}

#[test]
fn tool_start_kinds_transition_to_waiting_tool() {
    let current = starting_activity();
    for kind in [ek::TOOL_USE_START, ek::TOOL_CALL_STARTED] {
        assert_eq!(
            apply_loop_activity(&current, kind),
            Some(LoopActivityTransition::WaitingTool),
            "expected WaitingTool for {kind}",
        );
    }
}

#[test]
fn tool_completed_and_tool_result_return_to_running_processing() {
    let current = starting_activity();
    for kind in [ek::TOOL_CALL_COMPLETED, ek::TOOL_RESULT] {
        assert_eq!(
            apply_loop_activity(&current, kind),
            Some(LoopActivityTransition::Running {
                step: STEP_PROCESSING,
            }),
            "expected Running(processing) for {kind}",
        );
    }
}

#[test]
fn unknown_event_kind_returns_none() {
    let current = starting_activity();
    for kind in [
        ek::TOOL_CALL_SNAPSHOT,
        ek::TOKEN_USAGE,
        ek::ASSISTANT_MESSAGE_END,
        ek::USAGE,
        ek::SESSION_USAGE,
        ek::TASK_COMPLETED,
        ek::TASK_FAILED,
        ek::DONE,
        ek::ERROR,
        ek::GIT_COMMITTED,
        ek::GIT_COMMIT_FAILED,
        ek::GIT_PUSHED,
        ek::GIT_PUSH_FAILED,
        "totally_unknown_event",
    ] {
        assert_eq!(
            apply_loop_activity(&current, kind),
            None,
            "expected None for {kind}",
        );
    }
}

#[test]
fn redundant_running_thinking_returns_none() {
    let current = running_with_step(STEP_THINKING);
    for kind in [ek::TEXT_DELTA, ek::THINKING_DELTA] {
        assert_eq!(
            apply_loop_activity(&current, kind),
            None,
            "expected no-op for {kind} when already Running(thinking)",
        );
    }
}

#[test]
fn redundant_running_processing_returns_none() {
    let current = running_with_step(STEP_PROCESSING);
    for kind in [ek::TOOL_CALL_COMPLETED, ek::TOOL_RESULT] {
        assert_eq!(
            apply_loop_activity(&current, kind),
            None,
            "expected no-op for {kind} when already Running(processing)",
        );
    }
}

#[test]
fn legacy_stale_event_kinds_do_not_transition() {
    // Section A regression guard. These are the literal strings the
    // pre-G2 server-side mapper matched against. The harness has not
    // emitted them in a long time; matching them caused the spinner
    // to stall (no transition fired for a real `tool_use_start` /
    // `tool_call_started`). If a future refactor accidentally
    // resurrects any of these literals, this test fails loud.
    let current = starting_activity();
    for kind in [
        "tool_call_start",
        "tool_invocation",
        "tool_call_end",
        "compaction_started",
        "context_compaction_started",
        "task_started",
        "run_started",
        "session_started",
        "assistant_message_start",
        "assistant_message_delta",
    ] {
        assert_eq!(
            apply_loop_activity(&current, kind),
            None,
            "stale event kind must not transition: {kind}",
        );
    }
}
