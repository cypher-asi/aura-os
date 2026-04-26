//! Recover-remote-agent flow: delete + re-provision and failure paths.

use std::sync::Arc;

use axum::http::StatusCode;
use serde_json::Value;
use tower::ServiceExt;

use aura_os_store::SettingsStore;

use super::common::*;
use super::mocks::*;

#[tokio::test]
async fn recover_remote_agent_deletes_and_reprovisions() {
    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let update_capture: Arc<tokio::sync::Mutex<Option<Value>>> =
        Arc::new(tokio::sync::Mutex::new(None));

    let network_url = start_mock_network_get_with_update(
        network_agent_json("remote", Some("old-vm")),
        "pod-recovered-123".to_string(),
        update_capture.clone(),
    )
    .await;

    let swarm_url = start_mock_swarm(
        StatusCode::OK,
        serde_json::json!({
            "agent_id": AGENT_UUID,
            "status": "running",
            "pod_id": "pod-recovered-123"
        }),
    )
    .await;

    let app = build_app_with_swarm(
        store,
        store_dir.path().to_path_buf(),
        &network_url,
        Some(swarm_url),
    );

    let req = json_request(
        "POST",
        &format!("/api/agents/{AGENT_UUID}/remote_agent/recover"),
        None,
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = response_json(resp).await;
    assert_eq!(body["status"], "running");
    assert_eq!(body["previous_vm_id"], "old-vm");
    assert_eq!(body["vm_id"], "pod-recovered-123");

    let captured = update_capture.lock().await;
    let update_body = captured
        .as_ref()
        .expect("network update should have been called");
    assert_eq!(
        update_body["vmId"], "pod-recovered-123",
        "PUT body should contain the recovered vmId"
    );
}

#[tokio::test]
async fn recover_remote_agent_fails_when_delete_returns_error() {
    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let update_capture: Arc<tokio::sync::Mutex<Option<Value>>> =
        Arc::new(tokio::sync::Mutex::new(None));

    let network_url = start_mock_network_get_with_update(
        network_agent_json("remote", Some("old-vm")),
        "unused".to_string(),
        update_capture.clone(),
    )
    .await;

    let swarm_url = start_mock_swarm_with_delete(
        StatusCode::INTERNAL_SERVER_ERROR,
        StatusCode::OK,
        serde_json::json!({
            "agent_id": AGENT_UUID,
            "status": "running",
            "pod_id": "pod-new"
        }),
    )
    .await;

    let app = build_app_with_swarm(
        store,
        store_dir.path().to_path_buf(),
        &network_url,
        Some(swarm_url),
    );

    let req = json_request(
        "POST",
        &format!("/api/agents/{AGENT_UUID}/remote_agent/recover"),
        None,
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_GATEWAY);

    let body = response_json(resp).await;
    assert_eq!(body["code"], "bad_gateway");
    assert!(
        update_capture.lock().await.is_none(),
        "network update should not run when delete fails"
    );
}

#[tokio::test]
async fn recover_remote_agent_succeeds_when_delete_returns_404() {
    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let update_capture: Arc<tokio::sync::Mutex<Option<Value>>> =
        Arc::new(tokio::sync::Mutex::new(None));

    let network_url = start_mock_network_get_with_update(
        network_agent_json("remote", Some("old-vm")),
        "pod-new-123".to_string(),
        update_capture.clone(),
    )
    .await;

    let swarm_url = start_mock_swarm_with_delete(
        StatusCode::NOT_FOUND,
        StatusCode::OK,
        serde_json::json!({
            "agent_id": AGENT_UUID,
            "status": "running",
            "pod_id": "pod-new-123"
        }),
    )
    .await;

    let app = build_app_with_swarm(
        store,
        store_dir.path().to_path_buf(),
        &network_url,
        Some(swarm_url),
    );

    let req = json_request(
        "POST",
        &format!("/api/agents/{AGENT_UUID}/remote_agent/recover"),
        None,
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = response_json(resp).await;
    assert_eq!(body["status"], "running");
    assert_eq!(body["vm_id"], "pod-new-123");
    assert!(
        update_capture.lock().await.is_some(),
        "network update should have been called"
    );
}

#[tokio::test]
async fn recover_remote_agent_rejects_local_agents() {
    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let network_url = start_mock_network_get_only(network_agent_json("local", None)).await;

    let app = build_app_with_swarm(store, store_dir.path().to_path_buf(), &network_url, None);

    let req = json_request(
        "POST",
        &format!("/api/agents/{AGENT_UUID}/remote_agent/recover"),
        None,
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    let body = response_json(resp).await;
    assert_eq!(body["code"], "bad_request");
}

#[tokio::test]
async fn recover_remote_agent_surfaces_provision_errors_after_delete() {
    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let update_capture: Arc<tokio::sync::Mutex<Option<Value>>> =
        Arc::new(tokio::sync::Mutex::new(None));

    let network_url = start_mock_network_get_with_update(
        network_agent_json("remote", Some("old-vm")),
        "unused-vm".to_string(),
        update_capture.clone(),
    )
    .await;

    let swarm_url = start_mock_swarm_with_delete(
        StatusCode::OK,
        StatusCode::INTERNAL_SERVER_ERROR,
        serde_json::json!({"error": "internal"}),
    )
    .await;

    let app = build_app_with_swarm(
        store,
        store_dir.path().to_path_buf(),
        &network_url,
        Some(swarm_url),
    );

    let req = json_request(
        "POST",
        &format!("/api/agents/{AGENT_UUID}/remote_agent/recover"),
        None,
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_GATEWAY);

    let body = response_json(resp).await;
    assert_eq!(body["code"], "bad_gateway");
    assert!(
        update_capture.lock().await.is_none(),
        "network update should not run when provisioning fails"
    );
}
