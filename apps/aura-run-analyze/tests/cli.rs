//! End-to-end tests for the `aura-run-analyze` binary. Each test
//! stages a synthetic bundle in a tempdir, invokes the compiled
//! binary via `assert_cmd`, and asserts on stdout + exit code.

use std::fs;
use std::path::{Path, PathBuf};

use assert_cmd::Command;
use chrono::{TimeZone, Utc};
use predicates::prelude::*;
use serde_json::{json, Value};
use tempfile::TempDir;

const PROJECT_ID: &str = "11111111-1111-4111-8111-111111111111";
const AGENT_INSTANCE_ID: &str = "22222222-2222-4222-8222-222222222222";
const TASK_A: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RUN_ID: &str = "20260420_143022_run";

struct Fixture {
    _tmp: TempDir,
    loop_logs_dir: PathBuf,
    bundle_dir: PathBuf,
}

fn stage_bundle() -> Fixture {
    let tmp = TempDir::new().expect("tempdir");
    let loop_logs_dir = tmp.path().to_path_buf();
    let bundle_dir = loop_logs_dir.join(PROJECT_ID).join(RUN_ID);
    fs::create_dir_all(&bundle_dir).expect("bundle dir");

    let started = Utc.with_ymd_and_hms(2026, 4, 20, 14, 30, 22).unwrap();
    let ended = Utc.with_ymd_and_hms(2026, 4, 20, 14, 45, 0).unwrap();
    let metadata = json!({
        "run_id": RUN_ID,
        "project_id": PROJECT_ID,
        "agent_instance_id": AGENT_INSTANCE_ID,
        "started_at": started.to_rfc3339(),
        "ended_at": ended.to_rfc3339(),
        "status": "failed",
        "tasks": [
            {
                "task_id": TASK_A,
                "spec_id": null,
                "started_at": started.to_rfc3339(),
                "ended_at": null,
                "status": null
            }
        ],
        "spec_ids": [],
        "counters": {
            "events_total": 42,
            "llm_calls": 3,
            "iterations": 5,
            "blockers": 3,
            "retries": 2,
            "tool_calls": 7,
            "task_completed": 0,
            "task_failed": 1,
            "input_tokens": 120000,
            "output_tokens": 800
        }
    });
    fs::write(
        bundle_dir.join("metadata.json"),
        serde_json::to_vec_pretty(&metadata).unwrap(),
    )
    .unwrap();

    write_jsonl(
        &bundle_dir.join("blockers.jsonl"),
        &[
            json!({"type": "debug.blocker", "path": "src/foo.rs", "task_id": TASK_A}),
            json!({"type": "debug.blocker", "path": "src/foo.rs", "task_id": TASK_A}),
            json!({"type": "debug.blocker", "path": "src/foo.rs", "task_id": TASK_A}),
        ],
    );
    write_jsonl(
        &bundle_dir.join("llm_calls.jsonl"),
        &[
            json!({
                "type": "debug.llm_call",
                "model": "claude-4.6-sonnet",
                "task_id": TASK_A,
                "input_tokens": 100_000,
                "output_tokens": 500
            }),
            json!({
                "type": "debug.llm_call",
                "model": "claude-4.6-sonnet",
                "task_id": TASK_A,
                "input_tokens": 20_000,
                "output_tokens": 300
            }),
        ],
    );
    write_jsonl(
        &bundle_dir.join("iterations.jsonl"),
        &[
            json!({"type": "debug.iteration", "task_id": TASK_A, "duration_ms": 500, "tool_calls": 1}),
            json!({"type": "debug.iteration", "task_id": TASK_A, "duration_ms": 35_000, "tool_calls": 2}),
        ],
    );
    write_jsonl(&bundle_dir.join("retries.jsonl"), &[]);
    write_jsonl(&bundle_dir.join("events.jsonl"), &[]);

    Fixture {
        _tmp: tmp,
        loop_logs_dir,
        bundle_dir,
    }
}

fn write_jsonl(path: &Path, events: &[Value]) {
    let mut body = String::new();
    for event in events {
        let wrapped = json!({
            "_ts": "2026-04-20T14:30:22Z",
            "event": event,
        });
        body.push_str(&serde_json::to_string(&wrapped).unwrap());
        body.push('\n');
    }
    fs::write(path, body).unwrap();
}

fn bin() -> Command {
    Command::cargo_bin("aura-run-analyze").expect("binary built")
}

#[test]
fn markdown_output_against_direct_bundle() {
    let fx = stage_bundle();
    let assert = bin()
        .arg(&fx.bundle_dir)
        .arg("--format")
        .arg("markdown")
        .assert()
        .code(2);
    let out = String::from_utf8(assert.get_output().stdout.clone()).unwrap();
    assert!(out.contains("# Run"), "missing H1 header: {out}");
    assert!(
        out.contains("repeated_blocker_path"),
        "missing heuristic id: {out}"
    );
    assert!(
        out.contains("token_hog_llm_call"),
        "missing token_hog id: {out}"
    );
    assert!(
        out.contains("task_never_completed"),
        "missing task_never_completed id: {out}"
    );
    assert!(out.contains("| metric | value |"), "missing counters table");
}

#[test]
fn json_output_shape() {
    let fx = stage_bundle();
    let assert = bin()
        .arg(&fx.bundle_dir)
        .arg("--format")
        .arg("json")
        .assert()
        .code(2);
    let out = String::from_utf8(assert.get_output().stdout.clone()).unwrap();
    let parsed: Value = serde_json::from_str(&out).expect("valid json");
    assert!(parsed.get("metadata").is_some());
    assert!(parsed.get("summary").is_some());
    let findings = parsed["findings"].as_array().expect("findings array");
    assert!(!findings.is_empty());
    let ids: Vec<&str> = findings.iter().filter_map(|f| f["id"].as_str()).collect();
    assert!(ids.contains(&"repeated_blocker_path"));
    assert!(ids.contains(&"token_hog_llm_call"));
    let summary = &parsed["summary"];
    assert!(summary["error_count"].as_u64().unwrap() >= 1);
}

#[test]
fn min_severity_filters_below_threshold() {
    let fx = stage_bundle();
    let assert = bin()
        .arg(&fx.bundle_dir)
        .arg("--format")
        .arg("json")
        .arg("--min-severity")
        .arg("error")
        .assert()
        .code(2);
    let out = String::from_utf8(assert.get_output().stdout.clone()).unwrap();
    let parsed: Value = serde_json::from_str(&out).unwrap();
    let findings = parsed["findings"].as_array().unwrap();
    assert!(findings.iter().all(|f| f["severity"] == "error"));
}

#[test]
fn project_latest_resolves_newest_run() {
    let fx = stage_bundle();
    let assert = bin()
        .arg("--loop-logs-dir")
        .arg(&fx.loop_logs_dir)
        .arg("--project")
        .arg(PROJECT_ID)
        .arg("--latest")
        .arg("--format")
        .arg("markdown")
        .assert()
        .code(2);
    let out = String::from_utf8(assert.get_output().stdout.clone()).unwrap();
    assert!(out.contains(RUN_ID));
}

#[test]
fn list_mode_shows_projects_and_runs() {
    let fx = stage_bundle();
    bin()
        .arg("--list")
        .arg("--loop-logs-dir")
        .arg(&fx.loop_logs_dir)
        .assert()
        .code(0)
        .stdout(predicate::str::contains(PROJECT_ID))
        .stdout(predicate::str::contains(RUN_ID));
}

#[test]
fn clean_bundle_exits_zero() {
    let tmp = TempDir::new().unwrap();
    let bundle_dir = tmp.path().join("bundle");
    fs::create_dir_all(&bundle_dir).unwrap();
    let started = Utc.with_ymd_and_hms(2026, 4, 20, 14, 30, 22).unwrap();
    let ended = Utc.with_ymd_and_hms(2026, 4, 20, 14, 31, 0).unwrap();
    let metadata = json!({
        "run_id": RUN_ID,
        "project_id": PROJECT_ID,
        "agent_instance_id": AGENT_INSTANCE_ID,
        "started_at": started.to_rfc3339(),
        "ended_at": ended.to_rfc3339(),
        "status": "completed",
        "tasks": [],
        "spec_ids": [],
        "counters": {
            "events_total": 1,
            "llm_calls": 0,
            "iterations": 0,
            "blockers": 0,
            "retries": 0,
            "tool_calls": 0,
            "task_completed": 0,
            "task_failed": 0,
            "input_tokens": 0,
            "output_tokens": 0
        }
    });
    fs::write(
        bundle_dir.join("metadata.json"),
        serde_json::to_vec_pretty(&metadata).unwrap(),
    )
    .unwrap();
    bin().arg(&bundle_dir).assert().code(0);
}
