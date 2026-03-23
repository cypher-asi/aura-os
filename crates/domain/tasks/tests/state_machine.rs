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

// ---------------------------------------------------------------------------
// 3. Integration tests (claim, dependency, concurrent safety)
// ---------------------------------------------------------------------------

mod integration {
    use std::sync::Arc;

    use aura_core::*;
    use aura_storage::StorageClient;
    use aura_store::RocksStore;
    use aura_tasks::TaskService;

    struct TestCtx {
        task_service: Arc<TaskService>,
        storage_client: Arc<StorageClient>,
        store: Arc<RocksStore>,
        spec_id: String,
        project_id: String,
        _tmp: tempfile::TempDir,
    }

    async fn setup() -> TestCtx {
        let tmp = tempfile::TempDir::new().expect("temp dir creation should succeed");
        let store = Arc::new(RocksStore::open(tmp.path()).expect("RocksStore should open"));
        aura_billing::testutil::store_zero_auth_session(&store);

        let (storage_url, _db) = aura_storage::testutil::start_mock_storage().await;
        let storage_client = Arc::new(StorageClient::with_base_url(&storage_url));
        let task_service = Arc::new(TaskService::new(
            store.clone(),
            Some(storage_client.clone()),
        ));

        let jwt = store
            .get_jwt()
            .expect("JWT should exist after session setup");
        let pid = ProjectId::new().to_string();
        let spec = storage_client
            .create_spec(
                &pid,
                &jwt,
                &aura_storage::CreateSpecRequest {
                    title: "Spec A".into(),
                    order_index: Some(0),
                    markdown_contents: None,
                },
            )
            .await
            .expect("spec creation should succeed");

        TestCtx {
            task_service,
            storage_client,
            store,
            spec_id: spec.id,
            project_id: pid,
            _tmp: tmp,
        }
    }

    struct CreateTestTask<'a> {
        sc: &'a StorageClient,
        store: &'a RocksStore,
        pid: &'a str,
        spec_id: &'a str,
        title: &'a str,
        status: &'a str,
        order_index: i32,
        dependency_ids: Option<Vec<String>>,
    }

    async fn create_task(params: CreateTestTask<'_>) -> String {
        let jwt = params.store.get_jwt().expect("store should have a JWT");
        let t = params
            .sc
            .create_task(
                params.pid,
                &jwt,
                &aura_storage::CreateTaskRequest {
                    spec_id: params.spec_id.into(),
                    title: params.title.into(),
                    description: Some(format!("Desc for {}", params.title)),
                    status: Some(params.status.into()),
                    order_index: Some(params.order_index),
                    dependency_ids: params.dependency_ids,
                },
            )
            .await
            .expect("create_task storage call should succeed");
        t.id
    }

    // -----------------------------------------------------------------------
    // Claim ordering: tasks should be claimed by order_index
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn claim_ordering_respects_order_index() {
        let ctx = setup().await;
        let pid: ProjectId = ctx.project_id.parse().expect("project_id should parse");
        let aid = AgentInstanceId::new();

        create_task(CreateTestTask {
            sc: &ctx.storage_client,
            store: &ctx.store,
            pid: &ctx.project_id,
            spec_id: &ctx.spec_id,
            title: "Third",
            status: "ready",
            order_index: 2,
            dependency_ids: None,
        })
        .await;
        create_task(CreateTestTask {
            sc: &ctx.storage_client,
            store: &ctx.store,
            pid: &ctx.project_id,
            spec_id: &ctx.spec_id,
            title: "First",
            status: "ready",
            order_index: 0,
            dependency_ids: None,
        })
        .await;
        create_task(CreateTestTask {
            sc: &ctx.storage_client,
            store: &ctx.store,
            pid: &ctx.project_id,
            spec_id: &ctx.spec_id,
            title: "Second",
            status: "ready",
            order_index: 1,
            dependency_ids: None,
        })
        .await;

        let t1 = ctx
            .task_service
            .claim_next_task(&pid, &aid, None)
            .await
            .expect("claim should not error")
            .expect("a ready task should exist");
        assert_eq!(t1.title, "First", "should claim lowest order_index first");

        let t2 = ctx
            .task_service
            .claim_next_task(&pid, &aid, None)
            .await
            .expect("claim should not error")
            .expect("a ready task should exist");
        assert_eq!(t2.title, "Second");

        let t3 = ctx
            .task_service
            .claim_next_task(&pid, &aid, None)
            .await
            .expect("claim should not error")
            .expect("a ready task should exist");
        assert_eq!(t3.title, "Third");

        let none = ctx
            .task_service
            .claim_next_task(&pid, &aid, None)
            .await
            .expect("claim should not error");
        assert!(none.is_none(), "no more ready tasks");
    }

    // -----------------------------------------------------------------------
    // Claim ordering: multi-spec ordering (spec order then task order)
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn claim_ordering_multi_spec() {
        let tmp = tempfile::TempDir::new().expect("temp dir should be created");
        let store = Arc::new(RocksStore::open(tmp.path()).expect("RocksStore should open"));
        aura_billing::testutil::store_zero_auth_session(&store);

        let (storage_url, _db) = aura_storage::testutil::start_mock_storage().await;
        let sc = Arc::new(StorageClient::with_base_url(&storage_url));
        let svc = Arc::new(TaskService::new(store.clone(), Some(sc.clone())));

        let jwt = store.get_jwt().expect("JWT should be available");
        let pid = ProjectId::new();
        let pid_str = pid.to_string();

        let spec_b = sc
            .create_spec(
                &pid_str,
                &jwt,
                &aura_storage::CreateSpecRequest {
                    title: "Spec B".into(),
                    order_index: Some(1),
                    markdown_contents: None,
                },
            )
            .await
            .expect("spec creation should succeed");
        let spec_a = sc
            .create_spec(
                &pid_str,
                &jwt,
                &aura_storage::CreateSpecRequest {
                    title: "Spec A".into(),
                    order_index: Some(0),
                    markdown_contents: None,
                },
            )
            .await
            .expect("spec creation should succeed");

        create_task(CreateTestTask {
            sc: &sc,
            store: &store,
            pid: &pid_str,
            spec_id: &spec_b.id,
            title: "B-task",
            status: "ready",
            order_index: 0,
            dependency_ids: None,
        })
        .await;
        create_task(CreateTestTask {
            sc: &sc,
            store: &store,
            pid: &pid_str,
            spec_id: &spec_a.id,
            title: "A-task",
            status: "ready",
            order_index: 0,
            dependency_ids: None,
        })
        .await;

        let aid = AgentInstanceId::new();
        let t1 = svc
            .claim_next_task(&pid, &aid, None)
            .await
            .expect("claim should not error")
            .expect("a ready task should exist");
        assert_eq!(
            t1.title, "A-task",
            "spec_a (order 0) should be claimed before spec_b (order 1)"
        );

        let t2 = svc
            .claim_next_task(&pid, &aid, None)
            .await
            .expect("claim should not error")
            .expect("a ready task should exist");
        assert_eq!(t2.title, "B-task");
    }

    // -----------------------------------------------------------------------
    // Dependency promotion: pending → ready when deps complete
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn dependency_promotion_on_completion() {
        let tmp = tempfile::TempDir::new().expect("temp dir should be created");
        let store = Arc::new(RocksStore::open(tmp.path()).expect("RocksStore should open"));
        aura_billing::testutil::store_zero_auth_session(&store);

        let (storage_url, _db) = aura_storage::testutil::start_mock_storage().await;
        let sc = Arc::new(StorageClient::with_base_url(&storage_url));
        let svc = Arc::new(TaskService::new(store.clone(), Some(sc.clone())));

        let jwt = store.get_jwt().expect("JWT should be available");
        let pid = ProjectId::new();
        let pid_str = pid.to_string();

        let spec = sc
            .create_spec(
                &pid_str,
                &jwt,
                &aura_storage::CreateSpecRequest {
                    title: "Spec".into(),
                    order_index: Some(0),
                    markdown_contents: None,
                },
            )
            .await
            .expect("spec creation should succeed");

        let task_a_id = create_task(CreateTestTask {
            sc: &sc,
            store: &store,
            pid: &pid_str,
            spec_id: &spec.id,
            title: "Task A",
            status: "ready",
            order_index: 0,
            dependency_ids: None,
        })
        .await;
        let task_b_id = create_task(CreateTestTask {
            sc: &sc,
            store: &store,
            pid: &pid_str,
            spec_id: &spec.id,
            title: "Task B",
            status: "pending",
            order_index: 1,
            dependency_ids: Some(vec![task_a_id.clone()]),
        })
        .await;
        let _task_c_id = create_task(CreateTestTask {
            sc: &sc,
            store: &store,
            pid: &pid_str,
            spec_id: &spec.id,
            title: "Task C",
            status: "pending",
            order_index: 2,
            dependency_ids: Some(vec![task_a_id.clone(), task_b_id.clone()]),
        })
        .await;

        let aid = AgentInstanceId::new();
        let claimed_a = svc
            .claim_next_task(&pid, &aid, None)
            .await
            .expect("claim should not error")
            .expect("a ready task should exist");
        assert_eq!(claimed_a.title, "Task A");

        let no_ready = svc
            .claim_next_task(&pid, &aid, None)
            .await
            .expect("claim should not error");
        assert!(no_ready.is_none(), "B and C should still be pending");

        svc.complete_task(
            &pid,
            &spec.id.parse().expect("spec id should parse"),
            &claimed_a.task_id,
            "done",
            vec![],
        )
        .await
        .expect("task completion should succeed");

        let promoted = svc
            .resolve_dependencies_after_completion(&pid, &claimed_a.task_id)
            .await
            .expect("dependency resolution should succeed");
        assert_eq!(
            promoted.len(),
            1,
            "only Task B should become ready (C still waiting on B)"
        );
        assert_eq!(promoted[0].title, "Task B");

        let claimed_b = svc
            .claim_next_task(&pid, &aid, None)
            .await
            .expect("claim should not error")
            .expect("a ready task should exist");
        assert_eq!(claimed_b.title, "Task B");

        svc.complete_task(
            &pid,
            &spec.id.parse().expect("spec id should parse"),
            &claimed_b.task_id,
            "done",
            vec![],
        )
        .await
        .expect("task completion should succeed");

        let promoted2 = svc
            .resolve_dependencies_after_completion(&pid, &claimed_b.task_id)
            .await
            .expect("dependency resolution should succeed");
        assert_eq!(promoted2.len(), 1, "Task C should now become ready");
        assert_eq!(promoted2[0].title, "Task C");
    }

    // -----------------------------------------------------------------------
    // resolve_initial_readiness promotes all satisfiable pending tasks
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn initial_readiness_promotes_all_satisfiable() {
        let tmp = tempfile::TempDir::new().expect("temp dir should be created");
        let store = Arc::new(RocksStore::open(tmp.path()).expect("RocksStore should open"));
        aura_billing::testutil::store_zero_auth_session(&store);

        let (storage_url, _db) = aura_storage::testutil::start_mock_storage().await;
        let sc = Arc::new(StorageClient::with_base_url(&storage_url));
        let svc = Arc::new(TaskService::new(store.clone(), Some(sc.clone())));

        let jwt = store.get_jwt().expect("JWT should be available");
        let pid = ProjectId::new();
        let pid_str = pid.to_string();

        let spec = sc
            .create_spec(
                &pid_str,
                &jwt,
                &aura_storage::CreateSpecRequest {
                    title: "Spec".into(),
                    order_index: Some(0),
                    markdown_contents: None,
                },
            )
            .await
            .expect("spec creation should succeed");

        create_task(CreateTestTask {
            sc: &sc,
            store: &store,
            pid: &pid_str,
            spec_id: &spec.id,
            title: "No deps A",
            status: "pending",
            order_index: 0,
            dependency_ids: None,
        })
        .await;
        create_task(CreateTestTask {
            sc: &sc,
            store: &store,
            pid: &pid_str,
            spec_id: &spec.id,
            title: "No deps B",
            status: "pending",
            order_index: 1,
            dependency_ids: None,
        })
        .await;
        let blocker_id = create_task(CreateTestTask {
            sc: &sc,
            store: &store,
            pid: &pid_str,
            spec_id: &spec.id,
            title: "Blocker",
            status: "pending",
            order_index: 2,
            dependency_ids: None,
        })
        .await;
        create_task(CreateTestTask {
            sc: &sc,
            store: &store,
            pid: &pid_str,
            spec_id: &spec.id,
            title: "Blocked",
            status: "pending",
            order_index: 3,
            dependency_ids: Some(vec![blocker_id]),
        })
        .await;

        let promoted = svc
            .resolve_initial_readiness(&pid)
            .await
            .expect("initial readiness resolution should succeed");

        let promoted_titles: Vec<&str> = promoted.iter().map(|t| t.title.as_str()).collect();
        assert!(promoted_titles.contains(&"No deps A"));
        assert!(promoted_titles.contains(&"No deps B"));
        assert!(promoted_titles.contains(&"Blocker"));
        assert!(
            !promoted_titles.contains(&"Blocked"),
            "Blocked task has an unsatisfied dependency"
        );
        assert_eq!(promoted.len(), 3);
    }

    // -----------------------------------------------------------------------
    // Concurrent claim safety: two concurrent claims produce different tasks
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn concurrent_claims_produce_different_tasks() {
        let tmp = tempfile::TempDir::new().expect("temp dir should be created");
        let store = Arc::new(RocksStore::open(tmp.path()).expect("RocksStore should open"));
        aura_billing::testutil::store_zero_auth_session(&store);

        let (storage_url, _db) = aura_storage::testutil::start_mock_storage().await;
        let sc = Arc::new(StorageClient::with_base_url(&storage_url));
        let svc = Arc::new(TaskService::new(store.clone(), Some(sc.clone())));

        let jwt = store.get_jwt().expect("JWT should be available");
        let pid = ProjectId::new();
        let pid_str = pid.to_string();

        let spec = sc
            .create_spec(
                &pid_str,
                &jwt,
                &aura_storage::CreateSpecRequest {
                    title: "Spec".into(),
                    order_index: Some(0),
                    markdown_contents: None,
                },
            )
            .await
            .expect("spec creation should succeed");

        for i in 0..4 {
            create_task(CreateTestTask {
                sc: &sc,
                store: &store,
                pid: &pid_str,
                spec_id: &spec.id,
                title: &format!("Task {i}"),
                status: "ready",
                order_index: i,
                dependency_ids: None,
            })
            .await;
        }

        let svc1 = svc.clone();
        let svc2 = svc.clone();
        let aid1 = AgentInstanceId::new();
        let aid2 = AgentInstanceId::new();

        let (r1, r2) = tokio::join!(
            svc1.claim_next_task(&pid, &aid1, None),
            svc2.claim_next_task(&pid, &aid2, None),
        );

        let t1 = r1
            .expect("first claim should not error")
            .expect("first claim should succeed");
        let t2 = r2
            .expect("second claim should not error")
            .expect("second claim should succeed");
        assert_ne!(
            t1.task_id, t2.task_id,
            "concurrent claims must return different tasks"
        );
    }
}
