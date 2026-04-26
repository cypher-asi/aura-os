//! Remote agent creation: success and failure paths.

use std::sync::Arc;

use axum::extract::Path;
use axum::http::StatusCode;
use axum::routing::post;
use axum::Json;
use axum::Router;
use serde_json::Value;
use tokio::net::TcpListener;
use tower::ServiceExt;

use aura_os_store::SettingsStore;

use super::common::*;
use super::mocks::*;

#[tokio::test]
async fn create_remote_agent_provisions_swarm_and_sets_vm_id() {
    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let update_capture: Arc<tokio::sync::Mutex<Option<Value>>> =
        Arc::new(tokio::sync::Mutex::new(None));

    let network_url = start_mock_network_with_update(
        network_agent_json("remote", None),
        "pod-abc-123".to_string(),
        update_capture.clone(),
    )
    .await;

    let swarm_url = start_mock_swarm(
        StatusCode::OK,
        serde_json::json!({
            "agent_id": AGENT_UUID,
            "status": "running",
            "pod_id": "pod-abc-123"
        }),
    )
    .await;

    let app = build_app_with_swarm(
        store,
        store_dir.path().to_path_buf(),
        &network_url,
        Some(swarm_url),
    );

    let req = json_request("POST", "/api/agents", Some(create_agent_body("remote")));
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = response_json(resp).await;
    assert_eq!(body["vm_id"], "pod-abc-123");

    let captured = update_capture.lock().await;
    let update_body = captured
        .as_ref()
        .expect("network update should have been called");
    assert_eq!(
        update_body["vmId"], "pod-abc-123",
        "PUT body should contain vmId"
    );
}

#[tokio::test]
async fn create_remote_agent_falls_back_to_swarm_agent_id_when_no_pod_id() {
    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let update_capture: Arc<tokio::sync::Mutex<Option<Value>>> =
        Arc::new(tokio::sync::Mutex::new(None));

    let network_url = start_mock_network_with_update(
        network_agent_json("remote", None),
        "swarm-agent-xyz".to_string(),
        update_capture.clone(),
    )
    .await;

    let swarm_url = start_mock_swarm(
        StatusCode::OK,
        serde_json::json!({
            "agent_id": "swarm-agent-xyz",
            "status": "running"
        }),
    )
    .await;

    let app = build_app_with_swarm(
        store,
        store_dir.path().to_path_buf(),
        &network_url,
        Some(swarm_url),
    );

    let req = json_request("POST", "/api/agents", Some(create_agent_body("remote")));
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body = response_json(resp).await;
    assert_eq!(
        body["vm_id"], "swarm-agent-xyz",
        "should fall back to agent_id when pod_id is absent"
    );
}

#[tokio::test]
async fn create_remote_agent_fails_when_swarm_not_configured() {
    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let network_url = start_mock_network_create_only(network_agent_json("remote", None)).await;

    let app = build_app_with_swarm(store, store_dir.path().to_path_buf(), &network_url, None);

    let req = json_request("POST", "/api/agents", Some(create_agent_body("remote")));
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);

    let body = response_json(resp).await;
    assert_eq!(body["code"], "service_unavailable");
}

#[tokio::test]
async fn create_remote_agent_fails_when_swarm_returns_error() {
    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let network_url = start_mock_network_create_only(network_agent_json("remote", None)).await;

    let swarm_url = start_mock_swarm(
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

    let req = json_request("POST", "/api/agents", Some(create_agent_body("remote")));
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_GATEWAY);

    let body = response_json(resp).await;
    assert_eq!(body["code"], "bad_gateway");
}

#[tokio::test]
async fn create_remote_agent_fails_when_swarm_returns_401() {
    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let network_url = start_mock_network_create_only(network_agent_json("remote", None)).await;

    let swarm_url = start_mock_swarm(
        StatusCode::UNAUTHORIZED,
        serde_json::json!({"error": "unauthorized"}),
    )
    .await;

    let app = build_app_with_swarm(
        store,
        store_dir.path().to_path_buf(),
        &network_url,
        Some(swarm_url),
    );

    let req = json_request("POST", "/api/agents", Some(create_agent_body("remote")));
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

    let body = response_json(resp).await;
    assert_eq!(body["code"], "unauthorized");
}

#[tokio::test]
async fn create_remote_agent_fails_when_swarm_returns_malformed_json() {
    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let network_url = start_mock_network_create_only(network_agent_json("remote", None)).await;

    let swarm_url =
        start_mock_swarm_raw(StatusCode::OK, r#"{"unexpected": true}"#.to_string()).await;

    let app = build_app_with_swarm(
        store,
        store_dir.path().to_path_buf(),
        &network_url,
        Some(swarm_url),
    );

    let req = json_request("POST", "/api/agents", Some(create_agent_body("remote")));
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);

    let body = response_json(resp).await;
    assert_eq!(body["code"], "internal_error");
}

#[tokio::test]
async fn create_remote_agent_fails_when_network_update_fails() {
    let store_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(SettingsStore::open(store_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let create_json = network_agent_json("remote", None);
    let create_json_clone = create_json.clone();
    let network_app = Router::new()
        .route(
            "/api/agents",
            post(move || {
                let j = create_json_clone.clone();
                async move { (StatusCode::CREATED, Json(j)) }
            }),
        )
        .route(
            "/api/agents/:agent_id",
            axum::routing::put(|Path(_id): Path<String>| async {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": "db failure"})),
                )
            }),
        );
    let net_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let net_addr = net_listener.local_addr().unwrap();
    let network_url = format!("http://{}", net_addr);
    tokio::spawn(async move { axum::serve(net_listener, network_app).await.ok() });

    let swarm_url = start_mock_swarm(
        StatusCode::OK,
        serde_json::json!({
            "agent_id": AGENT_UUID,
            "status": "running",
            "pod_id": "pod-abc-123"
        }),
    )
    .await;

    let app = build_app_with_swarm(
        store,
        store_dir.path().to_path_buf(),
        &network_url,
        Some(swarm_url),
    );

    let req = json_request("POST", "/api/agents", Some(create_agent_body("remote")));
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_GATEWAY);

    let body = response_json(resp).await;
    assert_eq!(body["code"], "bad_gateway");
    assert!(
        body["error"]
            .as_str()
            .unwrap_or("")
            .contains("failed to update agent record"),
        "error should mention update failure, got: {}",
        body["error"]
    );
}
