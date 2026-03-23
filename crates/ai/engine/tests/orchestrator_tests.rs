mod fixtures;

use aura_core::*;
use aura_engine::events::PhaseTimingEntry;
use aura_engine::metrics::{LoopRunMetrics, TaskMetrics};
use aura_engine::*;

// ---------------------------------------------------------------------------
// Event emission tests
// ---------------------------------------------------------------------------

#[test]
fn engine_event_serialization() {
    let event = EngineEvent::TaskStarted {
        project_id: ProjectId::new(),
        agent_instance_id: AgentInstanceId::new(),
        task_id: TaskId::new(),
        task_title: "Test task".into(),
        session_id: SessionId::new(),
        prompt_tokens_estimate: None,
        codebase_snapshot_bytes: None,
        codebase_file_count: None,
    };
    let json = serde_json::to_string(&event).unwrap();
    assert!(json.contains("task_started"));
    assert!(json.contains("Test task"));
}

#[test]
fn engine_event_loop_finished_serialization() {
    let event = EngineEvent::LoopFinished {
        project_id: ProjectId::new(),
        agent_instance_id: AgentInstanceId::new(),
        outcome: "all_tasks_complete".into(),
        total_duration_ms: None,
        tasks_completed: None,
        tasks_failed: None,
        tasks_retried: None,
        total_input_tokens: None,
        total_output_tokens: None,
        total_cost_usd: None,
        sessions_used: None,
        total_parse_retries: None,
        total_build_fix_attempts: None,
        duplicate_error_bailouts: None,
    };
    let json = serde_json::to_string(&event).unwrap();
    assert!(json.contains("loop_finished"));
    assert!(json.contains("all_tasks_complete"));
}

// ---------------------------------------------------------------------------
// Loop handle / command tests
// ---------------------------------------------------------------------------

#[test]
fn loop_command_equality() {
    assert_eq!(LoopCommand::Continue, LoopCommand::Continue);
    assert_ne!(LoopCommand::Continue, LoopCommand::Pause);
    assert_ne!(LoopCommand::Pause, LoopCommand::Stop);
}

#[test]
fn loop_outcome_variants() {
    let complete = LoopOutcome::AllTasksComplete;
    let paused = LoopOutcome::Paused { completed_count: 3 };
    let stopped = LoopOutcome::Stopped { completed_count: 1 };
    let blocked = LoopOutcome::AllTasksBlocked;
    let task_failed = LoopOutcome::TaskFailed {
        completed_count: 2,
        task_id: TaskId::new(),
        reason: "boom".into(),
    };
    let error = LoopOutcome::Error("test".into());

    let _ = format!("{complete:?}");
    let _ = format!("{paused:?}");
    let _ = format!("{stopped:?}");
    let _ = format!("{blocked:?}");
    let _ = format!("{task_failed:?}");
    let _ = format!("{error:?}");
}

// ---------------------------------------------------------------------------
// TaskMetrics builder pattern tests
// ---------------------------------------------------------------------------

#[test]
fn task_metrics_completed_builder() {
    let m = TaskMetrics::completed(
        "t1".into(),
        "Add feature".into(),
        5000,
        Some("claude-opus-4-6".into()),
    )
    .with_tokens(1000, 500)
    .with_files_changed(3)
    .with_llm_duration(4500)
    .with_build_verify_duration(300)
    .with_file_ops_duration(200)
    .with_parse_retries(1)
    .with_build_fix_attempts(2);

    assert_eq!(m.task_id, "t1");
    assert_eq!(m.title, "Add feature");
    assert_eq!(m.outcome, "completed");
    assert_eq!(m.duration_ms, 5000);
    assert_eq!(m.input_tokens, 1000);
    assert_eq!(m.output_tokens, 500);
    assert_eq!(m.files_changed, 3);
    assert_eq!(m.llm_duration_ms, Some(4500));
    assert_eq!(m.build_verify_duration_ms, Some(300));
    assert_eq!(m.file_ops_duration_ms, Some(200));
    assert_eq!(m.parse_retries, 1);
    assert_eq!(m.build_fix_attempts, 2);
    assert!(m.failure_phase.is_none());
    assert!(m.failure_reason.is_none());
}

#[test]
fn task_metrics_failed_builder() {
    let m = TaskMetrics::failed(
        "t2".into(),
        "Broken task".into(),
        3000,
        None,
        "build_verify",
        "compilation failed".into(),
    )
    .with_tokens(800, 400);

    assert_eq!(m.outcome, "failed");
    assert_eq!(m.failure_phase, Some("build_verify".into()));
    assert_eq!(m.failure_reason, Some("compilation failed".into()));
    assert!(m.model.is_none());
    assert_eq!(m.input_tokens, 800);
}

#[test]
fn task_metrics_with_phase_timings() {
    let timings = vec![
        PhaseTimingEntry {
            phase: "llm".into(),
            duration_ms: 2000,
        },
        PhaseTimingEntry {
            phase: "build".into(),
            duration_ms: 1000,
        },
    ];
    let m = TaskMetrics::completed("t3".into(), "T".into(), 3000, None).with_phase_timings(timings);
    assert_eq!(m.phase_timings.len(), 2);
    assert_eq!(m.phase_timings[0].phase, "llm");
}

#[test]
fn task_metrics_serializes_to_json() {
    let m = TaskMetrics::completed("t1".into(), "T".into(), 1000, None).with_tokens(100, 50);
    let json = serde_json::to_string(&m).unwrap();
    assert!(json.contains("\"outcome\":\"completed\""));
    assert!(json.contains("\"input_tokens\":100"));
    assert!(
        !json.contains("failure_phase"),
        "None fields should be skipped"
    );
}

// ---------------------------------------------------------------------------
// LoopRunMetrics tests
// ---------------------------------------------------------------------------

#[test]
fn loop_run_metrics_new_has_defaults() {
    let m = LoopRunMetrics::new("proj-1".into());
    assert_eq!(m.project_id, "proj-1");
    assert_eq!(m.tasks_completed, 0);
    assert_eq!(m.tasks_failed, 0);
    assert!(m.tasks.is_empty());
    assert_eq!(m.estimated_cost_usd, 0.0);
}

#[test]
fn loop_run_metrics_finalize_recomputes() {
    let mut m = LoopRunMetrics::new("proj-2".into());
    m.tasks
        .push(TaskMetrics::completed("t1".into(), "T1".into(), 1000, None).with_tokens(500, 200));
    m.tasks.push(
        TaskMetrics::failed("t2".into(), "T2".into(), 2000, None, "exec", "err".into())
            .with_tokens(300, 100),
    );

    m.finalize("partial", 3000, 2, 1, 0, &[]);
    assert_eq!(m.tasks_completed, 1);
    assert_eq!(m.tasks_failed, 1);
    assert_eq!(m.total_input_tokens, 800);
    assert_eq!(m.total_output_tokens, 300);
    assert_eq!(m.outcome, "partial");
    assert_eq!(m.total_duration_ms, 3000);
    assert_eq!(m.sessions_used, 2);
}

#[test]
fn loop_run_metrics_snapshot_sets_in_progress() {
    let mut m = LoopRunMetrics::new("proj-3".into());
    m.tasks
        .push(TaskMetrics::completed("t1".into(), "T1".into(), 500, None).with_tokens(100, 50));
    m.snapshot(1000, 1, 0, 0, &[]);
    assert_eq!(m.outcome, "in_progress");
    assert_eq!(m.tasks_completed, 1);
}

// ---------------------------------------------------------------------------
// Metrics file I/O tests
// ---------------------------------------------------------------------------

#[test]
fn write_and_read_single_task_metrics() {
    let dir = tempfile::tempdir().unwrap();
    let task =
        TaskMetrics::completed("t1".into(), "Do thing".into(), 2000, None).with_tokens(200, 100);

    aura_engine::metrics::write_single_task_metrics(dir.path(), "proj-1", task, &[]);

    let metrics_path = dir.path().join(".aura").join("last_run_metrics.json");
    assert!(metrics_path.exists());
    let content = std::fs::read_to_string(&metrics_path).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
    assert_eq!(parsed["project_id"], "proj-1");
    assert_eq!(parsed["tasks_completed"], 1);
}
