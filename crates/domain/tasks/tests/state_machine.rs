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
        let tmp = tempfile::TempDir::new().unwrap();
        let store = Arc::new(RocksStore::open(tmp.path()).unwrap());
        aura_billing::testutil::store_zero_auth_session(&store);

        let (storage_url, _db) = aura_storage::testutil::start_mock_storage().await;
        let storage_client = Arc::new(StorageClient::with_base_url(&storage_url));
        let task_service = Arc::new(TaskService::new(
            store.clone(),
            Some(storage_client.clone()),
        ));

        let jwt = store.get_jwt().unwrap();
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
            .unwrap();

        TestCtx {
            task_service,
            storage_client,
            store,
            spec_id: spec.id,
            project_id: pid,
            _tmp: tmp,
        }
    }

    async fn create_task(
        sc: &StorageClient,
        store: &RocksStore,
        pid: &str,
        spec_id: &str,
        title: &str,
        status: &str,
        order_index: i32,
        dependency_ids: Option<Vec<String>>,
    ) -> String {
        let jwt = store.get_jwt().unwrap();
        let t = sc
            .create_task(
                pid,
                &jwt,
                &aura_storage::CreateTaskRequest {
                    spec_id: spec_id.into(),
                    title: title.into(),
                    description: Some(format!("Desc for {title}")),
                    status: Some(status.into()),
                    order_index: Some(order_index),
                    dependency_ids,
                },
            )
            .await
            .unwrap();
        t.id
    }

    // -----------------------------------------------------------------------
    // Claim ordering: tasks should be claimed by order_index
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn claim_ordering_respects_order_index() {
        let ctx = setup().await;
        let pid: ProjectId = ctx.project_id.parse().unwrap();
        let aid = AgentInstanceId::new();

        create_task(&ctx.storage_client, &ctx.store, &ctx.project_id, &ctx.spec_id, "Third", "ready", 2, None).await;
        create_task(&ctx.storage_client, &ctx.store, &ctx.project_id, &ctx.spec_id, "First", "ready", 0, None).await;
        create_task(&ctx.storage_client, &ctx.store, &ctx.project_id, &ctx.spec_id, "Second", "ready", 1, None).await;

        let t1 = ctx.task_service.claim_next_task(&pid, &aid, None).await.unwrap().unwrap();
        assert_eq!(t1.title, "First", "should claim lowest order_index first");

        let t2 = ctx.task_service.claim_next_task(&pid, &aid, None).await.unwrap().unwrap();
        assert_eq!(t2.title, "Second");

        let t3 = ctx.task_service.claim_next_task(&pid, &aid, None).await.unwrap().unwrap();
        assert_eq!(t3.title, "Third");

        let none = ctx.task_service.claim_next_task(&pid, &aid, None).await.unwrap();
        assert!(none.is_none(), "no more ready tasks");
    }

    // -----------------------------------------------------------------------
    // Claim ordering: multi-spec ordering (spec order then task order)
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn claim_ordering_multi_spec() {
        let tmp = tempfile::TempDir::new().unwrap();
        let store = Arc::new(RocksStore::open(tmp.path()).unwrap());
        aura_billing::testutil::store_zero_auth_session(&store);

        let (storage_url, _db) = aura_storage::testutil::start_mock_storage().await;
        let sc = Arc::new(StorageClient::with_base_url(&storage_url));
        let svc = Arc::new(TaskService::new(
            store.clone(),
            Some(sc.clone()),
        ));

        let jwt = store.get_jwt().unwrap();
        let pid = ProjectId::new();
        let pid_str = pid.to_string();

        let spec_b = sc
            .create_spec(&pid_str, &jwt, &aura_storage::CreateSpecRequest {
                title: "Spec B".into(),
                order_index: Some(1),
                markdown_contents: None,
            })
            .await
            .unwrap();
        let spec_a = sc
            .create_spec(&pid_str, &jwt, &aura_storage::CreateSpecRequest {
                title: "Spec A".into(),
                order_index: Some(0),
                markdown_contents: None,
            })
            .await
            .unwrap();

        create_task(&sc, &store, &pid_str, &spec_b.id, "B-task", "ready", 0, None).await;
        create_task(&sc, &store, &pid_str, &spec_a.id, "A-task", "ready", 0, None).await;

        let aid = AgentInstanceId::new();
        let t1 = svc.claim_next_task(&pid, &aid, None).await.unwrap().unwrap();
        assert_eq!(t1.title, "A-task", "spec_a (order 0) should be claimed before spec_b (order 1)");

        let t2 = svc.claim_next_task(&pid, &aid, None).await.unwrap().unwrap();
        assert_eq!(t2.title, "B-task");
    }

    // -----------------------------------------------------------------------
    // Dependency promotion: pending → ready when deps complete
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn dependency_promotion_on_completion() {
        let tmp = tempfile::TempDir::new().unwrap();
        let store = Arc::new(RocksStore::open(tmp.path()).unwrap());
        aura_billing::testutil::store_zero_auth_session(&store);

        let (storage_url, _db) = aura_storage::testutil::start_mock_storage().await;
        let sc = Arc::new(StorageClient::with_base_url(&storage_url));
        let svc = Arc::new(TaskService::new(
            store.clone(),
            Some(sc.clone()),
        ));

        let jwt = store.get_jwt().unwrap();
        let pid = ProjectId::new();
        let pid_str = pid.to_string();

        let spec = sc
            .create_spec(&pid_str, &jwt, &aura_storage::CreateSpecRequest {
                title: "Spec".into(),
                order_index: Some(0),
                markdown_contents: None,
            })
            .await
            .unwrap();

        let task_a_id = create_task(&sc, &store, &pid_str, &spec.id, "Task A", "ready", 0, None).await;
        let task_b_id = create_task(
            &sc, &store, &pid_str, &spec.id, "Task B", "pending", 1,
            Some(vec![task_a_id.clone()]),
        ).await;
        let _task_c_id = create_task(
            &sc, &store, &pid_str, &spec.id, "Task C", "pending", 2,
            Some(vec![task_a_id.clone(), task_b_id.clone()]),
        ).await;

        let aid = AgentInstanceId::new();
        let claimed_a = svc.claim_next_task(&pid, &aid, None).await.unwrap().unwrap();
        assert_eq!(claimed_a.title, "Task A");

        let no_ready = svc.claim_next_task(&pid, &aid, None).await.unwrap();
        assert!(no_ready.is_none(), "B and C should still be pending");

        svc.complete_task(&pid, &spec.id.parse().unwrap(), &claimed_a.task_id, "done", vec![])
            .await
            .unwrap();

        let promoted = svc
            .resolve_dependencies_after_completion(&pid, &claimed_a.task_id)
            .await
            .unwrap();
        assert_eq!(promoted.len(), 1, "only Task B should become ready (C still waiting on B)");
        assert_eq!(promoted[0].title, "Task B");

        let claimed_b = svc.claim_next_task(&pid, &aid, None).await.unwrap().unwrap();
        assert_eq!(claimed_b.title, "Task B");

        svc.complete_task(&pid, &spec.id.parse().unwrap(), &claimed_b.task_id, "done", vec![])
            .await
            .unwrap();

        let promoted2 = svc
            .resolve_dependencies_after_completion(&pid, &claimed_b.task_id)
            .await
            .unwrap();
        assert_eq!(promoted2.len(), 1, "Task C should now become ready");
        assert_eq!(promoted2[0].title, "Task C");
    }

    // -----------------------------------------------------------------------
    // resolve_initial_readiness promotes all satisfiable pending tasks
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn initial_readiness_promotes_all_satisfiable() {
        let tmp = tempfile::TempDir::new().unwrap();
        let store = Arc::new(RocksStore::open(tmp.path()).unwrap());
        aura_billing::testutil::store_zero_auth_session(&store);

        let (storage_url, _db) = aura_storage::testutil::start_mock_storage().await;
        let sc = Arc::new(StorageClient::with_base_url(&storage_url));
        let svc = Arc::new(TaskService::new(
            store.clone(),
            Some(sc.clone()),
        ));

        let jwt = store.get_jwt().unwrap();
        let pid = ProjectId::new();
        let pid_str = pid.to_string();

        let spec = sc
            .create_spec(&pid_str, &jwt, &aura_storage::CreateSpecRequest {
                title: "Spec".into(),
                order_index: Some(0),
                markdown_contents: None,
            })
            .await
            .unwrap();

        create_task(&sc, &store, &pid_str, &spec.id, "No deps A", "pending", 0, None).await;
        create_task(&sc, &store, &pid_str, &spec.id, "No deps B", "pending", 1, None).await;
        let blocker_id = create_task(
            &sc, &store, &pid_str, &spec.id, "Blocker", "pending", 2, None,
        ).await;
        create_task(
            &sc, &store, &pid_str, &spec.id, "Blocked", "pending", 3,
            Some(vec![blocker_id]),
        ).await;

        let promoted = svc.resolve_initial_readiness(&pid).await.unwrap();

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
        let tmp = tempfile::TempDir::new().unwrap();
        let store = Arc::new(RocksStore::open(tmp.path()).unwrap());
        aura_billing::testutil::store_zero_auth_session(&store);

        let (storage_url, _db) = aura_storage::testutil::start_mock_storage().await;
        let sc = Arc::new(StorageClient::with_base_url(&storage_url));
        let svc = Arc::new(TaskService::new(
            store.clone(),
            Some(sc.clone()),
        ));

        let jwt = store.get_jwt().unwrap();
        let pid = ProjectId::new();
        let pid_str = pid.to_string();

        let spec = sc
            .create_spec(&pid_str, &jwt, &aura_storage::CreateSpecRequest {
                title: "Spec".into(),
                order_index: Some(0),
                markdown_contents: None,
            })
            .await
            .unwrap();

        for i in 0..4 {
            create_task(&sc, &store, &pid_str, &spec.id, &format!("Task {i}"), "ready", i, None).await;
        }

        let svc1 = svc.clone();
        let svc2 = svc.clone();
        let aid1 = AgentInstanceId::new();
        let aid2 = AgentInstanceId::new();

        let (r1, r2) = tokio::join!(
            svc1.claim_next_task(&pid, &aid1, None),
            svc2.claim_next_task(&pid, &aid2, None),
        );

        let t1 = r1.unwrap().expect("first claim should succeed");
        let t2 = r2.unwrap().expect("second claim should succeed");
        assert_ne!(
            t1.task_id, t2.task_id,
            "concurrent claims must return different tasks"
        );
    }
}
