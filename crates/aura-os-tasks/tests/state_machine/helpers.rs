use std::sync::Arc;

use aura_os_core::*;
use aura_os_storage::StorageClient;
use aura_os_store::SettingsStore;
use aura_os_tasks::TaskService;

pub(crate) struct TestCtx {
    pub(crate) task_service: Arc<TaskService>,
    pub(crate) storage_client: Arc<StorageClient>,
    pub(crate) store: Arc<SettingsStore>,
    pub(crate) spec_id: String,
    pub(crate) project_id: String,
    pub(crate) _tmp: tempfile::TempDir,
}

pub(crate) async fn setup() -> TestCtx {
    let tmp = tempfile::TempDir::new().expect("temp dir creation should succeed");
    let store = Arc::new(SettingsStore::open(tmp.path()).expect("SettingsStore should open"));
    aura_os_billing::testutil::store_zero_auth_session(&store);

    let (storage_url, _db) = aura_os_storage::testutil::start_mock_storage().await;
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
            &aura_os_storage::CreateSpecRequest {
                title: "Spec A".into(),
                org_id: None,
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

pub(crate) struct CreateTestTask<'a> {
    pub(crate) sc: &'a StorageClient,
    pub(crate) store: &'a SettingsStore,
    pub(crate) pid: &'a str,
    pub(crate) spec_id: &'a str,
    pub(crate) title: &'a str,
    pub(crate) status: &'a str,
    pub(crate) order_index: i32,
    pub(crate) dependency_ids: Option<Vec<String>>,
}

pub(crate) async fn create_task(params: CreateTestTask<'_>) -> String {
    let jwt = params.store.get_jwt().expect("store should have a JWT");
    let t = params
        .sc
        .create_task(
            params.pid,
            &jwt,
            &aura_os_storage::CreateTaskRequest {
                spec_id: params.spec_id.into(),
                title: params.title.into(),
                org_id: None,
                description: Some(format!("Desc for {}", params.title)),
                status: Some(params.status.into()),
                order_index: Some(params.order_index),
                dependency_ids: params.dependency_ids,
                assigned_project_agent_id: None,
            },
        )
        .await
        .expect("create_task storage call should succeed");
    t.id
}
