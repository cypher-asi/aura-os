use std::sync::Arc;

use aura_os_core::*;
use aura_os_sessions::CreateSessionParams;

use crate::common::*;

#[tokio::test]
async fn record_task_worked_persists_count() {
    let (storage_url, db) = start_mock_storage().await;
    let tmp = tempfile::TempDir::new().expect("temp dir should be created");
    let store = Arc::new(
        aura_os_store::SettingsStore::open(tmp.path()).expect("SettingsStore should open"),
    );
    store_test_jwt(&store);

    let svc = make_session_service(&store, &storage_url, 0.99);

    let pid = ProjectId::new();
    let aid = AgentInstanceId::new();

    let session = svc
        .create_session(CreateSessionParams {
            agent_instance_id: aid,
            project_id: pid,
            active_task_id: None,
            summary: String::new(),
            user_id: None,
            model: None,
        })
        .await
        .expect("session creation should succeed");

    for i in 0..3u32 {
        svc.record_task_worked(&pid, &aid, &session.session_id, TaskId::new())
            .await
            .expect("record_task_worked should succeed");

        let sessions = db.lock().await;
        let stored = sessions
            .iter()
            .find(|s| s.id == session.session_id.to_string())
            .expect("session must exist");
        assert_eq!(
            stored.tasks_worked_count,
            Some(i + 1),
            "tasks_worked_count should be {} after {} record(s)",
            i + 1,
            i + 1,
        );
    }
}

#[tokio::test]
async fn tasks_worked_count_survives_reload_from_storage() {
    let (storage_url, _db) = start_mock_storage().await;
    let tmp = tempfile::TempDir::new().expect("temp dir should be created");
    let store = Arc::new(
        aura_os_store::SettingsStore::open(tmp.path()).expect("SettingsStore should open"),
    );
    store_test_jwt(&store);

    let svc = make_session_service(&store, &storage_url, 0.99);

    let pid = ProjectId::new();
    let aid = AgentInstanceId::new();

    let session = svc
        .create_session(CreateSessionParams {
            agent_instance_id: aid,
            project_id: pid,
            active_task_id: None,
            summary: String::new(),
            user_id: None,
            model: None,
        })
        .await
        .expect("session creation should succeed");

    for _ in 0..5 {
        svc.record_task_worked(&pid, &aid, &session.session_id, TaskId::new())
            .await
            .expect("record_task_worked should succeed");
    }

    // Reload from storage (no local_overrides) -- should reflect persisted count
    let reloaded = svc
        .get_session(&pid, &aid, &session.session_id)
        .await
        .expect("get session should succeed");
    assert_eq!(
        reloaded.tasks_worked.len(),
        5,
        "tasks_worked should reflect persisted count after reload"
    );
}
