//! Local-machine agent creation: skips swarm completely.

use std::sync::Arc;

use axum::http::StatusCode;
use tower::ServiceExt;

use aura_os_store::SettingsStore;

use super::common::*;
use super::mocks::*;

#[tokio::test]
async fn create_local_agent_skips_swarm() {
    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let network_url = start_mock_network_create_only(network_agent_json("local", None)).await;

    let app = build_app_with_swarm(store, store_dir.path().to_path_buf(), &network_url, None);

    let req = json_request("POST", "/api/agents", Some(create_agent_body("local")));
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = response_json(resp).await;
    assert_eq!(body["name"], "Test Agent");
    assert!(
        body["vm_id"].is_null(),
        "local agent should have null vm_id, got: {}",
        body["vm_id"]
    );
}
