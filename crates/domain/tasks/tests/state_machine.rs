use std::sync::Arc;

use aura_core::*;
use aura_store::RocksStore;
use aura_tasks::TaskService;
use chrono::Utc;
use tempfile::TempDir;

fn setup() -> (TaskService, Arc<RocksStore>, TempDir, ProjectId, SpecId) {
    let dir = TempDir::new().unwrap();
    let store = Arc::new(RocksStore::open(dir.path()).unwrap());
    let svc = TaskService::new(store.clone());

    let now = Utc::now();
    let project_id = ProjectId::new();
    let spec_id = SpecId::new();

    let project = Project {
        project_id,
        org_id: OrgId::new(),
        name: "Test".into(),
        description: String::new(),
        linked_folder_path: "/tmp".into(),
        requirements_doc_path: None,
        current_status: ProjectStatus::Active,
        build_command: None,
        test_command: None,
        specs_summary: None,
        specs_title: None,
        created_at: now,
        updated_at: now,
    };
    store.put_project(&project).unwrap();

    let spec = Spec {
        spec_id,
        project_id,
        title: "Spec".into(),
        order_index: 0,
        markdown_contents: String::new(),
        created_at: now,
        updated_at: now,
    };
    store.put_spec(&spec).unwrap();

    (svc, store, dir, project_id, spec_id)
}

fn insert_task(
    store: &RocksStore,
    project_id: ProjectId,
    spec_id: SpecId,
    status: TaskStatus,
    deps: Vec<TaskId>,
) -> Task {
    static COUNTER: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let now = Utc::now();
    let id = TaskId::new();
    let task = Task {
        task_id: id,
        project_id,
        spec_id,
        title: format!("Task-{n}"),
        description: String::new(),
        status,
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
    store.put_task(&task).unwrap();
    task
}

// ---------------------------------------------------------------------------
// 1. Valid and invalid state transitions
// ---------------------------------------------------------------------------

#[test]
fn valid_transitions_succeed() {
    let (svc, store, _dir, pid, sid) = setup();
    let task = insert_task(&store, pid, sid, TaskStatus::Pending, vec![]);

    let t = svc.transition_task(&pid, &sid, &task.task_id, TaskStatus::Ready).unwrap();
    assert_eq!(t.status, TaskStatus::Ready);

    let t = svc.transition_task(&pid, &sid, &t.task_id, TaskStatus::InProgress).unwrap();
    assert_eq!(t.status, TaskStatus::InProgress);

    let t = svc.transition_task(&pid, &sid, &t.task_id, TaskStatus::Done).unwrap();
    assert_eq!(t.status, TaskStatus::Done);

    // Done -> Ready (re-open)
    let t = svc.transition_task(&pid, &sid, &t.task_id, TaskStatus::Ready).unwrap();
    assert_eq!(t.status, TaskStatus::Ready);
}

#[test]
fn illegal_transitions_are_rejected() {
    let (svc, store, _dir, pid, sid) = setup();
    let task = insert_task(&store, pid, sid, TaskStatus::Pending, vec![]);

    let err = svc
        .transition_task(&pid, &sid, &task.task_id, TaskStatus::Done)
        .unwrap_err();
    let msg = format!("{err}");
    assert!(msg.contains("illegal transition"), "got: {msg}");

    let task = insert_task(&store, pid, sid, TaskStatus::Ready, vec![]);
    let err = svc
        .transition_task(&pid, &sid, &task.task_id, TaskStatus::Pending)
        .unwrap_err();
    let msg = format!("{err}");
    assert!(msg.contains("illegal transition"), "got: {msg}");
}

// ---------------------------------------------------------------------------
// 2. Claim flow (select + assign atomically)
// ---------------------------------------------------------------------------

#[test]
fn claim_next_task_assigns_and_transitions() {
    let (svc, store, _dir, pid, sid) = setup();
    let _t1 = insert_task(&store, pid, sid, TaskStatus::Ready, vec![]);
    let _t2 = insert_task(&store, pid, sid, TaskStatus::Pending, vec![]);

    let agent_instance_id = AgentInstanceId::new();
    let session_id = SessionId::new();

    let claimed = svc
        .claim_next_task(&pid, &agent_instance_id, Some(session_id))
        .unwrap();
    assert!(claimed.is_some());
    let claimed = claimed.unwrap();
    assert_eq!(claimed.status, TaskStatus::InProgress);
    assert_eq!(claimed.assigned_agent_instance_id, Some(agent_instance_id));
    assert_eq!(claimed.session_id, Some(session_id));

    // No more ready tasks, next claim returns None
    let next = svc
        .claim_next_task(&pid, &agent_instance_id, Some(session_id))
        .unwrap();
    assert!(next.is_none());
}

// ---------------------------------------------------------------------------
// 3. Dependency resolution on task completion
// ---------------------------------------------------------------------------

#[test]
fn dependency_resolution_promotes_pending_tasks() {
    let (svc, store, _dir, pid, sid) = setup();
    let dep = insert_task(&store, pid, sid, TaskStatus::Ready, vec![]);
    let blocked = insert_task(&store, pid, sid, TaskStatus::Pending, vec![dep.task_id]);

    // Move dep through Ready -> InProgress -> Done
    svc.transition_task(&pid, &sid, &dep.task_id, TaskStatus::InProgress).unwrap();
    svc.transition_task(&pid, &sid, &dep.task_id, TaskStatus::Done).unwrap();

    let promoted = svc.resolve_dependencies_after_completion(&pid, &dep.task_id).unwrap();
    assert_eq!(promoted.len(), 1);
    assert_eq!(promoted[0].task_id, blocked.task_id);
    assert_eq!(promoted[0].status, TaskStatus::Ready);
}

// ---------------------------------------------------------------------------
// 4. Cycle detection
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

// ---------------------------------------------------------------------------
// 5. Follow-up task creation
// ---------------------------------------------------------------------------

#[test]
fn follow_up_task_creation_and_dedup() {
    let (svc, store, _dir, pid, sid) = setup();
    let origin = insert_task(&store, pid, sid, TaskStatus::Done, vec![]);

    let follow = svc
        .create_follow_up_task(&origin, "Fix bug".into(), "desc".into(), vec![])
        .unwrap();
    assert_eq!(follow.status, TaskStatus::Ready);
    assert_eq!(follow.parent_task_id, Some(origin.task_id));

    // Duplicate title is rejected
    let err = svc
        .create_follow_up_task(&origin, "fix bug".into(), "desc".into(), vec![])
        .unwrap_err();
    let msg = format!("{err}");
    assert!(msg.contains("duplicate"), "got: {msg}");

    // Follow-up with dependencies starts Pending
    let follow2 = svc
        .create_follow_up_task(
            &origin,
            "Deploy".into(),
            "d".into(),
            vec![follow.task_id],
        )
        .unwrap();
    assert_eq!(follow2.status, TaskStatus::Pending);
}

// ---------------------------------------------------------------------------
// 6. Retry clears fields
// ---------------------------------------------------------------------------

#[test]
fn retry_resets_task_fields() {
    let (svc, store, _dir, pid, sid) = setup();
    let mut task = insert_task(&store, pid, sid, TaskStatus::Ready, vec![]);

    // Move to InProgress then Failed
    task = svc.transition_task(&pid, &sid, &task.task_id, TaskStatus::InProgress).unwrap();
    task = svc.fail_task(&pid, &sid, &task.task_id, "broke").unwrap();
    assert_eq!(task.status, TaskStatus::Failed);

    let retried = svc.retry_task(&pid, &sid, &task.task_id).unwrap();
    assert_eq!(retried.status, TaskStatus::Ready);
    assert!(retried.assigned_agent_instance_id.is_none());
    assert!(retried.session_id.is_none());
    assert!(retried.build_steps.is_empty());
    assert!(retried.live_output.is_empty());
}
