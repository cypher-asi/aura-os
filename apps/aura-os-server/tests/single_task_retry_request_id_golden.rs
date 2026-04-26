//! End-to-end golden regression for the Phase 8 "harden LLM stream
//! retry observability" plan.
//!
//! The plan (c:\\Users\\n3o\\.cursor\\plans\\harden-llm-stream-retry-observability_9a4b1e2f.plan.md)
//! plumbs the HTTP `x-request-id` captured by aura-harness
//! (`StreamEvent::HttpMeta`) all the way onto the `task_failed` event
//! emitted by the dev loop, and — on the server side — onto the JSON
//! payload the UI's Run sidekick decodes. This integration test pins
//! the wire shape at the *single seam* the UI and the operator
//! tooling depend on, so a future refactor of the harness, of
//! `extract_task_failure_context`, or of `synthesize_task_failed`
//! cannot silently drop any of the four fields without failing CI.
//!
//! Scope — what this test exercises:
//!
//! * aura-harness's canonical mid-stream error reason string
//!   (produced by `StreamAccumulator::into_response` today, shape
//!   `stream terminated with error (model=…, msg_id=…, request_id=…):
//!   <error_type>: <raw>`).
//! * Dev-loop classification: the reason must stay retryable via
//!   `is_provider_internal_error`, so the single-task restart budget
//!   still kicks in on a failing stream rather than treating it as
//!   terminal.
//! * Event plumbing: whether the harness forwards structured sibling
//!   fields (Commit B wire shape) or only the reason string (pre-
//!   Commit B fallback), the dev loop must produce a `task_failed`
//!   payload carrying `provider_request_id`, `model`, and
//!   `sse_error_type` siblings alongside the human-readable `reason`.
//!
//! Scope — what this test intentionally does *not* exercise:
//!
//! * Running a real mock harness against `run_single_task`. The full
//!   workspace already has end-to-end coverage for the restart /
//!   retry loop in `dev_loop_dod_regression.rs` and
//!   `autonomous_recovery_replay.rs`; replicating that plumbing here
//!   would duplicate those fixtures without catching anything new.
//!   Instead this test pins the single serialization seam (`task_failed`
//!   payload) that the UI decodes — if *that* shape regresses, the
//!   Run sidekick's "req=… model=… sse_error_type=…" label vanishes
//!   regardless of how the rest of the harness/server plumbing
//!   behaves.
//! * On-disk run-bundle artifacts (`llm_calls.jsonl` / `retries.jsonl`).
//!   Those are produced by the harness, not the server, and are
//!   already covered by the aura-harness side of the Phase 8 plan
//!   (Commits A/B).

use aura_os_server::phase7_test_support::{
    is_provider_internal_error, task_failed_payload_with_context,
};
use serde_json::{json, Map, Value};

/// Canonical reason string aura-harness produces when the streamed
/// response aborts mid-frame with an Anthropic `api_error`. The shape
/// is asserted by `crates/aura-reasoner/src/anthropic/sse.rs` tests
/// in the harness repo; we keep the string verbatim here so any
/// divergence between the two wire formats surfaces immediately.
const HARNESS_REASON: &str = "stream terminated with error (model=claude-sonnet-4, msg_id=msg_01ABC, request_id=req_01XYZ): api_error: Internal server error";

#[test]
fn task_failed_payload_carries_provider_context_from_reason_fallback() {
    // Pre-Commit-B path: the harness only forwards the reason string
    // and the dev loop must parse the `(…)` fragments out of it to
    // hydrate the sibling fields the UI renders.
    let payload = task_failed_payload_with_context("task-abc", HARNESS_REASON, None);
    let obj = payload
        .as_object()
        .expect("task_failed payload is a JSON object");

    assert_eq!(
        obj.get("reason").and_then(Value::as_str),
        Some(HARNESS_REASON),
        "human-readable reason must survive alongside the structured siblings",
    );
    assert_eq!(
        obj.get("provider_request_id").and_then(Value::as_str),
        Some("req_01XYZ"),
        "provider_request_id must be parsed from the reason's `request_id=…` fragment",
    );
    assert_eq!(
        obj.get("model").and_then(Value::as_str),
        Some("claude-sonnet-4"),
        "model must be parsed from the reason's `model=…` fragment",
    );
    assert_eq!(
        obj.get("sse_error_type").and_then(Value::as_str),
        Some("api_error"),
        "sse_error_type must be parsed from the `): api_error:` segment of the reason",
    );
    assert_eq!(
        obj.get("message_id").and_then(Value::as_str),
        Some("msg_01ABC"),
        "message_id must be parsed from the reason's `msg_id=…` fragment",
    );
}

#[test]
fn task_failed_payload_prefers_structured_event_fields_over_reason_parsing() {
    // Commit-B path: the harness forwards structured sibling fields
    // from `StreamEvent::HttpMeta` / `DebugEvent::LlmCall`. Those must
    // take precedence over anything parsed out of the reason string —
    // the fragments in the reason are a compatibility shim, not the
    // source of truth.
    let mut siblings = Map::new();
    siblings.insert(
        "provider_request_id".into(),
        Value::String("req_from_header".into()),
    );
    siblings.insert("model".into(), Value::String("claude-opus-4".into()));
    siblings.insert(
        "sse_error_type".into(),
        Value::String("overloaded_error".into()),
    );
    siblings.insert("message_id".into(), Value::String("msg_from_stream".into()));

    let payload = task_failed_payload_with_context("task-abc", HARNESS_REASON, Some(&siblings));
    let obj = payload
        .as_object()
        .expect("task_failed payload is a JSON object");

    assert_eq!(
        obj.get("provider_request_id").and_then(Value::as_str),
        Some("req_from_header"),
        "structured sibling must win over `request_id=req_01XYZ` in the reason",
    );
    assert_eq!(
        obj.get("model").and_then(Value::as_str),
        Some("claude-opus-4"),
        "structured model sibling must win over the reason's `model=…` fragment",
    );
    assert_eq!(
        obj.get("sse_error_type").and_then(Value::as_str),
        Some("overloaded_error"),
        "structured sse_error_type must win over the reason's `api_error`",
    );
    assert_eq!(
        obj.get("message_id").and_then(Value::as_str),
        Some("msg_from_stream"),
        "structured message_id must win over the reason's `msg_id=…` fragment",
    );
    assert_eq!(
        obj.get("reason").and_then(Value::as_str),
        Some(HARNESS_REASON),
        "reason must not be rewritten when structured siblings take precedence",
    );
}

#[test]
fn task_failed_payload_accepts_legacy_sibling_aliases() {
    // Older harness builds (and the pre-Phase-8 automaton) emit
    // `request_id` / `error_type` / `msg_id` directly as siblings.
    // The extractor must accept those aliases and surface them under
    // the canonical field names, otherwise a half-upgraded fleet
    // silently loses the context label.
    let mut legacy = Map::new();
    legacy.insert("request_id".into(), Value::String("req_legacy".into()));
    legacy.insert("error_type".into(), Value::String("api_error".into()));
    legacy.insert("msg_id".into(), Value::String("msg_legacy".into()));

    let payload = task_failed_payload_with_context(
        "task-abc",
        "stream terminated with error (model=claude-sonnet-4): api_error: boom",
        Some(&legacy),
    );
    let obj = payload
        .as_object()
        .expect("task_failed payload is a JSON object");

    assert_eq!(
        obj.get("provider_request_id").and_then(Value::as_str),
        Some("req_legacy"),
        "`request_id` alias must be normalised to `provider_request_id`",
    );
    assert_eq!(
        obj.get("sse_error_type").and_then(Value::as_str),
        Some("api_error"),
        "`error_type` alias must be normalised to `sse_error_type`",
    );
    assert_eq!(
        obj.get("message_id").and_then(Value::as_str),
        Some("msg_legacy"),
        "`msg_id` alias must be normalised to `message_id`",
    );
    assert_eq!(
        obj.get("model").and_then(Value::as_str),
        Some("claude-sonnet-4"),
        "model must still fall back to the reason-string fragment when no sibling is set",
    );
}

#[test]
fn task_failed_payload_drops_context_when_unavailable() {
    // A bare infra-retry reason (no `(…)` fragments, no siblings) must
    // not synthesize any context — the UI treats missing siblings as
    // "no label to render", which is the correct outcome when the
    // underlying failure is e.g. a pre-stream `ECONNRESET`.
    let payload = task_failed_payload_with_context("task-abc", "reset: connection closed", None);
    let obj = payload
        .as_object()
        .expect("task_failed payload is a JSON object");

    assert_eq!(
        obj.get("reason").and_then(Value::as_str),
        Some("reset: connection closed")
    );
    assert!(
        obj.get("provider_request_id").is_none(),
        "no provider context is available on a bare reset; must stay absent"
    );
    assert!(obj.get("model").is_none());
    assert!(obj.get("sse_error_type").is_none());
    assert!(obj.get("message_id").is_none());
    // Guard the minimal shape so a future refactor can't accidentally
    // add stray keys (a nondeterministic wire shape breaks consumers
    // that match by key presence).
    let unexpected_keys: Vec<&String> = obj
        .keys()
        .filter(|k| !matches!(k.as_str(), "task_id" | "reason"))
        .collect();
    assert!(
        unexpected_keys.is_empty(),
        "unexpected keys on a context-free task_failed payload: {unexpected_keys:?}",
    );
}

#[test]
fn harness_reason_still_routes_through_provider_internal_error_retry_path() {
    // The reason string must keep matching `is_provider_internal_error`
    // so the single-task restart budget (Phase 5's
    // `SINGLE_TASK_RESTART_BUDGET=3`) still kicks in on a streaming
    // failure. If this regresses, the mid-stream 5xx case goes back to
    // being terminal and the 3-retry budget added in the prior
    // session is silently bypassed.
    assert!(
        is_provider_internal_error(HARNESS_REASON),
        "canonical harness reason must classify as ProviderInternalError \
         so the single-task retry budget still applies",
    );
    // Sanity-check the negative — if a future change to the marker
    // list accidentally makes the predicate trivially true, this
    // regression assertion catches it.
    assert!(
        !is_provider_internal_error(
            "task reached implementation phase but no file operations completed"
        ),
        "truncation-style failures must not be absorbed into the provider-internal-error bucket",
    );
}

#[test]
fn partial_sibling_fields_merge_without_clobbering_siblings_from_reason() {
    // Mixed path: the harness forwards only `provider_request_id` from
    // the HTTP header (the other fields require a parsed MessageStart
    // which may not have arrived before the stream aborted). The
    // missing fields must fall back to reason-string parsing, so the
    // UI still gets a full `req=… model=… sse_error_type=…` label.
    let mut partial = Map::new();
    partial.insert(
        "provider_request_id".into(),
        Value::String("req_header_only".into()),
    );

    let payload = task_failed_payload_with_context("task-abc", HARNESS_REASON, Some(&partial));
    let obj = payload
        .as_object()
        .expect("task_failed payload is a JSON object");

    assert_eq!(
        obj.get("provider_request_id").and_then(Value::as_str),
        Some("req_header_only"),
        "the sibling-provided provider_request_id must take precedence",
    );
    assert_eq!(
        obj.get("model").and_then(Value::as_str),
        Some("claude-sonnet-4"),
        "model must still be recovered from the reason string when the sibling is absent",
    );
    assert_eq!(
        obj.get("sse_error_type").and_then(Value::as_str),
        Some("api_error"),
        "sse_error_type must still be recovered from the reason string when the sibling is absent",
    );
    assert_eq!(
        obj.get("message_id").and_then(Value::as_str),
        Some("msg_01ABC"),
        "message_id must still be recovered from the reason string when the sibling is absent",
    );
}

/// Guard for the wire shape the UI's Run sidekick decodes. If a new
/// field sneaks onto the `task_failed` payload (or an existing one is
/// renamed), the UI breaks silently: `formatFailureContext` pulls
/// exactly these four keys and the renderer's `failReasonContext`
/// line disappears when any of them are missing. Pinning the full set
/// here means a future harness/automaton change cannot regress the
/// observable UX without failing this test first.
#[test]
fn golden_wire_shape_matches_ui_expectation() {
    let payload = task_failed_payload_with_context("task-abc", HARNESS_REASON, None);
    let expected = json!({
        "task_id": "task-abc",
        "reason": HARNESS_REASON,
        "provider_request_id": "req_01XYZ",
        "model": "claude-sonnet-4",
        "sse_error_type": "api_error",
        "message_id": "msg_01ABC",
    });
    assert_eq!(
        payload, expected,
        "task_failed wire shape drifted from the UI contract; \
         update interface/src/stores/task-stream-bootstrap.ts \
         (handleTaskFailed) and CompletedTaskOutput.formatFailureContext \
         together if this is intentional",
    );
}
