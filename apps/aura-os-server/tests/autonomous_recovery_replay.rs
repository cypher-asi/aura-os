//! Phase 7a — replay-based integration test for the autonomous
//! recovery pipeline.
//!
//! Reproduces the scenario the plan's `autonomous-dev-loop-resilience`
//! was designed for: a task-spec that asks the agent to generate the
//! *full implementation* of a specific file, the agent spends many
//! turns on `search_code` and `text_delta` narration, and then
//! `task_failed` with a reason string of the Phase 2b
//! `NeedsDecomposition` shape.
//!
//! What we can exercise end-to-end in integration form:
//!
//! * [`aura_run_heuristics::analyze`] against a synthetic bundle on
//!   disk returns at least one finding whose remediation is
//!   `SplitWriteIntoSkeletonPlusAppends` with the concrete path the
//!   agent was stuck on.
//! * Phase 3's failure classifier treats the synthesized reason string
//!   as [`FailureClass::Truncation`] via
//!   [`aura_os_server::phase7_test_support::is_truncation_failure`].
//! * Phase 5's preflight detector matches the canonical
//!   "generate the full implementation of …" description via
//!   [`aura_os_server::phase7_test_support::preflight_decomposition_reason`].
//!
//! What we punt on (consistent with the Phase 3/5/6 punts called out
//! in the plan):
//!
//! * [`try_remediate_task_failure`] itself — it needs a live
//!   `TaskService`, a `LoopLogWriter`, a broadcast channel, and a
//!   storage backend. We already have unit coverage for the decision
//!   logic in `handlers::dev_loop::tests`; mocking every dependency
//!   here would duplicate that coverage without catching anything new.
//! * [`spawn_skeleton_and_fill_children`] prompt formatting — the
//!   helper is async and requires a `TaskService`. The pure part
//!   (`DecompositionContext::header`) is already covered by the
//!   Phase 5 unit test `header_differs_between_contexts`.
//!
//! Both punts are documented inline below so it's obvious to the next
//! reader why these aren't asserted here.

use std::fs;
use std::path::Path;

use aura_run_heuristics::{analyze, load_bundle, RemediationHint};
use chrono::{TimeZone, Utc};
use serde_json::{json, Value};
use tempfile::TempDir;

const PROJECT_ID: &str = "11111111-1111-4111-8111-111111111111";
const AGENT_INSTANCE_ID: &str = "22222222-2222-4222-8222-222222222222";
const TASK_ID: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RUN_ID: &str = "20240101_000000_replay";

/// Path the simulated run kept trying to write. The concrete value
/// matters — the heuristic pipeline surfaces it verbatim as the
/// remediation target and Phase 3 feeds it into
/// `spawn_skeleton_and_fill_children`.
const BLOCKED_PATH: &str = "crates/foo/src/bar.rs";

/// Reason string of the Phase 2b `NeedsDecomposition` shape. The exact
/// wording is what the harness produces today; `classify_failure` only
/// cares that `"needs decomposition"` appears somewhere case-
/// insensitively.
const FAILURE_REASON: &str =
    "task reached implementation phase but no file operations completed — \
     needs decomposition (failed_paths=1, last_pending=Some(\"crates/foo/src/bar.rs\"))";

/// Build a minimal-but-realistic run bundle on disk and return the
/// tempdir guard plus the bundle path.
fn stage_bundle() -> (TempDir, std::path::PathBuf) {
    let tmp = TempDir::new().expect("tempdir");
    let bundle_dir = tmp.path().to_path_buf();

    let started = Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap();
    let failed_at = Utc.with_ymd_and_hms(2024, 1, 1, 0, 3, 30).unwrap();

    let metadata = json!({
        "run_id": RUN_ID,
        "project_id": PROJECT_ID,
        "agent_instance_id": AGENT_INSTANCE_ID,
        "started_at": started.to_rfc3339(),
        "ended_at": failed_at.to_rfc3339(),
        "status": "failed",
        // A single dangling task: `task_never_completed` fires on this,
        // which together with the blocker repetition gives us the
        // concrete-path `SplitWriteIntoSkeletonPlusAppends` finding the
        // assertion below looks for.
        "tasks": [{
            "task_id": TASK_ID,
            "spec_id": null,
            "started_at": started.to_rfc3339(),
            "ended_at": null,
            "status": null,
        }],
        "spec_ids": [],
        "counters": {
            "events_total": 18,
            "llm_calls": 5,
            "iterations": 5,
            "blockers": 3,
            "retries": 0,
            "tool_calls": 5,
            "task_completed": 0,
            "task_failed": 1,
            "input_tokens": 85_000,
            "output_tokens": 600,
            "narration_deltas": 7,
        }
    });
    fs::write(
        bundle_dir.join("metadata.json"),
        serde_json::to_vec_pretty(&metadata).unwrap(),
    )
    .unwrap();

    // events.jsonl — the sequence the agent actually produced on the
    // failing turn: task_started, a few search_code tool calls, several
    // text_delta narration frames, then task_failed with the Phase 2b
    // reason string. Ordering is significant for any future
    // timeline-based rule; no current rule actually walks this stream,
    // but we include it so the fixture reads like a real bundle.
    write_jsonl(
        &bundle_dir.join("events.jsonl"),
        &[
            json!({"type": "task_started", "task_id": TASK_ID}),
            json!({
                "type": "tool_call_started",
                "task_id": TASK_ID,
                "name": "search_code",
                "input": {"pattern": "pub fn generate|NeuralKey"}
            }),
            json!({
                "type": "tool_call_started",
                "task_id": TASK_ID,
                "name": "search_code",
                "input": {"pattern": "impl NeuralKey"}
            }),
            json!({
                "type": "tool_call_started",
                "task_id": TASK_ID,
                "name": "search_code",
                "input": {"pattern": "pub fn generate|impl NeuralKey"}
            }),
            json!({"type": "text_delta", "task_id": TASK_ID, "delta": "Now I'll plan the module. "}),
            json!({"type": "text_delta", "task_id": TASK_ID, "delta": "First I need to consider edge cases. "}),
            json!({"type": "text_delta", "task_id": TASK_ID, "delta": "Let me think about the API shape. "}),
            json!({"type": "text_delta", "task_id": TASK_ID, "delta": "I'll outline each function. "}),
            json!({"type": "text_delta", "task_id": TASK_ID, "delta": "Considering error handling… "}),
            json!({
                "type": "tool_call_started",
                "task_id": TASK_ID,
                "name": "write_file",
                "input": {"path": BLOCKED_PATH, "content": "<TRUNCATED — 12kb payload>"}
            }),
            json!({
                "type": "task_failed",
                "task_id": TASK_ID,
                "reason": FAILURE_REASON,
            }),
        ],
    );

    // Blockers with the concrete path give `repeated_blocker_path` a
    // finding that carries `BLOCKED_PATH` verbatim into its
    // `SplitWriteIntoSkeletonPlusAppends` remediation — this is the
    // finding the assertion below pattern-matches on.
    write_jsonl(
        &bundle_dir.join("blockers.jsonl"),
        &[
            json!({
                "type": "debug.blocker",
                "task_id": TASK_ID,
                "path": BLOCKED_PATH,
                "message": "write_file truncated"
            }),
            json!({
                "type": "debug.blocker",
                "task_id": TASK_ID,
                "path": BLOCKED_PATH,
                "message": "write_file truncated"
            }),
            json!({
                "type": "debug.blocker",
                "task_id": TASK_ID,
                "path": BLOCKED_PATH,
                "message": "write_file truncated"
            }),
        ],
    );

    // A few iterations so the zero_tool_calls_in_turn and
    // slow_iteration rules have something to chew on; the stream we
    // assert against doesn't depend on these, but including them keeps
    // the bundle shape representative.
    write_jsonl(
        &bundle_dir.join("iterations.jsonl"),
        &[
            json!({"type": "debug.iteration", "task_id": TASK_ID, "duration_ms": 900, "tool_calls": 1}),
            json!({"type": "debug.iteration", "task_id": TASK_ID, "duration_ms": 1_200, "tool_calls": 0}),
            json!({"type": "debug.iteration", "task_id": TASK_ID, "duration_ms": 1_100, "tool_calls": 0}),
            json!({"type": "debug.iteration", "task_id": TASK_ID, "duration_ms": 1_300, "tool_calls": 0}),
            json!({"type": "debug.iteration", "task_id": TASK_ID, "duration_ms": 1_400, "tool_calls": 1}),
        ],
    );
    write_jsonl(
        &bundle_dir.join("llm_calls.jsonl"),
        &[json!({
            "type": "debug.llm_call",
            "task_id": TASK_ID,
            "model": "claude-4.6-sonnet",
            "input_tokens": 80_000,
            "output_tokens": 500
        })],
    );
    write_jsonl(&bundle_dir.join("retries.jsonl"), &[]);

    (tmp, bundle_dir)
}

fn write_jsonl(path: &Path, events: &[Value]) {
    let mut body = String::new();
    for event in events {
        let wrapped = json!({
            "_ts": "2024-01-01T00:00:00Z",
            "event": event,
        });
        body.push_str(&serde_json::to_string(&wrapped).unwrap());
        body.push('\n');
    }
    fs::write(path, body).unwrap();
}

#[test]
fn classify_failure_recognizes_needs_decomposition_reason() {
    assert!(
        aura_os_server::phase7_test_support::is_truncation_failure(FAILURE_REASON),
        "Phase 2b-style reason string must classify as Truncation so \
         try_remediate_task_failure enters the remediation path",
    );
    // Sanity-check the negative so a future tweak to the marker list
    // doesn't silently turn this into an always-true assertion.
    assert!(
        !aura_os_server::phase7_test_support::is_truncation_failure(
            "tool execution failed: ENETUNREACH"
        ),
        "transport-level errors must not be auto-decomposed",
    );
}

#[test]
fn classify_push_timeout_as_post_commit_infra_not_truncation() {
    let reason = "git_commit_push timed out while waiting for git push to origin";
    assert!(
        aura_os_server::phase7_test_support::is_git_push_timeout_failure(reason),
        "push-leg timeouts must route to the non-fatal post-commit infra path",
    );
    assert!(
        !aura_os_server::phase7_test_support::is_truncation_failure(reason),
        "push timeouts must not burn truncation-remediation budget",
    );
}

#[test]
fn heuristics_surface_split_write_for_blocked_path() {
    let (_tmp, bundle_dir) = stage_bundle();
    let view = load_bundle(&bundle_dir).expect("load synthesized bundle");
    let findings = analyze(&view);

    let matched = findings.iter().any(|f| match &f.remediation {
        Some(RemediationHint::SplitWriteIntoSkeletonPlusAppends {
            path,
            suggested_chunk_bytes,
        }) => path == BLOCKED_PATH && *suggested_chunk_bytes == 6_000,
        _ => false,
    });
    assert!(
        matched,
        "expected a SplitWriteIntoSkeletonPlusAppends finding for \
         path={BLOCKED_PATH} with chunk=6000; got {findings:#?}"
    );
}

#[test]
fn completion_validation_rejects_unverified_source_changes() {
    let reason = aura_os_server::phase7_test_support::completion_validation_reason(
        "edited source",
        &["src/lib.rs"],
        0,
        0,
        0,
        0,
    )
    .expect("source changes without verification should be rejected");
    assert!(
        reason.contains("no build/compile step"),
        "expected build-step rejection, got {reason:?}",
    );
}

#[test]
fn recovery_checkpoint_marks_commit_created_when_push_fails() {
    let git_steps = vec![
        json!({"type": "git_committed", "commit_sha": "abc123"}),
        json!({"type": "git_push_failed", "reason": "timeout"}),
    ];
    assert_eq!(
        aura_os_server::phase7_test_support::recovery_checkpoint(
            "implementation completed",
            &["src/lib.rs"],
            &git_steps,
        ),
        "commit_created",
        "post-commit push failures should preserve the durable local-work checkpoint",
    );
}

#[test]
fn classify_stream_terminated_internal_as_provider_internal_error() {
    // Axis 1 lives-or-dies on this exact reason string from the user
    // bug report: the task failed with the wording emitted by the
    // harness when an LLM request hits a provider-side 5xx or the
    // streamed response is aborted mid-frame. If this assertion ever
    // regresses, the dev loop will go back to treating it as fatal
    // and the original `1.1 Create zero-core crate with newtype IDs`
    // failure resurfaces.
    for reason in [
        "LLM error: stream terminated with error: Internal server error",
        "LLM error: HTTP 500 from provider",
        "upstream returned 502 Bad Gateway",
        "connection reset by peer while streaming",
    ] {
        assert!(
            aura_os_server::phase7_test_support::is_provider_internal_error(reason),
            "{reason:?} must classify as ProviderInternalError so Axis 3's \
             jittered escalation path runs instead of terminating the task",
        );
    }

    // Sanity-check that truly unrelated failures still do *not* go
    // down the provider-internal-error path — otherwise a broken
    // classifier could absorb rate limits or truncation into the
    // retry bucket and silently burn cooldown budget.
    for reason in [
        "task reached implementation phase but no file operations completed — needs decomposition",
        "HTTP 429 too many requests",
    ] {
        assert!(
            !aura_os_server::phase7_test_support::is_provider_internal_error(reason),
            "{reason:?} is not a 5xx/stream-abort and must stay on its own \
             failure path",
        );
    }
}

#[test]
fn looks_like_unclassified_transient_detects_retry_miss_candidates() {
    // Axis 4: when the classifier returns `None` but the text reads
    // like a transient network blip, the dev loop emits
    // `debug.retry_miss` so `aura-run-heuristics` can flag the gap.
    // These are reasons the heuristic *should* catch.
    for reason in [
        "dns lookup failed for api.example.com",
        "tls handshake failure while streaming response",
        "socket hang up",
    ] {
        assert!(
            aura_os_server::phase7_test_support::looks_like_unclassified_transient(reason),
            "{reason:?} looks transient but isn't classified — dev loop \
             must emit debug.retry_miss so the gap is visible in bundles",
        );
    }

    // And things that shouldn't trip the detector — either because
    // the classifier already owns them (so `looks_like_unclassified_
    // transient_for_tests` short-circuits on the `is_none()` guard)
    // or because they genuinely aren't transient.
    for reason in [
        "LLM error: stream terminated with error: Internal server error",
        "task reached implementation phase but no file operations completed — needs decomposition",
    ] {
        assert!(
            !aura_os_server::phase7_test_support::looks_like_unclassified_transient(reason),
            "{reason:?} is either already classified or not transient — \
             must not produce a spurious debug.retry_miss",
        );
    }
}

#[test]
fn preflight_decomposition_flags_full_implementation_description() {
    let hit = aura_os_server::phase7_test_support::preflight_decomposition_reason(
        "Implement NeuralKey",
        "Please generate the full implementation of `crates/foo/src/bar.rs`, \
         covering every public function and every error path.",
    )
    .expect("canonical 'generate the full implementation of …' should match");
    let (reason, target) = hit;
    assert!(
        reason.starts_with("phrase:"),
        "expected a phrase-match reason label, got {reason:?}",
    );
    assert_eq!(
        target.as_deref(),
        Some("crates/foo/src/bar.rs"),
        "preflight detector should lift the backticked target path",
    );
}

// NOTE (punted):
//
// * Invoking `try_remediate_task_failure` end-to-end requires a live
//   `TaskService`, a `LoopLogWriter`, a `broadcast::Sender`, and a
//   storage backend wired together. The `handlers::dev_loop::tests`
//   module already exercises every branch of the decision logic
//   against real helpers behind mocks; running it again here would
//   duplicate that coverage without catching anything new. The
//   individual pieces (`classify_failure`, `analyze` →
//   `SplitWriteIntoSkeletonPlusAppends`, `detect_preflight_
//   decomposition`) are asserted above, which covers every input to
//   the remediation decision short of the storage side effect.
//
// * The child-task prompt formatting produced by
//   `spawn_skeleton_and_fill_children` is async and needs a
//   `TaskService`; its pure contribution is the header line, and the
//   Phase 5 unit test `header_differs_between_contexts` already pins
//   down both `PostFailure` and `Preflight` wordings.
