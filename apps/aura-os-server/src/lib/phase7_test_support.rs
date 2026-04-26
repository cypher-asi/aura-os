/// True when `reason` is classified as a truncation-style failure
/// by Phase 3's `classify_failure`. Anything else — auth errors,
/// crashes, rate limits — returns `false`.
pub fn is_truncation_failure(reason: &str) -> bool {
    crate::handlers::dev_loop::is_truncation_failure_for_tests(reason)
}

/// True when the harness/task tool rejected `task_done` because an
/// implementation task completed without write/edit/delete evidence and
/// without the explicit `no_changes_needed` escape hatch.
pub fn is_completion_contract_failure(reason: &str) -> bool {
    crate::handlers::dev_loop::is_completion_contract_failure_for_tests(reason)
}

/// True when `reason` looks like a provider rate-limit or overload
/// (HTTP 429 / 529 / `overloaded_error`). The orchestrator routes
/// these through the infra-retry path rather than Phase 3's
/// truncation remediation so a provider cooldown isn't wasted on
/// heuristic follow-up tasks.
pub fn is_rate_limited_failure(reason: &str) -> bool {
    crate::handlers::dev_loop::is_rate_limited_failure_for_tests(reason)
}

/// True when `reason` indicates the provider rejected work because the
/// account has no remaining credits. This is terminal for dev loops:
/// retrying or moving to the next task only burns build/setup time.
pub fn is_insufficient_credits_failure(reason: &str) -> bool {
    crate::handlers::dev_loop::is_insufficient_credits_failure_for_tests(reason)
}

/// True when `reason` is recognized as a post-commit `git push`
/// timeout. This is the non-fatal infra path: the task can still be
/// marked done because the commit already exists locally.
pub fn is_git_push_timeout_failure(reason: &str) -> bool {
    crate::handlers::dev_loop::is_git_push_timeout_failure_for_tests(reason)
}

/// True when `reason` is classified as a transient provider
/// internal error (5xx / stream aborted) — the class added in
/// Axis 1 so the `LLM error: stream terminated with error:
/// Internal server error` pattern routes through the retry path
/// instead of being treated as terminal.
pub fn is_provider_internal_error(reason: &str) -> bool {
    crate::handlers::dev_loop::is_provider_internal_error_for_tests(reason)
}

/// True when `reason` text *looks* transient but the classifier
/// didn't match it — the `debug.retry_miss` trigger condition from
/// Axis 4. Used by integration tests to pin the exact coverage
/// surface of `looks_like_unclassified_transient`.
pub fn looks_like_unclassified_transient(reason: &str) -> bool {
    crate::handlers::dev_loop::looks_like_unclassified_transient_for_tests(reason)
}

/// True when `reason` is a terminal agent-side anti-waste signal
/// from the harness (consecutive-error guard, "appears stuck",
/// "stopping to prevent waste"). The error-event handler uses this
/// to skip the restart path because restarting a harness that has
/// already decided to stop just tight-loops on a WS reconnect.
pub fn is_agent_stuck_terminal_signal(reason: &str) -> bool {
    crate::handlers::dev_loop::is_agent_stuck_terminal_signal_for_tests(reason)
}

/// True when an `error`-event reason from the harness should
/// trigger an automaton restart. Restart iff the reason is
/// actually transient (classified or unclassified-transient
/// heuristic) **and** is not a terminal agent-stuck signal.
pub fn should_restart_on_error_event(reason: &str) -> bool {
    crate::handlers::dev_loop::should_restart_on_error_event_for_tests(reason)
}

/// Compatibility shim for the former server-side Definition-of-Done
/// gate. The harness is now authoritative for completion semantics,
/// so aura-os always accepts harness terminal events and only records
/// verification evidence for display.
pub fn completion_validation_reason(
    live_output: &str,
    files_changed: &[&str],
    n_build_steps: usize,
    n_test_steps: usize,
    n_format_steps: usize,
    n_lint_steps: usize,
) -> Option<String> {
    crate::handlers::dev_loop::completion_validation_failure_reason_for_tests(
        live_output,
        files_changed,
        n_build_steps,
        n_test_steps,
        n_format_steps,
        n_lint_steps,
    )
}

/// Compatibility shim for callers that still pass empty-path-write
/// counters. The harness owns task completion, so these counters are
/// diagnostic history only.
pub fn completion_validation_reason_with_empty_path_writes(
    live_output: &str,
    files_changed: &[&str],
    n_build_steps: usize,
    n_test_steps: usize,
    n_format_steps: usize,
    n_lint_steps: usize,
    n_empty_path_writes: u32,
) -> Option<String> {
    crate::handlers::dev_loop::completion_validation_failure_reason_with_empty_path_writes_for_tests(
        live_output,
        files_changed,
        n_build_steps,
        n_test_steps,
        n_format_steps,
        n_lint_steps,
        n_empty_path_writes,
    )
}

/// Compatibility shim for callers that still pass tool-call failures.
/// Harness policy failures remain harness-owned task failures; aura-os
/// should not reinterpret them as server-side DoD failures.
#[allow(clippy::too_many_arguments)]
pub fn completion_validation_reason_with_tool_call_failures(
    live_output: &str,
    files_changed: &[&str],
    n_build_steps: usize,
    n_test_steps: usize,
    n_format_steps: usize,
    n_lint_steps: usize,
    n_empty_path_writes: u32,
    tool_call_failures: &[(&str, &str)],
) -> Option<String> {
    crate::handlers::dev_loop::completion_validation_failure_reason_with_tool_call_failures_for_tests(
        live_output,
        files_changed,
        n_build_steps,
        n_test_steps,
        n_format_steps,
        n_lint_steps,
        n_empty_path_writes,
        tool_call_failures,
    )
}

/// True when a harness-emitted `tool_call_failed` with this
/// `reason` should trigger another server-side infra retry given
/// the number of retries already consumed for the task.
///
/// Mirrors the gate used inside the forwarder's per-tool-call
/// retry dispatch so a regression in the classifier wiring or
/// the [`tool_call_retry_budget`] cap is caught without having
/// to stand up a real automaton. Two axes tested here:
/// * classifier must recognise the reason as infra-transient
///   (`classify_infra_failure` non-None)
/// * counter must be strictly below the budget
pub fn tool_call_failed_should_retry(reason: &str, prior_count: u32) -> bool {
    crate::handlers::dev_loop::tool_call_failed_should_retry_for_tests(reason, prior_count)
}

/// The per-task upper bound on server-side infra-retry attempts
/// driven by `tool_call_failed` events. Returned as a plain `u32`
/// so test assertions stay a single comparison.
#[must_use]
pub const fn tool_call_retry_budget() -> u32 {
    crate::handlers::dev_loop::tool_call_retry_budget_for_tests()
}

/// True when the harness streamed a `write_file` / `edit_file`
/// `tool_call_completed` event with a missing or empty `path`.
/// Those events cannot land on disk and are retained as diagnostic
/// history; the harness owns any resulting completion decision.
///
/// Started/snapshot events are intentionally ignored so a single
/// malformed call is only counted once.
pub fn is_empty_path_write_event(event_type: &str, event: &serde_json::Value) -> bool {
    crate::handlers::dev_loop::is_empty_path_write_event_for_tests(event_type, event)
}

/// Extracts `(path, op)` for a successful
/// `tool_call_completed` representing a `write_file`,
/// `edit_file`, or `delete_file` with a real path. The returned
/// `op` is one of `"create" | "modify" | "delete"` (aligned with
/// `StorageTaskFileChangeSummary::op`).
///
/// This is the fallback signal aura-os uses to populate
/// `files_changed` when the upstream `assistant_message_end` did
/// not carry a `files_changed` payload.
pub fn successful_write_event_path(
    event_type: &str,
    event: &serde_json::Value,
) -> Option<(String, &'static str)> {
    crate::handlers::dev_loop::successful_write_event_path_for_tests(event_type, event)
}

/// True when a successful `task_done` tool completion explicitly declares
/// that no file edits were required for the task.
pub fn task_done_declares_no_changes_needed(event_type: &str, event: &serde_json::Value) -> bool {
    crate::handlers::dev_loop::task_done_declares_no_changes_needed_for_tests(event_type, event)
}

/// Returns a stable diagnostic label when a successful `task_done` call
/// lacks both file-change evidence and `no_changes_needed: true`.
pub fn task_done_missing_file_changes_reason(
    event_type: &str,
    event: &serde_json::Value,
    files_changed: &[&str],
) -> Option<&'static str> {
    crate::handlers::dev_loop::task_done_missing_file_changes_reason_for_tests(
        event_type,
        event,
        files_changed,
    )
}

/// Preflight a local workspace directory the way the dev-loop would
/// when starting a task. Returns `Ok(())` if the workspace is
/// usable (or eligible for auto-clone via `git_repo_url`), and the
/// remediation hint string otherwise.
pub fn preflight_local_workspace(
    project_path: &str,
    git_repo_url: Option<&str>,
) -> Result<(), String> {
    crate::handlers::dev_loop::preflight_local_workspace_for_tests(project_path, git_repo_url)
}

/// Summarize how far a task got in the recovery lifecycle without
/// requiring callers to replay the full handler state machine.
pub fn recovery_checkpoint(
    live_output: &str,
    files_changed: &[&str],
    git_steps: &[serde_json::Value],
) -> &'static str {
    crate::handlers::dev_loop::recovery_checkpoint_for_tests(live_output, files_changed, git_steps)
}

/// Run Phase 5's preflight decomposition detector against a
/// prospective task's `(title, description)`. Returns
/// `Some((reason_label, target_path))` when the heuristic would
/// trigger a skeleton+fill split, `None` otherwise.
pub fn preflight_decomposition_reason(
    title: &str,
    description: &str,
) -> Option<(String, Option<String>)> {
    crate::handlers::task_decompose::preflight_decomposition_reason_for_tests(title, description)
}

/// Test-only: run the dev-loop invariant helper that decides
/// whether a push-layer failure should keep the task in `done`.
/// `push_class` accepts `"timeout"`, `"remote_storage_exhausted"`,
/// or `"generic"` (anything else is treated as `"generic"`).
#[allow(clippy::too_many_arguments)]
pub fn should_task_complete_despite_push_failure(
    live_output: &str,
    files_changed: &[&str],
    n_build_steps: usize,
    n_test_steps: usize,
    n_format_steps: usize,
    n_lint_steps: usize,
    git_steps: &[serde_json::Value],
    push_class: &str,
) -> bool {
    crate::handlers::dev_loop::should_task_complete_despite_push_failure_for_tests(
        live_output,
        files_changed,
        n_build_steps,
        n_test_steps,
        n_format_steps,
        n_lint_steps,
        git_steps,
        push_class,
    )
}

/// Test-only: classify a `task_failed` reason into one of the
/// push-failure classes, or `None` for non-push failures.
/// Returns one of `"timeout" | "remote_storage_exhausted" | "generic"`.
pub fn classify_push_failure(reason: &str) -> Option<&'static str> {
    crate::handlers::dev_loop::classify_push_failure_for_tests(reason)
}

/// Compatibility shim for the retired aura-os DoD retry classifier.
/// Always returns `None`; the harness owns retry/remediation policy.
pub fn classify_dod_remediation_kind(reason: &str) -> Option<&'static str> {
    crate::handlers::dev_loop::classify_dod_remediation_kind_for_tests(reason)
}

/// Compatibility shim for the retired aura-os DoD retry prompt.
/// Always returns `None`; the harness owns follow-up prompts.
pub fn build_dod_followup_prompt(
    kind_label: &str,
    attempt: u32,
    previous_reason: &str,
) -> Option<String> {
    crate::handlers::dev_loop::build_dod_followup_prompt_for_tests(
        kind_label,
        attempt,
        previous_reason,
    )
}

/// Test-only: the retired aura-os Definition-of-Done retry budget.
/// Returns zero because retry/remediation policy now lives in the
/// harness.
#[must_use]
pub const fn max_dod_retries_per_task() -> u32 {
    crate::handlers::dev_loop::max_dod_retries_per_task_for_tests()
}

/// Test-only: exercise the per-project push-failure counter.
/// Bumps the streak `n` times on a fresh project id and returns a
/// vector of `project_push_stuck`-emission booleans. Exactly one
/// entry should be `true` even when `n` exceeds the threshold.
pub fn bump_project_push_failures_streak(n: u32) -> Vec<bool> {
    crate::handlers::dev_loop::bump_project_push_failures_streak_for_tests(n)
}

/// Test-only: bump once, reset, bump once â proves the streak
/// restarts cleanly so a subsequent threshold crossing re-emits
/// `project_push_stuck`.
pub fn push_failure_reset_rearms_stuck_emission() -> bool {
    crate::handlers::dev_loop::push_failure_reset_rearms_stuck_emission_for_tests()
}

/// Test-only: the dev-loop's configured push-failure stuck
/// threshold. Exposed so regression tests don't hard-code the
/// numeric constant.
pub fn consecutive_push_failures_stuck_threshold() -> u32 {
    crate::handlers::dev_loop::CONSECUTIVE_PUSH_FAILURES_STUCK_THRESHOLD
}

pub fn sync_state_from_git_steps(git_steps: &[serde_json::Value]) -> serde_json::Value {
    serde_json::to_value(crate::sync_state::derive_sync_state(git_steps))
        .unwrap_or_else(|_| serde_json::json!({}))
}

pub fn recovery_point_from_git_steps(git_steps: &[serde_json::Value]) -> Option<serde_json::Value> {
    let sync_state = crate::sync_state::derive_sync_state(git_steps);
    crate::sync_state::derive_recovery_point(&sync_state)
        .and_then(|point| serde_json::to_value(point).ok())
}

/// Run the reconciler's pure decision engine against a synthetic
/// task recovery context and return the chosen action as a small
/// JSON payload. Exposed so integration tests and downstream
/// supervisors can exercise the decision table without depending
/// on the server's private module layout.
///
/// `failure_class` accepts one of `"none"`, `"truncation"`,
/// `"rate_limited"`, `"push_timeout"`, `"other"`. Anything else is
/// treated as `"other"`.
///
/// A `max_retries` of `0` is treated as "use the default"
/// ([`crate::reconciler::DEFAULT_MAX_RETRIES_PER_TASK`]) so callers
/// that don't yet persist a per-task budget stay in lockstep with
/// `handlers::dev_loop`'s `MAX_RETRIES_PER_TASK`.
/// Extract the structured provider-failure context that the dev loop
/// plumbs onto `task_failed` events, in the exact shape the UI sees:
/// a JSON object with optional `provider_request_id`, `model`,
/// `sse_error_type`, and `message_id` siblings next to the human-
/// readable `reason`.
///
/// `event_sibling_fields` is merged into the synthetic `task_failed`
/// event *before* context extraction, so callers can exercise both
/// the "harness emitted structured siblings" path and the
/// "classic reason-string-only" fallback through a single entry
/// point. Pass `None` to exercise the fallback path on its own.
///
/// The returned payload is the same object the UI decodes (see
/// `interface/src/stores/task-stream-bootstrap.ts::handleTaskFailed`),
/// so integration tests can assert against the full wire shape
/// without reaching into private handler internals.
pub fn task_failed_payload_with_context(
    task_id: &str,
    reason: &str,
    event_sibling_fields: Option<&serde_json::Map<String, serde_json::Value>>,
) -> serde_json::Value {
    let mut synthetic = serde_json::json!({
        "task_id": task_id,
        "reason": reason,
    });
    if let Some(extra) = event_sibling_fields {
        if let Some(obj) = synthetic.as_object_mut() {
            for (k, v) in extra {
                obj.insert(k.clone(), v.clone());
            }
        }
    }
    let ctx = crate::handlers::dev_loop::extract_task_failure_context(&synthetic, Some(reason));
    if ctx.has_any() {
        if let Some(obj) = synthetic.as_object_mut() {
            ctx.merge_into(obj);
        }
    }
    synthetic
}

pub fn reconcile_decision(
    git_steps: &[serde_json::Value],
    failure_class: &str,
    retry_count: u32,
    max_retries: u32,
    has_live_automaton: bool,
    auto_decompose_disabled: bool,
) -> serde_json::Value {
    reconcile_decision_with_test_evidence(
        git_steps,
        failure_class,
        retry_count,
        max_retries,
        has_live_automaton,
        auto_decompose_disabled,
        false,
    )
}

/// Same as [`reconcile_decision`] but lets tests opt the
/// "tests-as-truth" gate on by passing `has_test_pass_evidence: true`.
/// When the failure is a `CompletionContract`, this rewrites the
/// terminal verdict into a successful `mark_done` with reason
/// `test_evidence_accepted`. Other failure classes are unaffected.
pub fn reconcile_decision_with_test_evidence(
    git_steps: &[serde_json::Value],
    failure_class: &str,
    retry_count: u32,
    max_retries: u32,
    has_live_automaton: bool,
    auto_decompose_disabled: bool,
    has_test_pass_evidence: bool,
) -> serde_json::Value {
    let sync_state = crate::sync_state::derive_sync_state(git_steps);
    let recovery_point = crate::sync_state::derive_recovery_point(&sync_state);
    let failure_signal = match failure_class {
        "none" => None,
        "truncation" => Some(aura_os_harness::signals::HarnessSignal::TaskFailed {
            task_id: None,
            reason: Some("truncation".to_string()),
            failure: aura_os_harness::signals::HarnessFailureKind::Truncation,
        }),
        "rate_limited" => Some(aura_os_harness::signals::HarnessSignal::TaskFailed {
            task_id: None,
            reason: Some("rate_limited".to_string()),
            failure: aura_os_harness::signals::HarnessFailureKind::RateLimited,
        }),
        "completion_contract" => Some(aura_os_harness::signals::HarnessSignal::TaskFailed {
            task_id: None,
            reason: Some("task_done_without_file_changes".to_string()),
            failure: aura_os_harness::signals::HarnessFailureKind::CompletionContract,
        }),
        "push_timeout" => Some(aura_os_harness::signals::HarnessSignal::GitPushFailed {
            task_id: None,
            commit_sha: None,
            reason: Some("git push timeout".to_string()),
        }),
        _ => Some(aura_os_harness::signals::HarnessSignal::TaskFailed {
            task_id: None,
            reason: Some("other".to_string()),
            failure: aura_os_harness::signals::HarnessFailureKind::Other,
        }),
    };
    let effective_max = if max_retries == 0 {
        crate::reconciler::DEFAULT_MAX_RETRIES_PER_TASK
    } else {
        max_retries
    };
    let mut inputs = crate::reconciler::ReconcileInputs::from_sync_state(&sync_state);
    inputs.recovery_point = recovery_point.as_ref();
    inputs.retry_count = retry_count;
    inputs.max_retries = effective_max;
    inputs.latest_signal = failure_signal.as_ref();
    inputs.has_live_automaton = has_live_automaton;
    inputs.auto_decompose_disabled = auto_decompose_disabled;
    inputs.has_test_pass_evidence = has_test_pass_evidence;
    crate::reconciler::decide_reconcile_action(&inputs).to_json()
}

/// Re-export of the test-evidence detector so external integration
/// tests can exercise the same recognizer the dev-loop uses without
/// reaching into private handler internals.
pub fn is_successful_test_run_event(event_type: &str, event: &serde_json::Value) -> bool {
    crate::handlers::dev_loop::is_successful_test_run_event(event_type, event)
}

/// Re-export of the recognizer label so tests can verify which runner
/// satisfied [`is_successful_test_run_event`].
pub fn recognized_test_runner_label(command: &str) -> Option<&'static str> {
    crate::handlers::dev_loop::recognized_test_runner_label(command)
}

/// Replay a raw sequence of streamed `tool_call_*` events through the
/// dev-loop's empty-path-writes bookkeeping and ask the harness-owned
/// completion gate for a verdict.
///
/// The harness now owns Definition-of-Done (see
/// `completion_validation_failure_reason_with_empty_path_writes_for_tests`),
/// so this helper always returns `None` for callers that pass through
/// recovered or fully-evidenced histories — mirroring the deferred
/// behaviour of the live gate. Kept as a public surface so existing
/// regression tests can still call it without compile breakage after
/// the production helpers were split out across modules.
///
/// The replay is performed against the `outstanding_empty_path_write_ids`
/// bookkeeping recorded in [`crate::state::CachedTaskOutput`]: empty-
/// path writes are recorded by tool-call id and reconciled when a
/// subsequent successful pathed write/edit lands. The reconciled count
/// is forwarded to the underlying gate, which currently treats it as
/// diagnostic history only.
pub fn replay_task_completion_gate(
    events: &[(String, serde_json::Value)],
    live_output: &str,
    files_changed: &[&str],
    n_build_steps: usize,
    n_test_steps: usize,
    n_format_steps: usize,
    n_lint_steps: usize,
) -> Option<String> {
    use std::collections::HashSet;
    let mut outstanding: HashSet<String> = HashSet::new();
    let mut had_pathed_write_or_edit = false;
    for (event_type, event) in events {
        let id = event
            .get("id")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        if is_empty_path_write_event(event_type, event) {
            if let Some(id) = id.clone() {
                outstanding.insert(id);
            }
            continue;
        }
        if event_type == "tool_call_completed" {
            if let Some((_path, _op)) =
                crate::handlers::dev_loop::successful_write_event_path_for_tests(event_type, event)
            {
                had_pathed_write_or_edit = true;
            }
        }
    }
    if had_pathed_write_or_edit {
        outstanding.clear();
    }
    let n_empty_path = outstanding.len() as u32;
    completion_validation_reason_with_empty_path_writes(
        live_output,
        files_changed,
        n_build_steps,
        n_test_steps,
        n_format_steps,
        n_lint_steps,
        n_empty_path,
    )
}
