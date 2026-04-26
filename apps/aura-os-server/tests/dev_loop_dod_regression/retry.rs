//! Tool-call infra-retry budget, harness-owned DoD, and retired
//! aura-os DoD remediation surface regressions.

use aura_os_server::phase7_test_support as tsp;
use serde_json::json;

#[test]
fn tool_call_failures_are_diagnostic_history_not_aura_os_dod_failures() {
    let reason = tsp::completion_validation_reason_with_tool_call_failures(
        "edited one Rust file",
        &["apps/aura-os-server/src/lib.rs"],
        0,
        0,
        0,
        0,
        0,
        &[(
            "run_command",
            "Tool 'run_command' is not allowed by the active policy",
        )],
    );

    assert!(
        reason.is_none(),
        "aura-os must not convert harness tool failures into server-owned DoD rejection"
    );
}

// ---------------------------------------------------------------------------
// Per-tool-call infra-retry budget (server-retry-budget)
// ---------------------------------------------------------------------------
//
// The harness emits `tool_call_failed` once its own streaming-retry
// budget of 8 is exhausted (harness-retry-streaming, commit 9174501).
// The server forwarder then routes the event through
// `attempt_infra_retry` to buy one more fresh streaming request
// against the provider, capped per task at TOOL_CALL_RETRY_BUDGET.
// These tests pin:
//   1. the classifier wiring (only infra-transient reasons retry),
//   2. the budget constant (must stay at 8 to mirror the harness),
//   3. the counter monotonicity (8+1 must NOT retry).
//
// They do not replay the full forwarder — the live retry path needs
// a running automaton/task service — but they do lock in the gate
// that the forwarder consults before dispatching.

#[test]
fn tool_call_retry_budget_is_eight_and_matches_harness_retry_count() {
    // Harness emits `tool_call_failed` only after its internal
    // retry-with-backoff loop (default 8 attempts) runs out, so the
    // server-side budget should match to keep the worst-case
    // recovery ladder symmetric at 8 × 8 = 64 total provider
    // attempts. Changing this number is a wire-contract break and
    // must be coordinated with the harness side.
    assert_eq!(
        tsp::tool_call_retry_budget(),
        8,
        "TOOL_CALL_RETRY_BUDGET must stay aligned with aura-harness's streaming-retry budget"
    );
}

#[test]
fn provider_internal_error_triggers_tool_call_retry_when_under_budget() {
    // This is the exact reason string the reasoner emits when
    // Anthropic sends `stream terminated with error: Internal server
    // error` mid-`tool_use` — the motivating 4.6-class failure.
    let reason = "LLM error: stream terminated with error: Internal server error";
    assert!(
        tsp::tool_call_failed_should_retry(reason, 0),
        "first tool_call_failed with ProviderInternalError reason must retry"
    );
    assert!(
        tsp::tool_call_failed_should_retry(reason, 7),
        "7th prior retry must still be under budget (budget=8)"
    );
}

#[test]
fn rate_limit_reason_triggers_tool_call_retry() {
    // HTTP 429 and 529 both classify as `ProviderRateLimited`; the
    // forwarder must route both through the retry gate so a
    // temporary cooldown doesn't terminate the task.
    for reason in [
        "Anthropic 429 Too Many Requests",
        "upstream provider returned 529 overloaded",
    ] {
        assert!(
            tsp::tool_call_failed_should_retry(reason, 0),
            "rate-limit reason '{reason}' must retry"
        );
    }
}

#[test]
fn insufficient_credits_reason_is_terminal_not_retryable() {
    let reason = "agent execution error: LLM error: kernel reason_streaming error: reasoner error: Insufficient credits: Anthropic API error: 402 Payment Required - {\"error\":{\"code\":\"INSUFFICIENT_CREDITS\",\"message\":\"Insufficient credits: balance=4, required=5\"}}";
    assert!(
        tsp::is_insufficient_credits_failure(reason),
        "exact provider 402 insufficient-credits reason must be classified"
    );
    assert!(
        !tsp::tool_call_failed_should_retry(reason, 0),
        "credits exhaustion must stop the loop instead of entering infra retry"
    );
    assert!(
        !tsp::should_restart_on_error_event(reason),
        "credits exhaustion must not restart the automaton"
    );
}

#[test]
fn insufficient_credits_classifier_covers_api_code_forms() {
    for reason in [
        "upstream returned payment_required",
        "body code=insufficient_credits",
        "402 Payment Required",
        "Insufficient credits: balance=0",
    ] {
        assert!(
            tsp::is_insufficient_credits_failure(reason),
            "credits classifier missed '{reason}'"
        );
    }
}

#[test]
fn budget_exhaustion_stops_tool_call_retry_even_for_transient_reason() {
    // Once the per-task counter hits the budget the forwarder must
    // let the event fall through to the normal task_failed path,
    // even if the reason is classifier-positive — otherwise a
    // permanently-broken upstream would loop the task forever.
    let reason = "LLM error: stream terminated with error: Internal server error";
    let budget = tsp::tool_call_retry_budget();
    assert!(
        !tsp::tool_call_failed_should_retry(reason, budget),
        "prior_count == budget must NOT retry"
    );
    assert!(
        !tsp::tool_call_failed_should_retry(reason, budget + 1),
        "prior_count > budget must NOT retry"
    );
    assert!(
        !tsp::tool_call_failed_should_retry(reason, u32::MAX),
        "saturated counter must NOT retry"
    );
}

#[test]
fn non_transient_reason_never_triggers_tool_call_retry() {
    // Compile errors / syntax errors / kernel-policy denials are
    // deterministic; retrying them just wastes a provider call and
    // delays the task_failed surface.
    for reason in [
        "syntax error in generated code",
        "run_command tool is not allowed by kernel policy",
        "write_file: Permission denied (os error 13)",
        "",
    ] {
        assert!(
            !tsp::tool_call_failed_should_retry(reason, 0),
            "non-transient reason '{reason}' must NOT retry"
        );
    }
}

#[test]
fn push_timeout_reason_is_eligible_for_tool_call_retry() {
    // `git push` timeouts are classified as infra (see
    // `InfraFailureClass::GitPushTimeout`) and retried by the
    // error/task_failed paths; tool_call_failed for the same class
    // must line up so a push-during-tool-call is not treated
    // differently.
    assert!(
        tsp::tool_call_failed_should_retry("git push orbit HEAD:main: timed out after 60s", 0),
        "git push timeout reason must retry"
    );
}

// ---------------------------------------------------------------------------
// Retired aura-os DoD remediation retry surface
// ---------------------------------------------------------------------------

#[test]
fn dod_classifier_is_inert_because_harness_owns_remediation() {
    for reason in [
        "Task modified source code but no build/compile step was run",
        "Task modified source code but no test step was run",
        "Task modified source code but no format check was run",
        "Task modified source code but no lint check was run",
        "run_command is denied by harness command policy",
    ] {
        assert_eq!(
            tsp::classify_dod_remediation_kind(reason),
            None,
            "aura-os must not classify harness DoD remediation reason: {reason}"
        );
    }
}

#[test]
fn task_done_no_file_reason_is_completion_contract_not_truncation() {
    let reason = "ERROR: You are completing this task but have not made any file changes \
                  (write_file, edit_file, or delete_file). Implementation tasks must produce \
                  file changes. If this task genuinely requires no file changes, call \
                  task_done again with \"no_changes_needed\": true and explain why in the \
                  notes field.";

    assert!(
        tsp::is_completion_contract_failure(reason),
        "task_done no-file failures should be labeled as completion-contract errors"
    );
    assert!(
        !tsp::is_truncation_failure(reason),
        "task_done no-file failures must not trigger truncation decomposition"
    );
}

#[test]
fn completion_contract_failure_reconciles_to_terminal_reason() {
    let decision = tsp::reconcile_decision(&[], "completion_contract", 0, 3, false, false);

    assert_eq!(
        decision,
        json!({
            "action": "mark_terminal",
            "reason": "completion_contract",
        }),
        "missing file-edit evidence is an agent/tool contract failure, not a decomposition candidate"
    );
}

#[test]
fn dod_followup_prompt_and_retry_budget_are_retired() {
    assert!(tsp::build_dod_followup_prompt(
        "missing_test",
        1,
        "Task modified source code but no test step was run"
    )
    .is_none());
    assert_eq!(
        tsp::max_dod_retries_per_task(),
        0,
        "aura-os must not retry harness-owned DoD failures"
    );
}
