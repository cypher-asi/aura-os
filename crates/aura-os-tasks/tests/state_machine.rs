use aura_os_core::*;
use aura_os_tasks::TaskService;
use chrono::Utc;

#[path = "state_machine/claim.rs"]
mod claim;
#[path = "state_machine/dependencies.rs"]
mod dependencies;
#[path = "state_machine/helpers.rs"]
mod helpers;

// ---------------------------------------------------------------------------
// 1. Valid and invalid state transitions (pure validation logic)
// ---------------------------------------------------------------------------

/// `validate_transition` enumerates only the **direct** storage-legal
/// edges (plus the aura-os-only Backlog/ToDo edges the planner uses
/// before anything hits storage). Edges that require bridging - such
/// as `InProgress -> Ready` or `Failed -> InProgress` - are
/// intentionally rejected here; callers must use
/// `aura_os_tasks::safe_transition`, which bridges through
/// intermediate hops. See the doc-comment on `validate_transition`
/// for why: its prior list included `(InProgress, Ready)` and
/// `(Failed, InProgress)` which storage then 400'd, and the two
/// disagreeing state machines caused a protracted whack-a-mole.
#[test]
fn valid_transitions_succeed() {
    // Storage-enforced direct edges (must match
    // aura-storage/crates/domain/tasks/src/repo.rs::validate_transition).
    assert!(TaskService::validate_transition(TaskStatus::Pending, TaskStatus::Ready).is_ok());
    assert!(TaskService::validate_transition(TaskStatus::Ready, TaskStatus::InProgress).is_ok());
    assert!(TaskService::validate_transition(TaskStatus::InProgress, TaskStatus::Done).is_ok());
    assert!(TaskService::validate_transition(TaskStatus::InProgress, TaskStatus::Failed).is_ok());
    assert!(TaskService::validate_transition(TaskStatus::InProgress, TaskStatus::Blocked).is_ok());
    assert!(TaskService::validate_transition(TaskStatus::Failed, TaskStatus::Ready).is_ok());
    assert!(TaskService::validate_transition(TaskStatus::Blocked, TaskStatus::Ready).is_ok());

    // aura-os-only Backlog/ToDo edges (not persisted by storage).
    assert!(TaskService::validate_transition(TaskStatus::Backlog, TaskStatus::ToDo).is_ok());
    assert!(TaskService::validate_transition(TaskStatus::Backlog, TaskStatus::Pending).is_ok());
    assert!(TaskService::validate_transition(TaskStatus::ToDo, TaskStatus::Pending).is_ok());
    assert!(TaskService::validate_transition(TaskStatus::ToDo, TaskStatus::Backlog).is_ok());
    assert!(TaskService::validate_transition(TaskStatus::Pending, TaskStatus::ToDo).is_ok());
    assert!(TaskService::validate_transition(TaskStatus::Pending, TaskStatus::Backlog).is_ok());
}

/// Regression pins for the two edges that used to be in the list but
/// are **not** storage-legal. Anyone re-adding them to
/// `validate_transition` will fail this test, because the real fix for
/// those transitions is a bridge via `safe_transition`.
#[test]
fn non_storage_edges_are_rejected_by_direct_validator() {
    assert!(
        TaskService::validate_transition(TaskStatus::InProgress, TaskStatus::Ready).is_err(),
        "in_progress -> ready must go through safe_transition (bridge via failed)"
    );
    assert!(
        TaskService::validate_transition(TaskStatus::Failed, TaskStatus::InProgress).is_err(),
        "failed -> in_progress must go through safe_transition (bridge via ready)"
    );
}

/// Auto-promote uses the two-step sequence ToDo -> Pending -> Ready.
#[test]
fn auto_promote_two_step_sequence_is_valid() {
    assert!(
        TaskService::validate_transition(TaskStatus::ToDo, TaskStatus::Pending).is_ok(),
        "first step: to_do → pending"
    );
    assert!(
        TaskService::validate_transition(TaskStatus::Pending, TaskStatus::Ready).is_ok(),
        "second step: pending → ready"
    );
}

#[test]
fn illegal_transitions_are_rejected() {
    assert!(TaskService::validate_transition(TaskStatus::Pending, TaskStatus::Done).is_err());
    assert!(TaskService::validate_transition(TaskStatus::Ready, TaskStatus::Pending).is_err());
    assert!(TaskService::validate_transition(TaskStatus::Done, TaskStatus::Ready).is_err());
    assert!(TaskService::validate_transition(TaskStatus::Done, TaskStatus::InProgress).is_err());
    assert!(TaskService::validate_transition(TaskStatus::Blocked, TaskStatus::Done).is_err());
    assert!(TaskService::validate_transition(TaskStatus::Failed, TaskStatus::Done).is_err());
}

/// Reset-from-in-progress is implemented as two storage transitions (in_progress → failed → ready)
/// because aura-storage does not allow direct in_progress → ready. Both steps are valid per validation.
#[test]
fn reset_from_in_progress_uses_two_step_sequence() {
    assert!(
        TaskService::validate_transition(TaskStatus::InProgress, TaskStatus::Failed).is_ok(),
        "first step of reset: in_progress → failed"
    );
    assert!(
        TaskService::validate_transition(TaskStatus::Failed, TaskStatus::Ready).is_ok(),
        "second step of reset: failed → ready"
    );
}

// ---------------------------------------------------------------------------
// 2. Cycle detection (pure logic, no store needed)
// ---------------------------------------------------------------------------

#[test]
fn cycle_detection_catches_circular_deps() {
    let id_a = TaskId::new();
    let id_b = TaskId::new();
    let id_c = TaskId::new();
    let now = Utc::now();

    let make = |id: TaskId, deps: Vec<TaskId>| Task {
        task_id: id,
        project_id: ProjectId::new(),
        spec_id: SpecId::new(),
        title: "T".into(),
        description: String::new(),
        status: TaskStatus::Pending,
        order_index: 0,
        dependency_ids: deps,
        parent_task_id: None,
        skip_auto_decompose: false,
        assigned_agent_instance_id: None,
        completed_by_agent_instance_id: None,
        session_id: None,
        execution_notes: String::new(),
        files_changed: vec![],
        live_output: String::new(),
        build_steps: vec![],
        test_steps: vec![],
        user_id: None,
        model: None,
        total_input_tokens: 0,
        total_output_tokens: 0,
        created_at: now,
        updated_at: now,
    };

    // A -> B -> C -> A  (cycle)
    let tasks = vec![
        make(id_a, vec![id_c]),
        make(id_b, vec![id_a]),
        make(id_c, vec![id_b]),
    ];
    let err = TaskService::detect_cycles(&tasks).expect_err("cyclic deps should produce an error");
    let msg = format!("{err}");
    assert!(msg.contains("cycle"), "got: {msg}");

    // No cycle: A -> B -> C (chain)
    let tasks = vec![
        make(id_a, vec![]),
        make(id_b, vec![id_a]),
        make(id_c, vec![id_b]),
    ];
    TaskService::detect_cycles(&tasks).expect("acyclic tasks should pass cycle detection");
}
