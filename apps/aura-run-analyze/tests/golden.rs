//! Phase 7b — golden test pinning the markdown renderer output for a
//! canned "truncated run" fixture.
//!
//! The fixture under `tests/fixtures/truncated-run/` is a
//! deliberately minimal run bundle that triggers exactly two
//! heuristics:
//!
//! * `task_never_completed` (Error) — one task in `metadata.tasks` has
//!   a null `ended_at` on a `Failed` run.
//! * `zero_tool_calls_in_turn` (Warn) — four consecutive iterations
//!   reported `tool_calls == 0` for the same task.
//!
//! Both rules attach a `RemediationHint`, so the rendered output
//! carries the Phase 2a `fix:` lines the test asserts on.
//!
//! Regenerating the golden: set `UPDATE_GOLDEN=1` and re-run the
//! test. The observed (normalised) stdout is written back to
//! `expected-output.txt` and the test short-circuits to success. Use
//! when the renderer output intentionally changes; check the diff
//! into source control alongside the change.

use std::fs;
use std::path::{Path, PathBuf};

use assert_cmd::Command;

/// Run `aura-run-analyze` against a bundle directory in markdown mode
/// and return the raw stdout as a `String`. Panics on IO / UTF-8
/// errors — a golden test has nothing useful to do with them.
fn run_analyze_markdown(bundle_dir: &Path) -> String {
    let output = Command::cargo_bin("aura-run-analyze")
        .expect("aura-run-analyze binary built")
        .arg(bundle_dir)
        .arg("--format")
        .arg("markdown")
        .output()
        .expect("spawn aura-run-analyze");
    // Exit code 2 is expected (there's an Error-severity finding in the
    // fixture); we only care about stdout here.
    String::from_utf8(output.stdout).expect("stdout is utf-8")
}

/// Normalise the `- path:` line to a fixed placeholder so the golden
/// is identical regardless of absolute path / path separator / CWD
/// quirks across machines and operating systems.
///
/// Every other line is expected to already be deterministic (ids,
/// rfc3339 timestamps, and counters in the fixture are all fixed).
fn normalize(output: &str) -> String {
    let mut lines: Vec<String> = Vec::new();
    for line in output.lines() {
        if line.starts_with("- path: ") {
            lines.push("- path: `<FIXTURE>`".to_string());
        } else {
            lines.push(line.to_string());
        }
    }
    let mut joined = lines.join("\n");
    joined.push('\n');
    joined
}

fn fixture_dir() -> PathBuf {
    // CARGO_MANIFEST_DIR is the package root at compile time; derive
    // the fixture path from it so the test is robust to the test
    // runner's CWD.
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("truncated-run")
}

#[test]
fn truncated_run_golden_output_matches() {
    let fixture = fixture_dir();
    let out = run_analyze_markdown(&fixture);
    let normalized = normalize(&out);

    let expected_path = fixture.join("expected-output.txt");

    // `UPDATE_GOLDEN=1` turns this test into a one-shot regenerator.
    // The existing-but-different expected file is simply overwritten;
    // review the resulting diff before committing.
    if std::env::var("UPDATE_GOLDEN").is_ok() {
        fs::write(&expected_path, normalized.as_bytes()).expect("write regenerated golden");
        eprintln!(
            "UPDATE_GOLDEN=1: wrote {} bytes to {}",
            normalized.len(),
            expected_path.display()
        );
        return;
    }

    let expected = fs::read_to_string(&expected_path)
        .unwrap_or_else(|e| panic!("read {}: {e}", expected_path.display()));

    assert_eq!(
        normalized.trim_end(),
        expected.trim_end(),
        "golden output drifted — re-run with UPDATE_GOLDEN=1 to \
         regenerate after inspecting the diff"
    );
}

#[test]
fn truncated_run_output_includes_remediation_fix_lines() {
    let fixture = fixture_dir();
    let out = run_analyze_markdown(&fixture);
    assert!(
        out.contains("fix:"),
        "expected Phase 2a remediation hints to be rendered; got:\n{out}"
    );
    // Be specific so a future renderer tweak that drops the structured
    // fields still trips this assertion.
    assert!(
        out.contains("fix: split-write"),
        "expected the task_never_completed split-write fix line; got:\n{out}"
    );
    assert!(
        out.contains("fix: force-tool-call"),
        "expected the zero_tool_calls_in_turn force-tool-call fix line; got:\n{out}"
    );
}
