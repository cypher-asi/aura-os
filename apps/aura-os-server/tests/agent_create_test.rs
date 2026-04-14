mod common;

use std::sync::Arc;

use axum::extract::Path;
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::Json;
use axum::Router;
use serde_json::Value;
use tokio::net::TcpListener;
use tower::ServiceExt;

use aura_os_network::NetworkClient;
use aura_os_store::RocksStore;

use common::*;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AGENT_UUID: &str = "00000000-1111-2222-3333-444444444444";
const NOW: &str = "2024-01-01T00:00:00Z";

fn network_agent_json(machine_type: &str, vm_id: Option<&str>) -> Value {
    serde_json::json!({
        "id": AGENT_UUID,
        "name": "Test Agent",
        "userId": "u1",
        "machineType": machine_type,
        "vmId": vm_id,
        "createdAt": NOW,
        "updatedAt": NOW,
    })
}

fn create_agent_body(machine_type: &str) -> Value {
    serde_json::json!({
        "name": "Test Agent",
        "role": "developer",
        "personality": "helpful",
        "system_prompt": "You are a test agent.",
        "skills": [],
        "machine_type": machine_type,
    })
}

/// Starts a mock network that only handles POST /api/agents (create)
/// and returns the given agent JSON. No PUT support.
async fn start_mock_network_create_only(agent_json: Value) -> String {
    let app = Router::new().route(
        "/api/agents",
        post(move || {
            let j = agent_json.clone();
            async move { (StatusCode::CREATED, Json(j)) }
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.ok() });
    format!("http://{}", addr)
}

/// Starts a mock network with POST /api/agents and PUT /api/agents/:id.
/// The PUT handler returns the agent with the given `vm_id` set.
/// `update_capture` receives the body of the PUT request for assertions.
async fn start_mock_network_with_update(
    create_json: Value,
    vm_id_for_update: String,
    update_capture: Arc<tokio::sync::Mutex<Option<Value>>>,
) -> String {
    let create_json_clone = create_json.clone();
    let app = Router::new()
        .route(
            "/api/agents",
            post(move || {
                let j = create_json_clone.clone();
                async move { (StatusCode::CREATED, Json(j)) }
            }),
        )
        .route(
            "/api/agents/:agent_id",
            axum::routing::put(
                move |Path(_agent_id): Path<String>, Json(body): Json<Value>| {
                    let capture = update_capture.clone();
                    let vm = vm_id_for_update.clone();
                    async move {
                        *capture.lock().await = Some(body);
                        let mut updated = network_agent_json("remote", Some(&vm));
                        updated["vmId"] = Value::String(vm);
                        Json(updated)
                    }
                },
            ),
        );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.ok() });
    format!("http://{}", addr)
}

async fn start_mock_network_get_only(agent_json: Value) -> String {
    let app = Router::new().route(
        "/api/agents/:agent_id",
        get(move |Path(_agent_id): Path<String>| {
            let j = agent_json.clone();
            async move { Json(j) }
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.ok() });
    format!("http://{}", addr)
}

async fn start_mock_network_get_with_update(
    agent_json: Value,
    vm_id_for_update: String,
    update_capture: Arc<tokio::sync::Mutex<Option<Value>>>,
) -> String {
    let agent_json_clone = agent_json.clone();
    let app = Router::new().route(
        "/api/agents/:agent_id",
        get(move |Path(_agent_id): Path<String>| {
            let j = agent_json_clone.clone();
            async move { Json(j) }
        })
        .put(
            move |Path(_agent_id): Path<String>, Json(body): Json<Value>| {
                let capture = update_capture.clone();
                let vm = vm_id_for_update.clone();
                async move {
                    *capture.lock().await = Some(body);
                    let mut updated = network_agent_json("remote", Some(&vm));
                    updated["vmId"] = Value::String(vm);
                    Json(updated)
                }
            },
        ),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.ok() });
    format!("http://{}", addr)
}

/// Starts a mock swarm gateway on a random port. Returns the base URL.
async fn start_mock_swarm(status_code: StatusCode, body: Value) -> String {
    let app = Router::new().route(
        "/v1/agents",
        post(move || {
            let b = body.clone();
            let sc = status_code;
            async move { (sc, Json(b)) }
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.ok() });
    format!("http://{}", addr)
}

/// Starts a mock swarm gateway that returns a raw string body (for malformed JSON test).
async fn start_mock_swarm_raw(status_code: StatusCode, raw_body: String) -> String {
    let app = Router::new().route(
        "/v1/agents",
        post(move || {
            let b = raw_body.clone();
            let sc = status_code;
            async move {
                (
                    sc,
                    [(axum::http::header::CONTENT_TYPE, "application/json")],
                    b,
                )
            }
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.ok() });
    format!("http://{}", addr)
}

fn build_app_with_swarm(
    store: Arc<RocksStore>,
    data_dir: std::path::PathBuf,
    network_url: &str,
    swarm_url: Option<String>,
) -> axum::Router {
    let (app, _state) = build_test_app_from_store(
        store,
        data_dir,
        Some(Arc::new(NetworkClient::with_base_url(network_url))),
        None,
        swarm_url,
        None,
    );
    app
}

// ===========================================================================
// Success Path Tests
// ===========================================================================

#[tokio::test]
async fn create_local_agent_skips_swarm() {
    let db_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(RocksStore::open(db_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let network_url = start_mock_network_create_only(network_agent_json("local", None)).await;

    let app = build_app_with_swarm(
        store,
        db_dir.path().to_path_buf(),
        &network_url,
        None, // no swarm configured
    );

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

#[tokio::test]
async fn create_remote_agent_provisions_swarm_and_sets_vm_id() {
    let db_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(RocksStore::open(db_dir.path()).unwrap());
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
        db_dir.path().to_path_buf(),
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
    let db_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(RocksStore::open(db_dir.path()).unwrap());
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
        db_dir.path().to_path_buf(),
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
async fn recover_remote_agent_reprovisions_swarm_and_sets_vm_id() {
    let db_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(RocksStore::open(db_dir.path()).unwrap());
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
            "status": "provisioning",
            "pod_id": "pod-recovered-123"
        }),
    )
    .await;

    let app = build_app_with_swarm(
        store,
        db_dir.path().to_path_buf(),
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
    assert_eq!(body["status"], "provisioning");
    assert_eq!(body["previous_vm_id"], "old-vm");
    assert_eq!(body["vm_id"], "pod-recovered-123");
    assert_eq!(body["vm_id_changed"], true);
    assert!(body.get("message").is_none(), "message should be omitted when vm_id changes");

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
async fn recover_remote_agent_reports_when_vm_mapping_does_not_change() {
    let db_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(RocksStore::open(db_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let update_capture: Arc<tokio::sync::Mutex<Option<Value>>> =
        Arc::new(tokio::sync::Mutex::new(None));

    let network_url = start_mock_network_get_with_update(
        network_agent_json("remote", Some(AGENT_UUID)),
        AGENT_UUID.to_string(),
        update_capture.clone(),
    )
    .await;

    let swarm_url = start_mock_swarm(
        StatusCode::OK,
        serde_json::json!({
            "agent_id": AGENT_UUID,
            "status": "provisioning"
        }),
    )
    .await;

    let app = build_app_with_swarm(
        store,
        db_dir.path().to_path_buf(),
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
    assert_eq!(body["status"], "provisioning");
    assert_eq!(body["previous_vm_id"], AGENT_UUID);
    assert_eq!(body["vm_id"], AGENT_UUID);
    assert_eq!(body["vm_id_changed"], false);
    assert_eq!(
        body["message"],
        "Swarm accepted the recovery request but kept the same machine mapping."
    );

    let captured = update_capture.lock().await;
    let update_body = captured
        .as_ref()
        .expect("network update should still have been called");
    assert_eq!(update_body["vmId"], AGENT_UUID);
}

// ===========================================================================
// Failure Path Tests
// ===========================================================================

#[tokio::test]
async fn create_remote_agent_fails_when_swarm_not_configured() {
    let db_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(RocksStore::open(db_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let network_url = start_mock_network_create_only(network_agent_json("remote", None)).await;

    let app = build_app_with_swarm(
        store,
        db_dir.path().to_path_buf(),
        &network_url,
        None, // swarm NOT configured
    );

    let req = json_request("POST", "/api/agents", Some(create_agent_body("remote")));
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);

    let body = response_json(resp).await;
    assert_eq!(body["code"], "service_unavailable");
}

#[tokio::test]
async fn create_remote_agent_fails_when_swarm_returns_error() {
    let db_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(RocksStore::open(db_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let network_url = start_mock_network_create_only(network_agent_json("remote", None)).await;

    let swarm_url = start_mock_swarm(
        StatusCode::INTERNAL_SERVER_ERROR,
        serde_json::json!({"error": "internal"}),
    )
    .await;

    let app = build_app_with_swarm(
        store,
        db_dir.path().to_path_buf(),
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
async fn recover_remote_agent_rejects_local_agents() {
    let db_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(RocksStore::open(db_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let network_url = start_mock_network_get_only(network_agent_json("local", None)).await;

    let app = build_app_with_swarm(store, db_dir.path().to_path_buf(), &network_url, None);

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
async fn recover_remote_agent_surfaces_swarm_errors() {
    let db_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(RocksStore::open(db_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let update_capture: Arc<tokio::sync::Mutex<Option<Value>>> =
        Arc::new(tokio::sync::Mutex::new(None));

    let network_url = start_mock_network_get_with_update(
        network_agent_json("remote", Some("old-vm")),
        "unused-vm".to_string(),
        update_capture.clone(),
    )
    .await;

    let swarm_url = start_mock_swarm(
        StatusCode::INTERNAL_SERVER_ERROR,
        serde_json::json!({"error": "internal"}),
    )
    .await;

    let app = build_app_with_swarm(
        store,
        db_dir.path().to_path_buf(),
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
        "network update should not run on failure"
    );
}

#[tokio::test]
async fn create_remote_agent_fails_when_swarm_returns_401() {
    let db_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(RocksStore::open(db_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let network_url = start_mock_network_create_only(network_agent_json("remote", None)).await;

    let swarm_url = start_mock_swarm(
        StatusCode::UNAUTHORIZED,
        serde_json::json!({"error": "unauthorized"}),
    )
    .await;

    let app = build_app_with_swarm(
        store,
        db_dir.path().to_path_buf(),
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
    let db_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(RocksStore::open(db_dir.path()).unwrap());
    store_zero_auth_session(&store);

    let network_url = start_mock_network_create_only(network_agent_json("remote", None)).await;

    let swarm_url =
        start_mock_swarm_raw(StatusCode::OK, r#"{"unexpected": true}"#.to_string()).await;

    let app = build_app_with_swarm(
        store,
        db_dir.path().to_path_buf(),
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
    let db_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(RocksStore::open(db_dir.path()).unwrap());
    store_zero_auth_session(&store);

    // Network: POST /api/agents succeeds, PUT /api/agents/:id returns 500
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
        db_dir.path().to_path_buf(),
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

// ===========================================================================
// Serde Contract Tests
// ===========================================================================

#[test]
fn network_agent_deserializes_vm_id() {
    let json = r#"{"id":"abc","name":"test","userId":"u1","vmId":"pod-123"}"#;
    let agent: aura_os_network::NetworkAgent = serde_json::from_str(json).unwrap();
    assert_eq!(agent.vm_id.as_deref(), Some("pod-123"));
}

#[test]
fn network_agent_deserializes_without_vm_id() {
    let json = r#"{"id":"abc","name":"test","userId":"u1"}"#;
    let agent: aura_os_network::NetworkAgent = serde_json::from_str(json).unwrap();
    assert_eq!(agent.vm_id, None);
}

#[test]
fn update_agent_request_serializes_vm_id() {
    let req = aura_os_network::UpdateAgentRequest {
        name: None,
        role: None,
        personality: None,
        system_prompt: None,
        skills: None,
        icon: None,
        harness: None,
        machine_type: None,
        vm_id: Some("pod-123".to_string()),
    };
    let val = serde_json::to_value(&req).unwrap();
    assert_eq!(val["vmId"], "pod-123");

    let obj = val.as_object().unwrap();
    assert_eq!(
        obj.len(),
        1,
        "only vmId should be serialized (skip_serializing_if = None), got keys: {:?}",
        obj.keys().collect::<Vec<_>>()
    );
}

#[test]
fn update_agent_request_skips_none_vm_id() {
    let req = aura_os_network::UpdateAgentRequest {
        name: None,
        role: None,
        personality: None,
        system_prompt: None,
        skills: None,
        icon: None,
        harness: None,
        machine_type: None,
        vm_id: None,
    };
    let val = serde_json::to_value(&req).unwrap();
    let obj = val.as_object().unwrap();
    assert!(
        !obj.contains_key("vmId"),
        "vmId should not appear when None, got: {val}"
    );
}

#[test]
fn swarm_create_agent_response_deserializes_pod_id() {
    let json = r#"{"agent_id":"a1","status":"running","pod_id":"pod-1"}"#;
    let resp: aura_os_link::CreateAgentResponse = serde_json::from_str(json).unwrap();
    assert_eq!(resp.agent_id, "a1");
    assert_eq!(resp.status, "running");
    assert_eq!(resp.pod_id.as_deref(), Some("pod-1"));
}

#[test]
fn swarm_create_agent_response_without_pod_id() {
    let json = r#"{"agent_id":"a1","status":"running"}"#;
    let resp: aura_os_link::CreateAgentResponse = serde_json::from_str(json).unwrap();
    assert_eq!(resp.agent_id, "a1");
    assert_eq!(resp.pod_id, None);
}
