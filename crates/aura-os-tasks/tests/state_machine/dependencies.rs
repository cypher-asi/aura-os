use std::sync::Arc;

use aura_os_core::*;
use aura_os_storage::StorageClient;
use aura_os_store::SettingsStore;
use aura_os_tasks::{CompleteTaskParams, TaskService};

use super::helpers::{create_task, CreateTestTask};

#[tokio::test]
async fn dependency_promotion_on_completion() {
    let tmp = tempfile::TempDir::new().expect("temp dir should be created");
    let store = Arc::new(SettingsStore::open(tmp.path()).expect("SettingsStore should open"));
    aura_os_billing::testutil::store_zero_auth_session(&store);

    let (storage_url, _db) = aura_os_storage::testutil::start_mock_storage().await;
    let sc = Arc::new(StorageClient::with_base_url(&storage_url));
    let svc = Arc::new(TaskService::new(store.clone(), Some(sc.clone())));

    let jwt = store.get_jwt().expect("JWT should be available");
    let pid = ProjectId::new();
    let pid_str = pid.to_string();

    let spec = sc
        .create_spec(
            &pid_str,
            &jwt,
            &aura_os_storage::CreateSpecRequest {
                title: "Spec".into(),
                org_id: None,
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

    svc.complete_task(CompleteTaskParams {
        project_id: pid,
        spec_id: spec.id.parse().expect("spec id should parse"),
        task_id: claimed_a.task_id,
        notes: "done".into(),
        files_changed: vec![],
    })
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

    svc.complete_task(CompleteTaskParams {
        project_id: pid,
        spec_id: spec.id.parse().expect("spec id should parse"),
        task_id: claimed_b.task_id,
        notes: "done".into(),
        files_changed: vec![],
    })
    .await
    .expect("task completion should succeed");

    let promoted2 = svc
        .resolve_dependencies_after_completion(&pid, &claimed_b.task_id)
        .await
        .expect("dependency resolution should succeed");
    assert_eq!(promoted2.len(), 1, "Task C should now become ready");
    assert_eq!(promoted2[0].title, "Task C");
}

#[tokio::test]
async fn initial_readiness_promotes_all_satisfiable() {
    let tmp = tempfile::TempDir::new().expect("temp dir should be created");
    let store = Arc::new(SettingsStore::open(tmp.path()).expect("SettingsStore should open"));
    aura_os_billing::testutil::store_zero_auth_session(&store);

    let (storage_url, _db) = aura_os_storage::testutil::start_mock_storage().await;
    let sc = Arc::new(StorageClient::with_base_url(&storage_url));
    let svc = Arc::new(TaskService::new(store.clone(), Some(sc.clone())));

    let jwt = store.get_jwt().expect("JWT should be available");
    let pid = ProjectId::new();
    let pid_str = pid.to_string();

    let spec = sc
        .create_spec(
            &pid_str,
            &jwt,
            &aura_os_storage::CreateSpecRequest {
                title: "Spec".into(),
                org_id: None,
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

#[tokio::test]
async fn concurrent_claims_produce_different_tasks() {
    let tmp = tempfile::TempDir::new().expect("temp dir should be created");
    let store = Arc::new(SettingsStore::open(tmp.path()).expect("SettingsStore should open"));
    aura_os_billing::testutil::store_zero_auth_session(&store);

    let (storage_url, _db) = aura_os_storage::testutil::start_mock_storage().await;
    let sc = Arc::new(StorageClient::with_base_url(&storage_url));
    let svc = Arc::new(TaskService::new(store.clone(), Some(sc.clone())));

    let jwt = store.get_jwt().expect("JWT should be available");
    let pid = ProjectId::new();
    let pid_str = pid.to_string();

    let spec = sc
        .create_spec(
            &pid_str,
            &jwt,
            &aura_os_storage::CreateSpecRequest {
                title: "Spec".into(),
                org_id: None,
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
