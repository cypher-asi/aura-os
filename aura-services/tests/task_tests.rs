use std::sync::Arc;

use aura_core::*;
use aura_services::{TaskError, TaskService};
use aura_store::RocksStore;
use chrono::Utc;
use tempfile::TempDir;

fn setup() -> (Arc<RocksStore>, TempDir) {
    let dir = TempDir::new().expect("temp dir");
    let store = RocksStore::open(dir.path()).expect("open store");
    (Arc::new(store), dir)
}

fn make_task_with(
    project_id: ProjectId,
    spec_id: SpecId,
    status: TaskStatus,
    order: u32,
    deps: Vec<TaskId>,
) -> Task {
    let now = Utc::now();
    Task {
        task_id: TaskId::new(),
        project_id,
        spec_id,
        title: format!("Task order {order}"),
        description: "Test task".into(),
        status,
        order_index: order,
        dependency_ids: deps,
        parent_task_id: None,
        assigned_agent_id: None,
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
    }
}

fn make_spec(project_id: ProjectId, order: u32) -> Spec {
    let now = Utc::now();
    Spec {
        spec_id: SpecId::new(),
        project_id,
        title: format!("Spec {order}"),
        order_index: order,
        markdown_contents: "test".into(),
        sprint_id: None,
        created_at: now,
        updated_at: now,
    }
}

fn make_project() -> Project {
    let now = Utc::now();
    Project {
        project_id: ProjectId::new(),
        org_id: OrgId::new(),
        name: "Test".into(),
        description: "Test".into(),
        linked_folder_path: "/tmp".into(),
        requirements_doc_path: None,
        current_status: ProjectStatus::Planning,
        github_integration_id: None,
        github_repo_full_name: None,
        build_command: None,
        test_command: None,
        created_at: now,
        updated_at: now,
    }
}

// ---------------------------------------------------------------------------
// State machine transitions
// ---------------------------------------------------------------------------

#[test]
fn legal_transitions_succeed() {
    let legal = vec![
        (TaskStatus::Pending, TaskStatus::Ready),
        (TaskStatus::Ready, TaskStatus::InProgress),
        (TaskStatus::InProgress, TaskStatus::Done),
        (TaskStatus::InProgress, TaskStatus::Failed),
        (TaskStatus::InProgress, TaskStatus::Blocked),
        (TaskStatus::InProgress, TaskStatus::Ready),
        (TaskStatus::Failed, TaskStatus::Ready),
        (TaskStatus::Blocked, TaskStatus::Ready),
        (TaskStatus::Done, TaskStatus::Ready),
    ];

    for (from, to) in legal {
        assert!(
            TaskService::validate_transition(from, to).is_ok(),
            "expected {from:?} -> {to:?} to be legal"
        );
    }
}

#[test]
fn illegal_transitions_fail() {
    let illegal = vec![
        (TaskStatus::Pending, TaskStatus::Done),
        (TaskStatus::Pending, TaskStatus::InProgress),
        (TaskStatus::Pending, TaskStatus::Failed),
        (TaskStatus::Ready, TaskStatus::Done),
        (TaskStatus::Ready, TaskStatus::Failed),
        (TaskStatus::Ready, TaskStatus::Blocked),
        (TaskStatus::Done, TaskStatus::InProgress),
        (TaskStatus::Done, TaskStatus::Pending),
        (TaskStatus::Failed, TaskStatus::Done),
        (TaskStatus::Failed, TaskStatus::InProgress),
        (TaskStatus::Blocked, TaskStatus::Done),
        (TaskStatus::Blocked, TaskStatus::InProgress),
    ];

    for (from, to) in illegal {
        let result = TaskService::validate_transition(from, to);
        assert!(result.is_err(), "expected {from:?} -> {to:?} to be illegal");
        assert!(matches!(
            result.unwrap_err(),
            TaskError::IllegalTransition { .. }
        ));
    }
}

#[test]
fn assign_task_transitions_ready_to_in_progress() {
    let (store, _dir) = setup();
    let svc = TaskService::new(store.clone());

    let project = make_project();
    let spec = make_spec(project.project_id, 0);
    let task = make_task_with(
        project.project_id,
        spec.spec_id,
        TaskStatus::Ready,
        0,
        vec![],
    );

    store.put_project(&project).unwrap();
    store.put_spec(&spec).unwrap();
    store.put_task(&task).unwrap();

    let agent_id = AgentId::new();
    let assigned = svc
        .assign_task(&project.project_id, &spec.spec_id, &task.task_id, &agent_id, None)
        .unwrap();

    assert_eq!(assigned.status, TaskStatus::InProgress);
    assert_eq!(assigned.assigned_agent_id, Some(agent_id));
}

#[test]
fn complete_task_sets_done_and_preserves_agent() {
    let (store, _dir) = setup();
    let svc = TaskService::new(store.clone());

    let project = make_project();
    let spec = make_spec(project.project_id, 0);
    let mut task = make_task_with(
        project.project_id,
        spec.spec_id,
        TaskStatus::InProgress,
        0,
        vec![],
    );
    task.assigned_agent_id = Some(AgentId::new());

    store.put_project(&project).unwrap();
    store.put_spec(&spec).unwrap();
    store.put_task(&task).unwrap();

    let completed = svc
        .complete_task(
            &project.project_id,
            &spec.spec_id,
            &task.task_id,
            "all good",
            vec![],
        )
        .unwrap();

    let agent_id = task.assigned_agent_id.unwrap();
    assert_eq!(completed.status, TaskStatus::Done);
    assert_eq!(completed.execution_notes, "all good");
    assert_eq!(completed.assigned_agent_id, Some(agent_id));
}

#[test]
fn fail_task_sets_failed_and_records_reason() {
    let (store, _dir) = setup();
    let svc = TaskService::new(store.clone());

    let project = make_project();
    let spec = make_spec(project.project_id, 0);
    let task = make_task_with(
        project.project_id,
        spec.spec_id,
        TaskStatus::InProgress,
        0,
        vec![],
    );

    store.put_project(&project).unwrap();
    store.put_spec(&spec).unwrap();
    store.put_task(&task).unwrap();

    let failed = svc
        .fail_task(
            &project.project_id,
            &spec.spec_id,
            &task.task_id,
            "compile error",
        )
        .unwrap();

    assert_eq!(failed.status, TaskStatus::Failed);
    assert_eq!(failed.execution_notes, "compile error");
}

#[test]
fn retry_task_transitions_failed_to_ready() {
    let (store, _dir) = setup();
    let svc = TaskService::new(store.clone());

    let project = make_project();
    let spec = make_spec(project.project_id, 0);
    let task = make_task_with(
        project.project_id,
        spec.spec_id,
        TaskStatus::Failed,
        0,
        vec![],
    );

    store.put_project(&project).unwrap();
    store.put_spec(&spec).unwrap();
    store.put_task(&task).unwrap();

    let retried = svc
        .retry_task(&project.project_id, &spec.spec_id, &task.task_id)
        .unwrap();

    assert_eq!(retried.status, TaskStatus::Ready);
}

// ---------------------------------------------------------------------------
// Dependency resolution
// ---------------------------------------------------------------------------

#[test]
fn dependency_resolution_makes_pending_ready() {
    let (store, _dir) = setup();
    let svc = TaskService::new(store.clone());

    let project = make_project();
    let spec = make_spec(project.project_id, 0);

    let root = make_task_with(
        project.project_id,
        spec.spec_id,
        TaskStatus::InProgress,
        0,
        vec![],
    );
    let leaf = make_task_with(
        project.project_id,
        spec.spec_id,
        TaskStatus::Pending,
        1,
        vec![root.task_id],
    );

    store.put_project(&project).unwrap();
    store.put_spec(&spec).unwrap();
    store.put_task(&root).unwrap();
    store.put_task(&leaf).unwrap();

    // Complete root
    svc.complete_task(&project.project_id, &spec.spec_id, &root.task_id, "done", vec![])
        .unwrap();

    // Resolve deps
    let newly_ready = svc
        .resolve_dependencies_after_completion(&project.project_id, &root.task_id)
        .unwrap();

    assert_eq!(newly_ready.len(), 1);
    assert_eq!(newly_ready[0].task_id, leaf.task_id);
    assert_eq!(newly_ready[0].status, TaskStatus::Ready);
}

#[test]
fn dependency_resolution_waits_for_all_deps() {
    let (store, _dir) = setup();
    let svc = TaskService::new(store.clone());

    let project = make_project();
    let spec = make_spec(project.project_id, 0);

    let dep_a = make_task_with(
        project.project_id,
        spec.spec_id,
        TaskStatus::Done,
        0,
        vec![],
    );
    let dep_b = make_task_with(
        project.project_id,
        spec.spec_id,
        TaskStatus::InProgress,
        1,
        vec![],
    );
    let leaf = make_task_with(
        project.project_id,
        spec.spec_id,
        TaskStatus::Pending,
        2,
        vec![dep_a.task_id, dep_b.task_id],
    );

    store.put_project(&project).unwrap();
    store.put_spec(&spec).unwrap();
    store.put_task(&dep_a).unwrap();
    store.put_task(&dep_b).unwrap();
    store.put_task(&leaf).unwrap();

    // dep_a is done but dep_b is still in progress -> leaf stays pending
    let newly_ready = svc
        .resolve_dependencies_after_completion(&project.project_id, &dep_a.task_id)
        .unwrap();

    assert_eq!(newly_ready.len(), 0);
}

// ---------------------------------------------------------------------------
// Cycle detection
// ---------------------------------------------------------------------------

#[test]
fn acyclic_graph_passes() {
    let pid = ProjectId::new();
    let sid = SpecId::new();

    let a = make_task_with(pid, sid, TaskStatus::Ready, 0, vec![]);
    let b = make_task_with(pid, sid, TaskStatus::Pending, 1, vec![a.task_id]);
    let c = make_task_with(pid, sid, TaskStatus::Pending, 2, vec![b.task_id]);

    assert!(TaskService::detect_cycles(&[a, b, c]).is_ok());
}

#[test]
fn direct_cycle_detected() {
    let pid = ProjectId::new();
    let sid = SpecId::new();

    let mut a = make_task_with(pid, sid, TaskStatus::Pending, 0, vec![]);
    let mut b = make_task_with(pid, sid, TaskStatus::Pending, 1, vec![]);

    a.dependency_ids = vec![b.task_id];
    b.dependency_ids = vec![a.task_id];

    let result = TaskService::detect_cycles(&[a, b]);
    assert!(matches!(result, Err(TaskError::CycleDetected)));
}

#[test]
fn deep_cycle_detected() {
    let pid = ProjectId::new();
    let sid = SpecId::new();

    let mut a = make_task_with(pid, sid, TaskStatus::Pending, 0, vec![]);
    let b = make_task_with(pid, sid, TaskStatus::Pending, 1, vec![a.task_id]);
    let c = make_task_with(pid, sid, TaskStatus::Pending, 2, vec![b.task_id]);
    a.dependency_ids = vec![c.task_id]; // A -> C -> B -> A

    let result = TaskService::detect_cycles(&[a, b, c]);
    assert!(matches!(result, Err(TaskError::CycleDetected)));
}

// ---------------------------------------------------------------------------
// Next-task selection
// ---------------------------------------------------------------------------

#[test]
fn select_next_task_picks_lowest_spec_and_order() {
    let (store, _dir) = setup();
    let svc = TaskService::new(store.clone());

    let project = make_project();
    let spec_0 = make_spec(project.project_id, 0);
    let spec_1 = make_spec(project.project_id, 1);

    let t_s1_o0 = make_task_with(
        project.project_id,
        spec_1.spec_id,
        TaskStatus::Ready,
        0,
        vec![],
    );
    let t_s0_o1 = make_task_with(
        project.project_id,
        spec_0.spec_id,
        TaskStatus::Ready,
        1,
        vec![],
    );
    let t_s0_o0 = make_task_with(
        project.project_id,
        spec_0.spec_id,
        TaskStatus::Ready,
        0,
        vec![],
    );

    store.put_project(&project).unwrap();
    store.put_spec(&spec_0).unwrap();
    store.put_spec(&spec_1).unwrap();
    store.put_task(&t_s1_o0).unwrap();
    store.put_task(&t_s0_o1).unwrap();
    store.put_task(&t_s0_o0).unwrap();

    let next = svc.select_next_task(&project.project_id).unwrap();
    assert!(next.is_some());
    let next = next.unwrap();
    // Should pick task from spec_0 with order 0
    assert_eq!(next.task_id, t_s0_o0.task_id);
}

#[test]
fn select_next_task_returns_none_when_no_ready_tasks() {
    let (store, _dir) = setup();
    let svc = TaskService::new(store.clone());

    let project = make_project();
    let spec = make_spec(project.project_id, 0);
    let task = make_task_with(
        project.project_id,
        spec.spec_id,
        TaskStatus::Pending,
        0,
        vec![],
    );

    store.put_project(&project).unwrap();
    store.put_spec(&spec).unwrap();
    store.put_task(&task).unwrap();

    let next = svc.select_next_task(&project.project_id).unwrap();
    assert!(next.is_none());
}

#[test]
fn select_next_task_returns_none_for_empty_project() {
    let (store, _dir) = setup();
    let svc = TaskService::new(store.clone());

    let project = make_project();
    store.put_project(&project).unwrap();

    let next = svc.select_next_task(&project.project_id).unwrap();
    assert!(next.is_none());
}

// ---------------------------------------------------------------------------
// Follow-up task creation
// ---------------------------------------------------------------------------

#[test]
fn follow_up_task_inherits_lineage() {
    let (store, _dir) = setup();
    let svc = TaskService::new(store.clone());

    let project = make_project();
    let spec = make_spec(project.project_id, 0);
    let origin = make_task_with(
        project.project_id,
        spec.spec_id,
        TaskStatus::InProgress,
        5,
        vec![],
    );

    store.put_project(&project).unwrap();
    store.put_spec(&spec).unwrap();
    store.put_task(&origin).unwrap();

    let follow_up = svc
        .create_follow_up_task(
            &origin,
            "Fix edge case".into(),
            "Handle null input".into(),
            vec![],
        )
        .unwrap();

    assert_eq!(follow_up.project_id, project.project_id);
    assert_eq!(follow_up.spec_id, spec.spec_id);
    assert_eq!(follow_up.order_index, 6); // origin + 1
    assert_eq!(follow_up.status, TaskStatus::Ready);
}

#[test]
fn follow_up_with_deps_starts_pending() {
    let (store, _dir) = setup();
    let svc = TaskService::new(store.clone());

    let project = make_project();
    let spec = make_spec(project.project_id, 0);
    let origin = make_task_with(
        project.project_id,
        spec.spec_id,
        TaskStatus::InProgress,
        0,
        vec![],
    );
    let dep = make_task_with(
        project.project_id,
        spec.spec_id,
        TaskStatus::Ready,
        1,
        vec![],
    );

    store.put_project(&project).unwrap();
    store.put_spec(&spec).unwrap();
    store.put_task(&origin).unwrap();
    store.put_task(&dep).unwrap();

    let follow_up = svc
        .create_follow_up_task(
            &origin,
            "Needs dep".into(),
            "desc".into(),
            vec![dep.task_id],
        )
        .unwrap();

    assert_eq!(follow_up.status, TaskStatus::Pending);
    assert_eq!(follow_up.dependency_ids, vec![dep.task_id]);
}

// ---------------------------------------------------------------------------
// Progress calculation
// ---------------------------------------------------------------------------

#[test]
fn progress_counts_all_statuses() {
    let (store, _dir) = setup();
    let svc = TaskService::new(store.clone());

    let project = make_project();
    let spec = make_spec(project.project_id, 0);

    store.put_project(&project).unwrap();
    store.put_spec(&spec).unwrap();

    let statuses = vec![
        TaskStatus::Pending,
        TaskStatus::Ready,
        TaskStatus::InProgress,
        TaskStatus::Blocked,
        TaskStatus::Done,
        TaskStatus::Done,
        TaskStatus::Failed,
    ];

    for (i, status) in statuses.iter().enumerate() {
        let task = make_task_with(project.project_id, spec.spec_id, *status, i as u32, vec![]);
        store.put_task(&task).unwrap();
    }

    let progress = svc.get_project_progress(&project.project_id).unwrap();
    assert_eq!(progress.total_tasks, 7);
    assert_eq!(progress.pending_tasks, 1);
    assert_eq!(progress.ready_tasks, 1);
    assert_eq!(progress.in_progress_tasks, 1);
    assert_eq!(progress.blocked_tasks, 1);
    assert_eq!(progress.done_tasks, 2);
    assert_eq!(progress.failed_tasks, 1);
    assert!((progress.completion_percentage - 28.57).abs() < 0.1);
}

#[test]
fn progress_zero_tasks_is_zero_percent() {
    let (store, _dir) = setup();
    let svc = TaskService::new(store.clone());

    let project = make_project();
    store.put_project(&project).unwrap();

    let progress = svc.get_project_progress(&project.project_id).unwrap();
    assert_eq!(progress.total_tasks, 0);
    assert_eq!(progress.completion_percentage, 0.0);
}
