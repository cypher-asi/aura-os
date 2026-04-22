//! Phase 6 — closed-loop heuristics.
//!
//! During an active dev-loop run, re-execute
//! [`aura_run_heuristics::analyze`] against the still-growing run
//! bundle on disk and broadcast any previously-unseen Warn/Error
//! findings as `heuristic_finding` domain events so the UI can surface
//! them mid-flight.
//!
//! This module is observational: it never spawns tasks. Phase 3
//! (`dev_loop::try_remediate_task_failure`, post-failure) and Phase 5
//! (`task_decompose::spawn_skeleton_and_fill_children`, pre-flight)
//! remain the authoritative actors on [`RemediationHint`]s. We simply
//! forward the hint in the event payload so downstream consumers can
//! act on it if they choose.
//!
//! Trigger policy (whichever comes first):
//!
//! * N=50 events since the last analysis,
//! * 30 seconds of wall-clock since the last analysis, or
//! * a `task_failed` event (immediate).
//!
//! Dedup is per-run, keyed by `Finding::id` + `Finding::task_id`.
//! `Info` findings are dropped (post-run noise).
//!
//! Opt out with `AURA_LIVE_HEURISTICS_DISABLED=1`.

use std::collections::HashSet;
use std::path::Path;
use std::time::{Duration, Instant};

use aura_os_core::{AgentInstanceId, ProjectId};
use aura_run_heuristics::{analyze, load_bundle, Finding, Severity};

/// Default event threshold — how many forwarded events we let accumulate
/// before forcing a re-analysis. Matches the plan's N=50.
const DEFAULT_EVENT_THRESHOLD: u64 = 50;

/// Default wall-clock threshold — how long we let a "quiet" run go
/// without a re-analysis. Matches the plan's 30 seconds.
const DEFAULT_TIME_THRESHOLD: Duration = Duration::from_secs(30);

/// Env var name for the opt-out.
pub(crate) const LIVE_HEURISTICS_DISABLED_ENV: &str = "AURA_LIVE_HEURISTICS_DISABLED";

/// Returns true when `AURA_LIVE_HEURISTICS_DISABLED` is set to a
/// truthy value (case-insensitive `1` / `true` / `yes` / `on`). When
/// set, [`LiveAnalyzer::maybe_analyze`] becomes a no-op without
/// touching disk.
pub(crate) fn live_heuristics_disabled() -> bool {
    std::env::var(LIVE_HEURISTICS_DISABLED_ENV)
        .ok()
        .map(|v| {
            let t = v.trim().to_ascii_lowercase();
            t == "1" || t == "true" || t == "yes" || t == "on"
        })
        .unwrap_or(false)
}

/// Per-run heuristic analyzer. One instance lives inside each
/// `forward_automaton_events` forwarder for the duration of the run.
/// Not `Clone`: we need the emitted-id set to be shared with exactly
/// one forwarder so dedup works.
pub(crate) struct LiveAnalyzer {
    events_since_last_run: u64,
    last_run_at: Instant,
    emitted_finding_ids: HashSet<String>,
    event_threshold: u64,
    time_threshold: Duration,
    force_next: bool,
}

impl LiveAnalyzer {
    /// Create an analyzer with the default thresholds (50 events,
    /// 30 s).
    pub(crate) fn new() -> Self {
        Self::with_thresholds(DEFAULT_EVENT_THRESHOLD, DEFAULT_TIME_THRESHOLD)
    }

    /// Variant used by tests: lets the caller override the thresholds
    /// so wall-clock triggers fire in milliseconds rather than the
    /// production 30 s. Also usable from hypothetical future ops
    /// tuning without having to re-plumb env vars.
    pub(crate) fn with_thresholds(event_threshold: u64, time_threshold: Duration) -> Self {
        Self {
            events_since_last_run: 0,
            last_run_at: Instant::now(),
            emitted_finding_ids: HashSet::new(),
            event_threshold,
            time_threshold,
            force_next: false,
        }
    }

    /// Record that a new event has been appended to the bundle. Must
    /// be called on every forwarded event — both to keep the event
    /// counter accurate and so the `task_failed` immediate-trigger
    /// fires at the right moment. Cheap: no I/O, no locking.
    pub(crate) fn note_event(&mut self, event_type: &str) {
        self.events_since_last_run = self.events_since_last_run.saturating_add(1);
        if event_type == "task_failed" {
            self.force_next = true;
        }
    }

    /// True when a trigger condition currently holds. The forwarder
    /// uses this as a cheap pre-check so it only pays the filesystem
    /// cost of resolving the bundle dir when an analysis is imminent.
    /// `maybe_analyze` calls it again internally so tests can bypass
    /// the pre-check.
    pub(crate) fn should_run(&self) -> bool {
        if self.force_next {
            return true;
        }
        if self.events_since_last_run >= self.event_threshold {
            return true;
        }
        self.last_run_at.elapsed() >= self.time_threshold
    }

    /// Consume any active trigger and return the new Warn/Error
    /// findings (de-duped against this run's prior output). Returns
    /// `None` when no trigger is pending or when the env opt-out is
    /// set. `Some(vec![])` is returned when an analysis ran but every
    /// finding was either filtered (Info) or already emitted — this
    /// still counts as a "fired" call and resets the counters.
    pub(crate) fn maybe_analyze(&mut self, bundle_dir: &Path) -> Option<Vec<Finding>> {
        if live_heuristics_disabled() {
            return None;
        }
        if !self.should_run() {
            return None;
        }

        // Reset trigger state up-front so a load failure doesn't leave
        // us hammering the filesystem on every subsequent event until
        // the wall-clock threshold fires again.
        self.events_since_last_run = 0;
        self.last_run_at = Instant::now();
        self.force_next = false;

        let view = match load_bundle(bundle_dir) {
            Ok(v) => v,
            Err(_) => return Some(Vec::new()),
        };
        let findings = analyze(&view);
        let out: Vec<Finding> = findings
            .into_iter()
            .filter(|f| matches!(f.severity, Severity::Warn | Severity::Error))
            .filter(|f| self.emitted_finding_ids.insert(finding_dedupe_key(f)))
            .collect();
        Some(out)
    }
}

/// Build the dedup key for a finding. `Finding::id` alone would
/// collapse distinct per-task findings from the same rule (e.g. two
/// tasks each triggering `task_never_completed`), so we include the
/// `task_id` when present. `task_id` is already structurally unique
/// per task in a run so this is enough to distinguish independent
/// occurrences.
fn finding_dedupe_key(f: &Finding) -> String {
    match f.task_id {
        Some(tid) => format!("{}:{}", f.id, tid),
        None => f.id.to_string(),
    }
}

/// Serialise a [`Finding`] into the JSON payload attached to a
/// `heuristic_finding` domain event. The payload mirrors the shape
/// described in Phase 6's plan: `finding_id`, `severity`, `message`,
/// and a structured `remediation` hint when available.
pub(crate) fn build_finding_payload(finding: &Finding, run_id: &str) -> serde_json::Value {
    serde_json::json!({
        "kind": "heuristic_finding",
        "run_id": run_id,
        "finding_id": finding_dedupe_key(finding),
        "finding_rule": finding.id,
        "severity": finding.severity.as_str(),
        "title": finding.title,
        "message": finding.detail,
        "task_id": finding.task_id.map(|t| t.to_string()),
        "remediation": finding.remediation,
    })
}

/// Broadcast a `heuristic_finding` event for a single newly-discovered
/// finding. A thin wrapper over the existing `emit_domain_event`
/// helper in the parent module so all live-heuristic broadcasts go
/// through one definition.
pub(crate) fn emit_live_heuristic(
    broadcast_tx: &tokio::sync::broadcast::Sender<serde_json::Value>,
    finding: &Finding,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    run_id: &str,
) {
    super::dev_loop::emit_domain_event(
        broadcast_tx,
        "heuristic_finding",
        project_id,
        agent_instance_id,
        build_finding_payload(finding, run_id),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_loop_log_schema::{RunCounters, RunMetadata, RunStatus};
    use chrono::{TimeZone, Utc};
    use std::fs;
    use std::thread;
    use tempfile::TempDir;

    const TID: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    /// Serialises every test in this module that reads or writes the
    /// `AURA_LIVE_HEURISTICS_DISABLED` env var, which is otherwise
    /// process-global and races across the Rust test harness's
    /// parallel runner. A plain `Mutex` is enough — the poison case
    /// can only arise if a test panics while holding the lock, and
    /// every observable test here already asserts cleanly before
    /// touching the env var.
    fn env_lock() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
        let m = LOCK.get_or_init(|| std::sync::Mutex::new(()));
        m.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Write a minimal bundle dir to `dir` with the given metadata.
    /// Tests append extra JSONL channels as needed with
    /// `write_iterations` / `write_events`.
    fn write_metadata(dir: &Path, metadata: &RunMetadata) {
        let json = serde_json::to_string_pretty(metadata).expect("serialize metadata");
        fs::write(dir.join("metadata.json"), json).expect("write metadata.json");
    }

    fn base_metadata(status: RunStatus) -> RunMetadata {
        RunMetadata {
            run_id: "test_run".into(),
            project_id: ProjectId::nil(),
            agent_instance_id: AgentInstanceId::nil(),
            started_at: Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap(),
            ended_at: None,
            status,
            tasks: Vec::new(),
            spec_ids: Vec::new(),
            counters: RunCounters::default(),
        }
    }

    /// Write an `iterations.jsonl` file with `count` consecutive
    /// zero-tool-call iteration events for the same task. Used to
    /// reliably produce a `zero_tool_calls_in_turn` Warn finding
    /// regardless of run status.
    fn write_zero_tool_call_iterations(dir: &Path, count: u64) {
        let mut lines = String::new();
        for _ in 0..count {
            let line = serde_json::json!({
                "type": "debug.iteration",
                "task_id": TID,
                "tool_calls": 0u64,
            });
            lines.push_str(&line.to_string());
            lines.push('\n');
        }
        fs::write(dir.join("iterations.jsonl"), lines).expect("write iterations.jsonl");
    }

    /// Build a bundle directory on disk that — when analyzed —
    /// produces exactly one `zero_tool_calls_in_turn` Warn finding.
    /// Returns the TempDir so the caller keeps the directory alive
    /// for the duration of the test.
    fn synthetic_bundle_warn_only() -> TempDir {
        let tmp = tempfile::tempdir().expect("tempdir");
        let meta = base_metadata(RunStatus::Running);
        write_metadata(tmp.path(), &meta);
        write_zero_tool_call_iterations(tmp.path(), 3);
        tmp
    }

    #[test]
    fn maybe_analyze_triggers_on_event_count_threshold() {
        let _env = env_lock();
        let tmp = synthetic_bundle_warn_only();
        let mut a = LiveAnalyzer::with_thresholds(
            50,
            // Large enough that the wall-clock path cannot fire during
            // the loop below, isolating the count-based trigger.
            Duration::from_secs(3600),
        );

        // 49 events: no trigger.
        for _ in 0..49 {
            a.note_event("text_delta");
            assert!(
                a.maybe_analyze(tmp.path()).is_none(),
                "below-threshold events must not trigger analysis"
            );
        }

        // 50th event: trigger.
        a.note_event("text_delta");
        let out = a
            .maybe_analyze(tmp.path())
            .expect("50th event should trigger analysis");
        assert_eq!(out.len(), 1, "expected one Warn finding from bundle");
        assert_eq!(out[0].severity, Severity::Warn);
    }

    #[test]
    fn maybe_analyze_triggers_on_wall_clock() {
        // Time-based trigger test. `Instant` is non-trivial to mock on
        // stable Rust, so we take the approach the plan explicitly
        // suggests: parameterize the thresholds and sleep past a
        // short one. The event threshold is set high enough that the
        // single `note_event` below cannot possibly satisfy it, so
        // only the time path can produce the trigger we observe.
        let _env = env_lock();
        let tmp = synthetic_bundle_warn_only();
        let mut a = LiveAnalyzer::with_thresholds(10_000, Duration::from_millis(50));

        a.note_event("text_delta");
        assert!(
            a.maybe_analyze(tmp.path()).is_none(),
            "wall clock not yet elapsed"
        );

        thread::sleep(Duration::from_millis(75));
        a.note_event("text_delta");
        let out = a
            .maybe_analyze(tmp.path())
            .expect("wall-clock trigger should fire after sleep");
        assert_eq!(out.len(), 1);
    }

    #[test]
    fn task_failed_forces_immediate_analysis() {
        let _env = env_lock();
        let tmp = synthetic_bundle_warn_only();
        let mut a = LiveAnalyzer::with_thresholds(
            // Thresholds deliberately unreachable so only the
            // `task_failed` force path can produce a trigger.
            10_000,
            Duration::from_secs(3600),
        );

        a.note_event("text_delta");
        assert!(a.maybe_analyze(tmp.path()).is_none());

        a.note_event("task_failed");
        let out = a
            .maybe_analyze(tmp.path())
            .expect("task_failed should force analysis");
        assert_eq!(out.len(), 1);
    }

    #[test]
    fn dedupe_emits_each_finding_once() {
        let _env = env_lock();
        let tmp = synthetic_bundle_warn_only();
        let mut a = LiveAnalyzer::with_thresholds(1, Duration::from_secs(3600));

        a.note_event("text_delta");
        let first = a.maybe_analyze(tmp.path()).expect("first trigger");
        assert_eq!(first.len(), 1);

        a.note_event("text_delta");
        let second = a
            .maybe_analyze(tmp.path())
            .expect("second trigger should still run");
        assert!(
            second.is_empty(),
            "previously-emitted finding must not surface a second time"
        );
    }

    #[test]
    fn feature_flag_disables_analysis() {
        // `set_var` mutates process-wide state; we restore it in a
        // guard so this test can't poison neighbours. Rust 2024 marks
        // these unsafe to signal that — we accept the contract.
        struct EnvGuard(&'static str, Option<String>);
        impl Drop for EnvGuard {
            fn drop(&mut self) {
                match &self.1 {
                    Some(v) => unsafe { std::env::set_var(self.0, v) },
                    None => unsafe { std::env::remove_var(self.0) },
                }
            }
        }

        let _env = env_lock();
        let prev = std::env::var(LIVE_HEURISTICS_DISABLED_ENV).ok();
        let _guard = EnvGuard(LIVE_HEURISTICS_DISABLED_ENV, prev);
        unsafe {
            std::env::set_var(LIVE_HEURISTICS_DISABLED_ENV, "1");
        }

        // Point at a nonexistent path: if the analyzer ran, it would
        // still short-circuit on the failed `load_bundle`, but we'd
        // see `Some(vec![])` rather than `None`. `None` is the only
        // answer compatible with "did not touch disk".
        let missing = Path::new("definitely-not-a-real-path-for-tests-6a83");
        let mut a = LiveAnalyzer::with_thresholds(1, Duration::from_secs(3600));
        a.note_event("task_failed");
        assert!(
            a.maybe_analyze(missing).is_none(),
            "feature flag opt-out must return None without touching disk"
        );
    }

    #[test]
    fn severity_floor_drops_info_findings() {
        // No env access here, but taking the lock keeps the test
        // serialised with the env-touching tests so its assertion
        // logic isn't interleaved with a `set_var` from a parallel
        // test that could otherwise make future refactors flaky.
        let _env = env_lock();
        // `analyze` across all rules only produces Info findings in
        // niche cases today, and none of them are reliably reachable
        // from a synthetic bundle. Instead, exercise the floor at the
        // filter level by constructing a small `Finding` pair inline
        // and asserting the filter keeps only Warn/Error. This is the
        // same filter expression `maybe_analyze` uses.
        let info = Finding {
            id: "synthetic_info",
            severity: Severity::Info,
            title: "info".into(),
            detail: "info".into(),
            task_id: None,
            remediation: None,
        };
        let warn = Finding {
            id: "synthetic_warn",
            severity: Severity::Warn,
            title: "warn".into(),
            detail: "warn".into(),
            task_id: None,
            remediation: None,
        };
        let kept: Vec<&Finding> = [&info, &warn]
            .into_iter()
            .filter(|f| matches!(f.severity, Severity::Warn | Severity::Error))
            .collect();
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].id, "synthetic_warn");
    }

    #[test]
    fn missing_bundle_does_not_loop_forever() {
        // A missing bundle dir must not leave `events_since_last_run`
        // high, otherwise the forwarder would re-attempt the load on
        // every subsequent event until the 50-event window closed
        // again. The reset happens unconditionally inside
        // `maybe_analyze` before the `load_bundle` call.
        //
        // Tests in this module run in parallel and one of them
        // temporarily sets `AURA_LIVE_HEURISTICS_DISABLED`. Take the
        // shared env lock so we never observe that transient setting,
        // then explicitly clear it in case the outer process had a
        // truthy value set.
        let _env = env_lock();
        let prev = std::env::var(LIVE_HEURISTICS_DISABLED_ENV).ok();
        unsafe {
            std::env::remove_var(LIVE_HEURISTICS_DISABLED_ENV);
        }
        let mut a = LiveAnalyzer::with_thresholds(1, Duration::from_secs(3600));
        a.note_event("text_delta");
        let out = a.maybe_analyze(Path::new("definitely-not-a-real-path-7d21"));
        assert_eq!(out.as_deref(), Some(&[][..]));
        // Second call without a new event: trigger must NOT still be
        // pending even though the load failed.
        let second = a.maybe_analyze(Path::new("definitely-not-a-real-path-7d21"));
        assert!(second.is_none());
        if let Some(v) = prev {
            unsafe { std::env::set_var(LIVE_HEURISTICS_DISABLED_ENV, v) };
        }
    }
}
