use std::sync::Arc;

use aura_os_core::*;
use aura_os_storage::StorageClient;
use aura_os_store::RocksStore;
use aura_os_tasks::TaskService;

use super::helpers::{create_task, setup, CreateTestTask};

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

#[tokio::test]
async fn claim_ordering_multi_spec() {
    let tmp = tempfile::TempDir::new().expect("temp dir should be created");
    let store = Arc::new(RocksStore::open(tmp.path()).expect("RocksStore should open"));
    aura_os_billing::testutil::store_zero_auth_session(&store);

    let (storage_url, _db) = aura_os_storage::testutil::start_mock_storage().await;
    let sc = Arc::new(StorageClient::with_base_url(&storage_url));
    let svc = Arc::new(TaskService::new(store.clone(), Some(sc.clone())));

    let jwt = store.get_jwt().expect("JWT should be available");
    let pid = ProjectId::new();
    let pid_str = pid.to_string();

    let spec_b = sc
        .create_spec(
            &pid_str,
            &jwt,
            &aura_os_storage::CreateSpecRequest {
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
            &aura_os_storage::CreateSpecRequest {
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
