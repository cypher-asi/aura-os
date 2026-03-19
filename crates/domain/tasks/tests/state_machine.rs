use aura_core::*;
use aura_tasks::TaskService;
use chrono::Utc;

// ---------------------------------------------------------------------------
// 1. Valid and invalid state transitions (pure validation logic)
// ---------------------------------------------------------------------------

#[test]
fn valid_transitions_succeed() {
    assert!(TaskService::validate_transition(TaskStatus::Pending, TaskStatus::Ready).is_ok());
    assert!(TaskService::validate_transition(TaskStatus::Ready, TaskStatus::InProgress).is_ok());
    assert!(TaskService::validate_transition(TaskStatus::InProgress, TaskStatus::Done).is_ok());
    assert!(TaskService::validate_transition(TaskStatus::InProgress, TaskStatus::Failed).is_ok());
    assert!(TaskService::validate_transition(TaskStatus::InProgress, TaskStatus::Blocked).is_ok());
    assert!(TaskService::validate_transition(TaskStatus::InProgress, TaskStatus::Ready).is_ok());
    assert!(TaskService::validate_transition(TaskStatus::Failed, TaskStatus::Ready).is_ok());
    assert!(TaskService::validate_transition(TaskStatus::Blocked, TaskStatus::Ready).is_ok());
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
    let err = TaskService::detect_cycles(&tasks).unwrap_err();
    let msg = format!("{err}");
    assert!(msg.contains("cycle"), "got: {msg}");

    // No cycle: A -> B -> C (chain)
    let tasks = vec![
        make(id_a, vec![]),
        make(id_b, vec![id_a]),
        make(id_c, vec![id_b]),
    ];
    TaskService::detect_cycles(&tasks).unwrap();
}

// Integration tests for claim, follow-up, retry, and dependency resolution
// require a running aura-storage service. Deferred to Phase 9e.
