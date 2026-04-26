//! Synthesise a run bundle on disk and assert the analyzer surfaces
//! the expected `SplitWriteIntoSkeletonPlusAppends` finding.

use std::fs;
use std::path::Path;

use aura_run_heuristics::{analyze, load_bundle, RemediationHint};
use chrono::{TimeZone, Utc};
use serde_json::{json, Value};
use tempfile::TempDir;

use super::{AGENT_INSTANCE_ID, BLOCKED_PATH, FAILURE_REASON, PROJECT_ID, RUN_ID, TASK_ID};

/// Build a minimal-but-realistic run bundle on disk and return the
/// tempdir guard plus the bundle path.
pub(crate) fn stage_bundle() -> (TempDir, std::path::PathBuf) {
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
